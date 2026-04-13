export { authAPI } from "./api/auth.api";
export { default as PermissionGate } from "./components/PermissionGate";
export { default as StepUpModal } from "./components/StepUpModal";
export { default as SensitiveAction } from "./components/SensitiveAction";
export { default as AuthLayout } from "./components/AuthLayout";
export { default as FormInput } from "./components/FormInput";
export { default as OTPInput } from "./components/OTPInput";
export { default as LoginPage } from "./pages/LoginPage";
export { default as RegisterPage } from "./pages/RegisterPage";
export { default as VerifyEmailPage } from "./pages/VerifyEmailPage";
export { default as ForgotPasswordPage } from "./pages/ForgotPasswordPage";
export { default as AddEmailPage } from "./pages/AddEmailPage";
export { useAuthStore } from "./state/auth.store";
export { usePermission } from "./hooks/usePermission";
export { useStepUp } from "./hooks/useStepUp";
export { AuthFlowProvider, useAuthFlow } from "./context/AuthFlowContext";
export {
  isActionSensitive,
  getGracePeriodExpiry,
  SENSITIVE_ACTIONS,
} from "./lib/authorization";
