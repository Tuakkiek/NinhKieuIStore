import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { Button } from "@/shared/ui/button";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";
import OTPInput from "../components/OTPInput";
import { authAPI } from "../api/auth.api";
import { auth } from "@/shared/lib/firebase";

const RESEND_COOLDOWN_SECONDS = 60;

const passwordPolicy = (password = "") => ({
  length: password.length >= 8,
  lower: /[a-z]/.test(password),
  upper: /[A-Z]/.test(password),
  number: /[0-9]/.test(password),
  special: /[^A-Za-z0-9]/.test(password),
});

const normalizeVietnamPhoneNumberToE164 = (raw) => {
  const input = String(raw ?? "")
    .trim()
    .replace(/[^\d+]/g, "");

  if (!input) return "";

  if (input.startsWith("+")) return input;
  if (input.startsWith("84")) return `+${input}`;
  if (input.startsWith("0")) return `+84${input.slice(1)}`;
  if (/^\d{9,10}$/.test(input)) return `+84${input}`;
  return input;
};

const mapFirebaseError = (error) => {
  const code = String(error?.code || "");
  if (code === "auth/invalid-phone-number") return "Số điện thoại không hợp lệ.";
  if (code === "auth/too-many-requests") return "Bạn thao tác quá nhanh. Vui lòng thử lại sau.";
  if (code === "auth/invalid-verification-code") return "OTP không đúng.";
  if (code === "auth/code-expired") return "OTP đã hết hạn. Vui lòng gửi lại.";
  if (code === "auth/captcha-check-failed") return "Không thể xác minh reCAPTCHA. Vui lòng thử lại.";
  if (code === "auth/invalid-app-credential") return "Không thể xác minh reCAPTCHA. Vui lòng thử lại.";
  if (code === "auth/recaptcha-not-enabled") return "Phone OTP chưa được bật trên Firebase Auth.";
  if (code === "auth/operation-not-allowed") return "Tính năng này chưa được bật. Vui lòng liên hệ quản trị.";
  if (code === "auth/quota-exceeded") return "Vượt quá hạn mức OTP. Vui lòng thử lại sau.";
  if (code === "auth/missing-verification-code") return "Vui lòng nhập OTP.";
  if (code === "auth/app-not-authorized") return "Ứng dụng chưa được cấp quyền. Kiểm tra domain/localhost trên Firebase.";
  if (code === "auth/network-request-failed") return "Lỗi mạng. Vui lòng kiểm tra kết nối và thử lại.";
  return error?.message || "Có lỗi xảy ra. Vui lòng thử lại.";
};

const ForgotPasswordPage = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const [maskedPhone, setMaskedPhone] = useState("");
  const [confirmationResult, setConfirmationResult] = useState(null);
  const confirmationResultRef = useRef(null);

  const passwordChecks = useMemo(() => passwordPolicy(newPassword), [newPassword]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const getFreshRecaptchaContainer = () => {
    const container = document.getElementById("recaptcha-container");
    if (!container) throw new Error("Không tìm thấy container reCAPTCHA.");

    if (container.childElementCount > 0) {
      const parent = container.parentElement;
      if (parent) {
        const fresh = container.cloneNode(false);
        parent.replaceChild(fresh, container);
        return fresh;
      }
      container.innerHTML = "";
    }

    return container;
  };
  const ensureRecaptchaVerifier = async () => {
    if (window.recaptchaVerifier) {
      if (window.recaptchaRenderPromise) {
        await window.recaptchaRenderPromise;
      }
      return window.recaptchaVerifier;
    }

    const container = getFreshRecaptchaContainer();

    // IMPORTANT: init only once, store globally
    window.recaptchaVerifier = new RecaptchaVerifier(auth, container, {
      size: "invisible",
      badge: "bottomleft",
    });
    window.recaptchaRenderPromise = window.recaptchaVerifier.render().catch((renderError) => {
      try {
        window.recaptchaVerifier?.clear?.();
      } catch {
        // ignore
      }
      window.recaptchaVerifier = null;
      window.recaptchaRenderPromise = null;
      throw renderError;
    });
    await window.recaptchaRenderPromise;
    return window.recaptchaVerifier;
  };

  const resetRecaptcha = () => {
    try {
      window.recaptchaVerifier?.clear?.();
    } catch {
      // ignore
    } finally {
      window.recaptchaVerifier = null;
      window.recaptchaRenderPromise = null;

      try {
        const container = document.getElementById("recaptcha-container");
        if (container && container.childElementCount > 0) {
          const parent = container.parentElement;
          if (parent) {
            const fresh = container.cloneNode(false);
            parent.replaceChild(fresh, container);
          } else {
            container.innerHTML = "";
          }
        }
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    return () => resetRecaptcha();
  }, []);

  const sendPhoneOTPViaFirebase = async ({ force = false } = {}) => {
    if (resendCooldown > 0 || loading) return;

    const normalizedLocal = phoneNumber.trim();
    if (!normalizedLocal) {
      setError("Vui lòng nhập số điện thoại");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Backend gate: ensure account exists + rate limiting
      const response = await authAPI.forgotPasswordPhone({ phoneNumber: normalizedLocal });
      const payload = response?.data?.data || {};
      setMaskedPhone(payload.maskedContact || "");

      const phoneE164 = normalizeVietnamPhoneNumberToE164(normalizedLocal);
      if (!phoneE164 || !phoneE164.startsWith("+")) {
        throw new Error("Số điện thoại không hợp lệ.");
      }

      console.log("Normalized phone:", phoneE164);

      if (force) {
        setConfirmationResult(null);
        confirmationResultRef.current = null;
        window.confirmationResult = null;
        resetRecaptcha();
      }

      const verifier = await ensureRecaptchaVerifier();
      console.log("Sending OTP...");
      const result = await signInWithPhoneNumber(auth, phoneE164, verifier);
      console.log("ConfirmationResult:", result);
      setConfirmationResult(result);
      confirmationResultRef.current = result;
      window.confirmationResult = result;
      setOtp("");
      setStep(2);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success("OTP đã được gửi");
    } catch (sendError) {
      resetRecaptcha();
      setError(sendError?.response?.data?.message || mapFirebaseError(sendError));
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async (event) => {
    event.preventDefault();
    const normalized = phoneNumber.trim();
    if (!normalized) {
      setError("Vui lòng nhập số điện thoại");
      return;
    }

    setError("");

    await sendPhoneOTPViaFirebase();
  };

  const handleVerifyOTP = async (event) => {
    event.preventDefault();
    if (otp.length !== 6) return;

    setLoading(true);
    setError("");

    try {
      console.log("Entered OTP:", otp);

      const effectiveConfirmationResult =
        confirmationResult || confirmationResultRef.current || window.confirmationResult;

      if (!effectiveConfirmationResult) {
        setLoading(false);
        setError("Vui lòng gửi OTP trước.");
        return;
      }

      const code = String(otp || "").trim();
      if (!/^\d{6}$/.test(code)) {
        setLoading(false);
        setError("OTP phải gồm đúng 6 chữ số.");
        return;
      }

      console.log("OTP:", code);
      const credential = await effectiveConfirmationResult.confirm(code);
      const idToken = await credential.user.getIdToken();

      const response = await authAPI.resetPassword({
        phoneNumber: phoneNumber.trim(),
        firebaseIdToken: idToken,
      });
      const payload = response?.data?.data || {};
      setResetToken(payload.resetToken || "");
      setStep(3);
      setLoading(false);
      toast.success("OTP hợp lệ. Vui lòng nhập mật khẩu mới.");
    } catch (verifyError) {
      setLoading(false);
      setError(verifyError?.response?.data?.message || mapFirebaseError(verifyError));
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();

    if (!resetToken) {
      setError("Phiên đặt lại mật khẩu không hợp lệ");
      return;
    }

    const checks = passwordPolicy(newPassword);
    const valid = checks.length && checks.lower && checks.upper && checks.number && checks.special;

    if (!valid) {
      setError("Mật khẩu mới chưa đạt điều kiện bảo mật");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Mật khẩu nhập lại không khớp");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await authAPI.resetPassword({
        resetToken,
        newPassword,
      });

      setLoading(false);
      toast.success("Đổi mật khẩu thành công");
      navigate("/login");
    } catch (resetError) {
      setLoading(false);
      setError(resetError?.response?.data?.message || "Không thể đổi mật khẩu");
    }
  };

  const handleResendOTP = async () => {
    if (resendCooldown > 0 || loading) return;
    await sendPhoneOTPViaFirebase();
  };

  return (
    <AuthLayout
      title="Quên mật khẩu"
      description="Nhập số điện thoại để nhận OTP, sau đó đặt lại mật khẩu."
      footer={
        <p className="text-center text-sm text-slate-600">
          Đã nhớ mật khẩu?{" "}
          <Link to="/login" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            Quay lại đăng nhập
          </Link>
        </p>
      }
    >
      {error ? <ErrorMessage message={error} /> : null}

      {step === 1 ? (
        <form className="space-y-4" onSubmit={handleContinue}>
          <FormInput
            label="Số điện thoại"
            name="phoneNumber"
            value={phoneNumber}
            onChange={(event) => {
              setError("");
              setPhoneNumber(event.target.value);
            }}
            placeholder="Ví dụ: 0912345678"
            required
          />

          <Button type="submit" className="h-11 w-full" disabled={loading}>
            {loading ? "Đang gửi OTP..." : "Gửi OTP"}
          </Button>
        </form>
      ) : null}

      {step === 2 ? (
        <form className="space-y-4" onSubmit={handleVerifyOTP}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            OTP đã gửi tới <strong>{maskedPhone || "số điện thoại của bạn"}</strong>.
          </div>

          <OTPInput value={otp} onChange={setOtp} disabled={loading} hasError={Boolean(error)} />

          <Button type="submit" className="h-11 w-full" disabled={loading || otp.length !== 6}>
            {loading ? "Đang xác nhận..." : "Xác nhận OTP"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={handleResendOTP}
            disabled={loading || resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Gửi lại OTP sau ${resendCooldown}s` : "Gửi lại OTP"}
          </Button>
        </form>
      ) : null}

      {step === 3 ? (
        <form className="space-y-4" onSubmit={handleResetPassword}>
          <FormInput
            label="Mật khẩu mới"
            name="newPassword"
            type="password"
            value={newPassword}
            onChange={(event) => {
              setError("");
              setNewPassword(event.target.value);
            }}
            required
          />

          <FormInput
            label="Nhập lại mật khẩu mới"
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => {
              setError("");
              setConfirmPassword(event.target.value);
            }}
            required
          />

          <div className="grid grid-cols-1 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
            <p className={passwordChecks.length ? "text-emerald-700" : ""}>• Ít nhất 8 ký tự</p>
            <p className={passwordChecks.lower ? "text-emerald-700" : ""}>• Có chữ thường</p>
            <p className={passwordChecks.upper ? "text-emerald-700" : ""}>• Có chữ hoa</p>
            <p className={passwordChecks.number ? "text-emerald-700" : ""}>• Có chữ số</p>
            <p className={passwordChecks.special ? "text-emerald-700 sm:col-span-2" : "sm:col-span-2"}>
              • Có ký tự đặc biệt
            </p>
          </div>

          <Button type="submit" className="h-11 w-full" disabled={loading}>
            {loading ? "Đang đổi mật khẩu..." : "Đổi mật khẩu"}
          </Button>
        </form>
      ) : null}

    </AuthLayout>
  );
};

export default ForgotPasswordPage;
