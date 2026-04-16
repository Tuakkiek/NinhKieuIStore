import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import resolveAccessContext from "../../middleware/authz/resolveAccessContext.js";
import { authorize } from "../../middleware/authz/authorize.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import {
  updateProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  getAllEmployees,
  createEmployee,
  toggleEmployeeStatus,
  deleteEmployee,
  updateEmployeeAvatar,
  updateEmployee,
  updateUserRoles,
  getAllShippers,
  createUserWithPermissions,
  getPermissionsCatalogController,
  getPermissionTemplatesController,
  getEffectivePermissionsForUser,
  getUserAuthorization,
  getUserRoleAssignments,
  getUserPermissionGrants,
  updateUserRoleAssignments,
  updateUserPermissionGrants,
  updateUserPermissions,
  previewPermissionAssignments,
} from "./userController.js";

const router = express.Router();

const resolveUserScopeMode = (req) => (req.authz?.isGlobalAdmin ? "global" : "branch");

const requireUsersRead = [
  resolveAccessContext,
  authorize(null, {
    anyOf: [
      AUTHZ_ACTIONS.USERS_READ_BRANCH,
      AUTHZ_ACTIONS.USERS_MANAGE_BRANCH,
      AUTHZ_ACTIONS.USERS_MANAGE_GLOBAL,
      AUTHZ_ACTIONS.ORDERS_READ,
    ],
    scopeMode: resolveUserScopeMode,
    requireActiveBranchFor: ["branch"],
    resourceType: "USER",
  }),
];

const requireUsersManage = [
  resolveAccessContext,
  authorize(null, {
    anyOf: [AUTHZ_ACTIONS.USERS_MANAGE_BRANCH, AUTHZ_ACTIONS.USERS_MANAGE_GLOBAL],
    scopeMode: resolveUserScopeMode,
    requireActiveBranchFor: ["branch"],
    resourceType: "USER",
  }),
];

const requireOrdersRead = [
  resolveAccessContext,
  authorize(AUTHZ_ACTIONS.ORDERS_READ, {
    scopeMode: resolveUserScopeMode,
    requireActiveBranchFor: ["branch"],
    resourceType: "USER",
  }),
];

router.use(protect);

// Customer routes
router.put(
  "/profile",
  resolveAccessContext,
  authorize(AUTHZ_ACTIONS.ACCOUNT_PROFILE_UPDATE_SELF, {
    scopeMode: "self",
    resourceType: "ACCOUNT",
  }),
  updateProfile
);
router.post(
  "/addresses",
  resolveAccessContext,
  authorize(AUTHZ_ACTIONS.ACCOUNT_ADDRESS_MANAGE_SELF, {
    scopeMode: "self",
    resourceType: "ACCOUNT",
  }),
  addAddress
);
router.put(
  "/addresses/:addressId",
  resolveAccessContext,
  authorize(AUTHZ_ACTIONS.ACCOUNT_ADDRESS_MANAGE_SELF, {
    scopeMode: "self",
    resourceType: "ACCOUNT",
  }),
  updateAddress
);
router.delete(
  "/addresses/:addressId",
  resolveAccessContext,
  authorize(AUTHZ_ACTIONS.ACCOUNT_ADDRESS_MANAGE_SELF, {
    scopeMode: "self",
    resourceType: "ACCOUNT",
  }),
  deleteAddress
);

// Permission catalog and template APIs
router.get("/permissions/catalog", ...requireUsersManage, getPermissionsCatalogController);
router.get("/permissions/templates", ...requireUsersManage, getPermissionTemplatesController);
router.post("/permissions/preview", ...requireUsersManage, previewPermissionAssignments);

// User CRUD and permission management
router.get("/employees", ...requireUsersRead, getAllEmployees);
router.post("/employees", ...requireUsersManage, createEmployee);
router.put("/employees/:id", ...requireUsersManage, updateEmployee);
router.put("/employees/:id/avatar", ...requireUsersManage, updateEmployeeAvatar);
router.patch("/employees/:id/toggle-status", ...requireUsersManage, toggleEmployeeStatus);
router.delete("/employees/:id", ...requireUsersManage, deleteEmployee);
router.get("/shippers", ...requireOrdersRead, getAllShippers);

// New granular permission endpoints
router.post("/", ...requireUsersManage, createUserWithPermissions);
router.put("/:id/permissions", ...requireUsersManage, updateUserPermissions);
router.put("/:id/roles", ...requireUsersManage, updateUserRoles);
router.get("/:id/authorization", ...requireUsersManage, getUserAuthorization);
router.get("/:id/role-assignments", ...requireUsersManage, getUserRoleAssignments);
router.put("/:id/role-assignments", ...requireUsersManage, updateUserRoleAssignments);
router.get("/:id/permission-grants", ...requireUsersManage, getUserPermissionGrants);
router.put("/:id/permission-grants", ...requireUsersManage, updateUserPermissionGrants);
router.get("/:id/effective-permissions", ...requireUsersManage, getEffectivePermissionsForUser);

export default router;
