import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "../config/db.js";
import User from "../modules/auth/User.js";
import Store from "../modules/store/Store.js";
import { deriveAuthzWriteFromLegacyInput } from "../authz/userAccessResolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const TARGET_ROLES = new Set([
  "ADMIN",
  "BRANCH_ADMIN",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_STAFF",
  "PRODUCT_MANAGER",
  "ORDER_MANAGER",
  "POS_STAFF",
  "CASHIER",
  "SHIPPER",
]);

const normalizeText = (value) => String(value || "").trim();

const findHoChiMinhStoreId = async () => {
  const hcmRegex = /ho\s*chi\s*minh|tp\.?\s*hcm|sai\s*gon|^hcm$/i;
  const filter = {
    $or: [
      { code: /HCM/i },
      { name: hcmRegex },
      { "address.province": hcmRegex },
    ],
  };

  let store = await Store.findOne({ ...filter, status: "ACTIVE" }).select("_id").lean();
  if (!store) {
    store = await Store.findOne(filter).select("_id").lean();
  }
  return normalizeText(store?._id);
};

const run = async () => {
  try {
    await connectDB();
    console.log("Connected to database");

    const hcmStoreId = await findHoChiMinhStoreId();
    if (!hcmStoreId) {
      throw new Error("Không tìm thấy chi nhánh Hồ Chí Minh");
    }

    const query = {
      role: { $in: Array.from(TARGET_ROLES) },
      $or: [
        { storeLocation: { $exists: false } },
        { storeLocation: null },
        { storeLocation: "" },
        { storeLocation: /^\s+$/ },
      ],
    };

    const users = await User.find(query).select(
      "_id role storeLocation permissionsVersion systemRoles taskRoles branchAssignments authzState authzVersion",
    );

    if (users.length === 0) {
      console.log("No legacy employees missing storeLocation");
      return;
    }

    let updated = 0;

    for (const user of users) {
      const normalizedRole = normalizeText(user.role).toUpperCase();
      const authzWrite = deriveAuthzWriteFromLegacyInput({
        role: normalizedRole,
        storeLocation: hcmStoreId,
        assignedBy: undefined,
      });

      user.storeLocation = hcmStoreId;
      user.systemRoles = authzWrite.systemRoles;
      user.taskRoles = authzWrite.taskRoles;
      user.branchAssignments = authzWrite.branchAssignments;
      user.authzState = authzWrite.authzState;
      user.authzVersion = 2;
      user.permissionsVersion = Number(user.permissionsVersion || 1) + 1;

      await user.save();
      updated += 1;
    }

    console.log(`Updated ${updated} legacy employees to Ho Chi Minh branch (${hcmStoreId})`);
  } catch (error) {
    console.error("Backfill failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
