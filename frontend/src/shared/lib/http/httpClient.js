import axios from "axios";
import { setupStepUpInterceptor } from "./stepUpInterceptor.js";

const BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? `${window.location.origin}/api` : "/api");

console.info("🚀 [HTTP Setup] Kích hoạt API Client với cấu hình:", {
  env_VITE_API_URL: import.meta.env.VITE_API_URL,
  mode: import.meta.env.MODE,
  isProd: import.meta.env.PROD,
  finalBaseUrl: BASE_URL,
  origin: window.location.origin,
  ...(import.meta.env.PROD &&
    !BASE_URL.startsWith("http") && {
      PROD_WARNING:
        "Relative /api detected in PROD. Set VITE_API_URL=https://ninhkieu-istore-ct.onrender.com/api on Render for best perf/IPv6 handling",
    }),
});

const normalizeBranchId = (value) => {
  if (!value) return "";
  return String(value).trim();
};

const toAllowedBranchIds = (authz) => {
  const raw = Array.isArray(authz?.allowedBranchIds)
    ? authz.allowedBranchIds
    : [];
  return [...new Set(raw.map(normalizeBranchId).filter(Boolean))];
};

const resolveAuthorizationState = (state) =>
  state?.authorization || state?.authz || null;

const isGlobalAdminState = (state) => {
  const authz = resolveAuthorizationState(state);
  return Boolean(authz?.isGlobalAdmin);
};

const isBranchScopedStaffState = (state) => {
  const authz = resolveAuthorizationState(state);
  if (isGlobalAdminState(state)) return false;
  return authz?.requiresBranchAssignment === true;
};

const deriveFixedBranchIdFromState = (state) => {
  const authz = resolveAuthorizationState(state);
  const allowedBranchIds = toAllowedBranchIds(authz);
  const authzActiveBranchId = normalizeBranchId(authz?.activeBranchId);

  if (authzActiveBranchId) {
    if (
      allowedBranchIds.length === 0 ||
      allowedBranchIds.includes(authzActiveBranchId)
    ) {
      return authzActiveBranchId;
    }
  }

  if (allowedBranchIds.length > 0) {
    return allowedBranchIds[0];
  }
  return "";
};

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

// Đăng ký step-up interceptor ngay sau khi tạo instance
setupStepUpInterceptor(api);

api.interceptors.request.use(
  (config) => {
    const authStorage = localStorage.getItem("auth-storage");
    if (authStorage) {
      try {
        const { state } = JSON.parse(authStorage);
        const token = state?.token;
        const authz = resolveAuthorizationState(state);
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        const allowedBranchIds = toAllowedBranchIds(authz);
        const fixedBranchId = deriveFixedBranchIdFromState(state);
        const mutableBranchId = normalizeBranchId(state?.activeBranchId);
        const contextMode = String(
          state?.contextMode || authz?.contextMode || "STANDARD",
        )
          .trim()
          .toUpperCase();
        const simulatedBranchId = normalizeBranchId(
          state?.simulatedBranchId || authz?.simulatedBranchId,
        );

        let activeBranchId = "";
        if (isBranchScopedStaffState(state)) {
          activeBranchId = fixedBranchId;
        } else if (
          isGlobalAdminState(state) &&
          contextMode === "SIMULATED" &&
          simulatedBranchId
        ) {
          activeBranchId = simulatedBranchId;
        } else if (mutableBranchId) {
          activeBranchId = mutableBranchId;
        } else {
          activeBranchId = fixedBranchId;
        }

        if (
          activeBranchId &&
          allowedBranchIds.length > 0 &&
          !allowedBranchIds.includes(activeBranchId) &&
          !isGlobalAdminState(state)
        ) {
          activeBranchId = fixedBranchId;
        }

        if (activeBranchId) {
          config.headers["X-Active-Branch-Id"] = activeBranchId;
        }

        if (
          isGlobalAdminState(state) &&
          contextMode === "SIMULATED" &&
          simulatedBranchId
        ) {
          config.headers["X-Simulate-Branch-Id"] = simulatedBranchId;
        } else if (config.headers["X-Simulate-Branch-Id"]) {
          delete config.headers["X-Simulate-Branch-Id"];
        }
      } catch (error) {
        console.error("Error parsing auth-storage:", error);
      }
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// 🔄 Network Retry + Enhanced Error Handler
const createRetryInterceptor = (axiosInstance) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_BASE = 1000;

  return axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config || {};
      config.retryCount = (config.retryCount || 0) + 1;

      const isRetryableNetworkError =
        error.code === "ENOTFOUND" ||
        error.code === "ENETUNREACH" ||
        error.code === "ERR_NETWORK" ||
        error.code === "ECONNREFUSED" ||
        (error.message &&
          (error.message.includes("Network Error") ||
            error.message.includes("Failed to fetch")));

      if (isRetryableNetworkError && config.retryCount <= MAX_RETRIES) {
        const delay = RETRY_DELAY_BASE * Math.pow(2, config.retryCount - 1); // Exponential backoff
        console.warn(
          `🔄 [Network Retry ${config.retryCount}/${MAX_RETRIES}] ${config.url || "unknown"}: ${error.code || error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return axiosInstance(config);
      }

      // Enhanced logging
      console.error("🚨 [HTTP Error]", {
        message: error?.message,
        code: error?.code,
        name: error?.name,
        url: error?.config?.url,
        method: error?.config?.method,
        baseURL: error?.config?.baseURL,
        status: error?.response?.status,
        retryCount: config.retryCount - 1,
        isNetworkError: isRetryableNetworkError,
        isBrowserOnline:
          typeof navigator !== "undefined" ? navigator.onLine : "unknown",
      });

      return Promise.reject(error);
    },
  );
};

// Register retry handler (replaces original response interceptor)
const retryInterceptorId = createRetryInterceptor(api);

// Keep separate auth logic interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      !String(error.config?.url || "").includes("/auth/login")
    ) {
      localStorage.removeItem("auth-storage");
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }
    return Promise.reject(error);
  },
);

export default api;
