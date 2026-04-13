/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo, useState } from "react";

const AuthFlowContext = createContext(null);

const initialVerifyState = {
  emailVerified: false,
  lastVerifiedAt: null,
};

export const AuthFlowProvider = ({ children }) => {
  const [otpSession, setOtpSession] = useState(null);
  const [verifyState, setVerifyState] = useState(initialVerifyState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startOTPSession = (nextSession = {}) => {
    setOtpSession({
      sessionId: nextSession.sessionId || "",
      purpose: nextSession.purpose || "",
      channel: nextSession.channel || "",
      target: nextSession.target || "",
      maskedTarget: nextSession.maskedTarget || "",
      expiresAt: nextSession.expiresAt || null,
      retryAfterSeconds: Number(nextSession.retryAfterSeconds || 0),
      meta: nextSession.meta || {},
    });
  };

  const clearOTPSession = () => setOtpSession(null);

  const markEmailVerified = () => {
    setVerifyState({
      emailVerified: true,
      lastVerifiedAt: new Date().toISOString(),
    });
  };

  const resetFlowState = () => {
    setOtpSession(null);
    setVerifyState(initialVerifyState);
    setLoading(false);
    setError("");
  };

  const value = useMemo(
    () => ({
      otpSession,
      verifyState,
      loading,
      error,
      setLoading,
      setError,
      startOTPSession,
      clearOTPSession,
      markEmailVerified,
      resetFlowState,
    }),
    [otpSession, verifyState, loading, error],
  );

  return <AuthFlowContext.Provider value={value}>{children}</AuthFlowContext.Provider>;
};

export const useAuthFlow = () => {
  const context = useContext(AuthFlowContext);
  if (!context) {
    throw new Error("useAuthFlow must be used within AuthFlowProvider");
  }
  return context;
};

export default AuthFlowContext;
