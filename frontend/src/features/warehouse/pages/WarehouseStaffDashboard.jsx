import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle,
  Clock,
  Package,
  RefreshCw,
  Store,
  TrendingDown,
  TruckIcon,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { api } from "@/shared/lib/http/httpClient";
import { useAuthStore } from "@/features/auth";
import { inventoryAPI, stockTransferAPI } from "@/features/inventory";
import { orderAPI } from "@/features/orders";
import { toast } from "sonner";

const TRANSFER_STATUS_LABEL = {
  CREATED: "Đã tạo - Chờ xác nhận",
  WAITING_FOR_PICKUP: "Đang chuẩn bị hàng",
  IN_TRANSIT: "Đang vận chuyển",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
  PENDING: "Chờ xử lý (cũ)",
  APPROVED: "Đã duyệt (cũ)",
  REJECTED: "Từ chối (cũ)",
  RECEIVED: "Đã nhận (cũ)",
};

const TRANSFER_STATUS_BADGE_CLASS = {
  CREATED: "bg-blue-100 text-blue-800",
  WAITING_FOR_PICKUP: "bg-amber-100 text-amber-800",
  IN_TRANSIT: "bg-indigo-100 text-indigo-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-zinc-200 text-zinc-800",
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
  RECEIVED: "bg-emerald-100 text-emerald-800",
};

const REPLENISHMENT_PRIORITY_BADGE_CLASS = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-amber-100 text-amber-800",
};

const RISK_LABEL = {
  CRITICAL: "Nghiêm trọng",
  HIGH: "Cao",
  MEDIUM: "Trung bình",
  LOW: "Thấp",
};

const REPLENISHMENT_TYPE_LABEL = {
  INTER_STORE_TRANSFER: "Chuyển kho liên cửa hàng",
  WAREHOUSE_REPLENISHMENT: "Bổ sung từ kho tổng",
};

const DEMAND_RISK_BADGE_CLASS = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-amber-100 text-amber-800",
  MEDIUM: "bg-blue-100 text-blue-800",
  LOW: "bg-zinc-200 text-zinc-800",
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN");
};

const formatCurrency = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0 VND";
  return amount.toLocaleString("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  });
};

const getTotalByPagination = (response, listKey) => {
  const total = response?.data?.pagination?.total;
  if (Number.isFinite(total)) return total;

  const items = response?.data?.[listKey];
  return Array.isArray(items) ? items.length : 0;
};

const getTransferItemSummary = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return "0 SKU";

  const requestedQty = items.reduce(
    (sum, item) => sum + (Number(item.requestedQuantity) || 0),
    0
  );
  return `${items.length} SKU / ${requestedQty} sp`;
};

const WarehouseStaffDashboard = () => {
  const navigate = useNavigate();
  const authz = useAuthStore((state) => state.authz);
  const userRole = useAuthStore((state) => state.user?.role);
  const isGlobalAdmin = Boolean(
    authz?.isGlobalAdmin || String(userRole || "").toUpperCase() === "GLOBAL_ADMIN"
  );

  const [stats, setStats] = useState({
    pendingPOs: 0,
    todayReceipts: 0,
    pendingPicks: 0,
    pendingTransfers: 0,
    inTransitTransfers: 0,
  });

  const [inventorySummary, setInventorySummary] = useState({
    totalSKUs: 0,
    lowStockCount: 0,
    criticalCount: 0,
    totalValue: 0,
  });

  const [storeNeedsAttention, setStoreNeedsAttention] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [replenishmentRecommendations, setReplenishmentRecommendations] =
    useState([]);
  const [replenishmentSummary, setReplenishmentSummary] = useState({
    totalRecommendations: 0,
    criticalCount: 0,
    interStoreCount: 0,
    warehouseCount: 0,
  });
  const [demandPredictions, setDemandPredictions] = useState([]);
  const [demandPredictionSummary, setDemandPredictionSummary] = useState({
    totalPredictions: 0,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    totalSuggestedQuantity: 0,
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [creatingRecommendationKey, setCreatingRecommendationKey] = useState("");

  const loadDashboardData = async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const allowForbidden = (promise, fallbackData) =>
        promise.catch((error) => {
          if (error?.response?.status === 403) {
            return { data: fallbackData };
          }
          throw error;
        });

      const [
        posRes,
        receiptsRes,
        confirmedOrdersRes,
        pickingOrdersRes,
        consolidatedRes,
        comparisonRes,
        alertsRes,
        movementsRes,
        transfersRes,
        replenishmentRes,
        predictionsRes,
      ] = await Promise.all([
        allowForbidden(
          api.get("/warehouse/purchase-orders", {
            params: { status: "CONFIRMED", limit: 100 },
          }),
          { purchaseOrders: [], pagination: { total: 0 } }
        ),
        allowForbidden(
          api.get("/warehouse/goods-receipt", { params: { page: 1, limit: 100 } }),
          { goodsReceipts: [] }
        ),
        allowForbidden(orderAPI.getByStage("CONFIRMED", { limit: 100 }), {
          orders: [],
          pagination: { total: 0 },
        }),
        allowForbidden(orderAPI.getByStage("PICKING", { limit: 100 }), {
          orders: [],
          pagination: { total: 0 },
        }),
        allowForbidden(inventoryAPI.getConsolidated(), { summary: {}, inventory: [] }),
        allowForbidden(inventoryAPI.getStoreComparison(), { needsAttention: [] }),
        allowForbidden(inventoryAPI.getAlerts({ limit: 8 }), { alerts: [], summary: {} }),
        allowForbidden(inventoryAPI.getMovements({ days: 7, limit: 10 }), {
          movements: [],
        }),
        allowForbidden(stockTransferAPI.getAll({ limit: 10 }), { transfers: [] }),
        allowForbidden(inventoryAPI.getReplenishment({ limit: 8 }), {
          recommendations: [],
          summary: {},
        }),
        allowForbidden(
          inventoryAPI.getPredictions({
            limit: 8,
            lowStockOnly: true,
            daysAhead: 7,
            historicalDays: 90,
          }),
          { predictions: [], summary: {} }
        ),
      ]);

      const today = new Date().toISOString().split("T")[0];
      const receipts = receiptsRes.data?.goodsReceipts || [];
      const todayReceipts = receipts.filter((receipt) => {
        const receivedDate =
          receipt?.receivedDate || receipt?.completedDate || receipt?.createdAt;
        if (!receivedDate) return false;
        return new Date(receivedDate).toISOString().split("T")[0] === today;
      });

      const pendingPicks =
        getTotalByPagination(confirmedOrdersRes, "orders") +
        getTotalByPagination(pickingOrdersRes, "orders");

      const alertRows = alertsRes.data?.alerts || [];
      const alertSummary = alertsRes.data?.summary || {};
      const transferRows = transfersRes.data?.transfers || [];
      const replenishmentRows = replenishmentRes.data?.recommendations || [];
      const replenishmentStats = replenishmentRes.data?.summary || {};
      const predictionRows = predictionsRes.data?.predictions || [];
      const predictionStats = predictionsRes.data?.summary || {};
      const consolidatedSummary = consolidatedRes.data?.summary || {};

      setStats({
        pendingPOs: getTotalByPagination(posRes, "purchaseOrders"),
        todayReceipts: todayReceipts.length,
        pendingPicks,
        pendingTransfers: transferRows.filter((row) => row.status === "CREATED")
          .length,
        inTransitTransfers: transferRows.filter(
          (row) => row.status === "IN_TRANSIT"
        ).length,
      });

      setInventorySummary({
        totalSKUs:
          Number(consolidatedSummary.totalSKUs) ||
          (consolidatedRes.data?.inventory || []).length,
        lowStockCount:
          Number(consolidatedSummary.lowStockCount) || alertRows.length,
        criticalCount:
          Number(alertSummary.critical) ||
          alertRows.filter((row) => row.priority === "CRITICAL").length,
        totalValue: Number(consolidatedSummary.totalValue) || 0,
      });

      setStoreNeedsAttention(comparisonRes.data?.needsAttention || []);
      setAlerts(alertRows);
      setMovements(movementsRes.data?.movements || []);
      setTransfers(transferRows);
      setReplenishmentRecommendations(replenishmentRows);
      setReplenishmentSummary({
        totalRecommendations:
          Number(replenishmentStats.totalRecommendations) ||
          replenishmentRows.length,
        criticalCount:
          Number(replenishmentStats.criticalCount) ||
          replenishmentRows.filter((row) => row.priority === "CRITICAL").length,
        interStoreCount:
          Number(replenishmentStats.interStoreCount) ||
          replenishmentRows.filter(
            (row) => row.type === "INTER_STORE_TRANSFER"
          ).length,
        warehouseCount:
          Number(replenishmentStats.warehouseCount) ||
          replenishmentRows.filter(
            (row) => row.type === "WAREHOUSE_REPLENISHMENT"
          ).length,
      });
      setDemandPredictions(predictionRows);
      setDemandPredictionSummary({
        totalPredictions:
          Number(predictionStats.totalPredictions) || predictionRows.length,
        criticalCount:
          Number(predictionStats.criticalCount) ||
          predictionRows.filter((row) => row.riskLevel === "CRITICAL").length,
        highCount:
          Number(predictionStats.highCount) ||
          predictionRows.filter((row) => row.riskLevel === "HIGH").length,
        mediumCount:
          Number(predictionStats.mediumCount) ||
          predictionRows.filter((row) => row.riskLevel === "MEDIUM").length,
        totalSuggestedQuantity:
          Number(predictionStats.totalSuggestedQuantity) ||
          predictionRows.reduce(
            (sum, row) => sum + (Number(row.suggestedReplenishment) || 0),
            0
          ),
      });
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Failed to load warehouse dashboard:", error);
      toast.error(error.response?.data?.message || "Không thể tải bảng điều khiển kho");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const getRecommendationKey = (item, index) =>
    `${item?.variantSku || "sku"}-${item?.toStore?.storeId || "store"}-${index}`;

  const canCreateTransferFromRecommendation = (item) => {
    if (!isGlobalAdmin) return false;
    if (item?.type !== "INTER_STORE_TRANSFER") return false;
    if (!item?.fromStore?.storeId || !item?.toStore?.storeId) return false;

    const requestedQuantity = Math.floor(Number(item?.suggestedQuantity) || 0);
    if (requestedQuantity <= 0) return false;

    const sku = String(item?.variantSku || "").trim();
    if (!sku) return false;

    return true;
  };

  const handleCreateTransferFromRecommendation = async (item, index) => {
    if (!canCreateTransferFromRecommendation(item)) {
      toast.error("Recommendation cannot be converted to transfer");
      return;
    }

    const requestKey = getRecommendationKey(item, index);
    const requestedQuantity = Math.floor(Number(item.suggestedQuantity) || 0);

    try {
      setCreatingRecommendationKey(requestKey);

      const response = await stockTransferAPI.request({
        fromStoreId: item.fromStore.storeId,
        toStoreId: item.toStore.storeId,
        reason: "RESTOCK",
        notes: `Auto-created from replenishment recommendation (${item.variantSku})`,
        items: [
          {
            variantSku: String(item.variantSku).trim(),
            requestedQuantity,
          },
        ],
      });

      const transferNumber = response?.data?.transfer?.transferNumber;
      toast.success(
        transferNumber
          ? `Transfer ${transferNumber} created`
          : "Transfer request created"
      );

      await loadDashboardData({ silent: true });
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tạo yêu cầu chuyển kho");
    } finally {
      setCreatingRecommendationKey("");
    }
  };

  const quickActions = [
    {
      title: "Nhập Hàng",
      description: "Nhập hàng từ nhà cung cấp",
      icon: TruckIcon,
      color: "bg-blue-500",
      link: "/warehouse-staff/receive-goods",
    },
    {
      title: "Xuất Kho",
      description: "Lấy hàng cho đơn hàng",
      icon: Package,
      color: "bg-green-500",
      link: "/warehouse-staff/pick-orders",
    },
    {
      title: "Chuyển Kho",
      description: "Quản lý chuyển kho nội bộ và liên chi nhánh",
      icon: ArrowRightLeft,
      color: "bg-orange-500",
      link: "/warehouse-staff/transfer",
    },
  ];

  const summaryCards = useMemo(
    () => [
      {
        title: "PO Chờ Nhận",
        value: stats.pendingPOs,
        hint: "Đơn mua đã được xác nhận",
        icon: Clock,
        className: "text-blue-600",
        iconWrapperClass: "bg-blue-100",
      },
      {
        title: "Nhập Kho Hôm Nay",
        value: stats.todayReceipts,
        hint: "Phiếu nhập đã hoàn tất",
        icon: CheckCircle,
        className: "text-green-600",
        iconWrapperClass: "bg-green-100",
      },
      {
        title: "Đơn Cần Pick",
        value: stats.pendingPicks,
        hint: "CONFIRMED + PICKING",
        icon: Package,
        className: "text-violet-600",
        iconWrapperClass: "bg-violet-100",
      },
      {
        title: "Chờ Chuyển Kho",
        value: stats.pendingTransfers,
        hint: "Yêu cầu mới tạo",
        icon: ArrowRightLeft,
        className: "text-amber-600",
        iconWrapperClass: "bg-amber-100",
      },
      {
        title: "Đang Vận Chuyển",
        value: stats.inTransitTransfers,
        hint: "Đang vận chuyển",
        icon: TruckIcon,
        className: "text-indigo-600",
        iconWrapperClass: "bg-indigo-100",
      },
      {
        title: "Tổng SKU",
        value: inventorySummary.totalSKUs,
        hint: "Tồn kho tổng hợp",
        icon: Package,
        className: "text-slate-700",
        iconWrapperClass: "bg-slate-100",
      },
      {
        title: "Cảnh Báo Tồn Thấp",
        value: inventorySummary.lowStockCount,
        hint: `${inventorySummary.criticalCount} mức nghiêm trọng`,
        icon: TrendingDown,
        className: "text-red-600",
        iconWrapperClass: "bg-red-100",
      },
      {
        title: "Đề Xuất Bổ Sung",
        value: replenishmentSummary.totalRecommendations,
        hint: `${replenishmentSummary.criticalCount} nghiêm trọng / ${replenishmentSummary.interStoreCount} liên store`,
        icon: ArrowRightLeft,
        className: "text-orange-600",
        iconWrapperClass: "bg-orange-100",
      },
      {
        title: "Giá Trị Tồn Kho",
        value: formatCurrency(inventorySummary.totalValue),
        hint: `${storeNeedsAttention.length} cửa hàng cần chú ý / ${replenishmentSummary.warehouseCount} cần cấp từ kho`,
        icon: Wallet,
        className: "text-emerald-700",
        iconWrapperClass: "bg-emerald-100",
      },
      {
        title: "Rủi Ro Dự Báo",
        value:
          (demandPredictionSummary.criticalCount || 0) +
          (demandPredictionSummary.highCount || 0),
        hint: `${demandPredictionSummary.totalSuggestedQuantity} đề xuất bổ sung`,
        icon: TrendingDown,
        className: "text-rose-700",
        iconWrapperClass: "bg-rose-100",
      },
    ],
    [
      demandPredictionSummary,
      inventorySummary,
      replenishmentSummary,
      stats,
      storeNeedsAttention.length,
    ]
  );

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return "-";
    return formatDateTime(lastUpdated.toISOString());
  }, [lastUpdated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
          <p className="mt-4 text-gray-600">Đang tải bảng điều khiển kho...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Bảng Điều Khiển Kho</h1>
          <p className="text-gray-600 mt-1">
            Cập nhật lần cuối: <span className="font-medium">{lastUpdatedLabel}</span>
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => loadDashboardData({ silent: true })}
          disabled={refreshing}
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "Đang làm mới..." : "Làm mới"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600">{card.title}</p>
                    <p className={`text-2xl font-bold ${card.className}`}>
                      {card.value}
                    </p>
                  </div>
                  <div className={`p-3 rounded-full ${card.iconWrapperClass}`}>
                    <Icon className={`w-5 h-5 ${card.className}`} />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">{card.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Tác Vụ Nhanh</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickActions.map((action) => (
            <Link key={action.link} to={action.link}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardContent className="p-6">
                  <div
                    className={`${action.color} w-12 h-12 rounded-lg flex items-center justify-center mb-4`}
                  >
                    <action.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{action.title}</h3>
                  <p className="text-sm text-gray-600">{action.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Cảnh Báo Tồn Kho Thấp
            </CardTitle>
            <Badge variant="outline">{alerts.length} dòng</Badge>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">
                Không có cảnh báo tồn kho thấp.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Cửa Hàng</TableHead>
                    <TableHead className="text-right">Khả Dụng</TableHead>
                    <TableHead className="text-right">Tối Thiểu</TableHead>
                    <TableHead>Mức Độ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert, index) => (
                    <TableRow
                      key={`${alert.storeId || "store"}-${alert.variantSku}-${index}`}
                    >
                      <TableCell>
                        <div className="font-medium">{alert.variantSku}</div>
                        <div className="text-xs text-gray-500">
                          {alert.productName || "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{alert.storeCode || "-"}</div>
                        <div className="text-xs text-gray-500">
                          {alert.storeName || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{alert.available ?? 0}</TableCell>
                      <TableCell className="text-right">{alert.minStock ?? 0}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            alert.priority === "CRITICAL"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {RISK_LABEL[alert.priority] || alert.priority || "HIGH"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-500" />
              Biến Động Tồn Kho Gần Đây
            </CardTitle>
            <Badge variant="outline">{movements.length} dòng</Badge>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">
                Chưa có biến động tồn kho trong 7 ngày.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời Gian</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">SL</TableHead>
                    <TableHead>Lộ Trình</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((movement, index) => (
                    <TableRow key={movement._id || `${movement.sku}-${index}`}>
                      <TableCell className="text-xs">
                        {formatDateTime(movement.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{movement.type || "-"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{movement.sku || "-"}</div>
                        <div className="text-xs text-gray-500">
                          {movement.productName || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(movement.quantity) || 0}
                      </TableCell>
                      <TableCell className="text-xs">
                        {(movement.fromLocationCode || "-") +
                          " -> " +
                          (movement.toLocationCode || "-")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-amber-500" />
              Chuyển Kho Gần Đây
            </CardTitle>
            <Badge variant="outline">{transfers.length} dòng</Badge>
          </CardHeader>
          <CardContent>
            {transfers.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">Chưa có chuyển kho gần đây.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã Phiếu</TableHead>
                    <TableHead>Lộ Trình</TableHead>
                    <TableHead>Sản Phẩm</TableHead>
                    <TableHead>Trạng Thái</TableHead>
                    <TableHead>Ngày Tạo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((transfer, index) => (
                    <TableRow key={transfer._id || `transfer-${index}`}>
                      <TableCell className="font-medium">
                        {transfer.transferNumber || "-"}
                      </TableCell>
                      <TableCell>
                        <div>{transfer.fromStore?.storeCode || "-"}</div>
                        <div className="text-xs text-gray-500">
                          {"-> " + (transfer.toStore?.storeCode || "-")}
                        </div>
                      </TableCell>
                      <TableCell>{getTransferItemSummary(transfer.items)}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            TRANSFER_STATUS_BADGE_CLASS[transfer.status] ||
                            "bg-zinc-100 text-zinc-800"
                          }
                        >
                          {TRANSFER_STATUS_LABEL[transfer.status] || transfer.status || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDateTime(transfer.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Store className="w-5 h-5 text-orange-500" />
              Cửa Hàng Cần Chú Ý
            </CardTitle>
            <Badge variant="outline">{storeNeedsAttention.length} cửa hàng</Badge>
          </CardHeader>
          <CardContent>
            {storeNeedsAttention.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">
                Tất cả cửa hàng đang ở mức tồn kho ổn định.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cửa Hàng</TableHead>
                    <TableHead className="text-right">Khả Dụng</TableHead>
                    <TableHead className="text-right">Hết Hàng</TableHead>
                    <TableHead className="text-right">Tồn Thấp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {storeNeedsAttention.map((store) => (
                    <TableRow key={store.storeId || store.storeCode}>
                      <TableCell>
                        <div className="font-medium">{store.storeCode || "-"}</div>
                        <div className="text-xs text-gray-500">
                          {store.storeName || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {store.stats?.totalAvailable ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-red-600">
                          {store.stats?.outOfStockSKUs ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-amber-600">
                          {store.stats?.lowStockSKUs ?? 0}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-rose-500" />
              Dự Báo Nhu Cầu (7 ngày)
            </CardTitle>
            <Badge variant="outline">{demandPredictions.length} dòng</Badge>
          </CardHeader>
          <CardContent>
            {demandPredictions.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">
                Chưa có dữ liệu dự báo nhu cầu.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rủi Ro</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Cửa Hàng</TableHead>
                    <TableHead className="text-right">Khả Dụng</TableHead>
                    <TableHead className="text-right">Dự Báo</TableHead>
                    <TableHead className="text-right">Đề Xuất</TableHead>
                    <TableHead>Độ Tin Cậy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demandPredictions.map((item, index) => (
                    <TableRow
                      key={`${item.storeId || "store"}-${item.variantSku || "sku"}-${index}`}
                    >
                      <TableCell>
                        <Badge
                          className={
                            DEMAND_RISK_BADGE_CLASS[item.riskLevel] ||
                            "bg-zinc-100 text-zinc-800"
                          }
                        >
                          {RISK_LABEL[item.riskLevel] || item.riskLevel || "LOW"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.variantSku || "-"}</div>
                        <div className="text-xs text-gray-500">
                          {item.productName || "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{item.storeCode || "-"}</div>
                        <div className="text-xs text-gray-500">
                          {item.storeName || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(item.available) || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(item.predictedDemand) || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(item.suggestedReplenishment) || 0}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.confidence || "LOW"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-orange-500" />
              Đề Xuất Bổ Sung
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {replenishmentRecommendations.length} rows
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/warehouse-staff/transfer")}
              >
                Quản lý chuyển kho
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {replenishmentRecommendations.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">
                Chưa có đề xuất bổ sung tồn kho.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mức độ</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Lộ trình</TableHead>
                    <TableHead className="text-right">Cần</TableHead>
                    <TableHead className="text-right">Đề xuất</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replenishmentRecommendations.map((item, index) => (
                    <TableRow
                      key={`${item.variantSku || "sku"}-${item.toStore?.storeId || index}`}
                    >
                      <TableCell>
                        <Badge
                          className={
                            REPLENISHMENT_PRIORITY_BADGE_CLASS[item.priority] ||
                            "bg-zinc-100 text-zinc-800"
                          }
                        >
                          {RISK_LABEL[item.priority] || item.priority || "HIGH"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.variantSku || "-"}</div>
                        <div className="text-xs text-gray-500">
                          {item.productName || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {(item.fromStore?.storeCode || "WH") +
                          " -> " +
                          (item.toStore?.storeCode || "-")}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(item.neededQuantity) || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(item.suggestedQuantity) || 0}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {REPLENISHMENT_TYPE_LABEL[item.type] || item.type || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {canCreateTransferFromRecommendation(item) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              creatingRecommendationKey ===
                              getRecommendationKey(item, index)
                            }
                            onClick={() =>
                              handleCreateTransferFromRecommendation(item, index)
                            }
                          >
                            {creatingRecommendationKey ===
                            getRecommendationKey(item, index)
                              ? "Creating..."
                              : "Create transfer"}
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-500">Manual follow-up</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default WarehouseStaffDashboard;
