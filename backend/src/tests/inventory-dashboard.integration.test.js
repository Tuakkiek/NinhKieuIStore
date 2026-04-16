import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import inventoryRoutes from "../modules/inventory/inventoryRoutes.js";
import User from "../modules/auth/User.js";
import Store from "../modules/store/Store.js";
import StoreInventory from "../modules/inventory/StoreInventory.js";
import StockTransfer from "../modules/inventory/StockTransfer.js";
import StockMovement from "../modules/warehouse/StockMovement.js";
import UniversalProduct, {
  UniversalVariant,
} from "../modules/product/UniversalProduct.js";
import Order from "../modules/order/Order.js";
import ReplenishmentSnapshot from "../modules/inventory/ReplenishmentSnapshot.js";
import ReplenishmentRecommendation from "../modules/inventory/ReplenishmentRecommendation.js";
import Notification from "../modules/notification/Notification.js";
import OmnichannelEvent from "../modules/monitoring/OmnichannelEvent.js";
import config from "../config/config.js";
import Role from "../modules/auth/Role.js";
import { ROLE_PERMISSIONS } from "../authz/actions.js";
import { syncUserRoleAssignments } from "../authz/roleAssignmentService.js";

const ROLES = [
  "ADMIN",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_STAFF",
  "ORDER_MANAGER",
];

process.env.REPLENISHMENT_NOTIFICATIONS_ENABLED = "true";
process.env.OMNICHANNEL_MONITORING_ENABLED = "true";

const JWT_SECRET = config.JWT_SECRET;

let phoneSeed = 100000000;
let storeSeed = 1;
let skuSeed = 1;
let orderSeed = 1;

let replSet;
let app;
let fixture;

const nextPhone = () => `0${String(phoneSeed++).padStart(9, "0")}`;

const nextStoreCode = (prefix = "ST") =>
  `${prefix}${String(storeSeed++).padStart(3, "0")}`;

const nextSku = () => `SKU-TEST-${String(skuSeed++).padStart(5, "0")}`;

const nextOrderNumber = () => `ORD-TEST-${String(orderSeed++).padStart(6, "0")}`;

const authHeader = (role) => ({
  Authorization: `Bearer ${fixture.tokens[role]}`,
});

const mapRoleToAssignmentRole = (role) => {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "ADMIN") return "BRANCH_ADMIN";
  return normalized;
};

const ensureRoleDefinitions = async () => {
  const roleKeys = [
    "BRANCH_ADMIN",
    "WAREHOUSE_MANAGER",
    "WAREHOUSE_STAFF",
    "ORDER_MANAGER",
    "GLOBAL_ADMIN",
  ];

  for (const roleKey of roleKeys) {
    await Role.findOneAndUpdate(
      { key: roleKey },
      {
        key: roleKey,
        name: roleKey,
        description: `Test role ${roleKey}`,
        permissions: ROLE_PERMISSIONS[roleKey] || [],
        scopeType: roleKey === "GLOBAL_ADMIN" ? "GLOBAL" : "BRANCH",
        isSystem: roleKey === "GLOBAL_ADMIN",
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
};

const createUserByRole = async ({ role, assignedStoreIds = [] }) => {
  const roleAssignments = assignedStoreIds.map((storeId, index) => ({
    storeId,
    roles: [mapRoleToAssignmentRole(role)],
    status: "ACTIVE",
    isPrimary: index === 0,
  }));

  const user = await User.create({
    role,
    fullName: `${role} User`,
    phoneNumber: nextPhone(),
    email: `${role.toLowerCase()}@test.local`,
    password: "Strong@1234",
    status: "ACTIVE",
    storeLocation: assignedStoreIds[0] ? String(assignedStoreIds[0]) : "",
    authzVersion: 2,
    branchAssignments: roleAssignments,
  });

  await syncUserRoleAssignments({
    user,
    assignments: assignedStoreIds.map((storeId) => ({
      roleKey: mapRoleToAssignmentRole(role),
      scopeType: "BRANCH",
      scopeRef: String(storeId),
    })),
    primaryBranchId: String(assignedStoreIds[0] || ""),
    reason: "inventory_dashboard_test_seed",
  });

  return user;
};

const createGlobalAdmin = async () => {
  const user = await User.create({
    role: "GLOBAL_ADMIN",
    systemRoles: ["GLOBAL_ADMIN"],
    fullName: "GLOBAL_ADMIN User",
    phoneNumber: nextPhone(),
    email: "global_admin@test.local",
    password: "Strong@1234",
    status: "ACTIVE",
    authzVersion: 2,
  });

  await syncUserRoleAssignments({
    user,
    assignments: [{ roleKey: "GLOBAL_ADMIN", scopeType: "GLOBAL", scopeRef: "" }],
    reason: "inventory_dashboard_test_seed",
  });

  return user;
};

const createStore = async ({ name, code }) =>
  Store.create({
    code,
    name,
    type: "STORE",
    status: "ACTIVE",
    address: {
      province: "Ho Chi Minh",
      district: "District 1",
      street: "Test Street",
    },
    capacity: {
      maxOrdersPerDay: 100,
      currentOrders: 0,
    },
  });

const seedFixture = async () => {
  const sourceStore = await createStore({
    name: "Source Store",
    code: nextStoreCode("SRC"),
  });
  const targetStore = await createStore({
    name: "Target Store",
    code: nextStoreCode("DST"),
  });
  const extraStore = await createStore({
    name: "Extra Store",
    code: nextStoreCode("EXT"),
  });

  const users = {};
  for (const role of ROLES) {
    users[role] = await createUserByRole({
      role,
      assignedStoreIds: [targetStore._id, sourceStore._id],
    });
  }
  users.GLOBAL_ADMIN = await createGlobalAdmin();

  const product = await UniversalProduct.create({
    name: "Integration Test Phone",
    model: "ITP-01",
    baseSlug: `integration-test-phone-${skuSeed}`,
    slug: `integration-test-phone-${skuSeed}`,
    brand: new mongoose.Types.ObjectId(),
    productType: new mongoose.Types.ObjectId(),
    condition: "NEW",
    createdBy: users.ADMIN._id,
  });

  const variantSku = nextSku();
  const variant = await UniversalVariant.create({
    color: "Black",
    variantName: "128GB",
    originalPrice: 30000000,
    price: 27000000,
    stock: 0,
    images: [],
    sku: variantSku,
    slug: `${product.baseSlug}-${variantSku.toLowerCase()}`,
    productId: product._id,
    attributes: {
      storage: "128GB",
    },
  });

  await StoreInventory.create({
    productId: product._id,
    variantSku: variant.sku,
    storeId: sourceStore._id,
    quantity: 60,
    reserved: 0,
    minStock: 10,
  });

  await StoreInventory.create({
    productId: product._id,
    variantSku: variant.sku,
    storeId: targetStore._id,
    quantity: 0,
    reserved: 0,
    minStock: 10,
  });

  await StoreInventory.create({
    productId: product._id,
    variantSku: variant.sku,
    storeId: extraStore._id,
    quantity: 45,
    reserved: 0,
    minStock: 10,
  });

  for (let dayOffset = 0; dayOffset < 6; dayOffset += 1) {
    await Order.create({
      userId: users.ORDER_MANAGER._id,
      customerId: users.ORDER_MANAGER._id,
      orderNumber: nextOrderNumber(),
      fulfillmentType: "HOME_DELIVERY",
      paymentMethod: "COD",
      paymentStatus: "PAID",
      status: "COMPLETED",
      assignedStore: {
        storeId: targetStore._id,
        storeName: targetStore.name,
        storeCode: targetStore.code,
      },
      items: [
        {
          productId: product._id,
          variantSku: variant.sku,
          name: "Integration Test Phone",
          productName: "Integration Test Phone",
          price: 27000000,
          quantity: 3,
        },
      ],
      createdAt: new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000),
    });
  }

  return {
    users,
    stores: {
      sourceStore,
      targetStore,
      extraStore,
    },
    product,
    variant,
    tokens: Object.fromEntries(
      [...ROLES, "GLOBAL_ADMIN"].map((role) => [
        role,
        jwt.sign(
          {
            id: String(users[role]._id),
            pv: Number(users[role].permissionsVersion || 1),
          },
          JWT_SECRET,
          { expiresIn: "1h" }
        ),
      ])
    ),
  };
};

const clearAllCollections = async () => {
  const collections = Object.values(mongoose.connection.collections);
  for (const collection of collections) {
    await collection.deleteMany({});
  }
};

before(
  async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
      },
    });

    await mongoose.connect(replSet.getUri(), {
      dbName: "inventory-dashboard-integration",
    });

    app = express();
    app.use(express.json());
    app.use("/api/inventory", inventoryRoutes);
    app.use((err, req, res, next) => {
      if (res.headersSent) {
        return next(err);
      }
      return res.status(500).json({
        success: false,
        message: err.message || "Unhandled test error",
      });
    });
  },
  { timeout: 180000 }
);

beforeEach(async () => {
  await clearAllCollections();
  await ensureRoleDefinitions();
  fixture = await seedFixture();
});

after(
  async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  },
  { timeout: 120000 }
);

test("role permissions matrix for targeted dashboard + transfer endpoints", async () => {
  const fakeTransferId = new mongoose.Types.ObjectId().toString();
  const rolesToCheck = [...ROLES, "GLOBAL_ADMIN"];

  const cases = [
    {
      name: "GET /dashboard/replenishment",
      method: "get",
      path: "/api/inventory/dashboard/replenishment",
      allowed: ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "GLOBAL_ADMIN"],
    },
    {
      name: "POST /dashboard/replenishment/run-snapshot",
      method: "post",
      path: "/api/inventory/dashboard/replenishment/run-snapshot",
      allowed: ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "GLOBAL_ADMIN"],
      expectAllowedStatus: 200,
      body: {},
    },
    {
      name: "GET /dashboard/predictions",
      method: "get",
      path: "/api/inventory/dashboard/predictions",
      allowed: ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "GLOBAL_ADMIN"],
    },
    {
      name: "POST /transfers/request",
      method: "post",
      path: "/api/inventory/transfers/request",
      allowed: ["GLOBAL_ADMIN"],
      body: {},
    },
    {
      name: "PUT /transfers/:id/approve",
      method: "put",
      path: `/api/inventory/transfers/${fakeTransferId}/approve`,
      allowed: rolesToCheck,
      expectAllowedStatus: 410,
      body: {},
    },
    {
      name: "PUT /transfers/:id/reject",
      method: "put",
      path: `/api/inventory/transfers/${fakeTransferId}/reject`,
      allowed: rolesToCheck,
      expectAllowedStatus: 410,
      body: { reason: "Not needed" },
    },
    {
      name: "PUT /transfers/:id/confirm-shipment",
      method: "put",
      path: `/api/inventory/transfers/${fakeTransferId}/confirm-shipment`,
      allowed: ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "GLOBAL_ADMIN"],
      body: { trackingNumber: "TN", carrier: "Carrier" },
    },
    {
      name: "PUT /transfers/:id/confirm-received",
      method: "put",
      path: `/api/inventory/transfers/${fakeTransferId}/confirm-received`,
      allowed: ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "GLOBAL_ADMIN"],
      body: { notes: "Received" },
    },
    {
      name: "PUT /transfers/:id/cancel",
      method: "put",
      path: `/api/inventory/transfers/${fakeTransferId}/cancel`,
      allowed: ["GLOBAL_ADMIN"],
      body: { reason: "Cancel test" },
    },
  ];

  for (const endpoint of cases) {
    for (const role of rolesToCheck) {
      let req = request(app)[endpoint.method](endpoint.path).set(authHeader(role));
      if (endpoint.body !== undefined) {
        req = req.send(endpoint.body);
      }

      const response = await req;
      const shouldAllow = endpoint.allowed.includes(role);

      if (!shouldAllow) {
        assert.equal(
          response.status,
          403,
          `${endpoint.name} should reject role ${role}`
        );
        continue;
      }

      assert.notEqual(
        response.status,
        401,
        `${endpoint.name} should authenticate role ${role}`
      );
      assert.notEqual(
        response.status,
        403,
        `${endpoint.name} should authorize role ${role}`
      );

      if (endpoint.expectAllowedStatus) {
        assert.equal(
          response.status,
          endpoint.expectAllowedStatus,
          `${endpoint.name} should return ${endpoint.expectAllowedStatus} for ${role}`
        );
      }
    }
  }
});

test("POST /dashboard/replenishment/run-snapshot and GET /dashboard/replenishment return persisted snapshot", async () => {
  const snapshotResponse = await request(app)
    .post("/api/inventory/dashboard/replenishment/run-snapshot")
    .set(authHeader("ADMIN"))
    .send({});

  assert.equal(snapshotResponse.status, 200);
  assert.equal(snapshotResponse.body.success, true);
  assert.equal(snapshotResponse.body.result.success, true);
  assert.equal(snapshotResponse.body.result.skipped, false);

  const snapshots = await ReplenishmentSnapshot.find().lean();
  const recommendations = await ReplenishmentRecommendation.find().lean();
  assert.equal(snapshots.length, 1);
  assert.ok(recommendations.length > 0);

  const notification = await Notification.findOne({
    eventType: "REPLENISHMENT_CRITICAL_DAILY",
  }).lean();
  assert.ok(notification, "Critical replenishment notification should be created");

  const readResponse = await request(app)
    .get("/api/inventory/dashboard/replenishment")
    .set(authHeader("WAREHOUSE_MANAGER"));

  assert.equal(readResponse.status, 200);
  assert.equal(readResponse.body.success, true);
  assert.equal(readResponse.body.dataSource, "SNAPSHOT");
  assert.ok(readResponse.body.snapshot?.snapshotDateKey);
  assert.ok(readResponse.body.recommendations.length > 0);

  const liveResponse = await request(app)
    .get("/api/inventory/dashboard/replenishment?source=live&criticalOnly=1")
    .set(authHeader("WAREHOUSE_STAFF"));

  assert.equal(liveResponse.status, 200);
  assert.equal(liveResponse.body.success, true);
  assert.equal(liveResponse.body.dataSource, "LIVE");
  assert.ok(Array.isArray(liveResponse.body.recommendations));
  assert.ok(
    liveResponse.body.recommendations.every(
      (item) => String(item.priority || "").toUpperCase() === "CRITICAL"
    )
  );
});

test("GET /dashboard/predictions returns demand analysis payload", async () => {
  const response = await request(app)
    .get(
      `/api/inventory/dashboard/predictions?storeId=${fixture.stores.targetStore._id}&daysAhead=14&historicalDays=90`
    )
    .set(authHeader("ADMIN"));

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(Array.isArray(response.body.predictions));
  assert.ok(response.body.predictions.length > 0);

  const targetPrediction = response.body.predictions.find(
    (item) =>
      String(item.variantSku).toUpperCase() ===
      String(fixture.variant.sku).toUpperCase()
  );

  assert.ok(targetPrediction, "Prediction for seeded SKU should exist");
  assert.ok(targetPrediction.predictedDemand >= 1);
  assert.ok(targetPrediction.suggestedReplenishment >= 0);
  assert.equal(
    String(targetPrediction.storeId),
    String(fixture.stores.targetStore._id)
  );
});

test("transfer lifecycle: request -> confirm-shipment -> confirm-received", async () => {
  const requestedQuantity = 5;

  const requestResponse = await request(app)
    .post("/api/inventory/transfers/request")
    .set(authHeader("GLOBAL_ADMIN"))
    .send({
      fromStoreId: fixture.stores.sourceStore._id,
      toStoreId: fixture.stores.targetStore._id,
      reason: "RESTOCK",
      notes: "Lifecycle integration test",
      items: [
        {
          variantSku: fixture.variant.sku,
          requestedQuantity,
        },
      ],
    });

  assert.equal(
    requestResponse.status,
    201,
    `request failed: ${JSON.stringify(requestResponse.body)}`
  );
  assert.equal(requestResponse.body.success, true);
  assert.equal(requestResponse.body.transfer.status, "CREATED");

  const transferId = requestResponse.body.transfer._id;

  const sourceAfterCreate = await StoreInventory.findOne({
    storeId: fixture.stores.sourceStore._id,
    productId: fixture.product._id,
    variantSku: fixture.variant.sku,
  })
    .setOptions({ skipBranchIsolation: true })
    .lean();
  assert.equal(sourceAfterCreate.quantity, 60);
  assert.equal(sourceAfterCreate.reserved, 0);

  const shipResponse = await request(app)
    .put(`/api/inventory/transfers/${transferId}/confirm-shipment`)
    .set(authHeader("WAREHOUSE_STAFF"))
    .send({
      trackingNumber: "TRK-123",
      carrier: "InternalCarrier",
    });

  assert.equal(shipResponse.status, 200);
  assert.equal(shipResponse.body.success, true);
  assert.equal(shipResponse.body.transfer.status, "IN_TRANSIT");

  const sourceAfterShipment = await StoreInventory.findOne({
    storeId: fixture.stores.sourceStore._id,
    productId: fixture.product._id,
    variantSku: fixture.variant.sku,
  })
    .setOptions({ skipBranchIsolation: true })
    .lean();
  assert.equal(sourceAfterShipment.quantity, 60);
  assert.equal(sourceAfterShipment.reserved, 0);

  const receiveResponse = await request(app)
    .put(`/api/inventory/transfers/${transferId}/confirm-received`)
    .set(authHeader("WAREHOUSE_STAFF"))
    .send({
      notes: "Received in full",
    });

  assert.equal(receiveResponse.status, 200);
  assert.equal(receiveResponse.body.success, true);
  assert.equal(receiveResponse.body.transfer.status, "COMPLETED");

  const sourceAfterReceive = await StoreInventory.findOne({
    storeId: fixture.stores.sourceStore._id,
    productId: fixture.product._id,
    variantSku: fixture.variant.sku,
  })
    .setOptions({ skipBranchIsolation: true })
    .lean();
  assert.equal(sourceAfterReceive.quantity, 60 - requestedQuantity);
  assert.equal(sourceAfterReceive.reserved, 0);

  const destinationAfterReceive = await StoreInventory.findOne({
    storeId: fixture.stores.targetStore._id,
    productId: fixture.product._id,
    variantSku: fixture.variant.sku,
  })
    .setOptions({ skipBranchIsolation: true })
    .lean();
  assert.equal(destinationAfterReceive.quantity, requestedQuantity);
  assert.equal(destinationAfterReceive.available, requestedQuantity);

  const transfer = await StockTransfer.findById(transferId).lean();
  assert.equal(transfer.status, "COMPLETED");
  assert.equal(transfer.items[0].confirmedQuantity, requestedQuantity);
  assert.equal(transfer.items[0].receivedQuantity, requestedQuantity);

  const movements = await StockMovement.find({
    referenceType: "TRANSFER",
    referenceId: transfer.transferNumber,
  })
    .sort({ createdAt: 1 })
    .lean();

  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantity, requestedQuantity);
});

test("deprecated approve/reject endpoints return 410 and cancel leaves stock untouched", async () => {
  const requestResponse = await request(app)
    .post("/api/inventory/transfers/request")
    .set(authHeader("GLOBAL_ADMIN"))
    .send({
      fromStoreId: fixture.stores.sourceStore._id,
      toStoreId: fixture.stores.targetStore._id,
      reason: "RESTOCK",
      items: [
        {
          variantSku: fixture.variant.sku,
          requestedQuantity: 3,
        },
      ],
    });

  assert.equal(requestResponse.status, 201);
  const transferId = requestResponse.body.transfer._id;

  const approveResponse = await request(app)
    .put(`/api/inventory/transfers/${transferId}/approve`)
    .set(authHeader("WAREHOUSE_MANAGER"))
    .send({});
  assert.equal(approveResponse.status, 410);

  const rejectResponse = await request(app)
    .put(`/api/inventory/transfers/${transferId}/reject`)
    .set(authHeader("ADMIN"))
    .send({ reason: "Deprecated path" });
  assert.equal(rejectResponse.status, 410);

  const sourceBeforeCancel = await StoreInventory.findOne({
    storeId: fixture.stores.sourceStore._id,
    productId: fixture.product._id,
    variantSku: fixture.variant.sku,
  })
    .setOptions({ skipBranchIsolation: true })
    .lean();
  assert.equal(sourceBeforeCancel.quantity, 60);
  assert.equal(sourceBeforeCancel.reserved, 0);

  const cancelResponse = await request(app)
    .put(`/api/inventory/transfers/${transferId}/cancel`)
    .set(authHeader("GLOBAL_ADMIN"))
    .send({
      reason: "Cancelled for test",
    });

  assert.equal(cancelResponse.status, 200);
  assert.equal(cancelResponse.body.transfer.status, "CANCELLED");

  const sourceAfterCancel = await StoreInventory.findOne({
    storeId: fixture.stores.sourceStore._id,
    productId: fixture.product._id,
    variantSku: fixture.variant.sku,
  })
    .setOptions({ skipBranchIsolation: true })
    .lean();
  assert.equal(sourceAfterCancel.quantity, 60);
  assert.equal(sourceAfterCancel.reserved, 0);
});

test("integration checks: consolidated/store-comparison/alerts/movements respond successfully", async () => {
  const healthChecks = [
    { path: "/api/inventory/dashboard/consolidated", role: "ADMIN" },
    { path: "/api/inventory/dashboard/store-comparison", role: "GLOBAL_ADMIN" },
    { path: "/api/inventory/dashboard/alerts", role: "ADMIN" },
    { path: "/api/inventory/dashboard/movements", role: "ADMIN" },
    { path: "/api/inventory/transfers", role: "ADMIN" },
  ];

  for (const check of healthChecks) {
    const response = await request(app).get(check.path).set(authHeader(check.role));
    assert.equal(response.status, 200, `${check.path} should return 200`);
    assert.equal(response.body.success, true, `${check.path} should return success=true`);
  }
});

test("scheduler job function creates snapshot and recommendation docs", async () => {
  const { runReplenishmentSnapshotJob } = await import(
    "../modules/inventory/replenishmentScheduler.js"
  );

  const result = await runReplenishmentSnapshotJob({
    source: "MANUAL",
    initiatedBy: String(fixture.users.ADMIN._id),
  });

  assert.equal(result.success, true);
  assert.equal(result.skipped, false);

  const snapshot = await ReplenishmentSnapshot.findOne({
    snapshotDateKey: result.snapshotDateKey,
  }).lean();
  assert.ok(snapshot);

  const recommendationCount = await ReplenishmentRecommendation.countDocuments({
    snapshotId: snapshot._id,
  });
  assert.ok(recommendationCount > 0);

  const eventCount = await OmnichannelEvent.countDocuments({
    operation: "inventory_replenishment_notifications",
  });
  assert.ok(eventCount >= 1);
});
