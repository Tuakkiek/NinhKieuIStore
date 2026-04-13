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
  if (code === "EMAIL_OTP_INVALID") return "OTP không dúng.";
  if (code === "EMAIL_OTP_SESSION_NOT_FOUND") return "OTP dã h?t h?n. Vui lòng g?i l?i mã m?i.";
  if (code === "EMAIL_OTP_TOO_MANY_ATTEMPTS") return "B?n dã nh?p sai quá nhi?u l?n.";
  return error?.response?.data?.message || "Không th? x? lý yêu c?u";
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
      setError("Email không h?p l?");
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
      toast.success("OTP dã du?c g?i t?i email c?a b?n");
    } catch (requestError) {
      setLoading(false);
      setError(requestError?.response?.data?.message || "Không th? g?i OTP");
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
      toast.success("Liên k?t email thành công");
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
      toast.success("Ðã g?i l?i OTP");
    } catch (resendError) {
      setLoading(false);
      setError(resendError?.response?.data?.message || "Không th? g?i l?i OTP");
    }
  };

  return (
    <AuthLayout
      title="Liên k?t email"
      description="Thêm email d? nh?n OTP khôi ph?c m?t kh?u và thông báo b?o m?t."
      footer={
        <p className="text-center text-sm text-slate-600">
          <Link to="/profile" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            Quay l?i h? so
          </Link>
        </p>
      }
    >
      {error ? <ErrorMessage message={error} /> : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {user?.email ? (
          <>
            Email hi?n t?i: <strong>{user.email}</strong>{" "}
            {user?.emailVerified ? "(dã xác th?c)" : "(chua xác th?c)"}
          </>
        ) : (
          <>
            <strong>B?n chua liên k?t email.</strong> Thêm email d? tang kh? nang khôi ph?c tài kho?n.
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
            {loading ? "Ðang g?i OTP..." : "G?i OTP"}
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={verifyOTP}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            OTP dã g?i t?i <strong>{otpSession?.maskedTarget || email}</strong>.
            <div className="mt-1 text-xs text-slate-500">Mã h?t h?n sau {formatCountdown(secondsToExpire)}</div>
          </div>

          <OTPInput value={otp} onChange={setOtp} hasError={Boolean(error)} disabled={loading || isExpired} />

          {isExpired ? (
            <p className="text-center text-sm font-medium text-amber-600">OTP dã h?t h?n. Vui lòng g?i l?i mã m?i.</p>
          ) : null}

          <Button type="submit" className="h-11 w-full" disabled={loading || otp.length !== 6 || isExpired}>
            {loading ? "Ðang xác nh?n..." : "Xác nh?n"}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={resendOTP}
            disabled={loading || resendCooldown > 0}
          >
            {resendCooldown > 0 ? `G?i l?i OTP sau ${resendCooldown}s` : "G?i l?i OTP"}
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
            Nh?p email khác
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default AddEmailPage;

