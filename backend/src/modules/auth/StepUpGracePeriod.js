import mongoose from "mongoose";

/**
 * StepUpGracePeriod — Lưu trữ "grace period" sau khi user đã step-up thành công.
 * Trong thời gian này (mặc định 15 phút), user không cần nhập OTP lại cho cùng action group.
 * TTL index tự động dọn dẹp khi hết hạn.
 */
const stepUpGracePeriodSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Nhóm action được miễn step-up (e.g. "PRODUCT_BULK_SENSITIVE")
    actionGroup: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    // Thời điểm grace period bắt đầu
    grantedAt: {
      type: Date,
      default: Date.now,
    },
    // Thời điểm grace period hết hạn (mặc định 15 phút sau grantedAt)
    expiresAt: {
      type: Date,
      required: true,
    },
    // IP tại thời điểm step-up để audit
    ipAddress: {
      type: String,
      trim: true,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Compound unique index — mỗi user chỉ có một grace period per actionGroup
stepUpGracePeriodSchema.index({ userId: 1, actionGroup: 1 }, { unique: true });

// TTL index — MongoDB tự động xóa document khi expiresAt < now
stepUpGracePeriodSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.StepUpGracePeriod ||
  mongoose.model("StepUpGracePeriod", stepUpGracePeriodSchema);
