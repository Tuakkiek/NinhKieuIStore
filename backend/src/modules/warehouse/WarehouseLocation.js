import mongoose from "mongoose";
import { branchIsolationPlugin } from "../../authz/branchIsolationPlugin.js";

const warehouseLocationSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },

    locationCode: {
      type: String,
      required: true,
      trim: true,
    },

    warehouse: {
      type: String,
      required: true,
      trim: true,
      default: "WH-HCM",
    },

    zone: {
      type: String,
      required: true,
      trim: true,
    },

    zoneName: {
      type: String,
      required: true,
      trim: true,
    },

    aisle: {
      type: String,
      required: true,
      trim: true,
    },

    shelf: {
      type: String,
      required: true,
      trim: true,
    },

    bin: {
      type: String,
      required: true,
      trim: true,
    },

    capacity: {
      type: Number,
      required: true,
      default: 100,
      min: 0,
    },

    currentLoad: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "MAINTENANCE"],
      default: "ACTIVE",
    },

    productCategories: [
      {
        type: String,
        trim: true,
      },
    ],

    qrCode: {
      type: String,
      trim: true,
    },

    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

warehouseLocationSchema.index({ storeId: 1, locationCode: 1 }, { unique: true });
warehouseLocationSchema.index({ storeId: 1, zone: 1, aisle: 1, shelf: 1, bin: 1 });
warehouseLocationSchema.index({ storeId: 1, status: 1 });
warehouseLocationSchema.index({ productCategories: 1 });

warehouseLocationSchema.virtual("fillRate").get(function fillRateGetter() {
  if (this.capacity === 0) return 0;
  return Math.round((this.currentLoad / this.capacity) * 100);
});

warehouseLocationSchema.methods.canAccommodate = function canAccommodate(quantity) {
  return this.currentLoad + quantity <= this.capacity;
};

warehouseLocationSchema.methods.addStock = async function addStock(quantity) {
  if (!this.canAccommodate(quantity)) {
    throw new Error("Vị trí không đủ chỗ");
  }
  this.currentLoad += quantity;
  await this.save();
};

warehouseLocationSchema.methods.removeStock = async function removeStock(quantity) {
  if (this.currentLoad < quantity) {
    throw new Error("Số lượng trong kho không đủ");
  }
  this.currentLoad -= quantity;
  await this.save();
};

warehouseLocationSchema.set("toJSON", { virtuals: true });
warehouseLocationSchema.set("toObject", { virtuals: true });

warehouseLocationSchema.plugin(branchIsolationPlugin, { branchField: "storeId" });

export default
  mongoose.models.WarehouseLocation ||
  mongoose.model("WarehouseLocation", warehouseLocationSchema);
