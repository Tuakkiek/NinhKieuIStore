import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

import { connectDB } from "../config/db.js";
import Inventory from "../modules/warehouse/Inventory.js";
import WarehouseLocation from "../modules/warehouse/WarehouseLocation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const SKIP = { skipBranchIsolation: true };

// ⚠️ bật false để chạy thật
const DRY_RUN = false;

// batch size
const BATCH_SIZE = 500;

const isMissing = (value) =>
  value === null || value === undefined || String(value).trim() === "";

const run = async () => {
  let totalScanned = 0;
  let totalDeleted = 0;
  let totalRepaired = 0;

  try {
    console.log("🚀 Starting inventory repair script...");
    await connectDB();

    // 👉 preload tất cả location (cực quan trọng)
    const locations = await WarehouseLocation.find({})
      .select("_id storeId")
      .lean()
      .setOptions(SKIP);

    const locationMap = new Map();
    for (const loc of locations) {
      locationMap.set(String(loc._id), loc.storeId);
    }

    console.log("✅ Loaded locations:", locationMap.size);

    const cursor = Inventory.find({
      $or: [
        { storeId: { $exists: false } },
        { storeId: null },
        { locationCode: /WH-ALL/i },
      ],
    })
      .select("_id storeId locationId locationCode")
      .lean()
      .setOptions(SKIP)
      .cursor();

    let bulkOps = [];

    for await (const row of cursor) {
      totalScanned++;

      const locationId = row?.locationId ? String(row.locationId) : null;

      // ❌ invalid location → delete
      if (
        isMissing(locationId) ||
        !mongoose.Types.ObjectId.isValid(locationId)
      ) {
        bulkOps.push({
          deleteOne: { filter: { _id: row._id } },
        });
        totalDeleted++;
        continue;
      }

      const correctStoreId = locationMap.get(locationId);

      // ❌ location không tồn tại → delete
      if (!correctStoreId) {
        bulkOps.push({
          deleteOne: { filter: { _id: row._id } },
        });
        totalDeleted++;
        continue;
      }

      // ✅ sai storeId → repair
      if (String(row.storeId) !== String(correctStoreId)) {
        bulkOps.push({
          updateOne: {
            filter: { _id: row._id },
            update: { $set: { storeId: correctStoreId } },
          },
        });
        totalRepaired++;
      }

      // 🚀 flush batch
      if (bulkOps.length >= BATCH_SIZE) {
        if (!DRY_RUN) {
          await Inventory.bulkWrite(bulkOps, { ordered: false });
        }

        console.log(
          `📦 Batch processed | scanned: ${totalScanned}, deleted: ${totalDeleted}, repaired: ${totalRepaired}`
        );

        bulkOps = [];
      }
    }

    // flush cuối
    if (bulkOps.length > 0 && !DRY_RUN) {
      await Inventory.bulkWrite(bulkOps, { ordered: false });
    }

    console.log("🎯 DONE");
    console.log(
      JSON.stringify(
        { totalScanned, totalDeleted, totalRepaired, DRY_RUN },
        null,
        2
      )
    );
  } catch (error) {
    console.error("❌ ERROR:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
