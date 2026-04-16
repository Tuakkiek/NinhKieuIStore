import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Lock,
  MapPin,
  Pencil,
  Search,
  Trash2,
  Unlock,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { userAPI } from "@/features/account";
import { useAuthStore } from "@/features/auth";
import { storeAPI } from "@/features/stores";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Loading } from "@/shared/ui/Loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { provinces } from "@/shared/constants/provinces";
import { getNameInitials, getStatusText } from "@/shared/lib/utils";

import EmployeeBranchStep from "../components/EmployeeBranchStep";
import EmployeePermissionStep, {
  ROLE_DEFINITIONS,
  getRoleLabel,
} from "../components/EmployeePermissionStep";

const EMPLOYEE_ROLE_TABS = [
  { value: "ALL", label: "Tất cả" },
  ...ROLE_DEFINITIONS.map((role) => ({
    value: role.value,
    label: role.shortLabel || role.label,
  })),
];

const STEPS = [
  {
    id: 1,
    label: "Thông tin cơ bản",
    description: "Tên, liên hệ và mật khẩu",
  },
  {
    id: 2,
    label: "Chi nhánh",
    description: "Phạm vi làm việc của nhân viên",
  },
  {
    id: 3,
    label: "Phân quyền",
    description: "Vai trò và quyền chi tiết",
  },
];

const BRANCH_ROLES = new Set([
  "ADMIN",
  "BRANCH_ADMIN",
  "SALES_STAFF",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_STAFF",
  "PRODUCT_MANAGER",
  "ORDER_MANAGER",
  "POS_STAFF",
  "CASHIER",
]);

const TASK_SCOPED_ROLES = new Set(["SHIPPER"]);

const normalize = (value) => String(value || "").trim();
const normalizeStoreId = (value) => normalize(value?._id || value);
const normalizeRoleKey = (value) => normalize(value).toUpperCase();

const unique = (items = []) =>
  Array.from(new Set(items.map((item) => normalize(item)).filter(Boolean)));

const uniqueRoleKeys = (items = []) =>
  Array.from(
    new Set(
      items
        .map((item) => normalizeRoleKey(item))
        .filter((item) => item && item !== "ALL"),
    ),
  );

const getPrimaryRoleKey = (roleKeys = [], fallback = "SHIPPER") => {
  const normalizedRoleKeys = uniqueRoleKeys(roleKeys);
  const preferredRole = normalizeRoleKey(fallback);

  if (preferredRole && normalizedRoleKeys.includes(preferredRole)) {
    return preferredRole;
  }

  return normalizedRoleKeys[0] || preferredRole || "SHIPPER";
};

const resolveSelectedRoleKeys = (formData = {}) => {
  const roleKeys = uniqueRoleKeys(formData?.roleKeys || []);
  if (roleKeys.length > 0) return roleKeys;
  return uniqueRoleKeys([formData?.role]);
};

const buildCanonicalRoleAssignments = ({
  roleKeys = [],
  branchIds = [],
  primaryBranchId = "",
}) => {
  const normalizedRoleKeys = uniqueRoleKeys(roleKeys);
  const normalizedBranchIds = unique(branchIds);
  const primaryBranch = normalize(primaryBranchId) || normalizedBranchIds[0] || "";

  return normalizedRoleKeys.flatMap((roleKey) => {
    if (TASK_SCOPED_ROLES.has(roleKey)) {
      return [{ roleKey, scopeType: "TASK", scopeRef: "" }];
    }

    if (!BRANCH_ROLES.has(roleKey)) {
      return [{ roleKey, scopeType: "GLOBAL", scopeRef: "" }];
    }

    return normalizedBranchIds.map((branchId) => ({
      roleKey,
      scopeType: "BRANCH",
      scopeRef: branchId,
      metadata: {
        isPrimary: normalize(branchId) === primaryBranch,
      },
    }));
  });
};

const isGranularFeatureEnabled = (user) => {
  const enabled =
    String(
      import.meta.env.VITE_FEATURE_PERMISSION_USER_MANAGEMENT || "false",
    ).toLowerCase() === "true";
  if (!enabled) return false;

  const pilotRaw = String(
    import.meta.env.VITE_FEATURE_PERMISSION_USER_MANAGEMENT_PILOT || "",
  ).trim();
  if (!pilotRaw) return true;

  const pilot = new Set(
    pilotRaw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

  return (
    pilot.has(normalize(user?._id).toLowerCase()) ||
    pilot.has(normalize(user?.email).toLowerCase())
  );
};

const emptyForm = () => ({
  fullName: "",
  phoneNumber: "",
  email: "",
  province: "",
  password: "",
  role: "POS_STAFF",
  roleKeys: ["POS_STAFF"],
  avatar: "",
  storeLocation: "",
});

const EmployeesPage = () => {
  const { user, authz } = useAuthStore();

  const [activeTab, setActiveTab] = useState("ALL");
  const [employees, setEmployees] = useState([]);
  const [stores, setStores] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [provinceFilter, setProvinceFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    total: 0,
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formData, setFormData] = useState(emptyForm());
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [step, setStep] = useState(1);
  const [catalog, setCatalog] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [permissionKeys, setPermissionKeys] = useState([]);
  const [templateKeys, setTemplateKeys] = useState([]);
  const [branchIds, setBranchIds] = useState([]);
  const [primaryBranchId, setPrimaryBranchId] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);

  const granularEnabled = useMemo(() => isGranularFeatureEnabled(user), [user]);
  const isGlobalAdmin = useMemo(
    () =>
      Boolean(
        authz?.isGlobalAdmin ||
          String(user?.role || "").toUpperCase() === "GLOBAL_ADMIN",
      ),
    [authz?.isGlobalAdmin, user?.role],
  );
  const isDialogOpen = showCreateDialog || Boolean(editingEmployee);
  const selectedRoleKeys = useMemo(() => resolveSelectedRoleKeys(formData), [formData]);
  const roleNeedsBranch = selectedRoleKeys.some((roleKey) => BRANCH_ROLES.has(roleKey));

  const catalogByKey = useMemo(() => {
    const map = new Map();
    for (const item of catalog) {
      map.set(normalize(item.key).toLowerCase(), item);
    }
    return map;
  }, [catalog]);

  const storeById = useMemo(() => {
    const map = new Map();
    for (const store of stores) {
      map.set(normalize(store._id), store);
    }
    return map;
  }, [stores]);

  const templateByKey = useMemo(() => {
    const map = new Map();
    for (const item of templates) {
      map.set(normalizeRoleKey(item.key), item);
    }
    return map;
  }, [templates]);

  const hasBranchScopedPermission = useMemo(
    () =>
      permissionKeys.some((key) => {
        const permission = catalogByKey.get(normalize(key).toLowerCase());
        return String(permission?.scopeType || "").toUpperCase() === "BRANCH";
      }),
    [catalogByKey, permissionKeys],
  );

  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) => {
        if (statusFilter !== "ALL" && employee.status !== statusFilter) {
          return false;
        }
        if (provinceFilter !== "ALL" && employee.province !== provinceFilter) {
          return false;
        }
        return true;
      }),
    [employees, provinceFilter, statusFilter],
  );

  const branchStoreOptions = useMemo(() => {
    if (isGlobalAdmin) return stores;

    const allowedBranchIds = unique(authz?.allowedBranchIds || []);
    if (!allowedBranchIds.length) return stores;

    return stores.filter((store) => allowedBranchIds.includes(normalize(store._id)));
  }, [authz?.allowedBranchIds, isGlobalAdmin, stores]);

  const sortedBranchIds = useMemo(() => {
    if (!branchIds.length) return [];

    const normalizedPrimaryBranch = normalize(primaryBranchId);
    if (!normalizedPrimaryBranch) return branchIds;

    return [
      normalizedPrimaryBranch,
      ...branchIds.filter((branchId) => normalize(branchId) !== normalizedPrimaryBranch),
    ];
  }, [branchIds, primaryBranchId]);

  const selectedRoleLabels = selectedRoleKeys.map(getRoleLabel);

  useEffect(() => {
    if (!branchIds.length) {
      setPrimaryBranchId("");
      return;
    }

    const normalizedPrimaryBranch = normalize(primaryBranchId);
    if (
      normalizedPrimaryBranch &&
      branchIds.some((branchId) => normalize(branchId) === normalizedPrimaryBranch)
    ) {
      return;
    }

    setPrimaryBranchId(normalize(branchIds[0]));
  }, [branchIds, primaryBranchId]);

  useEffect(() => {
    fetchEmployees(1);
    fetchStores();
  }, [activeTab, searchQuery, storeFilter]);

  useEffect(() => {
    if (!isDialogOpen) return;
    fetchMetadata();
  }, [isDialogOpen]);

  useEffect(() => {
    if (!granularEnabled || step !== 3 || !isDialogOpen) return;
    refreshPreview(editingEmployee?._id || "new-user-preview");
  }, [
    branchIds,
    editingEmployee?._id,
    formData.role,
    granularEnabled,
    isDialogOpen,
    permissionKeys,
    step,
    templateKeys,
  ]);

  const fetchStores = async () => {
    try {
      const response = await storeAPI.getAll({ limit: 200 });
      setStores(response.data.stores || []);
    } catch (fetchError) {
      console.error(fetchError);
    }
  };

  const fetchEmployees = async (page = 1) => {
    try {
      setIsLoading(true);

      const response = await userAPI.getAllEmployees({
        page,
        limit: 12,
        search: searchQuery || undefined,
        role: activeTab !== "ALL" ? activeTab : undefined,
        storeLocation: storeFilter !== "ALL" ? storeFilter : undefined,
        sortBy: "createdAt",
        sortOrder: "desc",
      });

      const data = response.data?.data || {};
      setEmployees(data.employees || []);
      setPagination({
        currentPage: data.pagination?.currentPage || 1,
        totalPages: data.pagination?.totalPages || 1,
        total: data.pagination?.total || 0,
      });
    } catch (fetchError) {
      setError("Không thể tải danh sách nhân viên");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMetadata = async () => {
    try {
      setMetadataLoading(true);
      const response = await userAPI.getPermissionCatalog();
      setCatalog(response.data?.data?.catalog || []);
      setTemplates(response.data?.data?.templates || []);
    } catch (fetchError) {
      setError(
        fetchError.response?.data?.message ||
          "Không thể tải metadata phân quyền",
      );
    } finally {
      setMetadataLoading(false);
    }
  };

  const deriveDefaultBranchIds = () => {
    if (isGlobalAdmin) return [];

    const preferredBranchId =
      normalize(authz?.activeBranchId) || normalize(user?.storeLocation);
    const allowedBranchIds = unique(authz?.allowedBranchIds || []);

    if (
      preferredBranchId &&
      (!allowedBranchIds.length || allowedBranchIds.includes(preferredBranchId))
    ) {
      return [preferredBranchId];
    }

    if (allowedBranchIds.length === 1) {
      return [allowedBranchIds[0]];
    }

    return [];
  };

  const extractBranchIdsFromEmployee = (employee) => {
    const assignments = Array.isArray(employee?.branchAssignments)
      ? employee.branchAssignments
      : [];

    const activeAssignments = assignments.filter(
      (item) => String(item?.status || "ACTIVE").toUpperCase() === "ACTIVE",
    );
    const orderedAssignments = [...activeAssignments].sort((left, right) =>
      right?.isPrimary === true ? 1 : left?.isPrimary === true ? -1 : 0,
    );

    const assignmentIds = orderedAssignments
      .map((assignment) => normalizeStoreId(assignment?.storeId))
      .filter(Boolean);

    if (assignmentIds.length) {
      return unique(assignmentIds);
    }

    const legacyStoreId = normalizeStoreId(employee?.storeLocation);
    return legacyStoreId ? [legacyStoreId] : [];
  };

  const extractPrimaryBranchId = (employee, employeeBranchIds = []) => {
    const assignments = Array.isArray(employee?.branchAssignments)
      ? employee.branchAssignments
      : [];
    const primaryAssignment = assignments.find((assignment) => assignment?.isPrimary);
    const primaryFromAssignment = normalizeStoreId(primaryAssignment?.storeId);

    if (primaryFromAssignment) {
      return primaryFromAssignment;
    }

    const legacyStoreId = normalizeStoreId(employee?.storeLocation);
    if (legacyStoreId) {
      return legacyStoreId;
    }

    return employeeBranchIds[0] ? normalize(employeeBranchIds[0]) : "";
  };

  const applyTemplate = (templateKey) => {
    const normalizedTemplateKey = normalizeRoleKey(templateKey);
    setTemplateKeys(normalizedTemplateKey ? [normalizedTemplateKey] : []);

    const template = templateByKey.get(normalizedTemplateKey);
    if (!template) {
      setPermissionKeys([]);
      return;
    }

    setPermissionKeys(unique((template.permissions || []).map((item) => item.key)));
  };

  const togglePermission = (permissionKey, checked) => {
    setTemplateKeys([]);
    setPermissionKeys((previous) =>
      checked
        ? unique([...previous, permissionKey])
        : previous.filter((key) => normalize(key) !== normalize(permissionKey)),
    );
  };

  const toggleModulePermissions = (modulePermissions = [], checked) => {
    const moduleKeys = unique(modulePermissions.map((permission) => permission.key));
    const moduleKeySet = new Set(moduleKeys.map((key) => normalize(key)));

    setTemplateKeys([]);
    setPermissionKeys((previous) =>
      checked
        ? unique([...previous, ...moduleKeys])
        : previous.filter((key) => !moduleKeySet.has(normalize(key))),
    );
  };

  const buildPermissionPayload = (targetUserId = "new-user-preview") => ({
    enableGranularPermissions: true,
    templateKeys,
    branchIds: sortedBranchIds,
    targetUserId,
    permissions: permissionKeys
      .map((key) => {
        const permission = catalogByKey.get(normalize(key).toLowerCase());
        if (!permission) return null;

        const scopeType = String(permission.scopeType || "").toUpperCase();
        if (scopeType === "BRANCH") {
          return {
            key: permission.key,
            scopeType: "BRANCH",
            branchIds: sortedBranchIds,
          };
        }

        if (scopeType === "SELF") {
          return { key: permission.key, scopeType: "SELF" };
        }

        if (scopeType === "TASK") {
          return { key: permission.key, scopeType: "TASK" };
        }

        return { key: permission.key, scopeType: "GLOBAL" };
      })
      .filter(Boolean),
  });

  const refreshPreview = async (targetUserId = "new-user-preview") => {
    if (!granularEnabled) return;

    try {
      setPreviewLoading(true);
      const response = await userAPI.previewPermissionAssignments({
        ...buildPermissionPayload(targetUserId),
        role: formData.role,
        storeLocation: sortedBranchIds[0] || formData.storeLocation,
      });

      setPreview(response.data?.data || null);
      if (response.data?.success === false) {
        setError(response.data?.message || "Bản xem trước phân quyền bị từ chối");
      }
    } catch (previewError) {
      setError(
        previewError.response?.data?.message || "Không thể xem trước phân quyền",
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const resetWizard = () => {
    const defaults = deriveDefaultBranchIds();
    setStep(1);
    setPreview(null);
    setBranchIds(defaults);
    setPrimaryBranchId(defaults[0] || "");
    setPermissionKeys([]);
    setTemplateKeys([]);
  };

  const openCreateDialog = () => {
    const role = activeTab !== "ALL" ? activeTab : "POS_STAFF";
    setFormData({ ...emptyForm(), role, roleKeys: [role] });
    resetWizard();
    setShowCreateDialog(true);
  };

  const openEditDialog = async (employee) => {
    setEditingEmployee(employee);
    setFormData({
      fullName: employee.fullName || "",
      phoneNumber: employee.phoneNumber || "",
      email: employee.email || "",
      province: employee.province || "",
      password: "",
      role: employee.role || "POS_STAFF",
      roleKeys: [employee.role || "POS_STAFF"],
      avatar: employee.avatar || "",
      storeLocation: employee.storeLocation || "",
    });
    setStep(1);
    setPreview(null);
    setPermissionKeys([]);
    setTemplateKeys([]);

    const employeeBranchIds = extractBranchIdsFromEmployee(employee);
    setBranchIds(employeeBranchIds);
    setPrimaryBranchId(extractPrimaryBranchId(employee, employeeBranchIds));

    try {
      const response = await userAPI.getUserAuthorization(employee._id);
      const data = response.data?.data || {};

      const authorizationRoleKeys = uniqueRoleKeys(
        data.roleKeys || (data.roleAssignments || []).map((item) => item.roleKey),
      );
      const authorizationBranchIds = unique([
        ...(data.allowedBranchIds || []),
        ...(data.roleAssignments || [])
          .filter((item) => String(item.scopeType || "").toUpperCase() === "BRANCH")
          .map((item) => item.scopeRef || item.scopeId),
        ...(data.directPermissionGrants || [])
          .filter((item) => String(item.scopeType || "").toUpperCase() === "BRANCH")
          .map((item) => item.scopeRef || item.scopeId),
      ]);

      setFormData((previous) => ({
        ...previous,
        role: getPrimaryRoleKey(authorizationRoleKeys, employee.role || "POS_STAFF"),
        roleKeys: authorizationRoleKeys.length
          ? authorizationRoleKeys
          : [employee.role || "POS_STAFF"],
      }));

      const resolvedBranchIds = authorizationBranchIds.length
        ? authorizationBranchIds
        : employeeBranchIds;
      setBranchIds(resolvedBranchIds);
      setPrimaryBranchId(
        normalize(data.activeBranchId) ||
          extractPrimaryBranchId(employee, resolvedBranchIds),
      );

      if (granularEnabled) {
        setPermissionKeys(
          unique((data.directPermissionGrants || []).map((item) => item.key)),
        );
      }
    } catch (fetchError) {
      setError(fetchError.response?.data?.message || "Không thể tải quyền hiện tại");
    }
  };

  const closeDialog = () => {
    setShowCreateDialog(false);
    setEditingEmployee(null);
    setFormData(emptyForm());
    setStep(1);
    setBranchIds([]);
    setPrimaryBranchId("");
    setPermissionKeys([]);
    setTemplateKeys([]);
    setPreview(null);
    setError("");
  };

  const handlePrimaryRoleChange = (roleKey) => {
    const normalizedRoleKey = normalizeRoleKey(roleKey);

    setFormData((previous) => {
      const nextRoleKeys = uniqueRoleKeys([
        normalizedRoleKey,
        ...resolveSelectedRoleKeys(previous),
      ]);

      return {
        ...previous,
        role: normalizedRoleKey,
        roleKeys: nextRoleKeys,
      };
    });
  };

  const handleSecondaryRoleToggle = (roleKey, checked) => {
    const normalizedRoleKey = normalizeRoleKey(roleKey);

    setFormData((previous) => {
      const primaryRole = getPrimaryRoleKey(resolveSelectedRoleKeys(previous), previous.role);
      const nextRoleKeys = checked
        ? uniqueRoleKeys([primaryRole, ...resolveSelectedRoleKeys(previous), normalizedRoleKey])
        : uniqueRoleKeys(
            resolveSelectedRoleKeys(previous).filter(
              (currentRoleKey) =>
                normalizeRoleKey(currentRoleKey) !== normalizedRoleKey,
            ),
          );

      return {
        ...previous,
        roleKeys: uniqueRoleKeys([primaryRole, ...nextRoleKeys]),
      };
    });
  };

  const handleBranchToggle = (storeId, checked) => {
    setBranchIds((previous) =>
      checked
        ? unique([...previous, storeId])
        : previous.filter((branchId) => normalize(branchId) !== normalize(storeId)),
    );
  };

  const basePayload = () => {
    const primaryRoleKey = getPrimaryRoleKey(selectedRoleKeys, formData.role);
    const canonicalRoleAssignments = buildCanonicalRoleAssignments({
      roleKeys: selectedRoleKeys,
      branchIds: sortedBranchIds,
      primaryBranchId,
    });
    const resolvedPrimaryBranchId =
      normalize(primaryBranchId) || sortedBranchIds[0] || formData.storeLocation;

    return {
      fullName: formData.fullName,
      phoneNumber: formData.phoneNumber,
      email: formData.email,
      province: formData.province,
      password: formData.password,
      role: primaryRoleKey,
      roleKeys: selectedRoleKeys,
      roleAssignments: canonicalRoleAssignments,
      avatar: formData.avatar,
      primaryBranchId: resolvedPrimaryBranchId,
      storeLocation: resolvedPrimaryBranchId,
      branchIds: sortedBranchIds,
    };
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const payload = basePayload();
      if (granularEnabled) {
        Object.assign(payload, buildPermissionPayload("new-user-preview"));
        await userAPI.createUser(payload);
      } else {
        await userAPI.createEmployee(payload);
      }

      toast.success("Tạo nhân viên thành công");
      await fetchEmployees();
      closeDialog();
    } catch (submitError) {
      const errorMessage =
        submitError.response?.data?.message || "Tạo nhân viên thất bại";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!editingEmployee) return;

    setIsSubmitting(true);
    setError("");

    try {
      const payload = basePayload();
      if (!normalize(payload.password)) {
        delete payload.password;
      }

      await userAPI.updateEmployee(editingEmployee._id, payload);

      if (granularEnabled) {
        await userAPI.updateUserPermissions(
          editingEmployee._id,
          buildPermissionPayload(editingEmployee._id),
        );
      }

      toast.success("Cập nhật nhân viên thành công");
      await fetchEmployees();
      closeDialog();
    } catch (submitError) {
      const errorMessage =
        submitError.response?.data?.message || "Cập nhật thất bại";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleStatus = async (id) => {
    try {
      await userAPI.toggleEmployeeStatus(id);
      await fetchEmployees();
    } catch {
      setError("Thao tác thất bại");
    }
  };

  const removeEmployee = (employee) => {
    setEmployeeToDelete(employee);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!employeeToDelete) return;

    try {
      await userAPI.deleteEmployee(employeeToDelete._id);
      toast.success("Xóa nhân viên thành công");
      await fetchEmployees();
    } catch {
      setError("Xóa nhân viên thất bại");
    } finally {
      setShowDeleteDialog(false);
      setEmployeeToDelete(null);
    }
  };

  const renderBasicStep = () => (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Họ và tên *</Label>
        <Input
          name="fullName"
          value={formData.fullName}
          onChange={(event) =>
            setFormData((previous) => ({
              ...previous,
              fullName: event.target.value,
            }))
          }
          required
        />
        <p className="text-xs text-muted-foreground">
          Tên hiển thị của nhân viên trong hệ thống và các chứng từ nội bộ.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Số điện thoại *</Label>
        <Input
          name="phoneNumber"
          value={formData.phoneNumber}
          onChange={(event) =>
            setFormData((previous) => ({
              ...previous,
              phoneNumber: event.target.value,
            }))
          }
          required
        />
        <p className="text-xs text-muted-foreground">
          Dùng cho liên hệ nội bộ và hỗ trợ đăng nhập khi cần.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Email</Label>
        <Input
          type="email"
          value={formData.email}
          onChange={(event) =>
            setFormData((previous) => ({
              ...previous,
              email: event.target.value,
            }))
          }
        />
        <p className="text-xs text-muted-foreground">
          Có thể để trống nếu nhân viên chỉ dùng số điện thoại để liên hệ.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Tỉnh / thành</Label>
        <Select
          value={formData.province}
          onValueChange={(value) =>
            setFormData((previous) => ({ ...previous, province: value }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Chọn tỉnh / thành" />
          </SelectTrigger>
          <SelectContent className="max-h-96">
            {provinces.map((province) => (
              <SelectItem key={province} value={province}>
                {province}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Mật khẩu {editingEmployee ? "(mới)" : "*"}</Label>
        <Input
          type="password"
          value={formData.password}
          onChange={(event) =>
            setFormData((previous) => ({
              ...previous,
              password: event.target.value,
            }))
          }
          required={!editingEmployee}
        />
        <p className="text-xs text-muted-foreground">
          {editingEmployee
            ? "Để trống nếu không muốn thay đổi mật khẩu hiện tại."
            : "Nhân viên sẽ dùng mật khẩu này cho lần đăng nhập đầu tiên."}
        </p>
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label>Ảnh đại diện (URL)</Label>
        <Input
          value={formData.avatar}
          onChange={(event) =>
            setFormData((previous) => ({
              ...previous,
              avatar: event.target.value,
            }))
          }
        />
      </div>
    </div>
  );

  const renderStepContent = () => {
    if (step === 1) {
      return renderBasicStep();
    }

    if (step === 2) {
      return (
        <EmployeeBranchStep
          branchStoreOptions={branchStoreOptions}
          branchIds={branchIds}
          primaryBranchId={primaryBranchId}
          sortedBranchIds={sortedBranchIds}
          roleNeedsBranch={roleNeedsBranch}
          hasBranchScopedPermission={hasBranchScopedPermission}
          onToggleBranch={handleBranchToggle}
          onPrimaryBranchChange={setPrimaryBranchId}
          storeById={storeById}
          selectedRoleLabels={selectedRoleLabels}
        />
      );
    }

    return (
      <EmployeePermissionStep
        availableRoles={ROLE_DEFINITIONS}
        primaryRoleKey={getPrimaryRoleKey(selectedRoleKeys, formData.role)}
        selectedRoleKeys={selectedRoleKeys}
        templateByKey={templateByKey}
        catalog={catalog}
        permissionKeys={permissionKeys}
        templateKeys={templateKeys}
        granularEnabled={granularEnabled}
        metadataLoading={metadataLoading}
        preview={preview}
        previewLoading={previewLoading}
        sortedBranchIds={sortedBranchIds}
        storeById={storeById}
        onPrimaryRoleChange={handlePrimaryRoleChange}
        onSecondaryRoleToggle={handleSecondaryRoleToggle}
        onApplyTemplate={applyTemplate}
        onTogglePermission={togglePermission}
        onToggleModulePermissions={toggleModulePermissions}
      />
    );
  };

  const renderWizard = () => (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        {STEPS.map((item) => {
          const isActive = step === item.id;
          const isCompleted = step > item.id;

          return (
            <button
              key={item.id}
              type="button"
              className={`rounded-2xl border p-4 text-left transition ${
                isActive
                  ? "border-primary bg-primary/5"
                  : isCompleted
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-border bg-background hover:border-primary/40"
              }`}
              onClick={() => {
                if (item.id < step) {
                  setStep(item.id);
                  return;
                }

                if (item.id === step) return;

                if (
                  (step === 1 &&
                    !(
                      normalize(formData.fullName) &&
                      normalize(formData.phoneNumber) &&
                      (editingEmployee || normalize(formData.password))
                    )) ||
                  (step === 2 &&
                    (roleNeedsBranch || hasBranchScopedPermission) &&
                    branchIds.length === 0)
                ) {
                  return;
                }

                setStep(item.id);
              }}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Bước {item.id}
              </div>
              <div className="mt-2 text-base font-semibold">{item.label}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {item.description}
              </div>
            </button>
          );
        })}
      </div>

      {renderStepContent()}
    </div>
  );

  const hasFilter =
    searchQuery ||
    statusFilter !== "ALL" ||
    provinceFilter !== "ALL" ||
    storeFilter !== "ALL";

  const canContinue =
    step === 1
      ? normalize(formData.fullName) &&
        normalize(formData.phoneNumber) &&
        (editingEmployee || normalize(formData.password))
      : step === 2
        ? !(roleNeedsBranch || hasBranchScopedPermission) || branchIds.length > 0
        : true;

  const dialogTitle = editingEmployee ? "Chỉnh sửa nhân viên" : "Tạo nhân viên mới";
  const dialogDescription = editingEmployee
    ? "Cập nhật thông tin, chi nhánh và phân quyền của nhân viên."
    : "Thiết lập thông tin cơ bản, chi nhánh và vai trò cho nhân viên mới.";
  const submitDisabled =
    isSubmitting ||
    ((roleNeedsBranch || hasBranchScopedPermission) && branchIds.length === 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Quản lý nhân viên</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tạo tài khoản nhân sự, gán chi nhánh và cấu hình quyền truy cập.
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <UserPlus className="mr-2 h-4 w-4" />
          Thêm nhân viên
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          setSearchQuery("");
          setStatusFilter("ALL");
          setProvinceFilter("ALL");
          setStoreFilter("ALL");
        }}
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl bg-muted/60 p-2">
          {EMPLOYEE_ROLE_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="rounded-xl">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Tìm tên, email, số điện thoại..."
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="xl:w-44">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả</SelectItem>
            <SelectItem value="ACTIVE">Hoạt động</SelectItem>
            <SelectItem value="LOCKED">Đã khóa</SelectItem>
          </SelectContent>
        </Select>

        <Select value={provinceFilter} onValueChange={setProvinceFilter}>
          <SelectTrigger className="xl:w-56">
            <SelectValue placeholder="Tỉnh / thành" />
          </SelectTrigger>
          <SelectContent className="max-h-96">
            <SelectItem value="ALL">Tất cả tỉnh / thành</SelectItem>
            {provinces.map((province) => (
              <SelectItem key={province} value={province}>
                {province}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isGlobalAdmin ? (
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="xl:w-56">
              <SelectValue placeholder="Chi nhánh" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả chi nhánh</SelectItem>
              {stores.map((store) => (
                <SelectItem key={store._id} value={store._id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {hasFilter ? (
          <Button
            variant="outline"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("ALL");
              setProvinceFilter("ALL");
              setStoreFilter("ALL");
            }}
          >
            <X className="mr-2 h-4 w-4" />
            Xóa bộ lọc
          </Button>
        ) : null}
      </div>

      {!isDialogOpen && error ? <ErrorMessage message={error} /> : null}

      {isLoading ? (
        <Loading />
      ) : filteredEmployees.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto mb-4 h-16 w-16 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">
            {hasFilter ? "Không tìm thấy nhân viên" : "Chưa có nhân viên nào"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredEmployees.map((employee) => (
            <Card key={employee._id}>
              <CardContent className="p-5">
                <div className="mb-4 flex items-start justify-between">
                  <Avatar className="h-12 w-12">
                    {employee.avatar ? (
                      <AvatarImage src={employee.avatar} alt={employee.fullName} />
                    ) : (
                      <AvatarFallback>
                        {getNameInitials(employee.fullName)}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <Badge
                    className={
                      employee.status === "ACTIVE"
                        ? "bg-emerald-500 text-white hover:bg-emerald-500"
                        : "bg-red-500 text-white hover:bg-red-500"
                    }
                  >
                    {getStatusText(employee.status)}
                  </Badge>
                </div>

                <h3 className="font-semibold">{employee.fullName}</h3>
                <p className="text-sm text-muted-foreground">{employee.phoneNumber}</p>
                {employee.email ? (
                  <p className="text-xs text-muted-foreground">{employee.email}</p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">{getRoleLabel(employee.role)}</Badge>
                  {employee.storeLocation ? (
                    <Badge variant="secondary" className="text-xs">
                      <MapPin className="mr-1 h-3 w-3" />
                      {storeById.get(normalize(employee.storeLocation))?.name || "Chi nhánh"}
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditDialog(employee)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(employee._id)}>
                    {employee.status === "ACTIVE" ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => removeEmployee(employee)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 ? (
        <div className="mt-8 flex items-center justify-center gap-6">
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.currentPage === 1}
            onClick={() => fetchEmployees(pagination.currentPage - 1)}
          >
            Trước
          </Button>
          <span className="text-sm">
            Trang {pagination.currentPage}/{pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.currentPage === pagination.totalPages}
            onClick={() => fetchEmployees(pagination.currentPage + 1)}
          >
            Sau
          </Button>
        </div>
      ) : null}

      <Dialog open={isDialogOpen} onOpenChange={(open) => (!open ? closeDialog() : null)}>
        <DialogContent className="max-h-[92vh] max-w-[min(96vw,72rem)] overflow-hidden p-0 sm:max-w-5xl">
          <form
            onSubmit={editingEmployee ? handleUpdate : handleCreate}
            className="flex max-h-[92vh] flex-col"
          >
            <DialogHeader className="border-b px-6 py-5 pr-14">
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription>{dialogDescription}</DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              {error ? <ErrorMessage message={error} /> : null}
              {renderWizard()}
            </div>

            <DialogFooter className="items-center border-t bg-muted/30 px-5 py-4 sm:justify-between sm:px-6">
              <div className="text-sm text-muted-foreground">
                Bước {step}/{STEPS.length}
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Hủy
                </Button>

                {step > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep((previous) => previous - 1)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Quay lại
                  </Button>
                ) : null}

                {step < STEPS.length ? (
                  <Button
                    type="button"
                    disabled={!canContinue}
                    onClick={() => setStep((previous) => previous + 1)}
                  >
                    Tiếp tục
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={submitDisabled}>
                    {isSubmitting
                      ? editingEmployee
                        ? "Đang cập nhật..."
                        : "Đang tạo..."
                      : editingEmployee
                        ? "Cập nhật nhân viên"
                        : "Tạo nhân viên"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa nhân viên</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa nhân viên <strong>{employeeToDelete?.fullName}</strong>?
              <br />
              <span className="text-red-600 font-medium">
                Hành động này không thể hoàn tác và tài khoản này sẽ không thể đăng nhập được nữa.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Xác nhận xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EmployeesPage;
