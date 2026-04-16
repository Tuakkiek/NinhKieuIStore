import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import { resolveAccessContext } from "../../middleware/authz/resolveAccessContext.js";
import { authorize } from "../../middleware/authz/authorize.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import {
  checkAvailability,
  getByStore,
  getConsolidatedInventory,
  getStoreInventoryComparison,
  getLowStockAlerts,
  getReplenishmentRecommendations,
  runReplenishmentSnapshotNow,
  getDemandPredictions,
  getSkuDemandPrediction,
  getRecentStockMovements,
} from "./inventoryController.js";
import {
  requestTransfer,
  getTransfers,
  getTransferById,
  approveTransfer,
  rejectTransfer,
  confirmShipment,
  confirmReceived,
  cancelTransfer,
} from "./transferController.js";

const router = express.Router();

// All inventory routes require auth + branch context
router.use(protect, resolveAccessContext);

// ── Inventory Read ──
router.get(
  "/check/:productId/:variantSku",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", resourceType: "INVENTORY" }),
  checkAvailability
);
router.get(
  "/store/:storeId",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  getByStore
);

// ── Inventory Dashboard ──
router.get(
  "/dashboard/consolidated",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  getConsolidatedInventory
);
router.get(
  "/dashboard/store-comparison",
  authorize(AUTHZ_ACTIONS.ANALYTICS_READ_BRANCH, { scopeMode: "branch", resourceType: "INVENTORY" }),
  getStoreInventoryComparison
);
router.get(
  "/dashboard/alerts",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  getLowStockAlerts
);
router.get(
  "/dashboard/replenishment",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  getReplenishmentRecommendations
);
router.post(
  "/dashboard/replenishment/run-snapshot",
  authorize(AUTHZ_ACTIONS.INVENTORY_WRITE, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  runReplenishmentSnapshotNow
);
router.get(
  "/dashboard/predictions",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  getDemandPredictions
);
router.get(
  "/dashboard/predictions/:variantSku",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  getSkuDemandPrediction
);
router.get(
  "/dashboard/movements",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  getRecentStockMovements
);

// ── Transfers ──
router.get(
  "/transfers",
  authorize(AUTHZ_ACTIONS.TRANSFER_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "TRANSFER" }),
  getTransfers
);
router.get(
  "/transfers/:id",
  authorize(AUTHZ_ACTIONS.TRANSFER_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "TRANSFER" }),
  getTransferById
);
router.post(
  "/transfers/request",
  authorize(AUTHZ_ACTIONS.TRANSFER_CREATE, { scopeMode: "global", resourceType: "TRANSFER" }),
  requestTransfer
);
router.put(
  "/transfers/:id/approve",
  approveTransfer
);
router.put(
  "/transfers/:id/reject",
  rejectTransfer
);
router.put(
  "/transfers/:id/confirm-shipment",
  authorize(AUTHZ_ACTIONS.TRANSFER_SHIP, { scopeMode: "branch", requireActiveBranch: true, resourceType: "TRANSFER" }),
  confirmShipment
);
router.put(
  "/transfers/:id/confirm-received",
  authorize(AUTHZ_ACTIONS.TRANSFER_RECEIVE, { scopeMode: "branch", requireActiveBranch: true, resourceType: "TRANSFER" }),
  confirmReceived
);

router.get(
  "/debug/inventory-by-sku/:sku",
  authorize(AUTHZ_ACTIONS.INVENTORY_READ, { scopeMode: "branch", requireActiveBranch: true, resourceType: "INVENTORY" }),
  async (req, res) => {
    try {
      const { sku } = req.params;
      const InventoryModel = (await import("../warehouse/Inventory.js")).default;
      const WarehouseLocationModel = (await import("../warehouse/WarehouseLocation.js")).default;

      const rows = await InventoryModel.find({ sku })
        .select("storeId sku quantity locationId locationCode status productId")
        .lean();

      const grouped = {};
      for (const row of rows) {
        const location = row.locationId
          ? await WarehouseLocationModel.findById(row.locationId)
              .select("storeId locationCode status")
              .lean()
          : null;
        const key = String(row.storeId || "unknown");
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({ row, location });
      }

      return res.json({ success: true, sku, grouped, rows });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);
router.put(
  "/transfers/:id/cancel",
  authorize(AUTHZ_ACTIONS.TRANSFER_CREATE, { scopeMode: "global", resourceType: "TRANSFER" }),
  cancelTransfer
);

export default router;
