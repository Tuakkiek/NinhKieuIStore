import { api } from "@/shared/lib/http/httpClient";

export const authAPI = {
  register: (data) => api.post("/auth/register", data),
  login: (data) => api.post("/auth/login", data),
  logout: () => api.post("/auth/logout"),
  getCurrentUser: () => api.get("/auth/me"),
  getEffectivePermissions: () => api.get("/auth/context/permissions"),
  setActiveBranchContext: (data) => api.put("/auth/context/active-branch", data),
  setSimulatedBranchContext: (data) => api.put("/auth/context/simulate-branch", data),
  clearSimulatedBranchContext: () => api.delete("/auth/context/simulate-branch"),
  changePassword: (data) => api.put("/auth/change-password", data),
  updateAvatar: (avatar) => api.put("/auth/avatar", { avatar }),
  checkCustomer: (phoneNumber) =>
    api.get("/auth/check-customer", { params: { phoneNumber } }),
  quickRegister: (data) => api.post("/auth/quick-register", data),

  // Step-up Authentication endpoints
  requestStepUp: (data) => api.post("/auth/step-up/request", data),
  verifyStepUp: (data) => api.post("/auth/step-up/verify", data),
  resendOTP: (data) => api.post("/auth/step-up/resend", data),
  getStepUpStatus: (action) => api.get("/auth/step-up/status", { params: { action } }),

  // Email Verification endpoints
  sendEmailOTP: (data) => api.post("/auth/send-email-otp", data),
  verifyEmailOTP: (data) => api.post("/auth/verify-email-otp", data),
  resendEmailOTP: (data) => api.post("/auth/resend-email-otp", data),
};
