import User from "./User.js";
import AuthOTPToken from "./AuthOTPToken.js";
import PasswordResetToken from "./PasswordResetToken.js";
import {
  classifySMTPError,
  getSMTPDiagnostic,
  sendOTPEmail,
} from "../../services/emailService.js";
import { getFirebaseAdmin } from "../../lib/firebaseAdmin.js";
import crypto from "crypto";
import {
  OTP_CHANNELS,
  OTP_PURPOSES,
  OTP_STATUSES,
  buildRequestMetadata,
  createOpaqueToken,
  createOTPSession,
  expirePendingOTPSessions,
  getRemainingCooldownSeconds,
  hashOpaqueToken,
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizePhone,
  verifyOTPSession,
} from "../../services/otpService.js";

const OTP_TTL_MINUTES = 10;
const OTP_BCRYPT_COST = 6;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESET_TOKEN_TTL_MINUTES = 10;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeVietnamPhoneNumberToLocal = (raw = "") => {
  const input = String(raw ?? "")
    .trim()
    .replace(/[^\d+]/g, "");

  if (!input) return "";

  if (input.startsWith("+84")) {
    const remain = input.slice(3);
    return remain ? `0${remain}` : "";
  }

  if (input.startsWith("84")) {
    const remain = input.slice(2);
    return remain ? `0${remain}` : "";
  }

  if (input.startsWith("0")) return input;

  if (/^\d{9,10}$/.test(input)) return `0${input}`;

  return input;
};

const normalizeFirebasePhoneToLocal = (phoneNumber = "") => {
  const input = String(phoneNumber || "").trim();
  if (!input) return "";
  if (input.startsWith("+84")) return `0${input.slice(3)}`;
  if (input.startsWith("84")) return `0${input.slice(2)}`;
  return input;
};

const validatePassword = (password = "") => {
  if (password.length < 8) {
    throw new Error("M?t kh?u ph?i có ít nh?t 8 ký t?");
  }

  const hasLowerCase = /[a-z]/.test(password);
  const hasUpperCase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password);

  if (!hasLowerCase || !hasUpperCase || !hasNumber || !hasSpecialChar) {
    throw new Error(
      "M?t kh?u ph?i bao g?m ch? thu?ng, ch? hoa, s? và ký t? d?c bi?t",
    );
  }
};

const mapForgotVerifyError = (result = {}) => {
  if (result.code === "OTP_INVALID") {
    return {
      status: 400,
      code: "FORGOT_PASSWORD_OTP_INVALID",
      message: `OTP không dúng. Còn ${result.attemptsLeft || 0} l?n th?.`,
      data: { attemptsLeft: result.attemptsLeft || 0 },
    };
  }

  if (result.code === "OTP_TOO_MANY_ATTEMPTS") {
    return {
      status: 429,
      code: "FORGOT_PASSWORD_OTP_TOO_MANY_ATTEMPTS",
      message:
        "OTP dã b? khóa do nh?p sai quá nhi?u l?n. Vui lòng yêu c?u mã m?i.",
    };
  }

  if (
    result.code === "OTP_EXPIRED" ||
    result.code === "OTP_SESSION_NOT_FOUND"
  ) {
    return {
      status: 404,
      code: "FORGOT_PASSWORD_OTP_EXPIRED",
      message: "OTP dã h?t h?n ho?c phiên không t?n t?i.",
    };
  }

  return {
    status: 400,
    code: "FORGOT_PASSWORD_OTP_VERIFY_FAILED",
    message: "Không th? xác th?c OTP.",
  };
};

const issueForgotPasswordOTP = async ({ req, user, channel, target }) => {
  const recentPending = await AuthOTPToken.findOne({
    userId: user._id,
    purpose: OTP_PURPOSES.FORGOT_PASSWORD,
    channel,
    target,
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
      code: "FORGOT_PASSWORD_RATE_LIMITED",
      message: `Vui lòng chờ ${waitSeconds} giây trước khi gửi lại OTP`,
      retryAfterSeconds: waitSeconds,
    };
  }

  await expirePendingOTPSessions({
    Model: AuthOTPToken,
    filter: {
      userId: user._id,
      purpose: OTP_PURPOSES.FORGOT_PASSWORD,
    },
  });

  const { otp, sessionId, expiresAt } = await createOTPSession({
    Model: AuthOTPToken,
    payload: {
      userId: user._id,
      purpose: OTP_PURPOSES.FORGOT_PASSWORD,
      channel,
      target,
      metadata: {
        identifierType: channel === OTP_CHANNELS.EMAIL ? "EMAIL" : "PHONE",
      },
      ...buildRequestMetadata(req),
    },
    ttlMinutes: OTP_TTL_MINUTES,
    maxAttempts: MAX_OTP_ATTEMPTS,
    bcryptCost: OTP_BCRYPT_COST,
  });

  if (channel === OTP_CHANNELS.EMAIL) {
    await sendOTPEmail({
      to: target,
      otp,
      ttlMinutes: OTP_TTL_MINUTES,
      type: "forgot_password",
    });
  }

  return {
    ok: true,
    data: {
      sessionId,
      expiresAt,
      ttlMinutes: OTP_TTL_MINUTES,
      channel,
      maskedContact:
        channel === OTP_CHANNELS.EMAIL ? maskEmail(target) : maskPhone(target),
      delivery: "EMAIL",
    },
  };
};

export const forgotPasswordByEmail = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        code: "FORGOT_PASSWORD_EMAIL_REQUIRED",
        message: "Vui lòng nh?p email",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        code: "FORGOT_PASSWORD_INVALID_EMAIL",
        message: "Email không h?p l?",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "FORGOT_PASSWORD_ACCOUNT_NOT_FOUND",
        message: "Không tìm th?y tài kho?n tuong ?ng v?i email này",
      });
    }

    const issued = await issueForgotPasswordOTP({
      req,
      user,
      channel: OTP_CHANNELS.EMAIL,
      target: normalizedEmail,
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
      message: "OTP dã du?c g?i qua email",
      data: issued.data,
    });
  } catch (error) {
    console.error("[AuthRecovery] forgotPasswordByEmail error:", error);

    const smtpFailure = classifySMTPError(error);
    if (smtpFailure.type !== "UNKNOWN") {
      console.error(
        "[AuthRecovery] forgotPasswordByEmail SMTP diagnostic:",
        getSMTPDiagnostic(error),
      );
      return res.status(smtpFailure.httpStatus).json({
        success: false,
        code: smtpFailure.appCode,
        message: smtpFailure.message,
      });
    }

    return res.status(500).json({
      success: false,
      code: "FORGOT_PASSWORD_EMAIL_FAILED",
      message: error.message || "Không th? g?i OTP qua email.",
    });
  }
};

export const forgotPasswordByPhone = async (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber || typeof phoneNumber !== "string") {
      return res.status(400).json({
        success: false,
        code: "FORGOT_PASSWORD_PHONE_REQUIRED",
        message: "Vui lòng nh?p s? di?n tho?i",
      });
    }

    const normalizedPhone = normalizeVietnamPhoneNumberToLocal(phoneNumber);

    const user = await User.findOne({ phoneNumber: normalizedPhone }).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "FORGOT_PASSWORD_ACCOUNT_NOT_FOUND",
        message: "Không tìm thấy tài khoản tương ứng với số điện thoại này",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OK",
      data: {
        channel: "FIREBASE_PHONE",
        maskedContact: maskPhone(normalizedPhone),
      },
    });
  } catch (error) {
    console.error("[AuthRecovery] forgotPasswordByPhone error:", error);
    return res.status(500).json({
      success: false,
      code: "FORGOT_PASSWORD_PHONE_FAILED",
      message:
        error.message ||
        "Không th? x? lý yêu c?u quên m?t kh?u qua s? di?n tho?i.",
    });
  }
};

const verifyForgotPasswordOTP = async (req, res) => {
  const { sessionId, otp } = req.body || {};

  if (!sessionId || !otp) {
    return res.status(400).json({
      success: false,
      code: "FORGOT_PASSWORD_MISSING_OTP_PARAMS",
      message: "sessionId và otp là b?t bu?c",
    });
  }

  const record = await AuthOTPToken.findOne({
    sessionId,
    purpose: OTP_PURPOSES.FORGOT_PASSWORD,
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
    const mapped = mapForgotVerifyError(verifyResult);
    return res.status(mapped.status).json({
      success: false,
      code: mapped.code,
      message: mapped.message,
      data: mapped.data,
    });
  }

  const resetToken = createOpaqueToken(32);
  verifyResult.record.resetTokenHash = hashOpaqueToken(resetToken);
  verifyResult.record.resetTokenExpiresAt = new Date(
    Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
  );
  await verifyResult.record.save();

  return res.status(200).json({
    success: true,
    message: "OTP h?p l?. B?n có th? d?t l?i m?t kh?u m?i.",
    data: {
      step: "OTP_VERIFIED",
      resetToken,
      resetTokenExpiresAt: verifyResult.record.resetTokenExpiresAt,
      channel: verifyResult.record.channel,
      maskedContact:
        verifyResult.record.channel === OTP_CHANNELS.EMAIL
          ? maskEmail(verifyResult.record.target)
          : maskPhone(verifyResult.record.target),
    },
  });
};

const issueResetTokenFromFirebasePhone = async (req, res) => {
  const { phoneNumber, firebaseIdToken } = req.body || {};

  console.log("Incoming phone:", req.body.phoneNumber);
  console.log("Firebase ID Token:", req.body.firebaseIdToken);

  if (!phoneNumber || !firebaseIdToken) {
    return res.status(400).json({
      success: false,
      code: "RESET_PASSWORD_MISSING_PARAMS",
      message: "phoneNumber và firebaseIdToken là b?t bu?c",
    });
  }

  try {
    const admin = getFirebaseAdmin();
    const decodedToken = await admin
      .auth()
      .verifyIdToken(String(firebaseIdToken));
    console.log("Decoded token:", decodedToken);
    console.log("Token phone:", decodedToken.phone_number);
    const firebasePhone = normalizeFirebasePhoneToLocal(
      decodedToken?.phone_number || "",
    );
    const requestedPhone = normalizeVietnamPhoneNumberToLocal(phoneNumber);

    if (!firebasePhone || !requestedPhone || firebasePhone !== requestedPhone) {
      return res.status(401).json({
        success: false,
        code: "RESET_PASSWORD_FIREBASE_PHONE_MISMATCH",
        message: "Xác th?c s? di?n tho?i không h?p l?.",
      });
    }

    const user = await User.findOne({ phoneNumber: requestedPhone }).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "RESET_PASSWORD_USER_NOT_FOUND",
        message: "Không tìm th?y ngu?i dùng",
      });
    }

    const resetToken = createOpaqueToken(32);
    const resetTokenHash = hashOpaqueToken(resetToken);
    const resetTokenExpiresAt = new Date(
      Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
    );

    await PasswordResetToken.create({
      userId: user._id,
      resetTokenHash,
      expiresAt: resetTokenExpiresAt,
      metadata: {
        provider: "FIREBASE_PHONE",
        phoneNumber: requestedPhone,
      },
      ...buildRequestMetadata(req),
    });

    return res.status(200).json({
      success: true,
      message: "OTP h?p l?. B?n có th? d?t l?i m?t kh?u m?i.",
      data: {
        step: "OTP_VERIFIED",
        resetToken,
        resetTokenExpiresAt,
        channel: "FIREBASE_PHONE",
        maskedContact: maskPhone(requestedPhone),
      },
    });
  } catch (error) {
    console.error("Firebase verify error:", error);
    return res.status(401).json({
      success: false,
      code: "RESET_PASSWORD_FIREBASE_VERIFY_FAILED",
      message: "Không th? xác th?c OTP. Vui lòng th? l?i.",
    });
  }
};

const applyNewPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body || {};

  if (!resetToken || !newPassword) {
    return res.status(400).json({
      success: false,
      code: "RESET_PASSWORD_MISSING_PARAMS",
      message: "resetToken và newPassword là b?t bu?c",
    });
  }

  try {
    validatePassword(String(newPassword));
  } catch (error) {
    return res.status(400).json({
      success: false,
      code: "RESET_PASSWORD_INVALID_PASSWORD",
      message: error.message,
    });
  }

  const resetTokenHash = hashOpaqueToken(resetToken);
  const tokenRecord = await AuthOTPToken.findOne({
    purpose: OTP_PURPOSES.FORGOT_PASSWORD,
    status: OTP_STATUSES.VERIFIED,
    resetTokenHash,
    resetTokenExpiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  const firebaseTokenRecord = tokenRecord
    ? null
    : await PasswordResetToken.findOne({
        resetTokenHash,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

  const effectiveUserId = tokenRecord?.userId || firebaseTokenRecord?.userId;

  if (!effectiveUserId) {
    return res.status(400).json({
      success: false,
      code: "RESET_PASSWORD_TOKEN_INVALID_OR_EXPIRED",
      message: "Phiên d?t l?i m?t kh?u không h?p l? ho?c dã h?t h?n",
    });
  }

  const user = await User.findById(effectiveUserId).select("+password");
  if (!user) {
    return res.status(404).json({
      success: false,
      code: "RESET_PASSWORD_USER_NOT_FOUND",
      message: "Không tìm th?y ngu?i dùng",
    });
  }

  const isSamePassword = await user.comparePassword(String(newPassword));
  if (isSamePassword) {
    return res.status(400).json({
      success: false,
      code: "RESET_PASSWORD_SAME_AS_OLD",
      message: "M?t kh?u m?i không du?c trùng v?i m?t kh?u cu",
    });
  }

  user.password = String(newPassword);
  await user.save();

  if (tokenRecord) {
    tokenRecord.status = OTP_STATUSES.USED;
    tokenRecord.resetTokenHash = null;
    tokenRecord.resetTokenExpiresAt = null;
    tokenRecord.expiresAt = new Date();
    await tokenRecord.save();
  }

  if (firebaseTokenRecord) {
    firebaseTokenRecord.usedAt = new Date();
    await firebaseTokenRecord.save();
  }

  await AuthOTPToken.updateMany(
    {
      userId: user._id,
      purpose: OTP_PURPOSES.FORGOT_PASSWORD,
      status: { $in: [OTP_STATUSES.PENDING, OTP_STATUSES.VERIFIED] },
    },
    {
      $set: { status: OTP_STATUSES.EXPIRED },
    },
  );

  return res.status(200).json({
    success: true,
    message: "Ð?i m?t kh?u thành công",
  });
};

export const resetPassword = async (req, res) => {
  try {
    const {
      sessionId,
      otp,
      resetToken,
      newPassword,
      phoneNumber,
      firebaseIdToken,
    } = req.body || {};

    if (sessionId && otp && !resetToken && !newPassword) {
      return verifyForgotPasswordOTP(req, res);
    }

    if (phoneNumber && firebaseIdToken && !resetToken && !newPassword) {
      return issueResetTokenFromFirebasePhone(req, res);
    }

    if (resetToken && newPassword) {
      return applyNewPassword(req, res);
    }

    return res.status(400).json({
      success: false,
      code: "RESET_PASSWORD_INVALID_PAYLOAD",
      message:
        "Payload không h?p l?. Vui lòng g?i OTP ho?c resetToken + m?t kh?u m?i.",
    });
  } catch (error) {
    console.error("[AuthRecovery] resetPassword error:", error);
    return res.status(500).json({
      success: false,
      code: "RESET_PASSWORD_FAILED",
      message: error.message || "Không th? d?t l?i m?t kh?u.",
    });
  }
};

export default {
  forgotPasswordByEmail,
  forgotPasswordByPhone,
  resetPassword,
};
