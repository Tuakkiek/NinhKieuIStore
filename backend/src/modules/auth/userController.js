import User from "./User.js";
import { deriveAuthzWriteFromLegacyInput } from "../../authz/userAccessResolver.js";
import mongoose from "mongoose";
import Store from "../store/Store.js";
import {
  ensurePermissionCatalogSeeded,
  getPermissionCatalog,
} from "../../authz/permissionCatalog.js";
import {
  ensurePermissionTemplatesSeeded,
  getPermissionTemplates,
} from "../../authz/permissionTemplateService.js";
import {
  applyUserPermissionAssignments,
  loadActiveUserPermissionGrants,
  normalizeRequestedPermissionAssignments,
  validateGrantAntiEscalation,
} from "../../authz/userPermissionService.js";
import { resolveEffectiveAccessContext } from "../../authz/authorizationService.js";
import { SYSTEM_ROLES, BRANCH_ROLES, TASK_ROLES } from "../../authz/actions.js";
import { omniLog } from "../../utils/logger.js";
import {
  normalizeRequestedRoleAssignments as normalizeCanonicalRoleAssignments,
  syncUserRoleAssignments,
} from "../../authz/roleAssignmentService.js";

const BRANCH_REQUIRED_EMPLOYEE_ROLES = new Set([
  "ADMIN",
  "BRANCH_ADMIN",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_STAFF",
  "PRODUCT_MANAGER",
  "ORDER_MANAGER",
  "POS_STAFF",
  "CASHIER",
  "CASHIER",
]);

const LEGACY_ROLE_TO_CANONICAL_BRANCH_ROLE = Object.freeze({
  ADMIN: "BRANCH_ADMIN",
});

const CANONICAL_BRANCH_ROLE_TO_LEGACY_ROLE = Object.freeze({
  BRANCH_ADMIN: "ADMIN",
});

const normalizeText = (value) => String(value || "").trim();
const toUniqueStrings = (items = []) =>
  Array.from(new Set(items.map((item) => normalizeText(item)).filter(Boolean)));

const toAppError = (status, code, message, details = null) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
};

const collectDirectPermissionKeys = (grants = []) =>
  toUniqueStrings(
    (Array.isArray(grants) ? grants : []).map((grant) =>
      normalizeText(grant?.key).toLowerCase(),
    ),
  ).sort();

const collectBranchIds = (payload = {}) => {
  const directBranchIds = Array.isArray(payload.branchIds)
    ? payload.branchIds
    : [];
  const scopedBranchIds = Array.isArray(payload?.branchScope?.branchIds)
    ? payload.branchScope.branchIds
    : [];

  const fallbackBranchId =
    normalizeText(payload?.branchScope?.primaryBranchId) ||
    normalizeText(payload.storeLocation);

  return toUniqueStrings([
    ...directBranchIds,
    ...scopedBranchIds,
    fallbackBranchId,
  ]);
};

const collectTemplateKeys = (payload = {}) => {
  const singleTemplate = normalizeText(payload.templateKey);
  const bulkTemplates = Array.isArray(payload.templateKeys)
    ? payload.templateKeys
    : [];
  return toUniqueStrings([singleTemplate, ...bulkTemplates]).map((item) =>
    item.toUpperCase(),
  );
};

const hasGranularPermissionPayload = (payload = {}) => {
  return (
    payload?.enableGranularPermissions === true ||
    (Array.isArray(payload?.permissions) && payload.permissions.length > 0) ||
    !!normalizeText(payload?.templateKey) ||
    (Array.isArray(payload?.templateKeys) && payload.templateKeys.length > 0)
  );
};

const hasCanonicalRolePayload = (payload = {}) => {
  return (
    (Array.isArray(payload?.roleAssignments) && payload.roleAssignments.length > 0) ||
    (Array.isArray(payload?.roleKeys) && payload.roleKeys.length > 0)
  );
};

const assertActorBranchScope = (req, branchIds = []) => {
  if (req?.authz?.isGlobalAdmin || !branchIds.length) {
    return;
  }

  const allowedBranches = Array.isArray(req?.authz?.allowedBranchIds)
    ? req.authz.allowedBranchIds.map((item) => normalizeText(item))
    : [];
  const forbidden = branchIds.filter(
    (branchId) => !allowedBranches.includes(normalizeText(branchId)),
  );

  if (forbidden.length) {
    throw toAppError(
      403,
      "AUTHZ_BRANCH_FORBIDDEN",
      "Cannot assign user to branch outside actor scope",
      { forbiddenBranchIds: forbidden },
    );
  }
};

const extractUserBranchIds = (user = {}) => {
  const assignmentBranchIds = Array.isArray(user?.branchAssignments)
    ? user.branchAssignments.map((item) => item?.storeId)
    : [];
  return toUniqueStrings([user?.storeLocation, ...assignmentBranchIds]);
};

const assertActorCanManageTargetUser = (req, user = {}) => {
  if (req?.authz?.isGlobalAdmin) {
    return;
  }

  const actorAllowedBranches = Array.isArray(req?.authz?.allowedBranchIds)
    ? req.authz.allowedBranchIds.map((item) => normalizeText(item))
    : [];
  const targetBranches = extractUserBranchIds(user);

  if (!targetBranches.length) {
    return;
  }

  const forbidden = targetBranches.filter(
    (branchId) => !actorAllowedBranches.includes(normalizeText(branchId)),
  );
  if (forbidden.length) {
    throw toAppError(
      403,
      "AUTHZ_BRANCH_FORBIDDEN",
      "Cannot manage user outside actor branch scope",
      { forbiddenBranchIds: forbidden },
    );
  }
};

const assertActorCanAssignRole = (req, role) => {
  if (req?.authz?.isGlobalAdmin) {
    return;
  }

  const normalizedRole = normalizeText(role).toUpperCase();
  if (normalizedRole === "GLOBAL_ADMIN") {
    throw toAppError(
      403,
      "AUTHZ_ROLE_FORBIDDEN",
      "Only global admin can assign GLOBAL_ADMIN role",
    );
  }
};

const assertActorCanAssignRoles = (req, roles = []) => {
  for (const role of roles) {
    assertActorCanAssignRole(req, role);
  }
};

const resolveCanonicalRoleAssignmentsFromPayload = async (req, payload = {}) => {
  await ensurePermissionTemplatesSeeded();
  const normalizedAssignments = await normalizeCanonicalRoleAssignments(payload);
  if (!normalizedAssignments.length) {
    throw toAppError(
      400,
      "AUTHZ_ROLE_ASSIGNMENTS_REQUIRED",
      "At least one valid role assignment is required",
    );
  }
  const roleKeys = normalizedAssignments.map((assignment) => assignment.roleKey);
  assertActorCanAssignRoles(req, roleKeys);

  const branchIds = normalizedAssignments
    .filter((assignment) => String(assignment.scopeType || "").toUpperCase() === "BRANCH")
    .map((assignment) => assignment.scopeRef);
  assertActorBranchScope(req, branchIds);

  return normalizedAssignments;
};

const syncExplicitPermissionsForUser = async ({
  req,
  user,
  payload,
  reason = "",
}) => {
  await ensurePermissionTemplatesSeeded();
  const templateKeys = collectTemplateKeys(payload);
  const branchIds = collectBranchIds(payload);
  const requestedPermissions = Array.isArray(payload.permissions)
    ? payload.permissions
    : [];

  omniLog.debug("authz.permissionSync.request", {
    targetUserId: String(user?._id || ""),
    actorId: req?.user?._id ? String(req.user._id) : "",
    permissionCount: requestedPermissions.length,
    permissionKeys: requestedPermissions
      .map((item) => normalizeText(item?.key || item?.permissionKey))
      .filter(Boolean)
      .slice(0, 12),
    templateKeys,
    branchIdCount: branchIds.length,
    legacyPermissionMode: user?.permissionMode || "",
    reason,
  });

  const { assignments, errors } = await normalizeRequestedPermissionAssignments(
    {
      permissions: Array.isArray(payload.permissions)
        ? payload.permissions
        : [],
      templateKeys,
      branchIds,
      targetUserId: String(user._id),
    },
  );

  if (errors.length) {
    omniLog.warn("authz.permissionSync.invalidPayload", {
      targetUserId: String(user?._id || ""),
      errorCount: errors.length,
      errors: errors.slice(0, 6),
      templateKeys,
      branchIdCount: branchIds.length,
    });
    throw toAppError(
      400,
      "AUTHZ_PERMISSION_PAYLOAD_INVALID",
      "Permission payload is invalid",
      {
        errors,
      },
    );
  }

  if (
    !assignments.length &&
    (requestedPermissions.length > 0 || templateKeys.length > 0)
  ) {
    omniLog.warn("authz.permissionSync.emptyAssignments", {
      targetUserId: String(user?._id || ""),
      permissionCount: requestedPermissions.length,
      templateKeys,
      branchIdCount: branchIds.length,
    });
  }

  const antiEscalation = validateGrantAntiEscalation({
    actorAuthz: req.authz,
    assignments,
    targetUserId: String(user._id),
  });

  if (!antiEscalation.allowed) {
    omniLog.warn("authz.permissionSync.antiEscalationBlocked", {
      targetUserId: String(user?._id || ""),
      violationCount: antiEscalation.violations?.length || 0,
      violations: (antiEscalation.violations || []).slice(0, 6),
      templateKeys,
    });
    throw toAppError(
      403,
      "AUTHZ_PERMISSION_ESCALATION_BLOCKED",
      "Permission grant violates anti-escalation rules",
      { violations: antiEscalation.violations },
    );
  }

  const result = await applyUserPermissionAssignments({
    targetUserId: String(user._id),
    assignments,
    actorUserId: req.user?._id || null,
    req,
    reason: reason || "user_permission_sync",
  });

  const legacyStateChanged =
    String(user.permissionMode || "ROLE_FALLBACK").toUpperCase() !== "ROLE_FALLBACK" ||
    (Array.isArray(user.permissions) && user.permissions.length > 0);

  user.permissionMode = "ROLE_FALLBACK";
  user.permissions = [];

  if (result.grantedCount > 0 || result.revokedCount > 0 || legacyStateChanged) {
    user.permissionsVersion = Number(user.permissionsVersion || 1) + 1;
    await user.save();
  }

  omniLog.debug("authz.permissionSync.result", {
    targetUserId: String(user?._id || ""),
    grantedCount: result.grantedCount || 0,
    revokedCount: result.revokedCount || 0,
    assignmentCount: assignments.length,
    legacyPermissionMode: user?.permissionMode || "",
    reason,
  });

  return {
    ...result,
    assignments,
    templateKeys,
    branchIds,
  };
};

const roleRequiresStoreLocation = (role) =>
  BRANCH_REQUIRED_EMPLOYEE_ROLES.has(
    String(role || "")
      .trim()
      .toUpperCase(),
  );

const normalizeRoleArray = (roles = []) =>
  toUniqueStrings(
    (Array.isArray(roles) ? roles : []).map((role) =>
      normalizeText(role).toUpperCase(),
    ),
  );

const normalizeBranchRoles = (roles = []) => {
  const output = new Set();
  for (const role of normalizeRoleArray(roles)) {
    if (!role) continue;
    const effectiveRole = LEGACY_ROLE_TO_CANONICAL_BRANCH_ROLE[role] || role;
    if (BRANCH_ROLES.includes(role) || BRANCH_ROLES.includes(effectiveRole)) {
      output.add(effectiveRole);
    }
  }
  return Array.from(output);
};

const normalizeBranchAssignmentsPayload = (assignments = []) => {
  const normalized = [];
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const storeId = normalizeText(assignment?.storeId);
    const roles = normalizeBranchRoles(assignment?.roles || []);
    if (!storeId || roles.length === 0) continue;

    normalized.push({
      storeId,
      roles,
      status: assignment?.status || "ACTIVE",
      isPrimary: Boolean(assignment?.isPrimary),
    });
  }

  if (normalized.length > 0 && !normalized.some((item) => item.isPrimary)) {
    normalized[0].isPrimary = true;
  }

  let primaryFound = false;
  for (const item of normalized) {
    if (item.isPrimary && !primaryFound) {
      primaryFound = true;
      continue;
    }
    if (primaryFound) {
      item.isPrimary = false;
    }
  }

  return normalized;
};

const deriveLegacyRoleFromAssignments = ({
  systemRoles = [],
  taskRoles = [],
  branchAssignments = [],
  fallbackRole = "USER",
} = {}) => {
  if (systemRoles.includes("GLOBAL_ADMIN")) return "GLOBAL_ADMIN";
  if (taskRoles.includes("SHIPPER")) return "SHIPPER";

  if (branchAssignments.length > 0) {
    const primary =
      branchAssignments.find((assignment) => assignment.isPrimary) ||
      branchAssignments[0];
    const role = primary?.roles?.[0] || fallbackRole;
    return CANONICAL_BRANCH_ROLE_TO_LEGACY_ROLE[role] || role;
  }

  return fallbackRole || "USER";
};

const resolveHoChiMinhStoreId = async () => {
  const hcmRegex = /ho\s*chi\s*minh|tp\.?\s*hcm|sai\s*gon|^hcm$/i;
  const filter = {
    $or: [
      { code: /HCM/i },
      { name: hcmRegex },
      { "address.province": hcmRegex },
    ],
  };

  let store = await Store.findOne({ ...filter, status: "ACTIVE" })
    .select("_id")
    .lean();
  if (!store) {
    store = await Store.findOne(filter).select("_id").lean();
  }
  return normalizeText(store?._id);
};

const resolveEmployeeStoreLocation = async ({ role, storeLocation }) => {
  const normalizedRole = normalizeText(role).toUpperCase();
  const normalizedStoreLocation = normalizeText(storeLocation);

  if (normalizedStoreLocation) {
    return normalizedStoreLocation;
  }

  if (!roleRequiresStoreLocation(normalizedRole)) {
    return "";
  }

  const hoChiMinhStoreId = await resolveHoChiMinhStoreId();
  if (!hoChiMinhStoreId) {
    throw new Error("Khong tim thay chi nhanh Ho Chi Minh de gan mac dinh");
  }

  return hoChiMinhStoreId;
};

// Cáº­p nháº­t thÃ´ng tin ngÆ°á»i dÃ¹ng
export const updateProfile = async (req, res) => {
  try {
    const { fullName, email, province } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { fullName, email, province },
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      message: "Cáº­p nháº­t thÃ´ng tin thÃ nh cÃ´ng",
      data: { user },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ThÃªm Ä‘á»‹a chá»‰ má»›i cho ngÆ°á»i dÃ¹ng
export const addAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    // Náº¿u Ä‘á»‹a chá»‰ má»›i Ä‘Æ°á»£c chá»n lÃ  máº·c Ä‘á»‹nh, set táº¥t cáº£ cÃ¡c Ä‘á»‹a chá»‰ khÃ¡c lÃ  khÃ´ng máº·c Ä‘á»‹nh
    if (req.body.isDefault) {
      user.addresses.forEach((addr) => (addr.isDefault = false));
    }

    user.addresses.push(req.body);
    await user.save();

    res.json({
      success: true,
      message: "ThÃªm Ä‘á»‹a chá»‰ thÃ nh cÃ´ng",
      data: { user },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Cáº­p nháº­t Ä‘á»‹a chá»‰ cho ngÆ°á»i dÃ¹ng
export const updateAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const address = user.addresses.id(req.params.addressId);

    if (!address) {
      return res
        .status(404)
        .json({ success: false, message: "KhÃ´ng tÃ¬m tháº¥y Ä‘á»‹a chá»‰" });
    }

    // Náº¿u Ä‘á»‹a chá»‰ má»›i Ä‘Æ°á»£c chá»n lÃ  máº·c Ä‘á»‹nh, set táº¥t cáº£ cÃ¡c Ä‘á»‹a chá»‰ khÃ¡c lÃ  khÃ´ng máº·c Ä‘á»‹nh
    if (req.body.isDefault) {
      user.addresses.forEach((addr) => (addr.isDefault = false));
    }

    // Cáº­p nháº­t Ä‘á»‹a chá»‰
    Object.assign(address, req.body);
    await user.save();

    res.json({
      success: true,
      message: "Cáº­p nháº­t Ä‘á»‹a chá»‰ thÃ nh cÃ´ng",
      data: { user },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// XÃ³a Ä‘á»‹a chá»‰ cá»§a ngÆ°á»i dÃ¹ng
export const deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.addresses.pull(req.params.addressId);
    await user.save();

    res.json({
      success: true,
      message: "XÃ³a Ä‘á»‹a chá»‰ thÃ nh cÃ´ng",
      data: { user },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Láº¥y táº¥t cáº£ nhÃ¢n viÃªn
// GET /api/users/employees - Láº¥y danh sÃ¡ch nhÃ¢n viÃªn (cÃ³ phÃ¢n trang + tÃ¬m kiáº¿m + sáº¯p xáº¿p)
export const getAllEmployees = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      role = "",
      storeLocation = "", // âœ… Filter by store
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // giá»›i háº¡n tá»‘i Ä‘a 100

    // Base employee roles list
    const EMPLOYEE_ROLES = [
      "SALES_STAFF",
      "WAREHOUSE_MANAGER",
      "PRODUCT_MANAGER",
      "ORDER_MANAGER",
      "SHIPPER",
      "ADMIN",
      "BRANCH_ADMIN",
      "POS_STAFF",
      "CASHIER",
    ];

    // Điều kiện lọc cơ bản - chấp nhận cả role chính hoặc role trong branchAssignments
    const filter = {
      $or: [
        { role: { $in: EMPLOYEE_ROLES } },
        { "branchAssignments.roles": { $in: EMPLOYEE_ROLES } },
      ],
    };

    // Tìm kiếm theo tên hoặc email hoặc số điện thoại
    if (search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      const searchFilter = {
        $or: [
          { fullName: searchRegex },
          { email: searchRegex },
          { phoneNumber: searchRegex },
        ],
      };

      // Wrap current filter and search in $and
      const existingFilter = { ...filter };
      filter.$and = [existingFilter, searchFilter];
      delete filter.$or;
    }

    // Lọc theo role cụ thể (nếu có truyền) - Additive check
    if (role && role !== "ALL") {
      const rolesToFilter = role.includes(",") ? role.split(",") : [role];
      const roleSpecificFilter = {
        $or: [
          { role: { $in: rolesToFilter } },
          { "branchAssignments.roles": { $in: rolesToFilter } },
        ],
      };

      if (filter.$and) {
        filter.$and.push(roleSpecificFilter);
      } else {
        const currentFilter = { ...filter };
        filter.$and = [currentFilter, roleSpecificFilter];
        delete filter.$or;
      }
    }

    // Branch-scoped actor: limit employee list to allowed branches.
    if (!req.authz?.isGlobalAdmin) {
      const allowedBranchIds = toUniqueStrings(req.authz?.allowedBranchIds || []);
      const requestedStoreLocation =
        storeLocation && storeLocation !== "ALL" ? normalizeText(storeLocation) : "";

      if (!allowedBranchIds.length) {
        return res.json({
          success: true,
          data: {
            employees: [],
            pagination: {
              currentPage: 1,
              totalPages: 0,
              total: 0,
              limit: limitNum,
            },
          },
        });
      }

      if (requestedStoreLocation) {
        if (!allowedBranchIds.includes(requestedStoreLocation)) {
          return res.json({
            success: true,
            data: {
              employees: [],
              pagination: {
                currentPage: 1,
                totalPages: 0,
                total: 0,
                limit: limitNum,
              },
            },
          });
        }
        filter.storeLocation = requestedStoreLocation;
      } else {
        filter.storeLocation = { $in: allowedBranchIds };
      }
    } else {
      // Global Admin can filter by store
      if (storeLocation && storeLocation !== "ALL") {
        filter.storeLocation = storeLocation;
      }
    }

    // Sáº¯p xáº¿p
    const sort = {};
    sort[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Query vá»›i phÃ¢n trang
    const employees = await User.find(filter)
      .select("-password -__v")
      .sort(sort)
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum)
      .lean();

    // Äáº¿m tá»•ng sá»‘ Ä‘á»ƒ tráº£ vá» phÃ¢n trang
    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      data: {
        employees,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          total,
          limit: limitNum,
        },
      },
    });
  } catch (error) {
    console.error("Lá»—i láº¥y danh sÃ¡ch nhÃ¢n viÃªn:", error);
    res.status(500).json({ success: false, message: "Lá»—i server" });
  }
};
// Táº¡o nhÃ¢n viÃªn má»›i
export const createEmployee = async (req, res) => {
  try {
    const {
      fullName,
      phoneNumber,
      email,
      province,
      password,
      role,
      avatar,
      storeLocation,
    } = req.body;
    const normalizedPassword = normalizeText(password);
    if (!normalizedPassword) {
      return res.status(400).json({
        success: false,
        code: "USER_PASSWORD_REQUIRED",
        message: "Mật khẩu không được để trống",
      });
    }

    const canonicalRoleRequested = hasCanonicalRolePayload(req.body);
    const requestedBranchIds = collectBranchIds(req.body);
    const fallbackRequestedRole =
      (Array.isArray(req.body?.roleKeys) && req.body.roleKeys[0]) || role || "USER";
    const legacyRole = String(fallbackRequestedRole || "USER")
      .trim()
      .toUpperCase();
    if (!canonicalRoleRequested) {
      assertActorCanAssignRole(req, legacyRole);
    }
    assertActorBranchScope(req, requestedBranchIds);
    const granularRequested = hasGranularPermissionPayload(req.body);
    const requestedPrimaryBranchId =
      normalizeText(req.body?.primaryBranchId) ||
      normalizeText(storeLocation) ||
      requestedBranchIds[0] ||
      "";

    const effectiveStoreLocation = await resolveEmployeeStoreLocation({
      role: legacyRole,
      storeLocation: requestedPrimaryBranchId,
    });
    const resolvedPrimaryBranchId = effectiveStoreLocation || requestedPrimaryBranchId;
    if (!resolvedPrimaryBranchId) {
      return res.status(400).json({
        success: false,
        code: "USER_BRANCH_REQUIRED",
        message: "Nhân viên phải được gán ít nhất một chi nhánh hợp lệ",
      });
    }

    const authzWrite = deriveAuthzWriteFromLegacyInput({
      role: legacyRole,
      storeLocation: resolvedPrimaryBranchId,
      assignedBy: req.user?._id,
    });

    let branchAssignments = normalizeBranchAssignmentsPayload(
      canonicalRoleRequested ? req.body?.branchAssignments || [] : authzWrite.branchAssignments,
    );

    if (branchAssignments.length === 0) {
      branchAssignments = [
        {
          storeId: resolvedPrimaryBranchId,
          roles: canonicalRoleRequested ? normalizeBranchRoles(req.body?.branchRoles || [legacyRole]) : normalizeBranchRoles([legacyRole]),
          status: "ACTIVE",
          isPrimary: true,
          assignedBy: req.user?._id || undefined,
        },
      ];
    } else if (requestedBranchIds.length > 0) {
      const assignmentRoles = normalizeBranchRoles(
        branchAssignments[0]?.roles?.length ? branchAssignments[0].roles : [legacyRole],
      );
      branchAssignments = requestedBranchIds.map((branchId, index) => ({
        storeId: branchId,
        roles: assignmentRoles,
        status: "ACTIVE",
        isPrimary: index === 0,
        assignedBy: req.user?._id || undefined,
      }));
    }

    if (!branchAssignments.length || !branchAssignments[0]?.storeId) {
      return res.status(400).json({
        success: false,
        code: "USER_BRANCH_REQUIRED",
        message: "Nhân viên phải được gán ít nhất một chi nhánh hợp lệ",
      });
    }

    const user = await User.create({
      fullName,
      phoneNumber,
      email,
      province,
      password: normalizedPassword,
      role: legacyRole,
      roles: [],
      permissions: [],
      avatar: avatar || "",
      systemRoles: canonicalRoleRequested ? [] : authzWrite.systemRoles,
      taskRoles: canonicalRoleRequested ? [] : authzWrite.taskRoles,
      branchAssignments,
      authzState: canonicalRoleRequested ? "ACTIVE" : authzWrite.authzState,
      authzVersion: 2,
      permissionsVersion: 1,
      authorizationVersion: 1,
      permissionMode: "ROLE_FALLBACK",
      storeLocation: resolvedPrimaryBranchId,
    });

    let permissionSync = null;
    let roleSync = null;
    const roleAssignmentPayload = canonicalRoleRequested
      ? {
          ...req.body,
          branchAssignments,
          storeLocation: resolvedPrimaryBranchId,
          primaryBranchId: resolvedPrimaryBranchId,
        }
      : {
          roleKeys: [legacyRole],
          branchIds: requestedBranchIds.length > 0 ? requestedBranchIds : [resolvedPrimaryBranchId],
          storeLocation: resolvedPrimaryBranchId,
          primaryBranchId: resolvedPrimaryBranchId,
        };

    try {
      const resolvedAssignments = await resolveCanonicalRoleAssignmentsFromPayload(
        req,
        roleAssignmentPayload,
      );
      if (!resolvedAssignments.length) {
        throw toAppError(
          400,
          "AUTHZ_ROLE_ASSIGNMENTS_REQUIRED",
          "At least one valid role assignment is required",
        );
      }

      roleSync = await syncUserRoleAssignments({
        user,
        assignments: resolvedAssignments,
        actorUserId: req.user?._id || null,
        primaryBranchId: resolvedPrimaryBranchId,
        reason: "user_create",
      });
    } catch (error) {
      await User.findByIdAndDelete(user._id);
      throw error;
    }

    if (granularRequested) {
      try {
        permissionSync = await syncExplicitPermissionsForUser({
          req,
          user,
          payload: req.body,
          reason: "user_create",
        });
      } catch (error) {
        await User.findByIdAndDelete(user._id);
        throw error;
      }
    }

    res.status(201).json({
      success: true,
      message: "Tao nhan vien thanh cong",
      data: {
        user,
        roleSync: roleSync
          ? {
              grantedCount: roleSync.grantedCount,
              revokedCount: roleSync.revokedCount,
              roleKeys: roleSync.roleKeys,
            }
          : null,
        permissionSync: permissionSync
          ? {
              grantedCount: permissionSync.grantedCount,
              revokedCount: permissionSync.revokedCount,
              templateKeys: permissionSync.templateKeys,
            }
          : null,
      },
    });
  } catch (error) {
    res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_CREATE_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};
// Thay Ä‘á»•i tráº¡ng thÃ¡i nhÃ¢n viÃªn (kÃ­ch hoáº¡t hoáº·c khÃ³a)
export const toggleEmployeeStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "KhÃ´ng tÃ¬m tháº¥y nhÃ¢n viÃªn" });
    }

    assertActorCanManageTargetUser(req, user);
    // Chuyá»ƒn Ä‘á»•i tráº¡ng thÃ¡i giá»¯a ACTIVE vÃ  LOCKED
    user.status = user.status === "ACTIVE" ? "LOCKED" : "ACTIVE";
    await user.save();

    res.json({
      success: true,
      message: `${
        user.status === "LOCKED" ? "KhÃ³a" : "Má»Ÿ khÃ³a"
      } nhÃ¢n viÃªn thÃ nh cÃ´ng`,
      data: { user },
    });
  } catch (error) {
    res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_TOGGLE_STATUS_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

// XÃ³a nhÃ¢n viÃªn
export const deleteEmployee = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "KhÃ´ng tÃ¬m tháº¥y nhÃ¢n viÃªn" });
    }

    assertActorCanManageTargetUser(req, user);
    await User.deleteOne({ _id: user._id });
    res.json({ success: true, message: "XÃ³a nhÃ¢n viÃªn thÃ nh cÃ´ng" });
  } catch (error) {
    res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_DELETE_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const updateEmployeeAvatar = async (req, res) => {
  try {
    const { avatar } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "KhÃ´ng tÃ¬m tháº¥y nhÃ¢n viÃªn" });
    }

    assertActorCanManageTargetUser(req, user);
    user.avatar = avatar;
    await user.save();

    res.json({
      success: true,
      message: "Cáº­p nháº­t áº£nh Ä‘áº¡i diá»‡n thÃ nh cÃ´ng",
      data: { user },
    });
  } catch (error) {
    res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_AVATAR_UPDATE_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const updateEmployee = async (req, res) => {
  try {
    const {
      fullName,
      phoneNumber,
      email,
      province,
      password,
      role,
      avatar,
      storeLocation,
    } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Khong tim thay nhan vien",
      });
    }

    assertActorCanManageTargetUser(req, user);
    const requestedBranchIds = collectBranchIds(req.body);
    assertActorBranchScope(req, requestedBranchIds);
    const canonicalRoleRequested = hasCanonicalRolePayload(req.body);

    const nextRole = role ? String(role).trim().toUpperCase() : user.role;
    if (!canonicalRoleRequested) {
      assertActorCanAssignRole(req, nextRole);
    }
    const requestedStoreLocation =
      storeLocation !== undefined ? storeLocation : user.storeLocation;
    const primaryBranchId =
      normalizeText(req.body?.primaryBranchId) ||
      normalizeText(requestedStoreLocation) ||
      requestedBranchIds[0] ||
      "";

    const nextStoreLocation = await resolveEmployeeStoreLocation({
      role: nextRole,
      storeLocation: primaryBranchId,
    });

    const authzWrite = deriveAuthzWriteFromLegacyInput({
      role: nextRole,
      storeLocation: nextStoreLocation,
      assignedBy: req.user?._id,
    });

    let nextBranchAssignments = authzWrite.branchAssignments;
    if (nextBranchAssignments.length === 1 && requestedBranchIds.length > 0) {
      const assignmentRoles = nextBranchAssignments[0].roles || [];
      nextBranchAssignments = requestedBranchIds.map((branchId, index) => ({
        storeId: branchId,
        roles: assignmentRoles,
        status: "ACTIVE",
        isPrimary: index === 0,
        assignedBy: req.user?._id || undefined,
      }));
    }

    const roleOrScopeChanged =
      String(user.role || "") !== String(nextRole || "") ||
      String(user.storeLocation || "") !== String(nextStoreLocation || "") ||
      JSON.stringify(user.branchAssignments || []) !==
        JSON.stringify(nextBranchAssignments || []);

    user.fullName = fullName || user.fullName;
    user.phoneNumber = phoneNumber || user.phoneNumber;
    user.email = email || user.email;
    user.province = province || user.province;
    user.role = nextRole;
    user.avatar = avatar !== undefined ? avatar : user.avatar;
    user.storeLocation = nextStoreLocation;
    user.systemRoles = canonicalRoleRequested ? user.systemRoles : authzWrite.systemRoles;
    user.taskRoles = canonicalRoleRequested ? user.taskRoles : authzWrite.taskRoles;
    user.branchAssignments = canonicalRoleRequested ? user.branchAssignments : nextBranchAssignments;
    user.authzState = canonicalRoleRequested ? "ACTIVE" : authzWrite.authzState;
    user.authzVersion = 2;

    if (roleOrScopeChanged) {
      user.permissionsVersion = Number(user.permissionsVersion || 1) + 1;
    }

    if (password && password.trim()) {
      user.password = password;
    }

    await user.save();

    let permissionSync = null;
    let roleSync = null;
    const roleAssignmentPayload = canonicalRoleRequested
      ? {
          ...req.body,
          branchAssignments: nextBranchAssignments,
          storeLocation: primaryBranchId || nextStoreLocation,
          primaryBranchId: primaryBranchId || nextStoreLocation,
        }
      : {
          roleKeys: [nextRole],
          branchIds: requestedBranchIds.length > 0 ? requestedBranchIds : [primaryBranchId || nextStoreLocation],
          storeLocation: primaryBranchId || nextStoreLocation,
          primaryBranchId: primaryBranchId || nextStoreLocation,
        };

    const resolvedAssignments = await resolveCanonicalRoleAssignmentsFromPayload(req, roleAssignmentPayload);
    if (!resolvedAssignments.length) {
      throw toAppError(
        400,
        "AUTHZ_ROLE_ASSIGNMENTS_REQUIRED",
        "At least one valid role assignment is required",
      );
    }

    roleSync = await syncUserRoleAssignments({
      user,
      assignments: resolvedAssignments,
      actorUserId: req.user?._id || null,
      primaryBranchId: primaryBranchId || nextStoreLocation,
      reason: "user_update",
    });

    if (hasGranularPermissionPayload(req.body)) {
      permissionSync = await syncExplicitPermissionsForUser({
        req,
        user,
        payload: req.body,
        reason: "user_update",
      });
    }

    return res.json({
      success: true,
      message: "Cap nhat nhan vien thanh cong",
      data: {
        user,
        roleSync: roleSync
          ? {
              grantedCount: roleSync.grantedCount,
              revokedCount: roleSync.revokedCount,
              roleKeys: roleSync.roleKeys,
            }
          : null,
        permissionSync: permissionSync
          ? {
              grantedCount: permissionSync.grantedCount,
              revokedCount: permissionSync.revokedCount,
              templateKeys: permissionSync.templateKeys,
            }
          : null,
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_UPDATE_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const updateUserRoles = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    assertActorCanManageTargetUser(req, targetUser);
    const branchAssignments = normalizeBranchAssignmentsPayload(
      req.body?.branchAssignments || [],
    );
    const fallbackAssignments = [
      ...normalizeRoleArray(req.body?.systemRoles)
        .filter((role) => SYSTEM_ROLES.includes(role))
        .map((roleKey) => ({ roleKey, scopeType: "GLOBAL", scopeRef: "" })),
      ...normalizeRoleArray(req.body?.taskRoles)
        .filter((role) => TASK_ROLES.includes(role))
        .map((roleKey) => ({ roleKey, scopeType: "TASK", scopeRef: "" })),
      ...branchAssignments.flatMap((assignment) =>
        normalizeBranchRoles(assignment?.roles || []).map((roleKey) => ({
          roleKey,
          scopeType: "BRANCH",
          scopeRef: normalizeText(assignment.storeId),
          metadata: {
            isPrimary: Boolean(assignment?.isPrimary),
          },
        })),
      ),
    ];

    const requestedAssignments = hasCanonicalRolePayload(req.body)
      ? await resolveCanonicalRoleAssignmentsFromPayload(req, req.body)
      : await resolveCanonicalRoleAssignmentsFromPayload(req, {
          roleAssignments: fallbackAssignments,
          primaryBranchId:
            normalizeText(req.body?.primaryBranchId) ||
            normalizeText(req.body?.storeLocation) ||
            normalizeText(branchAssignments.find((assignment) => assignment.isPrimary)?.storeId) ||
            normalizeText(branchAssignments[0]?.storeId) ||
            normalizeText(targetUser.storeLocation),
        });

    const primaryBranchId =
      normalizeText(req.body?.primaryBranchId) ||
      normalizeText(req.body?.storeLocation) ||
      requestedAssignments.find((assignment) => assignment.scopeType === "BRANCH")?.scopeRef ||
      normalizeText(targetUser.storeLocation);

    await syncUserRoleAssignments({
      user: targetUser,
      assignments: requestedAssignments,
      actorUserId: req.user?._id || null,
      primaryBranchId,
      reason: "user_role_update",
    });

    const effective = await resolveEffectiveAccessContext({
      user: targetUser,
      activeBranchId: targetUser.storeLocation || "",
    });

    return res.json({
      success: true,
      message: "User roles updated",
      data: {
        user: targetUser,
        authz: {
          permissionMode: effective.permissionMode || "ROLE_FALLBACK",
          activeBranchId: effective.activeBranchId || "",
          allowedBranchIds: effective.allowedBranchIds || [],
          roleKeys: effective.roleKeys || [],
          roleAssignments: effective.roleAssignments || [],
          permissions: Array.from(effective.permissions || []).sort(),
          permissionGrants: Array.isArray(effective.permissionGrants)
            ? effective.permissionGrants
            : [],
        },
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_ROLE_UPDATE_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};
export const getAllShippers = async (req, res) => {
  try {
    const filter = {
      $or: [{ role: "SHIPPER" }, { taskRoles: "SHIPPER" }],
      status: "ACTIVE",
    };

    const isGlobalAdmin = Boolean(req.authz?.isGlobalAdmin);

    if (!isGlobalAdmin) {
      const activeBranchId = String(req.authz?.activeBranchId || "").trim();
      if (!activeBranchId) {
        return res.json({
          success: true,
          data: { shippers: [] },
        });
      }

      const branchFilters = [{ storeLocation: activeBranchId }];
      if (mongoose.Types.ObjectId.isValid(activeBranchId)) {
        branchFilters.push({
          branchAssignments: {
            $elemMatch: {
              storeId: new mongoose.Types.ObjectId(activeBranchId),
              status: "ACTIVE",
            },
          },
        });
      }

      filter.$or = branchFilters;
    }

    const shippers = await User.find(filter)
      .select("_id fullName phoneNumber email")
      .sort({ fullName: 1 });

    res.json({
      success: true,
      data: { shippers },
    });
  } catch (error) {
    console.error("Get all shippers error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Lá»—i server",
    });
  }
};

export const createUserWithPermissions = async (req, res) =>
  createEmployee(req, res);

export const getPermissionsCatalogController = async (req, res) => {
  try {
    await ensurePermissionCatalogSeeded();
    await ensurePermissionTemplatesSeeded();

    const [catalog, templates] = await Promise.all([
      getPermissionCatalog(),
      getPermissionTemplates(),
    ]);

    const groupedByModule = catalog.reduce((acc, permission) => {
      const moduleKey = normalizeText(permission.module) || "general";
      if (!acc[moduleKey]) {
        acc[moduleKey] = [];
      }
      acc[moduleKey].push(permission);
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        catalog,
        groupedByModule,
        templates,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: "PERMISSION_CATALOG_LOAD_FAILED",
      message: error.message,
    });
  }
};

export const getPermissionTemplatesController = async (req, res) => {
  try {
    await ensurePermissionTemplatesSeeded();
    const templates = await getPermissionTemplates();
    return res.json({
      success: true,
      data: { templates },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: "PERMISSION_TEMPLATE_LOAD_FAILED",
      message: error.message,
    });
  }
};

export const getEffectivePermissionsForUser = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    assertActorCanManageTargetUser(req, targetUser);

    const queryBranchId = normalizeText(req.query?.activeBranchId);
    const effective = await resolveEffectiveAccessContext({
      user: targetUser,
      activeBranchId: queryBranchId || targetUser.storeLocation || "",
    });

    return res.json({
      success: true,
      data: {
        userId: String(targetUser._id),
        permissionMode: effective.permissionMode || "ROLE_FALLBACK",
        activeBranchId: effective.activeBranchId || "",
        allowedBranchIds: effective.allowedBranchIds || [],
        roleKeys: effective.roleKeys || [],
        roleAssignments: Array.isArray(effective.roleAssignments)
          ? effective.roleAssignments
          : [],
        permissions: Array.from(effective.permissions || []).sort(),
        permissionGrants: Array.isArray(effective.permissionGrants)
          ? effective.permissionGrants
          : [],
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_EFFECTIVE_PERMISSION_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const getUserAuthorization = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    assertActorCanManageTargetUser(req, targetUser);

    const queryBranchId = normalizeText(req.query?.activeBranchId);
    const effective = await resolveEffectiveAccessContext({
      user: targetUser,
      activeBranchId: queryBranchId || targetUser.storeLocation || "",
    });
    const directPermissionGrants = await loadActiveUserPermissionGrants({
      userId: targetUser._id,
      permissionsVersion: targetUser.permissionsVersion,
    });

    return res.json({
      success: true,
      data: {
        userId: String(targetUser._id),
        role: targetUser.role,
        roles: Array.isArray(targetUser.roles) ? targetUser.roles.map(String) : [],
        roleKeys: effective.roleKeys || [],
        roleAssignments: Array.isArray(effective.roleAssignments)
          ? effective.roleAssignments
          : [],
        directPermissions: collectDirectPermissionKeys(directPermissionGrants),
        directPermissionGrants,
        permissionMode: effective.permissionMode || "ROLE_FALLBACK",
        activeBranchId: effective.activeBranchId || "",
        allowedBranchIds: effective.allowedBranchIds || [],
        permissions: Array.from(effective.permissions || []).sort(),
        permissionGrants: Array.isArray(effective.permissionGrants)
          ? effective.permissionGrants
          : [],
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_AUTHORIZATION_LOAD_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const getUserRoleAssignments = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    assertActorCanManageTargetUser(req, targetUser);
    const effective = await resolveEffectiveAccessContext({
      user: targetUser,
      activeBranchId: targetUser.storeLocation || "",
    });

    return res.json({
      success: true,
      data: {
        userId: String(targetUser._id),
        roleKeys: effective.roleKeys || [],
        roleAssignments: Array.isArray(effective.roleAssignments)
          ? effective.roleAssignments
          : [],
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_ROLE_ASSIGNMENTS_LOAD_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const updateUserRoleAssignments = async (req, res) => updateUserRoles(req, res);

export const updateUserPermissions = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    assertActorCanManageTargetUser(req, targetUser);

    const requestedBranchIds = collectBranchIds(req.body);
    assertActorBranchScope(req, requestedBranchIds);

    let branchScopeChanged = false;
    if (requestedBranchIds.length > 0) {
      const roleBasedAuthz = deriveAuthzWriteFromLegacyInput({
        role: targetUser.role,
        storeLocation: requestedBranchIds[0],
        assignedBy: req.user?._id,
      });

      if (roleBasedAuthz.branchAssignments.length === 1) {
        const assignmentRoles = roleBasedAuthz.branchAssignments[0].roles || [];
        targetUser.branchAssignments = requestedBranchIds.map(
          (branchId, index) => ({
            storeId: branchId,
            roles: assignmentRoles,
            status: "ACTIVE",
            isPrimary: index === 0,
            assignedBy: req.user?._id || undefined,
          }),
        );
        targetUser.storeLocation = requestedBranchIds[0];
        branchScopeChanged = true;
      } else if (targetUser.storeLocation !== requestedBranchIds[0]) {
        targetUser.storeLocation = requestedBranchIds[0];
        branchScopeChanged = true;
      }
    }

    if (branchScopeChanged) {
      targetUser.permissionsVersion =
        Number(targetUser.permissionsVersion || 1) + 1;
      await targetUser.save();
    }

    const permissionSync = await syncExplicitPermissionsForUser({
      req,
      user: targetUser,
      payload: req.body,
      reason: "user_permission_update",
    });

    return res.json({
      success: true,
      message: "Permissions updated",
      data: {
        user: targetUser,
        permissionSync: {
          grantedCount: permissionSync.grantedCount,
          revokedCount: permissionSync.revokedCount,
          templateKeys: permissionSync.templateKeys,
        },
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_PERMISSION_UPDATE_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const getUserPermissionGrants = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    assertActorCanManageTargetUser(req, targetUser);

    const directPermissionGrants = await loadActiveUserPermissionGrants({
      userId: targetUser._id,
      permissionsVersion: targetUser.permissionsVersion,
    });

    return res.json({
      success: true,
      data: {
        userId: String(targetUser._id),
        directPermissions: collectDirectPermissionKeys(directPermissionGrants),
        permissionGrants: directPermissionGrants,
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_PERMISSION_GRANTS_LOAD_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};

export const updateUserPermissionGrants = async (req, res) => updateUserPermissions(req, res);

export const previewPermissionAssignments = async (req, res) => {
  try {
    const targetUserId = normalizeText(
      req.body?.targetUserId || req.params?.id || req.user?._id,
    );
    const branchIds = collectBranchIds(req.body);

    assertActorBranchScope(req, branchIds);

    const { assignments, errors } =
      await normalizeRequestedPermissionAssignments({
        permissions: Array.isArray(req.body?.permissions)
          ? req.body.permissions
          : [],
        templateKeys: collectTemplateKeys(req.body),
        branchIds,
        targetUserId,
      });

    if (errors.length) {
      return res.status(400).json({
        success: false,
        code: "AUTHZ_PERMISSION_PAYLOAD_INVALID",
        message: "Permission payload is invalid",
        details: { errors },
      });
    }

    const antiEscalation = validateGrantAntiEscalation({
      actorAuthz: req.authz,
      assignments,
      targetUserId,
    });

    const sensitiveAssignments = assignments.filter((item) => item.isSensitive);
    const byModule = assignments.reduce((acc, assignment) => {
      const moduleKey = normalizeText(assignment.module) || "general";
      if (!acc[moduleKey]) {
        acc[moduleKey] = [];
      }
      acc[moduleKey].push(assignment);
      return acc;
    }, {});

    return res.json({
      success: antiEscalation.allowed,
      data: {
        assignments,
        groupedByModule: byModule,
        sensitiveAssignments,
        antiEscalation,
      },
      ...(antiEscalation.allowed
        ? {}
        : {
            code: "AUTHZ_PERMISSION_ESCALATION_BLOCKED",
            message: "Permission grant violates anti-escalation rules",
          }),
    });
  } catch (error) {
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "USER_PERMISSION_PREVIEW_FAILED",
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
};
