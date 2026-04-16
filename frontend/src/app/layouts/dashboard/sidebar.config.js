import {
  Boxes,
  ClipboardList,
  FileText,
  History,
  Layers,
  Layout,
  LayoutDashboard,
  Package,
  PackageCheck,
  PackagePlus,
  Percent,
  Receipt,
  ArrowRightLeft,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Users,
  Video,
  Warehouse,
} from "lucide-react";
import {
  getAuthorizationSnapshot,
  getPermissionSet,
  getRoleKeys,
  normalizePermissionKey,
  normalizeRoleKey,
} from "@/features/auth/lib/authorization";

const ROLE_LABELS = {
  GLOBAL_ADMIN: "Quản trị viên toàn hệ thống",
  ADMIN: "Quan tri vien",
  BRANCH_ADMIN: "Quan tri chi nhanh",
  SALES_STAFF: "Nhan vien ban hang",
  WAREHOUSE_MANAGER: "Quan ly kho",
  WAREHOUSE_STAFF: "Nhan vien kho",
  PRODUCT_MANAGER: "Quan ly san pham",
  ORDER_MANAGER: "Quan ly don hang",
  SHIPPER: "Nhan vien giao hang",
  POS_STAFF: "Nhan vien POS",
  CASHIER: "Thu ngan",
};

const addItem = (items, item) => {
  if (!items.some((existing) => existing.path === item.path)) {
    items.push(item);
  }
};

export const getRoleLabel = (role) => {
  const roleKeys = (Array.isArray(role) ? role : [role])
    .map(normalizeRoleKey)
    .filter(Boolean);

  if (!roleKeys.length) return "";
  return roleKeys.map((roleKey) => ROLE_LABELS[roleKey] || roleKey).join(", ");
};

export const getDashboardNavigation = ({ user, authz, authorization }) => {
  const items = [];
  const snapshot = getAuthorizationSnapshot({ authz, authorization });
  const permissionSet = getPermissionSet(snapshot);
  const roleKeys = getRoleKeys({ user, authz, authorization });
  const isGlobalAdmin = Boolean(
    snapshot?.isGlobalAdmin || permissionSet.has("*"),
  );
  const hasPermission = (key) =>
    isGlobalAdmin || permissionSet.has(normalizePermissionKey(key));
  const hasAnyPermission = (keys = []) =>
    isGlobalAdmin || keys.some((key) => hasPermission(key));
  const hasAllPermissions = (keys = []) =>
    isGlobalAdmin || keys.every((key) => hasPermission(key));

  const canManageUsers =
    hasPermission("*") ||
    hasPermission("users.manage.branch") ||
    hasPermission("users.manage.global");

  if (
    hasAnyPermission([
      "analytics.read.global",
      "analytics.read.assigned",
      "users.manage.global",
      "store.manage",
    ])
  ) {
    addItem(items, {
      path: "/admin",
      icon: LayoutDashboard,
      label: "Dashboard",
    });
  }

  if (hasPermission("store.manage")) {
    addItem(items, {
      path: "/admin/stores",
      icon: Store,
      label: "Quản lý cửa hàng",
    });
  }

  if (canManageUsers) {
    addItem(items, {
      path: "/admin/employees",
      icon: Users,
      label: "Quản lý nhân viên",
    });
  }

  if (
    hasAnyPermission([
      "product.read",
      "product.create",
      "product.update",
      "product.delete",
    ])
  ) {
    addItem(items, {
      path: "/warehouse/products",
      icon: Smartphone,
      label: "Sản phẩm",
    });
  }

  if (hasPermission("brand.manage")) {
    addItem(items, {
      path: "/admin/brands",
      icon: Tags,
      label: "Quản lý hãng",
    });
  }

  if (hasPermission("product_type.manage")) {
    addItem(items, {
      path: "/admin/product-types",
      icon: Layers,
      label: "Loại sản phẩm",
    });
  }

  if (hasAnyPermission(["inventory.read", "warehouse.read"])) {
    addItem(items, {
      path: "/admin/inventory-dashboard",
      icon: Boxes,
      label: "Tổng quan kho",
    });
  }

  if (hasAnyPermission(["inventory.write", "warehouse.write"])) {
    addItem(items, {
      path: "/admin/stock-in",
      icon: PackagePlus,
      label: "Nhập kho",
    });
  }

  if (hasAnyPermission(["device.read", "device.write"])) {
    addItem(items, {
      path: "/admin/devices",
      icon: Smartphone,
      label: "Thiết bị",
    });
  }

  if (hasPermission("promotion.manage")) {
    addItem(items, {
      path: "/admin/promotions",
      icon: Percent,
      label: "Khuyến mãi",
    });
  }

  if (hasPermission("content.manage")) {
    addItem(items, {
      path: "/admin/homepage-editor",
      icon: Layout,
      label: "Giao diện trang chủ",
    });
    addItem(items, {
      path: "/admin/short-videos",
      icon: Video,
      label: "Video ngắn",
    });
  }

  if (hasPermission("analytics.read.global")) {
    addItem(items, {
      path: "/admin/audit-logs",
      icon: ShieldCheck,
      label: "Audit logs",
    });
  }

  const canAccessWarehouseDashboard =
    hasPermission("*") ||
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
    ]);

  const canAccessWarehouseReceive =
    hasPermission("*") ||
    hasAnyPermission(["warehouse.write", "inventory.write"]);

  const canAccessWarehousePick =
    hasAllPermissions([
      "orders.read",
      "warehouse.read",
      "warehouse.write",
    ]) &&
    hasAnyPermission([
      "order.status.manage.warehouse",
      "order.status.manage",
    ]);

  // Same scope as warehouse routes: anyone who can open the warehouse staff area
  // should see "Chuyển kho" (inter-branch + internal). Fine-grained actions use
  // transfer.* permissions on the page and API.
  const canAccessWarehouseTransfer = canAccessWarehouseDashboard;

  // Section for warehouse-staff specific pages (not admin core)
  if (canAccessWarehouseDashboard) {
    addItem(items, {
      path: "/warehouse-staff",
      icon: Package,
      label: "Dashboard kho",
    });
  }

  if (canAccessWarehouseReceive) {
    addItem(items, {
      path: "/warehouse-staff/receive-goods",
      icon: PackageCheck,
      label: "Nhận hàng",
    });
  }

  if (canAccessWarehousePick) {
    addItem(items, {
      path: "/warehouse-staff/pick-orders",
      icon: ClipboardList,
      label: "Xuất kho",
    });
  }

  if (canAccessWarehouseTransfer) {
    addItem(items, {
      path: "/warehouse-staff/transfer",
      icon: ArrowRightLeft,
      label: "Điều chuyển hàng",
    });
  }

  if (hasPermission("order.pick.complete.instore")) {
    addItem(items, {
      path: "/admin/warehouse-config",
      icon: Warehouse,
      label: "Cấu hình kho",
    });
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
    addItem(items, {
      path: "/order-manager/orders",
      icon: ShoppingBag,
      label: "Quản lý đơn hàng",
    });
  }

  if (
    hasAnyPermission([
      "task.read",
      "task.update",
      "order.view.assigned",
      "order.status.manage.task",
    ])
  ) {
    addItem(items, {
      path: "/shipper/dashboard",
      icon: Truck,
      label: "Giao hàng",
    });
  }

  if (
    hasAnyPermission([
      "pos.order.create",
      "pos.order.read.self",
      "order.status.manage.pos",
    ])
  ) {
    addItem(items, { path: "/pos/dashboard", icon: Receipt, label: "POS" });
    addItem(items, {
      path: "/pos/orders",
      icon: History,
      label: "Lịch sử POS",
    });
  }

  if (
    hasAnyPermission([
      "pos.order.read.branch",
      "pos.payment.process",
      "pos.order.finalize",
      "pos.vat.issue",
    ])
  ) {
    addItem(items, {
      path: "/CASHIER/dashboard",
      icon: TrendingUp,
      label: "Thu ngân",
    });
    addItem(items, {
      path: "/CASHIER/vat-invoices",
      icon: FileText,
      label: "Hóa đơn",
    });
  }

  if (
    !roleKeys.length &&
    items.length === 0 &&
    hasPermission("cart.manage.self")
  ) {
    addItem(items, { path: "/profile", icon: Users, label: "Tài khoản" });
  }

  return items;
};
