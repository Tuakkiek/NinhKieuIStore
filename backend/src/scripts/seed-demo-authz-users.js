#!/usr/bin/env node
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const MONGO_URI = process.env.MONGODB_CONNECTIONSTRING;
if (!MONGO_URI) {
  console.error("MONGODB_CONNECTIONSTRING not set");
  process.exit(1);
}

const DRY_RUN = String(process.env.DRY_RUN || "").toLowerCase() === "true";
const DEFAULT_PASSWORD = process.env.DEMO_USER_PASSWORD || "Password@123";
const DEFAULT_PASSWORD_HASH = await bcrypt.hash(DEFAULT_PASSWORD, 10);
const DEFAULT_BRANCH_CODES = ["BRANCH_1", "BRANCH_2", "BRANCH_3"];

await mongoose.connect(MONGO_URI);
console.log("Connected to MongoDB");

const UserSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const RoleSchema = new mongoose.Schema({}, { strict: false, collection: "roles" });
const AssignmentSchema = new mongoose.Schema({}, { strict: false, collection: "userroleassignments" });
const StoreSchema = new mongoose.Schema({}, { strict: false, collection: "stores" });

const User = mongoose.model("DemoSeedUser", UserSchema);
const Role = mongoose.model("DemoSeedRole", RoleSchema);
const UserRoleAssignment = mongoose.model("DemoSeedUserRoleAssignment", AssignmentSchema);
const Store = mongoose.model("DemoSeedStore", StoreSchema);

const normalize = (value) => String(value || "").trim();
const normalizeRoleKey = (value) => normalize(value).toUpperCase();
const normalizeCode = (value) => normalize(value).toUpperCase();
const now = new Date();

const demoUsers = [
  {
    fullName: "POS_Warehouse_Staff",
    phoneNumber: "0909000001",
    email: "pos_warehouse_staff@demo.store",
    province: "Ho Chi Minh",
    role: "POS_STAFF",
    branchCodes: ["BRANCH_1"],
    branchRoles: ["POS_STAFF", "WAREHOUSE_STAFF"],
    systemRoles: [],
  },
  {
    fullName: "Order_Product_Manager",
    phoneNumber: "0909000002",
    email: "order_product_manager@demo.store",
    province: "Ho Chi Minh",
    role: "ORDER_MANAGER",
    branchCodes: ["BRANCH_2"],
    branchRoles: ["ORDER_MANAGER", "PRODUCT_MANAGER"],
    systemRoles: [],
  },
  {
    fullName: "Branch_Admin_Demo",
    phoneNumber: "0909000003",
    email: "branch_admin_demo@demo.store",
    province: "Ho Chi Minh",
    role: "BRANCH_ADMIN",
    branchCodes: ["BRANCH_3"],
    branchRoles: ["BRANCH_ADMIN"],
    systemRoles: [],
  },
  {
    fullName: "Global_Admin_Demo",
    phoneNumber: "0909000004",
    email: "global_admin_demo@demo.store",
    province: "Ho Chi Minh",
    role: "GLOBAL_ADMIN",
    branchCodes: ["BRANCH_1"],
    branchRoles: ["GLOBAL_ADMIN"],
    systemRoles: ["GLOBAL_ADMIN"],
  },
];

const findStoreByAnyIdentifier = async (value) => {
  const identifier = normalize(value);
  if (!identifier) return null;

  const queries = [];
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    queries.push({ _id: new mongoose.Types.ObjectId(identifier) });
  }

  queries.push({ code: identifier }, { name: identifier });

  for (const query of queries) {
    try {
      const store = await Store.findOne(query).lean();
      if (store?._id) return store;
    } catch (error) {
      // Ignore cast/query errors from malformed identifiers and continue searching.
      continue;
    }
  }

  return null;
};

const ensureDemoBranch = async (branchCode, index) => {
  const normalizedCode = normalizeCode(branchCode);
  const existing = await findStoreByAnyIdentifier(normalizedCode);
  if (existing?._id) {
    return existing;
  }

  const fallbackProvince = ["Ho Chi Minh", "Ha Noi", "Da Nang"][index % 3];
  const fallbackDistrict = `Demo District ${index + 1}`;
  const fallbackStreet = `Demo Street ${index + 1}`;

  if (DRY_RUN) {
    const synthetic = {
      _id: `dry-run-${normalizedCode}`,
      code: normalizedCode,
      name: `${normalizedCode} Demo Branch`,
    };
    console.log(`[dry-run] would create branch ${normalizedCode}`);
    return synthetic;
  }

  const created = await Store.create({
    code: normalizedCode,
    name: `${normalizedCode} Demo Branch`,
    type: "STORE",
    address: {
      province: fallbackProvince,
      district: fallbackDistrict,
      ward: "Demo Ward",
      street: fallbackStreet,
    },
    phone: `09000010${index}`,
    email: `${normalizedCode.toLowerCase()}@demo.store`,
    status: "ACTIVE",
    isHeadquarters: index === 0,
    services: {
      clickAndCollect: true,
      homeDelivery: true,
      installation: false,
      warranty: true,
      tradeIn: true,
      installment: true,
    },
  });

  console.log(`Created demo branch ${normalizedCode} -> ${created._id}`);
  return created.toObject ? created.toObject() : created;
};

const resolveBranch = async (branchCode, fallbackStore) => {
  const normalizedCode = normalizeCode(branchCode);
  const found = await findStoreByAnyIdentifier(normalizedCode);
  if (found?._id) {
    return found;
  }
  return fallbackStore;
};

const roleDocs = await Role.find({ isActive: { $ne: false } }).select("_id key permissions").lean();
const roleMap = new Map(roleDocs.map((role) => [normalizeRoleKey(role.key), String(role._id)]));

const requiredRoles = ["GLOBAL_ADMIN", "BRANCH_ADMIN", "POS_STAFF", "WAREHOUSE_STAFF", "ORDER_MANAGER", "PRODUCT_MANAGER"];
if (!DRY_RUN) {
  for (const roleKey of requiredRoles) {
    if (roleMap.has(roleKey)) continue;
    const created = await Role.create({
      key: roleKey,
      name: roleKey.replaceAll("_", " "),
      description: `Demo role ${roleKey}`,
      permissions: [],
      scopeType: roleKey === "GLOBAL_ADMIN" ? "GLOBAL" : "BRANCH",
      isSystem: true,
      isActive: true,
      metadata: { source: "demo_seed" },
    });
    roleMap.set(roleKey, String(created._id));
    console.log(`Created fallback role ${roleKey}`);
  }
}

const demoBranchStores = new Map();
for (let i = 0; i < DEFAULT_BRANCH_CODES.length; i += 1) {
  const code = DEFAULT_BRANCH_CODES[i];
  const store = await ensureDemoBranch(code, i);
  demoBranchStores.set(code, store);
}

const upsertedUsers = [];
let created = 0;
let updated = 0;
let assignmentsCreated = 0;

for (const demoUser of demoUsers) {
  const assignedBranchStores = [];
  for (const branchCode of demoUser.branchCodes || []) {
    let store = await resolveBranch(branchCode, demoBranchStores.get(DEFAULT_BRANCH_CODES[0]));
    if (!store?._id) {
      store = demoBranchStores.get(DEFAULT_BRANCH_CODES[0]);
    }
    assignedBranchStores.push(store);
    console.log(`Assigning ${demoUser.fullName} -> branch ${normalizeCode(branchCode)} (${store.code || store.name || store._id})`);
  }

  if (!assignedBranchStores.length) {
    const fallbackStore = demoBranchStores.get(DEFAULT_BRANCH_CODES[0]);
    assignedBranchStores.push(fallbackStore);
    console.log(`Assigning ${demoUser.fullName} -> fallback branch ${fallbackStore.code || fallbackStore.name || fallbackStore._id}`);
  }

  const branchAssignments = assignedBranchStores.map((store, index) => ({
    storeId: store._id,
    roles: index === 0 ? demoUser.branchRoles : [demoUser.branchRoles[0] || demoUser.role],
    status: "ACTIVE",
    isPrimary: index === 0,
    assignedAt: now,
  }));

  const userPayload = {
    fullName: demoUser.fullName,
    phoneNumber: normalize(demoUser.phoneNumber),
    email: normalize(demoUser.email).toLowerCase(),
    province: demoUser.province,
    password: DEFAULT_PASSWORD_HASH,
    status: "ACTIVE",
    authzState: "ACTIVE",
    authzVersion: 2,
    authorizationVersion: 1,
    permissionsVersion: 1,
    permissionMode: "ROLE_FALLBACK",
    permissions: [],
    roles: [],
    systemRoles: Array.isArray(demoUser.systemRoles) ? demoUser.systemRoles.map(normalizeRoleKey) : [],
    taskRoles: [],
    branchAssignments,
    role: demoUser.role,
    storeLocation: assignedBranchStores[0]?._id || "",
    emailVerified: false,
    emailVerifiedAt: null,
    stepUpConfig: {
      preferredMethod: "EMAIL",
      totpSecret: null,
      totpEnabled: false,
    },
  };

  if (DRY_RUN) {
    console.log(`[dry-run] would upsert user ${demoUser.fullName}`);
    continue;
  }

  const existing = await User.findOne({
    $or: [
      { phoneNumber: userPayload.phoneNumber },
      { email: userPayload.email },
    ],
  }).lean();

  const result = await User.findOneAndUpdate(
    { _id: existing?._id || new mongoose.Types.ObjectId() },
    {
      $set: userPayload,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (existing?._id) updated += 1;
  else created += 1;
  upsertedUsers.push(result);

  await UserRoleAssignment.updateMany(
    { userId: result._id, status: "ACTIVE" },
    { $set: { status: "REVOKED", expiresAt: now } },
  );

  const activeAssignments = [];
  for (const branchAssignment of branchAssignments) {
    for (const roleKey of branchAssignment.roles || []) {
      const normalizedRoleKey = normalizeRoleKey(roleKey);
      const roleId = roleMap.get(normalizedRoleKey);
      if (!roleId) {
        throw new Error(`Missing role document for ${normalizedRoleKey}`);
      }
      activeAssignments.push({
        userId: result._id,
        roleId,
        roleKey: normalizedRoleKey,
        scopeType: "BRANCH",
        scopeRef: String(branchAssignment.storeId),
        status: "ACTIVE",
        assignedAt: now,
        metadata: {
          source: "demo_seed",
          user: demoUser.fullName,
        },
      });
    }
  }

  for (const systemRole of demoUser.systemRoles || []) {
    const normalizedSystemRole = normalizeRoleKey(systemRole);
    const roleId = roleMap.get(normalizedSystemRole);
    if (!roleId) {
      throw new Error(`Missing role document for ${normalizedSystemRole}`);
    }
    activeAssignments.push({
      userId: result._id,
      roleId,
      roleKey: normalizedSystemRole,
      scopeType: "GLOBAL",
      scopeRef: "",
      status: "ACTIVE",
      assignedAt: now,
      metadata: {
        source: "demo_seed",
        user: demoUser.fullName,
      },
    });
  }

  await UserRoleAssignment.insertMany(activeAssignments, { ordered: true });
  assignmentsCreated += activeAssignments.length;
}

console.log("Demo authz users seeded successfully");
console.log({
  dryRun: DRY_RUN,
  created,
  updated,
  assignmentsCreated,
  password: DEFAULT_PASSWORD,
});

await mongoose.disconnect();
process.exit(0);
