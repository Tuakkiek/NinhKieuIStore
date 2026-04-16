import { api } from "@/shared/lib/http/httpClient";

export const inventoryAPI = {
  checkAvailability: (productId, variantSku, province) =>
    api.get(`/inventory/check/${productId}/${variantSku}`, {
      params: { province },
    }),
  getByStore: (storeId, params = {}) =>
    api.get(`/inventory/store/${storeId}`, { params }),
  getConsolidated: (params = {}) =>
    api.get("/inventory/dashboard/consolidated", { params }),
  getStoreComparison: (params = {}) =>
    api.get("/inventory/dashboard/store-comparison", { params }),
  getAlerts: (params = {}) => api.get("/inventory/dashboard/alerts", { params }),
  getReplenishment: (params = {}) =>
    api.get("/inventory/dashboard/replenishment", { params }),
  runReplenishmentSnapshot: () =>
    api.post("/inventory/dashboard/replenishment/run-snapshot"),
  getPredictions: (params = {}) =>
    api.get("/inventory/dashboard/predictions", { params }),
  getPredictionBySku: (variantSku, params = {}) =>
    api.get(`/inventory/dashboard/predictions/${variantSku}`, { params }),
  getMovements: (params = {}) =>
    api.get("/inventory/dashboard/movements", { params }),
};

export const stockTransferAPI = {
  getAll: (params = {}) => api.get("/inventory/transfers", { params }),
  getById: (id) => api.get(`/inventory/transfers/${id}`),
  request: (data) => api.post("/inventory/transfers/request", data),
  confirmShipment: (id, data = {}) =>
    api.put(`/inventory/transfers/${id}/confirm-shipment`, data),
  confirmReceived: (id, data = {}) =>
    api.put(`/inventory/transfers/${id}/confirm-received`, data),
  cancel: (id, data = {}) => api.put(`/inventory/transfers/${id}/cancel`, data),
};

export const monitoringAPI = {
  getRolloutDecision: () => api.get("/monitoring/omnichannel/rollout"),
  getOmnichannelSummary: (params = {}) =>
    api.get("/monitoring/omnichannel/summary", { params }),
  getOmnichannelEvents: (params = {}) =>
    api.get("/monitoring/omnichannel/events", { params }),
};
