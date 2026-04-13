import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  register,
  login,
  logout,
  changePassword,
  getCurrentUser,
  updateAvatar,
  checkCustomerByPhone,
  quickRegisterCustomer,
  getEffectivePermissions,
  setActiveBranchContext,
  setSimulatedBranchContext,
  clearSimulatedBranchContext,
} from "./authController.js";
import { sendEmailOTP, addEmail, verifyEmailOTP, resendEmailOTP } from "./emailOTPController.js";
import {
  forgotPasswordByEmail,
  forgotPasswordByPhone,
  resetPassword,
} from "./passwordRecoveryController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { resolveAccessContext } from "../../middleware/authz/resolveAccessContext.js";
import { checkPermission } from "../../middleware/authz/checkPermission.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import stepUpRoutes from "./stepUpRoutes.js";

const router = express.Router();

const resolveUserScopeMode = (req) => (req.authz?.isGlobalAdmin ? "global" : "branch");

const requireCustomerLookup = checkPermission(null, {
  anyOf: [AUTHZ_ACTIONS.USERS_READ_BRANCH, AUTHZ_ACTIONS.POS_ORDER_CREATE],
  scopeMode: resolveUserScopeMode,
  requireActiveBranchFor: ["branch"],
  resourceType: "USER",
});

const requireCustomerQuickRegister = checkPermission(null, {
  anyOf: [AUTHZ_ACTIONS.USERS_MANAGE_BRANCH, AUTHZ_ACTIONS.POS_ORDER_CREATE],
  scopeMode: resolveUserScopeMode,
  requireActiveBranchFor: ["branch"],
  resourceType: "USER",
});

const emailOTPLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => `email-otp-send:${req.user?._id || ipKeyGenerator(req.ip || "")}`,
  message: {
    success: false,
    code: "EMAIL_OTP_RATE_LIMITED",
    message: "Quá nhi?u yêu c?u. Vui lòng ch? 1 phút tru?c khi th? l?i.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const emailOTPVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `email-otp-verify:${req.user?._id || ipKeyGenerator(req.ip || "")}`,
  message: {
    success: false,
    code: "EMAIL_OTP_RATE_LIMITED",
    message: "Quá nhi?u l?n th?. Vui lòng th? l?i sau.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const identifier = String(req.body?.email || req.body?.phoneNumber || "").trim().toLowerCase();
    return `forgot-password:${identifier || ipKeyGenerator(req.ip || "")}`;
  },
  message: {
    success: false,
    code: "FORGOT_PASSWORD_RATE_LIMITED",
    message: "Quá nhi?u yêu c?u OTP. Vui lòng th? l?i sau 1 phút.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  keyGenerator: (req) => `reset-password:${ipKeyGenerator(req.ip || "")}`,
  message: {
    success: false,
    code: "RESET_PASSWORD_RATE_LIMITED",
    message: "Quá nhi?u l?n th? d?t l?i m?t kh?u. Vui lòng th? l?i sau.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);

router.get("/me", protect, resolveAccessContext, getCurrentUser);
router.get("/context/permissions", protect, resolveAccessContext, getEffectivePermissions);
router.put("/context/active-branch", protect, resolveAccessContext, setActiveBranchContext);
router.put("/context/simulate-branch", protect, resolveAccessContext, setSimulatedBranchContext);
router.delete("/context/simulate-branch", protect, resolveAccessContext, clearSimulatedBranchContext);

router.put("/change-password", protect, changePassword);
router.put("/avatar", protect, updateAvatar);

router.get("/check-customer", protect, resolveAccessContext, requireCustomerLookup, checkCustomerByPhone);
router.post(
  "/quick-register",
  protect,
  resolveAccessContext,
  requireCustomerQuickRegister,
  quickRegisterCustomer,
);

router.post("/send-email-otp", protect, emailOTPLimiter, sendEmailOTP);
router.post("/add-email", protect, emailOTPLimiter, addEmail);
router.post("/verify-email-otp", protect, emailOTPVerifyLimiter, verifyEmailOTP);
router.post("/resend-email-otp", protect, emailOTPLimiter, resendEmailOTP);

router.post("/forgot-password/email", forgotPasswordLimiter, forgotPasswordByEmail);
router.post("/forgot-password/phone", forgotPasswordLimiter, forgotPasswordByPhone);
router.post("/reset-password", resetPasswordLimiter, resetPassword);

router.use("/step-up", protect, stepUpRoutes);

export default router;

