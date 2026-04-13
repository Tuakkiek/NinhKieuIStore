import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";
import OTPInput from "../components/OTPInput";
import { authAPI } from "../api/auth.api";

const RESEND_COOLDOWN_SECONDS = 60;

const passwordPolicy = (password = "") => ({
  length: password.length >= 8,
  lower: /[a-z]/.test(password),
  upper: /[A-Z]/.test(password),
  number: /[0-9]/.test(password),
  special: /[^A-Za-z0-9]/.test(password),
});

const formatCountdown = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const remain = String(safe % 60).padStart(2, "0");
  return `${minutes}:${remain}`;
};

const mapOTPError = (error) => {
  const code = error?.response?.data?.code;
  if (code === "FORGOT_PASSWORD_OTP_INVALID") return "OTP không đúng.";
  if (code === "FORGOT_PASSWORD_OTP_EXPIRED") return "OTP đã hết hạn. Vui lòng gửi lại mã mới.";
  if (code === "FORGOT_PASSWORD_OTP_TOO_MANY_ATTEMPTS") return "Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu OTP mới.";
  return error?.response?.data?.message || "Không thể xác thực OTP";
};

const ForgotPasswordPage = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [identifierType, setIdentifierType] = useState("");
  const [session, setSession] = useState(null);
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [secondsToExpire, setSecondsToExpire] = useState(0);

  const passwordChecks = useMemo(() => passwordPolicy(newPassword), [newPassword]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!session?.expiresAt) return undefined;

    const update = () => {
      const remain = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsToExpire(remain);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [session?.expiresAt]);

  const isOTPExpired = useMemo(
    () => Boolean(session?.expiresAt) && secondsToExpire <= 0,
    [session?.expiresAt, secondsToExpire],
  );

  const requestOTP = async (type) => {
    setLoading(true);
    setError("");

    try {
      const normalized = identifier.trim();
      const response =
        type === "EMAIL"
          ? await authAPI.forgotPasswordEmail({ email: normalized.toLowerCase() })
          : await authAPI.forgotPasswordPhone({ phoneNumber: normalized });

      const payload = response?.data?.data || {};

      setSession({
        sessionId: payload.sessionId,
        expiresAt: payload.expiresAt,
        channel: payload.channel,
        maskedContact: payload.maskedContact,
        devOTP: payload.devOTP,
      });
      setOtp("");
      setStep(3);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setLoading(false);

      if (payload.devOTP) {
        toast.message("SMS OTP mock", {
          description: `Mã OTP test: ${payload.devOTP}`,
        });
      } else {
        toast.success("OTP đã được gửi");
      }
    } catch (requestError) {
      setLoading(false);
      setError(requestError?.response?.data?.message || "Không thể gửi OTP");
    }
  };

  const handleContinue = async (event) => {
    event.preventDefault();
    const normalized = identifier.trim();
    if (!normalized) {
      setError("Vui lòng nhập số điện thoại hoặc email");
      return;
    }

    const isEmail = normalized.includes("@");
    setIdentifierType(isEmail ? "EMAIL" : "PHONE");
    setError("");

    if (isEmail) {
      setStep(2);
      return;
    }

    await requestOTP("PHONE");
  };

  const handleVerifyOTP = async (event) => {
    event.preventDefault();
    if (!session?.sessionId || otp.length !== 6) return;

    setLoading(true);
    setError("");

    try {
      const response = await authAPI.resetPassword({
        sessionId: session.sessionId,
        otp,
      });

      const payload = response?.data?.data || {};
      setResetToken(payload.resetToken || "");
      setStep(4);
      setLoading(false);
      toast.success("OTP hợp lệ. Vui lòng nhập mật khẩu mới.");
    } catch (verifyError) {
      setLoading(false);
      setError(mapOTPError(verifyError));
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
    await requestOTP(identifierType === "EMAIL" ? "EMAIL" : "PHONE");
  };

  return (
    <AuthLayout
      title="Quên mật khẩu"
      description="Khôi phục tài khoản bằng OTP qua email hoặc SMS."
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
            label="Số điện thoại hoặc Email"
            name="identifier"
            value={identifier}
            onChange={(event) => {
              setError("");
              setIdentifier(event.target.value);
            }}
            placeholder="Nhập số điện thoại hoặc email"
            required
          />

          <Button type="submit" className="h-11 w-full" disabled={loading}>
            {loading ? "Đang xử lý..." : "Tiếp tục"}
          </Button>
        </form>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            Bạn có muốn nhận OTP qua email <strong>{identifier.trim().toLowerCase()}</strong> không?
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button type="button" className="h-11" disabled={loading} onClick={() => requestOTP("EMAIL")}>
              {loading ? "Đang gửi..." : "Đồng ý"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={loading}
              onClick={() => {
                setStep(1);
                setIdentifierType("");
              }}
            >
              Hủy
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <form className="space-y-4" onSubmit={handleVerifyOTP}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            OTP đã gửi tới <strong>{session?.maskedContact || "liên hệ của bạn"}</strong>.
            <div className="mt-1 text-xs text-slate-500">Mã hết hạn sau {formatCountdown(secondsToExpire)}</div>
            {session?.devOTP ? (
              <div className="mt-1 text-xs font-medium text-amber-700">Mã OTP test (SMS mock): {session.devOTP}</div>
            ) : null}
          </div>

          <OTPInput value={otp} onChange={setOtp} disabled={loading || isOTPExpired} hasError={Boolean(error)} />

          {isOTPExpired ? (
            <p className="text-center text-sm font-medium text-amber-600">OTP đã hết hạn. Vui lòng gửi lại.</p>
          ) : null}

          <Button type="submit" className="h-11 w-full" disabled={loading || otp.length !== 6 || isOTPExpired}>
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

      {step === 4 ? (
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

