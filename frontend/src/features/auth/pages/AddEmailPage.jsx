import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";
import OTPInput from "../components/OTPInput";
import { authAPI } from "../api/auth.api";
import { useAuthStore } from "../state/auth.store";
import { useAuthFlow } from "../context/AuthFlowContext";

const RESEND_COOLDOWN_SECONDS = 60;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatCountdown = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const remain = String(safe % 60).padStart(2, "0");
  return `${minutes}:${remain}`;
};

const mapErrorMessage = (error) => {
  const code = error?.response?.data?.code;
  if (code === "EMAIL_OTP_INVALID") return "OTP không đúng.";
  if (code === "EMAIL_OTP_SESSION_NOT_FOUND") return "OTP đã hết hạn. Vui lòng gửi lại mã mới.";
  if (code === "EMAIL_OTP_TOO_MANY_ATTEMPTS") return "Bạn đã nhập sai quá nhiều lần.";
  return error?.response?.data?.message || "Không thể xử lý yêu cầu";
};

const AddEmailPage = () => {
  const navigate = useNavigate();
  const { user, getCurrentUser } = useAuthStore();
  const {
    otpSession,
    loading,
    error,
    setLoading,
    setError,
    startOTPSession,
    clearOTPSession,
    markEmailVerified,
  } = useAuthFlow();

  const [email, setEmail] = useState(user?.email || "");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [secondsToExpire, setSecondsToExpire] = useState(0);

  const step = otpSession?.purpose === "ADD_EMAIL" && otpSession?.sessionId ? 2 : 1;

  useEffect(() => {
    if (step === 2) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }, [step, otpSession?.sessionId]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!otpSession?.expiresAt) return undefined;

    const update = () => {
      const remain = Math.max(
        0,
        Math.floor((new Date(otpSession.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsToExpire(remain);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [otpSession?.expiresAt]);

  const isExpired = useMemo(
    () => Boolean(otpSession?.expiresAt) && secondsToExpire <= 0,
    [otpSession?.expiresAt, secondsToExpire],
  );

  const requestOTP = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      setError("Email không hợp lệ");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await authAPI.addEmail({ email: normalizedEmail });
      const payload = response?.data?.data || {};

      startOTPSession({
        sessionId: payload.sessionId,
        purpose: "ADD_EMAIL",
        channel: "EMAIL",
        target: normalizedEmail,
        maskedTarget: payload.maskedEmail,
        expiresAt: payload.expiresAt,
      });
      setOtp("");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setLoading(false);
      toast.success("OTP đã được gửi tới email của bạn");
    } catch (requestError) {
      setLoading(false);
      setError(requestError?.response?.data?.message || "Không thể gửi OTP");
    }
  };

  const verifyOTP = async (event) => {
    event.preventDefault();
    if (!otpSession?.sessionId || otp.length !== 6) return;

    setLoading(true);
    setError("");

    try {
      await authAPI.verifyEmailOTP({
        sessionId: otpSession.sessionId,
        otp,
      });

      markEmailVerified();
      clearOTPSession();
      setOtp("");
      setLoading(false);
      await getCurrentUser();
      toast.success("Liên kết email thành công");
      navigate("/profile");
    } catch (verifyError) {
      setLoading(false);
      setError(mapErrorMessage(verifyError));
    }
  };

  const resendOTP = async () => {
    if (!otpSession?.sessionId || resendCooldown > 0) return;

    setLoading(true);
    setError("");

    try {
      const response = await authAPI.resendEmailOTP({ sessionId: otpSession.sessionId });
      const payload = response?.data?.data || {};
      startOTPSession({
        sessionId: payload.sessionId,
        purpose: "ADD_EMAIL",
        channel: "EMAIL",
        target: otpSession.target,
        maskedTarget: payload.maskedEmail,
        expiresAt: payload.expiresAt,
      });
      setOtp("");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setLoading(false);
      toast.success("Đã gửi lại OTP");
    } catch (resendError) {
      setLoading(false);
      setError(resendError?.response?.data?.message || "Không thể gửi lại OTP");
    }
  };

  return (
    <AuthLayout
      title="Liên kết email"
      description="Thêm email để nhận OTP khôi phục mật khẩu và thông báo bảo mật."
      footer={
        <p className="text-center text-sm text-slate-600">
          <Link to="/profile" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            Quay lại hồ sơ
          </Link>
        </p>
      }
    >
      {error ? <ErrorMessage message={error} /> : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {user?.email ? (
          <>
            Email hiện tại: <strong>{user.email}</strong>{" "}
            {user?.emailVerified ? "(đã xác thực)" : "(chưa xác thực)"}
          </>
        ) : (
          <>
            <strong>Bạn chưa liên kết email.</strong> Thêm email để tăng khả năng khôi phục tài khoản.
          </>
        )}
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <FormInput
            label="Email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => {
              setError("");
              setEmail(event.target.value);
            }}
            placeholder="your-email@example.com"
            required
          />
          <Button type="button" className="h-11 w-full" disabled={loading} onClick={requestOTP}>
            {loading ? "Đang gửi OTP..." : "Gửi OTP"}
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={verifyOTP}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            OTP đã gửi tới <strong>{otpSession?.maskedTarget || email}</strong>.
            <div className="mt-1 text-xs text-slate-500">Mã hết hạn sau {formatCountdown(secondsToExpire)}</div>
          </div>

          <OTPInput value={otp} onChange={setOtp} hasError={Boolean(error)} disabled={loading || isExpired} />

          {isExpired ? (
            <p className="text-center text-sm font-medium text-amber-600">OTP đã hết hạn. Vui lòng gửi lại mã mới.</p>
          ) : null}

          <Button type="submit" className="h-11 w-full" disabled={loading || otp.length !== 6 || isExpired}>
            {loading ? "Đang xác nhận..." : "Xác nhận"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={resendOTP}
            disabled={loading || resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Gửi lại OTP sau ${resendCooldown}s` : "Gửi lại OTP"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full"
            onClick={() => {
              clearOTPSession();
              setOtp("");
              setError("");
            }}
            disabled={loading}
          >
            Nhập email khác
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default AddEmailPage;

