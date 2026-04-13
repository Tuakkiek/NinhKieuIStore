import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  requestStepUp,
  verifyStepUpOTP,
  resendStepUpOTP,
  getStepUpStatusHandler,
} from "./stepUpController.js";

const router = express.Router();

const resendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  keyGenerator: (req) => `stepup-resend:${req.user?._id || ipKeyGenerator(req.ip || "")}`,
  message: {
    success: false,
    code: "STEP_UP_RATE_LIMITED",
    message: "Please wait 60 seconds before requesting another OTP",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `stepup-verify:${req.user?._id || ipKeyGenerator(req.ip || "")}`,
  message: {
    success: false,
    code: "STEP_UP_RATE_LIMITED",
    message: "Too many verification attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/request", requestStepUp);
router.post("/verify", verifyLimiter, verifyStepUpOTP);
router.post("/resend", resendLimiter, resendStepUpOTP);
router.get("/status", getStepUpStatusHandler);

export default router;
