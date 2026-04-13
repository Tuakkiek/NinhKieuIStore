import mongoose from "mongoose";
import { branchIsolationPlugin } from "../../authz/branchIsolationPlugin.js";
import {
  INVENTORY_STATES,
  SERVICE_STATES,
} from "./afterSalesConfig.js";

const reservedForSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    orderItemId: mongoose.Schema.Types.ObjectId,
    assignedAt: Date,
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    mode: {
      type: String,
      enum: ["MANUAL", "AUTO"],
      default: "AUTO",
    },
  },
  { _id: false }
);

const saleSnapshotSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    orderNumber: String,
    orderItemId: mongoose.Schema.Types.ObjectId,
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    customerName: String,
    customerPhone: String,
    soldAt: Date,
  },
  { _id: false }
);

const deviceSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    warehouseLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WarehouseLocation",
    },
    warehouseLocationCode: {
      type: String,
      trim: true,
      default: "",
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UniversalProduct",
      required: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UniversalVariant",
    },
    variantSku: {
      type: String,
      required: true,
      trim: true,
    },
    productName: {
      type: String,
      trim: true,
      required: true,
    },
    variantName: {
      type: String,
      trim: true,
      default: "",
    },
    basePrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    sellingPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    costPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    priceUpdatedAt: {
      type: Date,
    },
    imei: {
      type: String,
      trim: true,
      sparse: true,
    },
    imeiNormalized: {
      type: String,
      trim: true,
    },
    serialNumber: {
      type: String,
      trim: true,
      sparse: true,
    },
    serialNumberNormalized: {
      type: String,
      trim: true,
    },
    lookupKeys: [{ type: String, trim: true }],
    // Assignment context (IMEI/Serial is now typically captured at fulfillment time)
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    assignedAt: {
      type: Date,
    },
    inventoryState: {
      type: String,
      enum: Object.values(INVENTORY_STATES),
      default: INVENTORY_STATES.IN_STOCK,
      required: true,
    },
    serviceState: {
      type: String,
      enum: Object.values(SERVICE_STATES),
      default: SERVICE_STATES.NONE,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    reservedFor: reservedForSchema,
    saleSnapshot: saleSnapshotSchema,
    currentWarrantyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WarrantyRecord",
    },
  },
  { timestamps: true }
);

const hasSingleFieldIndex = (fieldName) =>
  deviceSchema.indexes().some(
    ([specification]) =>
      Object.keys(specification || {}).length === 1 && specification[fieldName] === 1
  );

deviceSchema.index({ storeId: 1, variantSku: 1, inventoryState: 1 });
deviceSchema.index({ storeId: 1, warehouseLocationId: 1 });
deviceSchema.index({ lookupKeys: 1 });
deviceSchema.index({ orderId: 1, orderItemId: 1, assignedAt: -1 });
if (!hasSingleFieldIndex("imeiNormalized")) {
  deviceSchema.index({ imeiNormalized: 1 }, { unique: true, sparse: true });
}
if (!hasSingleFieldIndex("serialNumberNormalized")) {
  deviceSchema.index({ serialNumberNormalized: 1 }, { unique: true, sparse: true });
}

deviceSchema.plugin(branchIsolationPlugin, { branchField: "storeId" });

export default mongoose.models.Device || mongoose.model("Device", deviceSchema);
