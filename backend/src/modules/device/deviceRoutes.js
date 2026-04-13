import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import { resolveAccessContext } from "../../middleware/authz/resolveAccessContext.js";
import { authorize } from "../../middleware/authz/authorize.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import controller from "./deviceController.js";

const router = express.Router();

router.use(protect, resolveAccessContext);

router.get(
  "/",
  authorize(AUTHZ_ACTIONS.DEVICE_READ, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.listDevices
);

router.get(
  "/available",
  authorize(AUTHZ_ACTIONS.DEVICE_READ, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.getAvailableDevices
);

router.post(
  "/register",
  authorize(AUTHZ_ACTIONS.DEVICE_WRITE, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.registerDevice
);

router.post(
  "/import",
  authorize(AUTHZ_ACTIONS.DEVICE_WRITE, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.importDevices
);

// Assign IMEI/Serial to a specific order (post-payment / ready-to-ship)
router.get(
  "/imei-assign/orders",
  authorize(AUTHZ_ACTIONS.DEVICE_READ, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.listEligibleOrdersForImeiAssignment
);

router.get(
  "/imei-assign/orders/:id",
  authorize(AUTHZ_ACTIONS.DEVICE_READ, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.getEligibleOrderForImeiAssignment
);

router.post(
  "/imei-assign/assign",
  authorize(AUTHZ_ACTIONS.DEVICE_WRITE, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.assignImeiToOrder
);

router.get(
  "/:id",
  authorize(AUTHZ_ACTIONS.DEVICE_READ, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.getDeviceById
);

router.get(
  "/:id/history",
  authorize(AUTHZ_ACTIONS.DEVICE_READ, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.getDeviceHistory
);

router.patch(
  "/:id/service-state",
  authorize(AUTHZ_ACTIONS.DEVICE_WRITE, {
    scopeMode: "branch",
    requireActiveBranch: true,
    resourceType: "DEVICE",
  }),
  controller.updateDeviceServiceState
);

export default router;
