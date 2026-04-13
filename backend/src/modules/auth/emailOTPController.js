/**
 * emailOTPController.js
 * Handles customer email verification flow:
 *   POST /api/auth/send-email-otp
 *   POST /api/auth/add-email
 *   POST /api/auth/verify-email-otp
 *   POST /api/auth/resend-email-otp
 */
import User from "./User.js";
import AuthOTPToken from "./AuthOTPToken.js";
import { sendOTPEmail, sendWelcomeEmail } from "../../services/emailService.js";
import {
  OTP_CHANNELS,
  OTP_PURPOSES,
  OTP_STATUSES,
  buildRequestMetadata,
  createOTPSession,
  expirePendingOTPSessions,
  getRemainingCooldownSeconds,
  maskEmail,
  normalizeEmail,
  verifyOTPSession,
} from "../../services/otpService.js";

const OTP_TTL_MINUTES = 10;
const OTP_BCRYPT_COST = 6;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_PURPOSES = [OTP_PURPOSES.EMAIL_VERIFICATION, OTP_PURPOSES.ADD_EMAIL];

const mapVerifyError = (result = {}) => {
  if (result.code === "OTP_INVALID") {
    return {
      status: 400,
      code: "EMAIL_OTP_INVALID",
      message: `Mã OTP không dúng. Còn ${result.attemptsLeft || 0} l?n th?.`,
      data: { attemptsLeft: result.attemptsLeft || 0 },
    };
  }

  if (result.code === "OTP_TOO_MANY_ATTEMPTS") {
    return {
      status: 429,
      code: "EMAIL_OTP_TOO_MANY_ATTEMPTS",
      message: "Quá nhi?u l?n th? sai. Phiên OTP dã b? vô hi?u hóa. Vui lòng yêu c?u mã m?i.",
    };
  }

  if (result.code === "OTP_EXPIRED" || result.code === "OTP_SESSION_NOT_FOUND") {
    return {
      status: 404,
      code: "EMAIL_OTP_SESSION_NOT_FOUND",
      message: "Phiên OTP không t?n t?i ho?c dã h?t h?n. Vui lòng yêu c?u mã m?i.",
    };
  }

  return {
    status: 400,
    code: "EMAIL_OTP_VERIFY_FAILED",
    message: "Xác th?c OTP th?t b?i. Vui lòng th? l?i.",
  };
};

const ensureEmailCanBeUsed = async ({ userId, email }) => {
  const existingOwner = await User.findOne({
    email,
    _id: { $ne: userId },
  }).lean();

  if (existingOwner) {
    return {
      ok: false,
      status: 409,
      code: "EMAIL_OTP_EMAIL_TAKEN",
      message: "Email này dã du?c s? d?ng b?i tài kho?n khác",
    };
  }

  const currentUser = await User.findById(userId).lean();
  if (currentUser?.emailVerified && currentUser?.email === email) {
    return {
      ok: false,
      status: 400,
      code: "EMAIL_OTP_ALREADY_VERIFIED",
      message: "Email này dã du?c xác th?c tru?c dó",
    };
  }

  return { ok: true };
};

const issueEmailOTP = async ({ req, userId, email, purpose }) => {
  const metadata = buildRequestMetadata(req);

  const recentPending = await AuthOTPToken.findOne({
    userId,
    purpose,
    channel: OTP_CHANNELS.EMAIL,
    target: email,
    status: OTP_STATUSES.PENDING,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  const waitSeconds = getRemainingCooldownSeconds({
    createdAt: recentPending?.createdAt,
    cooldownMs: RESEND_COOLDOWN_MS,
  });

  if (waitSeconds > 0) {
    return {
      ok: false,
      status: 429,
      code: "EMAIL_OTP_RATE_LIMITED",
      message: `Vui lòng chờ ${waitSeconds} giây trước khi gửi lại mã OTP`,
      retryAfterSeconds: waitSeconds,
    };
  }

  await expirePendingOTPSessions({
    Model: AuthOTPToken,
    filter: {
      userId,
      purpose: { $in: EMAIL_PURPOSES },
    },
  });

  const { otp, sessionId, expiresAt } = await createOTPSession({
    Model: AuthOTPToken,
    payload: {
      userId,
      purpose,
      channel: OTP_CHANNELS.EMAIL,
      target: email,
      ...metadata,
    },
    ttlMinutes: OTP_TTL_MINUTES,
    maxAttempts: MAX_OTP_ATTEMPTS,
    bcryptCost: OTP_BCRYPT_COST,
  });

  await sendOTPEmail({
    to: email,
    otp,
    ttlMinutes: OTP_TTL_MINUTES,
    type: "email_verification",
  });

  return {
    ok: true,
    data: {
      sessionId,
      maskedEmail: maskEmail(email),
      expiresAt,
      ttlMinutes: OTP_TTL_MINUTES,
    },
  };
};

const sendEmailOTPByPurpose = async ({ req, res, purpose, successMessage }) => {
  try {
    const userId = String(req.user._id);
    const { email } = req.body || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        code: "EMAIL_OTP_EMAIL_REQUIRED",
        message: "Vui lòng cung c?p d?a ch? email",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        code: "EMAIL_OTP_INVALID_EMAIL",
        message: "Ð?a ch? email không h?p l?",
      });
    }

    const eligibility = await ensureEmailCanBeUsed({ userId, email: normalizedEmail });
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({
        success: false,
        code: eligibility.code,
        message: eligibility.message,
      });
    }

    const issued = await issueEmailOTP({
      req,
      userId,
      email: normalizedEmail,
      purpose,
    });

    if (!issued.ok) {
      return res.status(issued.status).json({
        success: false,
        code: issued.code,
        message: issued.message,
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    return res.status(200).json({
      success: true,
      message: successMessage,
      data: issued.data,
    });
  } catch (error) {
    console.error("[EmailOTP] send error:", error);

    if (error.code === "SMTP_CONFIG_MISSING") {
      return res.status(503).json({
        success: false,
        code: "EMAIL_SERVICE_UNAVAILABLE",
        message: "D?ch v? g?i email chua du?c c?u hình. Vui lòng liên h? admin.",
      });
    }

    return res.status(500).json({
      success: false,
      code: "EMAIL_OTP_SEND_FAILED",
      message: error.message || "Không th? g?i mã OTP. Vui lòng th? l?i.",
    });
  }
};

export const sendEmailOTP = async (req, res) =>
  sendEmailOTPByPurpose({
    req,
    res,
    purpose: OTP_PURPOSES.EMAIL_VERIFICATION,
    successMessage: "Mã OTP dã du?c g?i t?i email c?a b?n",
  });

export const addEmail = async (req, res) =>
  sendEmailOTPByPurpose({
    req,
    res,
    purpose: OTP_PURPOSES.ADD_EMAIL,
    successMessage: "Mã OTP dã du?c g?i d? liên k?t email",
  });

export const verifyEmailOTP = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const { sessionId, otp } = req.body || {};

    if (!sessionId || !otp) {
      return res.status(400).json({
        success: false,
        code: "EMAIL_OTP_MISSING_PARAMS",
        message: "sessionId và otp là b?t bu?c",
      });
    }

    const record = await AuthOTPToken.findOne({
      userId,
      sessionId,
      purpose: { $in: EMAIL_PURPOSES },
      channel: OTP_CHANNELS.EMAIL,
      status: OTP_STATUSES.PENDING,
      expiresAt: { $gt: new Date() },
    }).select("+otpHash");

    const verifyResult = await verifyOTPSession({
      record,
      otp,
      hashField: "otpHash",
      verifiedStatus: OTP_STATUSES.VERIFIED,
    });

    if (!verifyResult.success) {
      const mapped = mapVerifyError(verifyResult);
      return res.status(mapped.status).json({
        success: false,
        code: mapped.code,
        message: mapped.message,
        data: mapped.data,
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          email: verifyResult.record.target,
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      },
      { new: true },
    );

    await expirePendingOTPSessions({
      Model: AuthOTPToken,
      filter: {
        userId,
        purpose: { $in: EMAIL_PURPOSES },
      },
    });

    sendWelcomeEmail({
      to: verifyResult.record.target,
      fullName: updatedUser?.fullName || "",
    }).catch((err) => {
      console.warn("[EmailOTP] Welcome email failed (non-critical):", err.message);
    });

    return res.status(200).json({
      success: true,
      message: "Email dã du?c xác th?c thành công!",
      data: {
        emailVerified: true,
        email: verifyResult.record.target,
        emailVerifiedAt: updatedUser?.emailVerifiedAt,
        user: {
          _id: updatedUser?._id,
          fullName: updatedUser?.fullName,
          email: updatedUser?.email,
          emailVerified: updatedUser?.emailVerified,
          phoneNumber: updatedUser?.phoneNumber,
        },
      },
    });
  } catch (error) {
    console.error("[EmailOTP] verifyEmailOTP error:", error);
    return res.status(500).json({
      success: false,
      code: "EMAIL_OTP_VERIFY_FAILED",
      message: error.message || "Xác th?c OTP th?t b?i. Vui lòng th? l?i.",
    });
  }
};

export const resendEmailOTP = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const { sessionId } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        code: "EMAIL_OTP_SESSION_REQUIRED",
        message: "sessionId là b?t bu?c",
      });
    }

    const oldRecord = await AuthOTPToken.findOne({
      userId,
      sessionId,
      purpose: { $in: EMAIL_PURPOSES },
      channel: OTP_CHANNELS.EMAIL,
      status: OTP_STATUSES.PENDING,
    });

    if (!oldRecord) {
      return res.status(404).json({
        success: false,
        code: "EMAIL_OTP_SESSION_NOT_FOUND",
        message: "Phiên OTP không t?n t?i. Vui lòng yêu c?u mã m?i.",
      });
    }

    const waitSeconds = getRemainingCooldownSeconds({
      createdAt: oldRecord.createdAt,
      cooldownMs: RESEND_COOLDOWN_MS,
    });

    if (waitSeconds > 0) {
      return res.status(429).json({
        success: false,
        code: "EMAIL_OTP_RATE_LIMITED",
        message: `Vui lòng chờ ${waitSeconds} giây trước khi gửi lại mã OTP`,
        retryAfterSeconds: waitSeconds,
      });
    }

    oldRecord.status = OTP_STATUSES.EXPIRED;
    await oldRecord.save();

    const { otp, sessionId: newSessionId, expiresAt } = await createOTPSession({
      Model: AuthOTPToken,
      payload: {
        userId,
        purpose: oldRecord.purpose,
        channel: OTP_CHANNELS.EMAIL,
        target: oldRecord.target,
        ...buildRequestMetadata(req),
      },
      ttlMinutes: OTP_TTL_MINUTES,
      maxAttempts: MAX_OTP_ATTEMPTS,
      bcryptCost: OTP_BCRYPT_COST,
    });

    await sendOTPEmail({
      to: oldRecord.target,
      otp,
      ttlMinutes: OTP_TTL_MINUTES,
      type: "email_verification",
    });

    return res.status(200).json({
      success: true,
      message: "Mã OTP m?i dã du?c g?i",
      data: {
        sessionId: newSessionId,
        maskedEmail: maskEmail(oldRecord.target),
        expiresAt,
        ttlMinutes: OTP_TTL_MINUTES,
      },
    });
  } catch (error) {
    console.error("[EmailOTP] resendEmailOTP error:", error);

    if (error.code === "SMTP_CONFIG_MISSING") {
      return res.status(503).json({
        success: false,
        code: "EMAIL_SERVICE_UNAVAILABLE",
        message: "D?ch v? g?i email chua du?c c?u hình.",
      });
    }

    return res.status(500).json({
      success: false,
      code: "EMAIL_OTP_RESEND_FAILED",
      message: error.message || "Không th? g?i l?i mã OTP.",
    });
  }
};

export default {
  sendEmailOTP,
  addEmail,
  verifyEmailOTP,
  resendEmailOTP,
};

