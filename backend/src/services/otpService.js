import crypto from "crypto";
import bcrypt from "bcryptjs";

const DEFAULT_OTP_LENGTH = 6;
const DEFAULT_OTP_TTL_MINUTES = 10;
const DEFAULT_OTP_BCRYPT_COST = 6;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;

export const OTP_CHANNELS = Object.freeze({
  EMAIL: "EMAIL",
  SMS: "SMS",
});

export const OTP_PURPOSES = Object.freeze({
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  ADD_EMAIL: "ADD_EMAIL",
  FORGOT_PASSWORD: "FORGOT_PASSWORD",
});

export const OTP_STATUSES = Object.freeze({
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  EXPIRED: "EXPIRED",
  USED: "USED",
});

export const normalizeEmail = (value = "") => String(value).trim().toLowerCase();

export const normalizePhone = (value = "") => String(value).trim();

export const generateOTPCode = (length = DEFAULT_OTP_LENGTH) => {
  const size = Math.min(8, Math.max(4, Number(length) || DEFAULT_OTP_LENGTH));
  const upperBound = 10 ** size;
  return String(crypto.randomInt(0, upperBound)).padStart(size, "0");
};

export const maskEmail = (email = "") => {
  const [localPart, domainPart] = String(email).split("@");
  if (!domainPart) return "***";
  if (localPart.length <= 2) return `${localPart.charAt(0) || "*"}***@${domainPart}`;
  return `${localPart.charAt(0)}${"*".repeat(Math.min(4, localPart.length - 2))}${localPart.at(-1)}@${domainPart}`;
};

export const maskPhone = (phone = "") => {
  const normalized = normalizePhone(phone);
  if (normalized.length < 6) return "****";
  return `${normalized.slice(0, 3)}${"*".repeat(normalized.length - 6)}${normalized.slice(-3)}`;
};

export const hashOTP = async (otp, { bcryptCost = DEFAULT_OTP_BCRYPT_COST } = {}) =>
  bcrypt.hash(String(otp), bcryptCost);

export const createOTPSession = async ({
  Model,
  payload = {},
  otpLength = DEFAULT_OTP_LENGTH,
  ttlMinutes = DEFAULT_OTP_TTL_MINUTES,
  maxAttempts = DEFAULT_OTP_MAX_ATTEMPTS,
  bcryptCost = DEFAULT_OTP_BCRYPT_COST,
  hashField = "otpHash",
} = {}) => {
  if (!Model) {
    throw new Error("[OTPService] Model is required to create OTP session");
  }

  const otp = generateOTPCode(otpLength);
  const otpHash = await hashOTP(otp, { bcryptCost });
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + Number(ttlMinutes) * 60 * 1000);

  const record = await Model.create({
    ...payload,
    [hashField]: otpHash,
    sessionId,
    status: OTP_STATUSES.PENDING,
    attempts: 0,
    maxAttempts,
    expiresAt,
  });

  return {
    record,
    otp,
    sessionId,
    expiresAt,
    ttlMinutes: Number(ttlMinutes),
  };
};

export const expirePendingOTPSessions = async ({ Model, filter = {} } = {}) => {
  if (!Model) {
    throw new Error("[OTPService] Model is required to expire OTP sessions");
  }

  await Model.updateMany(
    {
      ...filter,
      status: OTP_STATUSES.PENDING,
    },
    {
      $set: {
        status: OTP_STATUSES.EXPIRED,
      },
    },
  );
};

export const getRemainingCooldownSeconds = ({ createdAt, cooldownMs } = {}) => {
  if (!createdAt || !cooldownMs) return 0;
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  if (elapsedMs >= cooldownMs) return 0;
  return Math.ceil((cooldownMs - elapsedMs) / 1000);
};

export const verifyOTPSession = async ({
  record,
  otp,
  hashField = "otpHash",
  verifiedStatus = OTP_STATUSES.VERIFIED,
} = {}) => {
  if (!record) {
    return {
      success: false,
      code: "OTP_SESSION_NOT_FOUND",
      status: 404,
    };
  }

  if (record.status !== OTP_STATUSES.PENDING) {
    return {
      success: false,
      code: "OTP_SESSION_NOT_PENDING",
      status: 400,
    };
  }

  if (record.expiresAt && new Date(record.expiresAt) <= new Date()) {
    record.status = OTP_STATUSES.EXPIRED;
    await record.save();
    return {
      success: false,
      code: "OTP_EXPIRED",
      status: 400,
    };
  }

  if (record.attempts >= record.maxAttempts) {
    record.status = OTP_STATUSES.EXPIRED;
    await record.save();
    return {
      success: false,
      code: "OTP_TOO_MANY_ATTEMPTS",
      status: 429,
      attemptsLeft: 0,
    };
  }

  const hashedOTP = record[hashField];
  const isValid = await bcrypt.compare(String(otp || ""), hashedOTP || "");

  if (!isValid) {
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      record.status = OTP_STATUSES.EXPIRED;
    }
    await record.save();

    return {
      success: false,
      code: record.status === OTP_STATUSES.EXPIRED ? "OTP_TOO_MANY_ATTEMPTS" : "OTP_INVALID",
      status: record.status === OTP_STATUSES.EXPIRED ? 429 : 400,
      attemptsLeft: Math.max(record.maxAttempts - record.attempts, 0),
    };
  }

  record.status = verifiedStatus;
  record.verifiedAt = new Date();
  await record.save();

  return {
    success: true,
    record,
  };
};

export const buildRequestMetadata = (req) => ({
  ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || "",
  userAgent: req?.headers?.["user-agent"] || "",
});

export const createOpaqueToken = (length = 32) => crypto.randomBytes(length).toString("hex");

export const hashOpaqueToken = (value = "") =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

export default {
  OTP_CHANNELS,
  OTP_PURPOSES,
  OTP_STATUSES,
  normalizeEmail,
  normalizePhone,
  generateOTPCode,
  maskEmail,
  maskPhone,
  createOTPSession,
  expirePendingOTPSessions,
  getRemainingCooldownSeconds,
  verifyOTPSession,
  buildRequestMetadata,
  createOpaqueToken,
  hashOpaqueToken,
};

