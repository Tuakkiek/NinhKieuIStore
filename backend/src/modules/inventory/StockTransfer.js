import mongoose from "mongoose";

const stockTransferSchema = new mongoose.Schema(
  {
    transferNumber: {
      type: String,
      unique: true,
      trim: true,
    },

    fromStore: {
      storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Store",
        required: true,
      },
      storeName: String,
      storeCode: String,
    },

    toStore: {
      storeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Store",
        required: true,
      },
      storeName: String,
      storeCode: String,
    },

    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "UniversalProduct",
        },
        variantSku: String,
        name: String,
        image: String,
        requestedQuantity: Number,
        approvedQuantity: {
          type: Number,
          default: 0,
        },
        receivedQuantity: {
          type: Number,
          default: 0,
        },
        confirmedQuantity: {
          type: Number,
          default: 0,
        },
        condition: {
          type: String,
          enum: ["NEW", "GOOD", "DAMAGED"],
          default: "NEW",
        },
      },
    ],

    reason: {
      type: String,
      enum: ["RESTOCK", "BALANCE", "CUSTOMER_REQUEST", "RETURN", "DEFECTIVE"],
      required: true,
    },

    notes: String,

    status: {
      type: String,
      enum: [
        "CREATED",
        "WAITING_FOR_PICKUP",
        "IN_TRANSIT",
        "COMPLETED",
        "CANCELLED",
        // Legacy statuses kept so old records still validate if re-saved.
        "PENDING",
        "APPROVED",
        "REJECTED",
        "RECEIVED",
      ],
      default: "CREATED",
    },

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: Date,

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rejectedAt: Date,
    rejectionReason: String,

    shippedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    shippedAt: Date,

    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    receivedAt: Date,

    trackingNumber: String,
    carrier: String,
    estimatedDelivery: Date,

    receivingNotes: String,
    discrepancies: [
      {
        variantSku: String,
        expected: Number,
        received: Number,
        reason: String,
      },
    ],
  },
  { timestamps: true }
);

stockTransferSchema.index({ "fromStore.storeId": 1, status: 1 });
stockTransferSchema.index({ "toStore.storeId": 1, status: 1 });
stockTransferSchema.index({ status: 1 });
stockTransferSchema.index({ createdAt: -1 });

stockTransferSchema.pre("save", async function ensureTransferNumber(next) {
  if (this.isNew && !this.transferNumber) {
    const now = Date.now();
    const count = await mongoose.model("StockTransfer").countDocuments();
    this.transferNumber = `TR${now}${String(count + 1).padStart(4, "0")}`;
  }

  next();
});

export default
  mongoose.models.StockTransfer ||
  mongoose.model("StockTransfer", stockTransferSchema);
