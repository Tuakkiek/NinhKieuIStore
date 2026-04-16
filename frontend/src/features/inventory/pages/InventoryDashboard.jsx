import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  RefreshCw,
  Store,
  TrendingDown,
  Truck,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { inventoryAPI, stockTransferAPI } from "../api/inventory.api";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

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

const RISK_LABEL = {
  CRITICAL: "Nghiêm trọng",
  HIGH: "Cao",
  MEDIUM: "Trung bình",
  LOW: "Thấp",
};

const RISK_BADGE_CLASS = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-amber-100 text-amber-800",
  MEDIUM: "bg-blue-100 text-blue-800",
  LOW: "bg-zinc-200 text-zinc-800",
};

const REPLENISHMENT_TYPE_LABEL = {
  INTER_STORE_TRANSFER: "Chuyển kho liên cửa hàng",
  WAREHOUSE_REPLENISHMENT: "Bổ sung từ kho tổng",
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

const toNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getTransferItemSummary = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return "0 SKU";
  const qty = items.reduce(
    (sum, item) => sum + (Number(item.requestedQuantity) || 0),
    0
  );
  return `${items.length} SKU / ${qty} units`;
};

const InventoryDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningSnapshot, setRunningSnapshot] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [skuFilterInput, setSkuFilterInput] = useState("");
  const [skuFilterApplied, setSkuFilterApplied] = useState("");

  const [consolidatedInventory, setConsolidatedInventory] = useState([]);
  const [consolidatedSummary, setConsolidatedSummary] = useState({
    totalSKUs: 0,
    totalValue: 0,
    lowStockCount: 0,
  });
  const [storeComparison, setStoreComparison] = useState([]);
  const [storesNeedingAttention, setStoresNeedingAttention] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertSummary, setAlertSummary] = useState({
    total: 0,
    critical: 0,
    high: 0,
  });
  const [movements, setMovements] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [replenishment, setReplenishment] = useState([]);
  const [replenishmentSummary, setReplenishmentSummary] = useState({
    totalRecommendations: 0,
    criticalCount: 0,
    highCount: 0,
    interStoreCount: 0,
    warehouseCount: 0,
  });
  const [replenishmentSnapshot, setReplenishmentSnapshot] = useState(null);
  const [replenishmentDataSource, setReplenishmentDataSource] = useState("LIVE");
  const [predictions, setPredictions] = useState([]);
  const [predictionSummary, setPredictionSummary] = useState({
    totalPredictions: 0,
    criticalCount: 0,
    highCount: 0,
    totalSuggestedQuantity: 0,
  });

  const loadData = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const consolidatedParams = {};
      const normalizedSku = String(skuFilterApplied || "").trim().toUpperCase();
      if (normalizedSku) consolidatedParams.sku = normalizedSku;

      // Use a helper to swallow errors for individual calls
      const safeFetch = async (promise, setter, defaultVal = []) => {
        try {
          const res = await promise;
          setter(res.data?.inventory || res.data?.comparison || res.data?.needsAttention || res.data?.alerts || res.data?.movements || res.data?.transfers || res.data?.recommendations || res.data?.predictions || res.data || defaultVal);
          
          // Special case for summaries and extra fields
          if (res.data?.summary) {
            if (setter === setConsolidatedInventory) setConsolidatedSummary(res.data.summary);
            if (setter === setAlerts) setAlertSummary(res.data.summary);
            if (setter === setReplenishment) setReplenishmentSummary(res.data.summary);
            if (setter === setPredictions) setPredictionSummary(res.data.summary);
          }
          if (res.data?.needsAttention && setter === setStoreComparison) {
            setStoresNeedingAttention(res.data.needsAttention);
          }
          if (res.data?.snapshot && setter === setReplenishment) setReplenishmentSnapshot(res.data.snapshot);
          if (res.data?.dataSource && setter === setReplenishment) setReplenishmentDataSource(res.data.dataSource);
          
        } catch (err) {
          console.error("Dashboard component load error:", err);
          // We don't toast here to avoid spamming the user if multiple fail
        }
      };

      await Promise.all([
        safeFetch(inventoryAPI.getConsolidated(consolidatedParams), setConsolidatedInventory),
        safeFetch(inventoryAPI.getStoreComparison(), setStoreComparison),
        safeFetch(inventoryAPI.getAlerts({ limit: 20 }), setAlerts),
        safeFetch(inventoryAPI.getMovements({ days: 7, limit: 20 }), setMovements),
        safeFetch(stockTransferAPI.getAll({ limit: 20 }), setTransfers),
        safeFetch(inventoryAPI.getReplenishment({ limit: 20 }), setReplenishment),
        safeFetch(inventoryAPI.getPredictions({
          limit: 20,
          lowStockOnly: true,
          daysAhead: 7,
          historicalDays: 90,
        }), setPredictions),
      ]);
      setLastUpdated(new Date());
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tải bảng điều khiển kho");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuFilterApplied]);

  const handleRunSnapshot = async () => {
    try {
      setRunningSnapshot(true);
      await inventoryAPI.runReplenishmentSnapshot();
      toast.success("Đã tạo snapshot bổ sung hàng");
      await loadData({ silent: true });
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể chạy snapshot");
    } finally {
      setRunningSnapshot(false);
    }
  };

  const summaryCards = useMemo(
    () => [
      {
        title: "Tổng mã SKU",
        value: toNum(consolidatedSummary.totalSKUs),
        hint: "Tổng hợp toàn hệ thống",
        icon: Boxes,
        iconWrap: "bg-blue-100",
        textClass: "text-blue-700",
      },
      {
        title: "Giá trị tồn kho",
        value: formatCurrency(consolidatedSummary.totalValue),
        hint: "Ước tính theo giá vốn",
        icon: Wallet,
        iconWrap: "bg-emerald-100",
        textClass: "text-emerald-700",
      },
      {
        title: "Cảnh báo tồn thấp",
        value: toNum(consolidatedSummary.lowStockCount),
        hint: `${toNum(alertSummary.critical)} nghiêm trọng`,
        icon: AlertCircle,
        iconWrap: "bg-red-100",
        textClass: "text-red-700",
      },
      {
        title: "Cửa hàng cần chú ý",
        value: storesNeedingAttention.length,
        hint: "Cần cân bằng tồn kho",
        icon: Store,
        iconWrap: "bg-orange-100",
        textClass: "text-orange-700",
      },
      {
        title: "Đề xuất bổ sung",
        value: toNum(replenishmentSummary.totalRecommendations),
        hint: `${toNum(replenishmentSummary.criticalCount)} nghiêm trọng`,
        icon: ArrowRightLeft,
        iconWrap: "bg-violet-100",
        textClass: "text-violet-700",
      },
      {
        title: "Rủi ro dự báo",
        value:
          toNum(predictionSummary.criticalCount) + toNum(predictionSummary.highCount),
        hint: `${toNum(predictionSummary.totalSuggestedQuantity)} sl đề xuất`,
        icon: TrendingDown,
        iconWrap: "bg-rose-100",
        textClass: "text-rose-700",
      },
      {
        title: "Chờ chuyển kho",
        value: transfers.filter((item) => item.status === "CREATED").length,
        hint: "Mới tạo",
        icon: Truck,
        iconWrap: "bg-amber-100",
        textClass: "text-amber-700",
      },
      {
        title: "Đang vận chuyển",
        value: transfers.filter((item) => item.status === "IN_TRANSIT").length,
        hint: "Đang giao giữa các kho",
        icon: Truck,
        iconWrap: "bg-indigo-100",
        textClass: "text-indigo-700",
      },
    ],
    [
      alertSummary.critical,
      consolidatedSummary.lowStockCount,
      consolidatedSummary.totalSKUs,
      consolidatedSummary.totalValue,
      predictionSummary.criticalCount,
      predictionSummary.highCount,
      predictionSummary.totalSuggestedQuantity,
      replenishmentSummary.criticalCount,
      replenishmentSummary.totalRecommendations,
      storesNeedingAttention.length,
      transfers,
    ]
  );

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return "-";
    return formatDateTime(lastUpdated.toISOString());
  }, [lastUpdated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="text-center">
          <div className="h-12 w-12 mx-auto border-b-2 border-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-600 mt-4">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tổng quan tồn kho</h1>
          <p className="text-gray-600 mt-1">
            Cập nhật lần cuối: <span className="font-medium">{lastUpdatedLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-[220px]"
            placeholder="Lọc theo SKU"
            value={skuFilterInput}
            onChange={(event) => setSkuFilterInput(event.target.value.toUpperCase().trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setSkuFilterApplied(skuFilterInput);
              }
            }}
          />
          <Button variant="outline" onClick={() => setSkuFilterApplied(skuFilterInput)}>
            Áp dụng
          </Button>
          <Button variant="outline" onClick={() => setSkuFilterApplied("")}>
            Xóa
          </Button>
          <Button
            variant="outline"
            onClick={() => loadData({ silent: true })}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Đang làm mới..." : "Làm mới"}
          </Button>
          <Button onClick={handleRunSnapshot} disabled={runningSnapshot}>
            <BarChart3 className="w-4 h-4 mr-2" />
            {runningSnapshot ? "Đang chạy..." : "Chạy Snapshot"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">{card.title}</p>
                    <p className={`text-2xl font-bold mt-1 ${card.textClass}`}>{card.value}</p>
                  </div>
                  <div className={`p-3 rounded-full ${card.iconWrap}`}>
                    <Icon className={`w-5 h-5 ${card.textClass}`} />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">{card.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="consolidated" className="space-y-4">
        <TabsList className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-1 h-auto">
          <TabsTrigger value="consolidated">Tổng hợp</TabsTrigger>
          <TabsTrigger value="stores">Cửa hàng</TabsTrigger>
          <TabsTrigger value="alerts">Cảnh báo</TabsTrigger>
          <TabsTrigger value="movements">Biến động</TabsTrigger>
          <TabsTrigger value="replenishment">Bổ sung</TabsTrigger>
          <TabsTrigger value="predictions">Dự báo</TabsTrigger>
          <TabsTrigger value="transfers">Chuyển kho</TabsTrigger>
        </TabsList>

        <TabsContent value="consolidated">
          <Card>
            <CardHeader>
              <CardTitle>Tồn kho tổng hợp</CardTitle>
            </CardHeader>
            <CardContent>
              {consolidatedInventory.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Không có dữ liệu tồn kho.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead className="text-right">SL</TableHead>
                      <TableHead className="text-right">Đã đặt</TableHead>
                      <TableHead className="text-right">Khả dụng</TableHead>
                      <TableHead className="text-right">Vị trí</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consolidatedInventory.map((item) => (
                      <TableRow key={item._id}>
                        <TableCell className="font-medium">{item._id}</TableCell>
                        <TableCell>
                          <div>{item.product?.name || "-"}</div>
                          <div className="text-xs text-gray-500">
                            {item.variant?.variantName || "-"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{toNum(item.totalQuantity)}</TableCell>
                        <TableCell className="text-right">{toNum(item.totalReserved)}</TableCell>
                        <TableCell className="text-right">{toNum(item.totalAvailable)}</TableCell>
                        <TableCell className="text-right">
                          {Array.isArray(item.locations) ? item.locations.length : 0}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stores">
          <Card>
            <CardHeader>
              <CardTitle>So sánh tồn kho cửa hàng</CardTitle>
            </CardHeader>
            <CardContent>
              {storeComparison.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Không có dữ liệu so sánh.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cửa hàng</TableHead>
                      <TableHead className="text-right">SKUs</TableHead>
                      <TableHead className="text-right">Khả dụng</TableHead>
                      <TableHead className="text-right">Hết hàng</TableHead>
                      <TableHead className="text-right">Tồn thấp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storeComparison.map((store) => (
                      <TableRow key={store.storeId || store.storeCode}>
                        <TableCell>
                          <div className="font-medium">{store.storeCode || "-"}</div>
                          <div className="text-xs text-gray-500">{store.storeName || "-"}</div>
                        </TableCell>
                        <TableCell className="text-right">{toNum(store.stats?.totalSKUs)}</TableCell>
                        <TableCell className="text-right">
                          {toNum(store.stats?.totalAvailable)}
                        </TableCell>
                        <TableCell className="text-right text-red-600">
                          {toNum(store.stats?.outOfStockSKUs)}
                        </TableCell>
                        <TableCell className="text-right text-amber-600">
                          {toNum(store.stats?.lowStockSKUs)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Cảnh báo tồn kho thấp</CardTitle>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Không có cảnh báo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Cửa hàng</TableHead>
                      <TableHead className="text-right">Khả dụng</TableHead>
                      <TableHead className="text-right">Tối thiểu</TableHead>
                      <TableHead>Mức độ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((alert, index) => (
                      <TableRow
                        key={`${alert.storeId || "store"}-${alert.variantSku || "sku"}-${index}`}
                      >
                        <TableCell>
                          <div className="font-medium">{alert.variantSku || "-"}</div>
                          <div className="text-xs text-gray-500">{alert.productName || "-"}</div>
                        </TableCell>
                        <TableCell>
                          <div>{alert.storeCode || "-"}</div>
                          <div className="text-xs text-gray-500">{alert.storeName || "-"}</div>
                        </TableCell>
                        <TableCell className="text-right">{toNum(alert.available)}</TableCell>
                        <TableCell className="text-right">{toNum(alert.minStock)}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              RISK_BADGE_CLASS[alert.priority] || "bg-zinc-100 text-zinc-800"
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
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle>Biến động tồn kho gần đây</CardTitle>
            </CardHeader>
            <CardContent>
              {movements.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Không có dữ liệu trong 7 ngày qua.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Thời gian</TableHead>
                      <TableHead>Loại</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">SL</TableHead>
                      <TableHead>Lộ trình</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((movement, index) => (
                      <TableRow key={movement._id || `movement-${index}`}>
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
                        <TableCell className="text-right">{toNum(movement.quantity)}</TableCell>
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
        </TabsContent>

        <TabsContent value="replenishment">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Đề xuất bổ sung hàng</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{replenishment.length} rows</Badge>
                <Badge variant="outline">{replenishmentDataSource}</Badge>
                {replenishmentSnapshot?.snapshotDateKey && (
                  <Badge variant="outline">{replenishmentSnapshot.snapshotDateKey}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {replenishment.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Không có đề xuất bổ sung.</p>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {replenishment.map((item, index) => (
                      <TableRow key={`${item.variantSku || "sku"}-${index}`}>
                        <TableCell>
                          <Badge
                            className={
                              RISK_BADGE_CLASS[item.priority] || "bg-zinc-100 text-zinc-800"
                            }
                          >
                            {RISK_LABEL[item.priority] || item.priority || "HIGH"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{item.variantSku || "-"}</div>
                          <div className="text-xs text-gray-500">{item.productName || "-"}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {(item.fromStore?.storeCode || "WH") +
                            " -> " +
                            (item.toStore?.storeCode || "-")}
                        </TableCell>
                        <TableCell className="text-right">{toNum(item.neededQuantity)}</TableCell>
                        <TableCell className="text-right">
                          {toNum(item.suggestedQuantity)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {REPLENISHMENT_TYPE_LABEL[item.type] || item.type || "-"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="predictions">
          <Card>
            <CardHeader>
              <CardTitle>Dự báo nhu cầu (7 ngày)</CardTitle>
            </CardHeader>
            <CardContent>
              {predictions.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Không có dữ liệu dự báo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rủi ro</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Cửa hàng</TableHead>
                      <TableHead className="text-right">Khả dụng</TableHead>
                      <TableHead className="text-right">Dự báo</TableHead>
                      <TableHead className="text-right">Đề xuất</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {predictions.map((item, index) => (
                      <TableRow
                        key={`${item.storeId || "store"}-${item.variantSku || "sku"}-${index}`}
                      >
                        <TableCell>
                          <Badge
                            className={
                              RISK_BADGE_CLASS[item.riskLevel] || "bg-zinc-100 text-zinc-800"
                            }
                          >
                            {RISK_LABEL[item.riskLevel] || item.riskLevel || "LOW"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{item.variantSku || "-"}</div>
                          <div className="text-xs text-gray-500">{item.productName || "-"}</div>
                        </TableCell>
                        <TableCell>
                          <div>{item.storeCode || "-"}</div>
                          <div className="text-xs text-gray-500">{item.storeName || "-"}</div>
                        </TableCell>
                        <TableCell className="text-right">{toNum(item.available)}</TableCell>
                        <TableCell className="text-right">
                          {toNum(item.predictedDemand)}
                        </TableCell>
                        <TableCell className="text-right">
                          {toNum(item.suggestedReplenishment)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transfers">
          <Card>
            <CardHeader>
              <CardTitle>Lịch sử chuyển kho</CardTitle>
            </CardHeader>
            <CardContent>
              {transfers.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Không có dữ liệu chuyển kho.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã phiếu</TableHead>
                      <TableHead>Lộ trình</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Ngày tạo</TableHead>
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
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InventoryDashboard;
