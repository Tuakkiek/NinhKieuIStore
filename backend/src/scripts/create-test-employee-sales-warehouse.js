/**
 * Script: create-test-employee-sales-warehouse.js
 * Tạo 1 nhân viên test có quyền bán hàng + lấy hàng (warehouse).
 *
 * Chạy: node src/scripts/create-test-employee-sales-warehouse.js
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "../config/db.js";
import User from "../modules/auth/User.js";
import Permission from "../modules/auth/Permission.js";
import UserPermission from "../modules/auth/UserPermission.js";
import Store from "../modules/store/Store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const normalize = (value) => String(value || "").trim();

const PERMISSIONS = [
  { key: "orders.read", scopeType: "BRANCH" },
  { key: "orders.write", scopeType: "BRANCH" },
  { key: "product.read", scopeType: "BRANCH" },
  { key: "device.read", scopeType: "BRANCH" },
  { key: "warranty.read", scopeType: "BRANCH" },
  { key: "inventory.read", scopeType: "BRANCH" },
  { key: "inventory.write", scopeType: "BRANCH" },
  { key: "warehouse.read", scopeType: "BRANCH" },
  { key: "warehouse.write", scopeType: "BRANCH" },
  { key: "analytics.read.personal", scopeType: "SELF" },
];

const run = async () => {
  await connectDB();

  const sampleStore = await Store.findOne({ status: "ACTIVE" })
    .select("_id name")
    .lean();
  if (!sampleStore) {
    throw new Error("Không tìm thấy chi nhánh ACTIVE để gán nhân viên.");
  }

  const branchId = String(sampleStore._id);
  const suffix = Date.now().toString().slice(-6);
  const phoneNumber = `0908${suffix}`;
  const email = `test.sales.warehouse.${suffix}@store.com`;
  const passwordText = "Test@12345";

  const existing = await User.findOne({ $or: [{ phoneNumber }, { email }] }).lean();
  if (existing) {
    await UserPermission.deleteMany({ userId: existing._id });
    await User.deleteOne({ _id: existing._id });
  }

  const user = await User.create({
    fullName: "Test - Sales + Warehouse",
    phoneNumber,
    email,
    password: passwordText,
    role: "POS_STAFF",
    province: "Ho Chi Minh",
    status: "ACTIVE",
    storeLocation: branchId,
    authzVersion: 2,
    authzState: "ACTIVE",
    systemRoles: [],
    taskRoles: [],
    branchAssignments: [
      {
        storeId: branchId,
        roles: ["POS_STAFF", "WAREHOUSE_STAFF"],
        status: "ACTIVE",
        isPrimary: true,
        assignedAt: new Date(),
      },
    ],
    permissionMode: "EXPLICIT",
    permissionsVersion: 1,
  });

  const allPerms = await Permission.find({ isActive: true })
    .select("_id key scopeType")
    .lean();
  const catalogMap = new Map(allPerms.map((p) => [normalize(p.key), p]));

  const grantRows = [];
  const missing = [];

  for (const { key, scopeType } of PERMISSIONS) {
    const perm = catalogMap.get(normalize(key));
    if (!perm) {
      missing.push(key);
      continue;
    }

    let scopeId = "";
    if (scopeType === "BRANCH") scopeId = branchId;
    else if (scopeType === "SELF") scopeId = String(user._id);

    grantRows.push({
      userId: user._id,
      permissionId: perm._id,
      scopeType,
      scopeId,
      status: "ACTIVE",
      grantedBy: null,
      grantedAt: new Date(),
      metadata: { source: "TEST_SCRIPT" },
    });
  }

  if (grantRows.length > 0) {
    await UserPermission.insertMany(grantRows, { ordered: false });
  }

  console.log("\n✅ Tạo nhân viên test thành công:");
  console.log(`- ID: ${user._id}`);
  console.log(`- Họ tên: ${user.fullName}`);
  console.log(`- SĐT: ${phoneNumber}`);
  console.log(`- Email: ${email}`);
  console.log(`- Mật khẩu: ${passwordText}`);
  console.log(`- Chi nhánh: ${sampleStore.name} (${branchId})`);
  console.log(`- Quyền được gán: ${grantRows.length}`);

  if (missing.length > 0) {
    console.log(`⚠️  Không tìm thấy trong catalog: ${missing.join(", ")}`);
  }

  process.exit(0);
};

run().catch((error) => {
  console.error("Script lỗi:", error);
  process.exit(1);
});
