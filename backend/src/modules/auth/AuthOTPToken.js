import mongoose from "mongoose";
import { OTP_CHANNELS, OTP_PURPOSES, OTP_STATUSES } from "../../services/otpService.js";

const authOTPTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: Object.values(OTP_PURPOSES),
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: Object.values(OTP_CHANNELS),
      required: true,
      index: true,
    },
    target: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
      select: false,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(OTP_STATUSES),
      default: OTP_STATUSES.PENDING,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    resetTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    resetTokenExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

authOTPTokenSchema.index({ userId: 1, purpose: 1, status: 1, expiresAt: 1 });
authOTPTokenSchema.index({ target: 1, purpose: 1, channel: 1, status: 1 });
authOTPTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.AuthOTPToken || mongoose.model("AuthOTPToken", authOTPTokenSchema);

