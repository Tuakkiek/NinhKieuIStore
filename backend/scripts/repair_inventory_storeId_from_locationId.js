import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_CONNECTIONSTRING;
const DB_NAME = process.env.MONGODB_DB_NAME || "istore_dev";

if (!MONGODB_URI) {
  throw new Error("MONGODB_CONNECTIONSTRING is required");
}

const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("--dryrun");
const APPLY = process.argv.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.log(
    "Usage: node scripts/repair_inventory_storeId_from_locationId.js --dry-run | --apply"
  );
  process.exit(1);
}

const InventorySchema = new mongoose.Schema({}, { strict: false });
const WarehouseLocationSchema = new mongoose.Schema({}, { strict: false });

async function main() {
  const conn = await mongoose.createConnection(MONGODB_URI, { dbName: DB_NAME }).asPromise();
  const Inventory = conn.model("Inventory", InventorySchema, "inventories");
  const WarehouseLocation = conn.model("WarehouseLocation", WarehouseLocationSchema, "warehouselocations");

  console.log(`[repair-inventory-storeId] mode=${DRY_RUN ? "dry-run" : "apply"} db=${DB_NAME}`);

  const rows = await Inventory.find({ locationId: { $exists: true, $ne: null } })
    .select("_id storeId sku locationId locationCode quantity status updatedAt")
    .lean();

  console.log(`[repair-inventory-storeId] loaded inventory rows=${rows.length}`);

  const updates = [];
  const anomalies = [];

  for (const row of rows) {
    const location = await WarehouseLocation.findById(row.locationId)
      .select("_id storeId locationCode status")
      .lean();

    if (!location) {
      anomalies.push({ type: "missing-location", row });
      continue;
    }

    const rowStoreId = String(row.storeId || "");
    const locationStoreId = String(location.storeId || "");
    if (!rowStoreId || rowStoreId !== locationStoreId) {
      updates.push({
        _id: row._id,
        sku: row.sku,
        fromStoreId: rowStoreId,
        toStoreId: locationStoreId,
        locationId: row.locationId,
        locationCode: row.locationCode,
      });
    }
  }

  console.log(`[repair-inventory-storeId] mismatched rows=${updates.length}`);
  if (updates.length) {
    console.log(JSON.stringify(updates.slice(0, 25), null, 2));
    if (updates.length > 25) {
      console.log(`[repair-inventory-storeId] ...and ${updates.length - 25} more`);
    }
  }

  if (anomalies.length) {
    console.log(`[repair-inventory-storeId] rows with missing location=${anomalies.length}`);
    console.log(JSON.stringify(anomalies.slice(0, 25), null, 2));
  }

  if (DRY_RUN) {
    console.log("[repair-inventory-storeId] dry-run complete; no changes written");
    await conn.close();
    return;
  }

  if (!updates.length) {
    console.log("[repair-inventory-storeId] no updates needed");
    await conn.close();
    return;
  }

  const session = await conn.startSession();
  try {
    session.startTransaction();

    let modified = 0;
    for (const update of updates) {
      const result = await Inventory.updateOne(
        { _id: update._id },
        { $set: { storeId: new mongoose.Types.ObjectId(update.toStoreId) } },
        { session }
      );
      modified += result.modifiedCount || 0;
    }

    await session.commitTransaction();
    console.log(`[repair-inventory-storeId] updated rows=${modified}`);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
    await conn.close();
  }
}

main().catch((error) => {
  console.error("[repair-inventory-storeId] failed:", error);
  process.exit(1);
});
