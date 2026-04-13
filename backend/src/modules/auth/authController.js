// backend/src/controllers/authController.js
import User from "./User.js";
import { signToken } from "../../middleware/authMiddleware.js";
import { normalizeUserAccess } from "../../authz/userAccessResolver.js";
import { resolveEffectiveAccessContext } from "../../authz/authorizationService.js";
import { ensurePermissionTemplatesSeeded } from "../../authz/permissionTemplateService.js";
import { syncUserRoleAssignments } from "../../authz/roleAssignmentService.js";

// ============================================
// VALIDATION HELPERS
// ============================================
const normalizeString = (value) => String(value ?? "").trim();

const validatePhoneNumber = (phoneNumber) => {
  const normalizedPhoneNumber = normalizeString(phoneNumber);
  const phoneRegex = /^0\d{9}$/;
  if (!phoneRegex.test(normalizedPhoneNumber)) {
    throw new Error("Số điện thoại phải có 10 chữ số và bắt đầu bằng số 0");
  }
};

const validateEmail = (email) => {
  const normalizedEmail = normalizeString(email).toLowerCase();
  if (!normalizedEmail) return; // Email is optional

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    throw new Error("Email không hợp lệ. Email phải có dạng: example@domain.com");
  }
};

const validatePassword = (password) => {
  if (password.length < 8) {
    throw new Error("Mật khẩu phải có ít nhất 8 ký tự");
  }

  const hasLowerCase = /[a-z]/.test(password);
  const hasUpperCase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (!hasLowerCase || !hasUpperCase || !hasNumber || !hasSpecialChar) {
    throw new Error("Mật khẩu phải bao gồm chữ thường (a-z), chữ hoa (A-Z), số (0-9) và ký tự đặc biệt (!@#$%...)");
  }
};

const serializeAuthUser = (user) => {
  if (!user) return null;

  const rawUser = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete rawUser.password;

  const fullName = normalizeString(rawUser.fullName || rawUser.name || rawUser.phoneNumber);

  return {
    ...rawUser,
    fullName: fullName || "Người dùng",
    phoneNumber: normalizeString(rawUser.phoneNumber),
    email: rawUser.email ? normalizeString(rawUser.email).toLowerCase() : rawUser.email,
  };
};

const branchFromBody = (body = {}) => {
  if (body.activeBranchId) return String(body.activeBranchId).trim();
  if (body.branchId) return String(body.branchId).trim();
  if (body.storeId) return String(body.storeId).trim();
  return "";
};

const normalizeRoleKey = (value) => String(value || "").trim().toUpperCase();

const syncSelfScopedRole = async ({ user, roleKey, reason }) => {
  await ensurePermissionTemplatesSeeded();
  await syncUserRoleAssignments({
    user,
    assignments: [
      {
        roleKey,
        scopeType: "SELF",
        scopeRef: String(user?._id || ""),
      },
    ],
    reason,
  });
};

const resolveHomeRoute = ({ roleKeys = [], permissions = [] } = {}) => {
  const normalizedRoleKeys = new Set((roleKeys || []).map(normalizeRoleKey));
  const permissionSet = new Set((permissions || []).map((item) => String(item || "").trim().toLowerCase()));
  const hasAnyPermission = (keys = []) => keys.some((key) => permissionSet.has(String(key || "").toLowerCase()));

  if (
    normalizedRoleKeys.has("GLOBAL_ADMIN") ||
    hasAnyPermission([
      "users.manage.global",
      "users.manage.branch",
      "analytics.read.global",
      "analytics.read.branch",
      "analytics.read.assigned",
      "store.manage",
      "promotion.manage",
      "content.manage",
      "brand.manage",
      "product_type.manage",
      "order.audit.read",
    ])
  ) {
    return "/admin";
  }
  if (hasAnyPermission(["product.create", "product.update", "product.delete", "product.read"])) {
    return "/warehouse/products";
  }
  if (
    hasAnyPermission([
      "warehouse.read",
      "warehouse.write",
      "inventory.read",
      "inventory.write",
      "transfer.read",
      "transfer.create",
      "transfer.approve",
      "transfer.ship",
      "transfer.receive",
      "order.status.manage.warehouse",
    ])
  ) {
    return "/warehouse-staff";
  }
  if (
    hasAnyPermission([
      "orders.read",
      "orders.write",
      "order.status.manage",
      "order.assign.carrier",
      "order.assign.store",
      "order.audit.read",
    ])
  ) {
    return "/order-manager/orders";
  }
  if (hasAnyPermission(["pos.payment.process", "pos.order.finalize", "pos.vat.issue", "pos.order.read.branch"])) {
    return "/CASHIER/dashboard";
  }
  if (hasAnyPermission(["pos.order.create", "pos.order.read.self", "order.status.manage.pos"])) {
    return "/pos/dashboard";
  }
  if (hasAnyPermission(["task.read", "task.update", "order.view.assigned", "order.status.manage.task"])) {
    return "/shipper/dashboard";
  }
  if (
    hasAnyPermission([
      "cart.manage.self",
      "account.profile.update.self",
      "account.address.manage.self",
      "order.view.self",
      "promotion.apply.self",
      "review.create.self",
    ])
  ) {
    return "/profile";
  }
  return "/";
};

const collectDirectPermissionKeys = (grants = []) =>
  Array.from(
    new Set(
      (Array.isArray(grants) ? grants : [])
        .map((grant) => String(grant?.key || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

const buildEffectivePermissionsPayload = async (user, resolvedContext = null) => {
  const normalized = resolvedContext || normalizeUserAccess(user);
  const alreadyResolved =
    resolvedContext &&
    resolvedContext.permissions instanceof Set &&
    Array.isArray(resolvedContext.permissionGrants);

  const effective = alreadyResolved
    ? resolvedContext
    : await resolveEffectiveAccessContext({
        user,
        normalizedAccess: normalized,
        activeBranchId: normalized.activeBranchId || normalized.defaultBranchId || "",
      });
  const permissions = effective.permissions instanceof Set ? effective.permissions : new Set();
  const sortedPermissions = Array.from(permissions).sort();
  const roleAssignments = Array.isArray(effective.roleAssignments)
    ? effective.roleAssignments.map((assignment) => ({
        roleId: assignment.roleId ? String(assignment.roleId) : "",
        roleKey: assignment.roleKey || "",
        roleName: assignment.roleName || assignment.role?.name || assignment.roleKey || "",
        scopeType: assignment.scopeType || "",
        scopeRef: assignment.scopeRef || assignment.scopeId || "",
      }))
    : [];
  const roleKeys =
    Array.isArray(effective.roleKeys) && effective.roleKeys.length > 0
      ? effective.roleKeys
      : Array.from(
          new Set(roleAssignments.map((assignment) => normalizeRoleKey(assignment.roleKey)).filter(Boolean))
        );
  const directPermissionGrants = Array.isArray(effective.directPermissionGrants)
    ? effective.directPermissionGrants
    : [];

  const authorizationPayload = {
    authzVersion: effective.authzVersion,
    authorizationVersion: Number(user?.authorizationVersion || 1),
    authzState: effective.authzState,
    role: effective.role,
    roles: Array.isArray(user?.roles) ? user.roles.map(String) : [],
    roleKeys,
    roleAssignments,
    systemRoles: effective.systemRoles,
    taskRoles: effective.taskRoles,
    branchAssignments: effective.branchAssignments,
    directPermissions: collectDirectPermissionKeys(directPermissionGrants),
    allowedBranchIds: effective.allowedBranchIds,
    activeBranchId: effective.activeBranchId || effective.defaultBranchId || "",
    simulatedBranchId: effective.simulatedBranchId || "",
    contextMode: effective.contextMode || "STANDARD",
    noBranchAssigned: Boolean(effective.noBranchAssigned),
    requiresBranchAssignment: Boolean(effective.requiresBranchAssignment),
    isGlobalAdmin: Boolean(effective.isGlobalAdmin),
    permissionMode: String(effective.permissionMode || "ROLE_FALLBACK"),
    permissionGrants: Array.isArray(effective.permissionGrants)
      ? effective.permissionGrants.map((grant) => ({
          key: grant.key,
          scopeType: grant.scopeType,
          scopeId: grant.scopeId || "",
          source: grant.source || "",
          conditions: Array.isArray(grant.conditions) ? grant.conditions : [],
        }))
      : [],
    permissions: sortedPermissions,
  };
  authorizationPayload.homeRoute = resolveHomeRoute({
    roleKeys: authorizationPayload.roleKeys,
    permissions: authorizationPayload.permissions,
  });

  return authorizationPayload;
};

// ============================================
// REGISTER
// ============================================
export const register = async (req, res) => {
  try {
    const { fullName, phone, phoneNumber, email, province, password, role } = req.body;
    const normalizedFullName = normalizeString(fullName);
    const normalizedPhone = normalizeString(phone || phoneNumber);
    const normalizedEmail = normalizeString(email).toLowerCase();
    const normalizedProvince = normalizeString(province);

    // Validate required fields
    if (!normalizedFullName || !normalizedPhone || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng điền đầy đủ thông tin bắt buộc",
      });
    }

    // Validate full name
    if (normalizedFullName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Họ tên phải có ít nhất 2 ký tự",
      });
    }

    // Validate phone number
    validatePhoneNumber(normalizedPhone);

    // Validate email if provided
    if (normalizedEmail) {
      validateEmail(normalizedEmail);
    }

    // Validate password
    validatePassword(password);

    // Check if phone number already exists
    const existingUserByPhone = await User.findOne({ phoneNumber: normalizedPhone });
    if (existingUserByPhone) {
      return res.status(400).json({
        success: false,
        message: "Số điện thoại đã được sử dụng",
      });
    }

    // Check if email already exists (if provided)
    if (normalizedEmail) {
      const existingUserByEmail = await User.findOne({ email: normalizedEmail });
      if (existingUserByEmail) {
        return res.status(400).json({
          success: false,
          message: "Email đã được sử dụng",
        });
      }
    }

    // Create user with CUSTOMER role by default (unless specified by admin)
    const normalizedRole = normalizeRoleKey(role || "CUSTOMER");
    const user = await User.create({
      fullName: normalizedFullName,
      phoneNumber: normalizedPhone,
      email: normalizedEmail || undefined,
      province: normalizedProvince || undefined,
      password,
      role: normalizedRole,
    });

    if (normalizedRole === "CUSTOMER") {
      await syncSelfScopedRole({
        user,
        roleKey: "CUSTOMER",
        reason: "register_customer",
      });
    }

    res.status(201).json({
      success: true,
      message: "Đăng ký thành công",
      data: { user: serializeAuthUser(user) },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Đăng ký thất bại",
    });
  }
};

// ============================================
// LOGIN
// ============================================
export const login = async (req, res) => {
  try {
    const { phone, phoneNumber, password } = req.body;
    const normalizedPhone = normalizeString(phone || phoneNumber);

    // Validate input
    if (!normalizedPhone || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập số điện thoại và mật khẩu",
      });
    }

    // ✅ BỎ VALIDATION FORMAT CHO LOGIN - CHO PHÉP TÀI KHOẢN CŨ
    // Tài khoản cũ có thể có format khác (ví dụ: 8 số, 11 số, không bắt đầu bằng 0...)

    // Find user - tìm bằng phoneNumber trực tiếp, không kiểm tra format
    const user = await User.findOne({ phoneNumber: normalizedPhone }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Số điện thoại hoặc mật khẩu không đúng",
      });
    }

    // Check if account is locked
    if (user.status === "LOCKED") {
      return res.status(403).json({
        success: false,
        message: "Tài khoản đã bị khóa. Vui lòng liên hệ admin.",
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Số điện thoại hoặc mật khẩu không đúng",
      });
    }

    // Generate token
    const token = signToken(user._id, user.permissionsVersion || 1);

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const authorization = await buildEffectivePermissionsPayload(user);

    res.json({
      success: true,
      message: "Đăng nhập thành công",
      data: {
        user: serializeAuthUser(user),
        authz: authorization,
        authorization,
        token,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Đăng nhập thất bại",
    });
  }
};

// ============================================
// LOGOUT
// ============================================
export const logout = async (req, res) => {
  try {
    res.clearCookie("token");
    res.json({
      success: true,
      message: "Đăng xuất thành công",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Đăng xuất thất bại",
    });
  }
};

// ============================================
// GET CURRENT USER
// ============================================
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy người dùng",
      });
    }

    const authorization = await buildEffectivePermissionsPayload(user, req.authz || null);

    res.json({
      success: true,
      data: {
        user: serializeAuthUser(user),
        authz: authorization,
        authorization,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};

// ============================================
// CHANGE PASSWORD
// ============================================
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ thông tin",
      });
    }

    // Validate new password
    validatePassword(newPassword);

    // Get user with password
    const user = await User.findById(req.user._id).select("+password");

    // Check current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Mật khẩu hiện tại không đúng",
      });
    }

    // Check if new password is same as old password
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "Mật khẩu mới không được trùng với mật khẩu cũ",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: "Đổi mật khẩu thành công",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Đổi mật khẩu thất bại",
    });
  }
};

// ============================================
// UPDATE AVATAR
// ============================================
export const updateAvatar = async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng cung cấp ảnh đại diện",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar },
      { new: true }
    );

    res.json({
      success: true,
      message: "Cập nhật ảnh đại diện thành công",
      data: { user: serializeAuthUser(user) },
    });
  } catch (error) {
    console.error("Update avatar error:", error);
    res.status(400).json({
      success: false,
      message: "Cập nhật ảnh đại diện thất bại",
    });
  }
};

const buildCustomerDefaultPassword = (fullName, phoneNumber) => {
  const compactName = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  const last3Digits = phoneNumber.slice(-3);
  return `${compactName}@${last3Digits}`;
};

export const checkCustomerByPhone = async (req, res) => {
  try {
    const { phoneNumber, phone } = req.query;
    const normalizedPhone = normalizeString(phone || phoneNumber);

    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng cung cấp số điện thoại",
      });
    }

    const user = await User.findOne({
      phoneNumber: normalizedPhone,
      role: "CUSTOMER",
    }).select("_id fullName name email phoneNumber");

    res.json({
      success: true,
      exists: !!user,
      customer: serializeAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const quickRegisterCustomer = async (req, res) => {
  try {
    const { fullName, phone, phoneNumber } = req.body;
    const normalizedName = normalizeString(fullName);
    const normalizedPhone = normalizeString(phone || phoneNumber);

    if (!normalizedName || !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập họ và tên cùng số điện thoại",
      });
    }

    if (normalizedName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Họ tên phải có ít nhất 2 ký tự",
      });
    }

    const existing = await User.findOne({ phoneNumber: normalizedPhone });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Phone number already registered",
      });
    }

    const generatedPassword = buildCustomerDefaultPassword(
      normalizedName,
      normalizedPhone
    );

    // console.log("Account created with password:", generatedPassword); // For debug if needed

    const user = await User.create({
      fullName: normalizedName,
      phoneNumber: normalizedPhone,
      email: `${normalizedPhone}@temp.com`,
      password: generatedPassword,
      role: "CUSTOMER",
      isActive: true,
    });

    await syncSelfScopedRole({
      user,
      roleKey: "CUSTOMER",
      reason: "quick_register_customer",
    });

    res.status(201).json({
      success: true,
      message: "Customer account created",
      customer: serializeAuthUser(user),
      temporaryPassword: generatedPassword,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const contextCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const getEffectivePermissions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "AUTHN_USER_NOT_FOUND",
        message: "User not found",
      });
    }

    const resolved = req.authz
      ? { ...req.authz }
      : {
          ...normalizeUserAccess(user),
          activeBranchId: "",
          contextMode: "STANDARD",
          simulatedBranchId: "",
          noBranchAssigned: false,
        };

    const authorization = await buildEffectivePermissionsPayload(user, resolved);

    return res.json({
      success: true,
      data: {
        authz: authorization,
        authorization,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const setActiveBranchContext = async (req, res) => {
  try {
    if (!req.authz) {
      return res.status(401).json({
        success: false,
        code: "AUTHZ_CONTEXT_MISSING",
        message: "Authorization context is missing",
      });
    }

    if (!req.authz.isGlobalAdmin && req.authz.requiresBranchAssignment) {
      return res.status(403).json({
        success: false,
        code: "AUTHZ_BRANCH_SWITCH_FORBIDDEN",
        message: "Branch context is fixed for staff accounts and cannot be switched manually",
      });
    }

    const targetBranchId = branchFromBody(req.body);
    if (!targetBranchId) {
      return res.status(400).json({
        success: false,
        code: "AUTHZ_ACTIVE_BRANCH_REQUIRED",
        message: "branchId is required",
      });
    }

    if (!req.authz.isGlobalAdmin && !req.authz.allowedBranchIds.includes(targetBranchId)) {
      return res.status(403).json({
        success: false,
        code: "AUTHZ_BRANCH_FORBIDDEN",
        message: "Branch is not assigned to current actor",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          "preferences.defaultBranchId": targetBranchId,
        },
      },
      { new: true }
    );

    res.cookie("activeBranchId", targetBranchId, contextCookieOptions);

    const resolved = {
      ...(req.authz || normalizeUserAccess(updatedUser)),
      activeBranchId: targetBranchId,
      simulatedBranchId: req.authz?.simulatedBranchId || "",
      contextMode: req.authz?.contextMode || "STANDARD",
    };

    const authorization = await buildEffectivePermissionsPayload(updatedUser, resolved);

    return res.json({
      success: true,
      message: "Active branch updated",
      data: {
        authz: authorization,
        authorization,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const setSimulatedBranchContext = async (req, res) => {
  try {
    if (!req.authz?.isGlobalAdmin) {
      return res.status(403).json({
        success: false,
        code: "AUTHZ_SIMULATION_FORBIDDEN",
        message: "Only global admin can simulate branch context",
      });
    }

    const targetBranchId = branchFromBody(req.body);
    if (!targetBranchId) {
      return res.status(400).json({
        success: false,
        code: "AUTHZ_SIMULATION_BRANCH_REQUIRED",
        message: "branchId is required",
      });
    }

    res.cookie("simulatedBranchId", targetBranchId, contextCookieOptions);

    const user = await User.findById(req.user._id);
    const resolved = {
      ...req.authz,
      activeBranchId: targetBranchId,
      simulatedBranchId: targetBranchId,
      contextMode: "SIMULATED",
    };

    const authorization = await buildEffectivePermissionsPayload(user, resolved);

    return res.json({
      success: true,
      message: "Simulation branch updated",
      data: {
        authz: authorization,
        authorization,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const clearSimulatedBranchContext = async (req, res) => {
  try {
    res.clearCookie("simulatedBranchId", contextCookieOptions);
    const user = await User.findById(req.user._id);

    const fallbackActiveBranch =
      req.authz?.activeBranchId || ""; // ── KILL-SWITCH: No cookie fallback ──
    const resolved = {
      ...normalizeUserAccess(user),
      activeBranchId: fallbackActiveBranch,
      simulatedBranchId: "",
      contextMode: "STANDARD",
    };

    const authorization = await buildEffectivePermissionsPayload(user, resolved);

    return res.json({
      success: true,
      message: "Simulation branch cleared",
      data: {
        authz: authorization,
        authorization,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export default {
  register,
  login,
  logout,
  getCurrentUser,
  changePassword,
  updateAvatar,
  checkCustomerByPhone,
  quickRegisterCustomer,
  getEffectivePermissions,
  setActiveBranchContext,
  setSimulatedBranchContext,
  clearSimulatedBranchContext,
};
