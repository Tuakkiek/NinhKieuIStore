import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import AuthLayout from "../components/AuthLayout";
import OTPInput from "../components/OTPInput";
import { authAPI } from "../api/auth.api";
import { useAuthStore } from "../state/auth.store";
import { useAuthFlow } from "../context/AuthFlowContext";

const RESEND_COOLDOWN_SECONDS = 60;

const formatCountdown = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const remaining = String(safe % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
};

const mapVerifyErrorMessage = (error) => {
  const code = error?.response?.data?.code;
  if (code === "EMAIL_OTP_INVALID") return "OTP không dúng.";
  if (code === "EMAIL_OTP_SESSION_NOT_FOUND") return "OTP dã h?t h?n. Vui lòng yêu c?u mã m?i.";
  if (code === "EMAIL_OTP_TOO_MANY_ATTEMPTS") return "B?n dã nh?p sai quá nhi?u l?n. Vui lòng g?i l?i OTP.";
  return error?.response?.data?.message || "Không th? xác th?c OTP";
};

const VerifyEmailPage = () => {
  const navigate = useNavigate();
  const { getCurrentUser } = useAuthStore();
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

  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [secondsToExpire, setSecondsToExpire] = useState(0);

  useEffect(() => {
    if (!otpSession?.sessionId) return;
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }, [otpSession?.sessionId]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (!otpSession?.expiresAt) return undefined;

    const update = () => {
      const value = Math.max(
        0,
        Math.floor((new Date(otpSession.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsToExpire(value);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [otpSession?.expiresAt]);

  const isExpired = useMemo(() => secondsToExpire <= 0 && Boolean(otpSession?.expiresAt), [secondsToExpire, otpSession?.expiresAt]);

  const handleVerify = async (event) => {
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
      toast.success("Xác th?c email thành công");
      navigate("/profile");
    } catch (verifyError) {
      setLoading(false);
      setError(mapVerifyErrorMessage(verifyError));
    }
  };

  const handleResend = async () => {
    if (!otpSession?.sessionId || resendCooldown > 0) return;

    setLoading(true);
    setError("");

    try {
      const response = await authAPI.resendEmailOTP({ sessionId: otpSession.sessionId });
      const payload = response?.data?.data || {};

      startOTPSession({
        sessionId: payload.sessionId,
        purpose: otpSession.purpose,
        channel: otpSession.channel,
        target: otpSession.target,
        maskedTarget: payload.maskedEmail,
        expiresAt: payload.expiresAt,
      });
      setOtp("");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setLoading(false);
      toast.success("OTP m?i dã du?c g?i");
    } catch (resendError) {
      setLoading(false);
      setError(resendError?.response?.data?.message || "Không th? g?i l?i OTP");
    }
  };

  if (!otpSession?.sessionId) {
    return (
      <AuthLayout
        title="Xác th?c email"
        description="B?n chua có phiên OTP ho?t d?ng."
        footer={
          <p className="text-center text-sm text-slate-600">
            <Link to="/register" className="font-medium text-slate-900 underline-offset-4 hover:underline">
              Quay l?i dang ký
            </Link>
          </p>
        }
      >
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Vui lòng dang ký ho?c yêu c?u OTP xác th?c email tru?c khi truy c?p trang này.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Xác th?c email"
      description={`Nh?p mã OTP 6 s? dã g?i t?i ${otpSession.maskedTarget || "email c?a b?n"}.`}
      footer={
        <div className="flex items-center justify-between text-sm text-slate-600">
          <button
            type="button"
            onClick={() => navigate("/profile")}
            className="font-medium text-slate-700 underline-offset-4 hover:text-slate-900 hover:underline"
          >
            Ð? sau
          </button>
          <span>Mã h?t h?n sau {formatCountdown(secondsToExpire)}</span>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleVerify}>
        {error ? <ErrorMessage message={error} /> : null}

        <OTPInput value={otp} onChange={setOtp} hasError={Boolean(error)} disabled={loading || isExpired} />

        {isExpired ? (
          <p className="text-center text-sm font-medium text-amber-600">OTP dã h?t h?n. Vui lòng g?i l?i mã m?i.</p>
        ) : null}

        <Button type="submit" className="h-11 w-full" disabled={loading || otp.length !== 6 || isExpired}>
          {loading ? "Ðang xác th?c..." : "Xác nh?n"}
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={handleResend}
          disabled={loading || resendCooldown > 0}
        >
          {resendCooldown > 0 ? `G?i l?i OTP sau ${resendCooldown}s` : "G?i l?i OTP"}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default VerifyEmailPage;

