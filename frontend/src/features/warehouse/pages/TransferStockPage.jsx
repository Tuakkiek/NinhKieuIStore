import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ClipboardList,
  MapPin,
  PackageCheck,
  RefreshCw,
  Truck,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { toast } from "sonner";
import { api } from "@/shared/lib/http/httpClient";
import { inventoryAPI, stockTransferAPI } from "@/features/inventory";
import { storeAPI } from "@/features/stores";
import { useAuthStore, usePermission } from "@/features/auth";

const TRANSFER_REASONS = [
  { value: "RESTOCK", label: "Bổ sung hàng" },
  { value: "BALANCE", label: "Cân bằng kho" },
  { value: "CUSTOMER_REQUEST", label: "Yêu cầu khách hàng" },
  { value: "RETURN", label: "Trả hàng" },
  { value: "DEFECTIVE", label: "Hàng lỗi" },
];

const TRANSFER_REASON_LABELS = Object.fromEntries(
  TRANSFER_REASONS.map((reason) => [reason.value, reason.label])
);

const STATUS_OPTIONS = [
  "ALL",
  "CREATED",
  "WAITING_FOR_PICKUP",
  "IN_TRANSIT",
  "COMPLETED",
  "CANCELLED",
];

const TRANSFER_STATUS_LABEL = {
  PENDING: "Chờ xử lý",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  IN_TRANSIT: "Đang vận chuyển",
  RECEIVED: "Đã nhận",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const STATUS_BADGE_CLASS = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-red-100 text-red-800",
  IN_TRANSIT: "bg-indigo-100 text-indigo-800",
  RECEIVED: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-zinc-200 text-zinc-800",
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN");
};

const getTransferItemSummary = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return "0 SKU";
  const qty = items.reduce(
    (sum, item) => sum + (Number(item.requestedQuantity) || 0),
    0
  );
  return `${items.length} SKU / ${qty} sp`;
};

const LEGACY_SUMMARIZE_TRANSFERS = (transfers = []) =>
  transfers.reduce(
    (acc, transfer) => {
      const status = transfer.status || "UNKNOWN";
      acc.total += 1;
      if (status === "PENDING") acc.pending += 1;
      if (status === "APPROVED") acc.approved += 1;
      if (status === "IN_TRANSIT") acc.inTransit += 1;
      if (status === "RECEIVED") acc.received += 1;
      if (status === "COMPLETED") acc.completed += 1;
      return acc;
    },
    {
      total: 0,
      pending: 0,
      approved: 0,
      inTransit: 0,
      received: 0,
      completed: 0,
    }
  );

const TRANSFER_STATUS_META = {
  labels: {
    ...TRANSFER_STATUS_LABEL,
    CREATED: "Đã tạo - Chờ xác nhận",
    WAITING_FOR_PICKUP: "Đang chuẩn bị hàng",
    IN_TRANSIT: "Đang vận chuyển",
    COMPLETED: "Hoàn thành",
    CANCELLED: "Đã hủy",
    PENDING: "Chờ xử lý (cũ)",
    APPROVED: "Đã duyệt (cũ)",
    REJECTED: "Từ chối (cũ)",
    RECEIVED: "Đã nhận (cũ)",
  },
  badges: {
    ...STATUS_BADGE_CLASS,
    CREATED: "bg-blue-100 text-blue-800",
    WAITING_FOR_PICKUP: "bg-amber-100 text-amber-800",
    IN_TRANSIT: "bg-indigo-100 text-indigo-800",
    COMPLETED: "bg-green-100 text-green-800",
    CANCELLED: "bg-zinc-200 text-zinc-800",
  },
};

const summarizeTransferRows = (transfers = []) =>
  transfers.reduce(
    (acc, transfer) => {
      const status = transfer.status || "UNKNOWN";
      acc.total += 1;
      if (status === "CREATED" || status === "WAITING_FOR_PICKUP") acc.created += 1;
      if (status === "IN_TRANSIT") acc.inTransit += 1;
      if (status === "COMPLETED") acc.completed += 1;
      if (status === "CANCELLED") acc.cancelled += 1;
      if (["PENDING", "APPROVED", "REJECTED", "RECEIVED"].includes(status)) acc.legacy += 1;
      return acc;
    },
    {
      total: 0,
      created: 0,
      inTransit: 0,
      completed: 0,
      cancelled: 0,
      legacy: 0,
    }
  );

const TransferStockPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const authz = useAuthStore((s) => s.authz);
  const userRole = useAuthStore((s) => s.user?.role);

  const isGlobalAdmin = Boolean(
    authz?.isGlobalAdmin || String(userRole || "").toUpperCase() === "GLOBAL_ADMIN"
  );
  const allowedBranches = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(authz?.allowedBranchIds) ? authz.allowedBranchIds : [])
            .map((branchId) => String(branchId))
            .filter(Boolean)
        )
      ),
    [authz?.allowedBranchIds]
  );
  const canConfirmShipment = usePermission("transfer.ship");
  const canConfirmReceived = usePermission("transfer.receive");
  const canApproveTransfers = false;
  const canOperateTransfers = false;

  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    tabFromUrl === "internal" ? "internal" : "branch"
  );
  const [loading, setLoading] = useState(false);

  const [step, setStep] = useState(1);
  const [sku, setSku] = useState("");
  const [fromLocationCode, setFromLocationCode] = useState("");
  const [toLocationCode, setToLocationCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [fromLocation, setFromLocation] = useState(null);
  const [toLocation, setToLocation] = useState(null);
  const [availableQty, setAvailableQty] = useState(0);
  const [transferResult, setTransferResult] = useState(null);

  const [branchLoading, setBranchLoading] = useState(false);
  const [stores, setStores] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [transferStatusFilter, setTransferStatusFilter] = useState("ALL");
  const [transferSearch, setTransferSearch] = useState("");
  const [transferForm, setTransferForm] = useState({
    fromStoreId: "",
    toStoreId: "",
    reason: "RESTOCK",
    notes: "",
    items: [{ variantSku: "", requestedQuantity: "" }],
  });

  // ── Modal states for approve / receive / ship / reject / cancel ──
  const [approveModal, setApproveModal] = useState({ open: false, transfer: null, items: [] });
  const [receiveModal, setReceiveModal] = useState({
    open: false,
    transfer: null,
    items: [],
    notes: "",
  });
  const [shipModal, setShipModal] = useState({ open: false, transfer: null, trackingNumber: "", carrier: "" });
  const [rejectModal, setRejectModal] = useState({ open: false, transfer: null, reason: "" });
  const [cancelModal, setCancelModal] = useState({ open: false, transfer: null, reason: "" });
  const [modalLoading, setModalLoading] = useState(false);

  const branchSummary = useMemo(() => summarizeTransferRows(transfers), [transfers]);

  const resetInternalForm = () => {
    setStep(1);
    setSku("");
    setFromLocationCode("");
    setToLocationCode("");
    setQuantity("");
    setReason("");
    setNotes("");
    setFromLocation(null);
    setToLocation(null);
    setAvailableQty(0);
    setTransferResult(null);
  };

  const fetchBranchData = async (overrides = {}) => {
    const selectedStatus = overrides.status ?? transferStatusFilter;
    const searchText = (overrides.search ?? transferSearch).trim();

    try {
      setBranchLoading(true);

      const [storeRes, transferRes] = await Promise.all([
        storeAPI.getAll({ status: "ACTIVE", limit: 100 }),
        stockTransferAPI.getAll({
          limit: 50,
          ...(selectedStatus !== "ALL" ? { status: selectedStatus } : {}),
          ...(searchText ? { search: searchText } : {}),
        }),
      ]);

      setStores(storeRes.data?.stores || []);
      setTransfers(transferRes.data?.transfers || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tải dữ liệu chuyển kho");
    } finally {
      setBranchLoading(false);
    }
  };

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "internal" || t === "branch") {
      setActiveTab(t);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeTab === "branch") {
      fetchBranchData();
    }
  }, [activeTab, transferStatusFilter]);

  const validateTransfer = async () => {
    if (!sku.trim() || !fromLocationCode.trim() || !toLocationCode.trim() || !quantity) {
      toast.error("Vui lòng điền đầy đủ thông tin");
      return;
    }

    if (fromLocationCode === toLocationCode) {
      toast.error("Vị trí xuất và nhập phải khác nhau");
      return;
    }

    if (parseInt(quantity, 10) <= 0) {
      toast.error("Số lượng phải lớn hơn 0");
      return;
    }

    try {
      setLoading(true);

      const fromRes = await api.get(`/warehouse/locations/${fromLocationCode}`);
      setFromLocation(fromRes.data.location);

      const invRes = await api.get(`/warehouse/inventory/search?sku=${sku}`);
      const inv = invRes.data.inventory?.find((item) => item.locationCode === fromLocationCode);
      if (!inv || inv.quantity < parseInt(quantity, 10)) {
        toast.error(
          `Không đủ tồn kho tại ${fromLocationCode}. Khả dụng: ${inv?.quantity || 0}`
        );
        setLoading(false);
        return;
      }
      setAvailableQty(inv.quantity);

      const toRes = await api.get(`/warehouse/locations/${toLocationCode}`);
      setToLocation(toRes.data.location);

      if (toRes.data.location.status !== "ACTIVE") {
        toast.error("Vị trí đích không hoạt động");
        setLoading(false);
        return;
      }

      const remaining = toRes.data.location.capacity - toRes.data.location.currentLoad;
      if (remaining < parseInt(quantity, 10)) {
        toast.error(`Vị trí đích chỉ còn trống ${remaining}`);
        setLoading(false);
        return;
      }

      setStep(2);
      toast.success("Đã sẵn sàng xác nhận chuyển kho");
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể xác thực chuyển kho");
    } finally {
      setLoading(false);
    }
  };

  const handleInternalTransfer = async () => {
    try {
      setLoading(true);
      const response = await api.post("/warehouse/transfer", {
        sku,
        fromLocationCode,
        toLocationCode,
        quantity: parseInt(quantity, 10),
        reason,
        notes,
      });

      setTransferResult(response.data);
      setStep(3);
      toast.success("Chuyển kho nội bộ hoàn tất");
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể thực hiện chuyển kho");
    } finally {
      setLoading(false);
    }
  };

  const updateTransferItem = (index, field, value) => {
    setTransferForm((prev) => {
      const nextItems = [...prev.items];
      nextItems[index] = { ...nextItems[index], [field]: value };
      return { ...prev, items: nextItems };
    });
  };

  const addTransferItem = () => {
    setTransferForm((prev) => ({
      ...prev,
      items: [...prev.items, { variantSku: "", requestedQuantity: "" }],
    }));
  };

  const removeTransferItem = (index) => {
    setTransferForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const submitTransferRequest = async () => {
    if (!isGlobalAdmin) {
      toast.error("Bạn không có quyền tạo yêu cầu chuyển kho");
      return;
    }
    if (!transferForm.fromStoreId || !transferForm.toStoreId) {
      toast.error("Vui lòng chọn kho xuất và kho nhập");
      return;
    }
    if (transferForm.fromStoreId === transferForm.toStoreId) {
      toast.error("Kho xuất và kho nhập không được trùng nhau");
      return;
    }

    const cleanedItems = transferForm.items
      .map((item) => ({
        variantSku: String(item.variantSku || "").trim(),
        requestedQuantity: Number(item.requestedQuantity),
      }))
      .filter(
        (item) =>
          item.variantSku &&
          Number.isFinite(item.requestedQuantity) &&
          item.requestedQuantity > 0
      );

    if (cleanedItems.length === 0) {
      toast.error("Vui lòng thêm ít nhất một SKU hợp lệ");
      return;
    }

    const skuSet = new Set();
    for (const item of cleanedItems) {
      if (skuSet.has(item.variantSku)) {
        toast.error(
          `SKU trùng lặp: ${item.variantSku}. Vui lòng gộp số lượng vào một dòng.`
        );
        return;
      }
      skuSet.add(item.variantSku);
    }

    // NOTE: Frontend pre-check only runs when fromStoreId matches the user's
    // active branch context (activeBranchId). For cross-branch creates (e.g.,
    // global admin), server-side validation remains the source of truth.
    const fromMatchesContext =
      activeBranchId &&
      String(transferForm.fromStoreId) === String(activeBranchId);

    if (fromMatchesContext) {
      try {
        setBranchLoading(true);
        for (const item of cleanedItems) {
          const res = await inventoryAPI.getConsolidated({ sku: item.variantSku });
          const row = res.data?.inventory?.[0];
          const available = Number(row?.totalAvailable ?? 0);
          if (available < item.requestedQuantity) {
            toast.error(
              `Không đủ tồn khả dụng tại kho nguồn cho SKU ${item.variantSku}. Khả dụng: ${available}`
            );
            setBranchLoading(false);
            return;
          }
        }
      } catch (error) {
        toast.error(
          error.response?.data?.message ||
            "Không thể kiểm tra tồn kho trước khi gửi. Thử lại hoặc kiểm tra kết nối."
        );
        setBranchLoading(false);
        return;
      }
    }

    try {
      setBranchLoading(true);
      console.log("[transfer-debug][frontend-request]", {
        fromWarehouseId: transferForm.fromStoreId,
        toWarehouseId: transferForm.toStoreId,
        items: cleanedItems.map((item) => ({
          sku: item.variantSku,
          quantity: item.requestedQuantity,
        })),
      });
      await stockTransferAPI.request({
        fromStoreId: transferForm.fromStoreId,
        toStoreId: transferForm.toStoreId,
        reason: transferForm.reason,
        notes: transferForm.notes,
        items: cleanedItems,
      });

      toast.success("Đã tạo yêu cầu chuyển kho");
      setTransferForm({
        fromStoreId: "",
        toStoreId: "",
        reason: "RESTOCK",
        notes: "",
        items: [{ variantSku: "", requestedQuantity: "" }],
      });
      await fetchBranchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tạo yêu cầu chuyển kho");
    } finally {
      setBranchLoading(false);
    }
  };

  // ── Open modals instead of window.prompt ──
  const handleTransferAction = (transfer, action) => {
    if (action === "approve") {
      setApproveModal({
        open: true,
        transfer,
        items: transfer.items.map((item) => ({
          variantSku: item.variantSku,
          name: item.name || item.variantSku,
          requestedQuantity: item.requestedQuantity,
          approvedQuantity: String(item.requestedQuantity), // default = full quantity
        })),
      });
    } else if (action === "receive") {
      setReceiveModal({
        open: true,
        transfer,
        items: transfer.items || [],
        notes: "",
      });
    } else if (action === "ship") {
      setShipModal({ open: true, transfer, trackingNumber: "", carrier: "" });
    } else if (action === "reject") {
      setRejectModal({ open: true, transfer, reason: "" });
    } else if (action === "cancel") {
      setCancelModal({ open: true, transfer, reason: "" });
    } else if (action === "complete") {
      handleDirectAction(transfer._id, "complete");
    }
  };

  // ── Direct action (no modal needed) ──
  const handleDirectAction = async (transferId, action, body = {}) => {
    try {
      setBranchLoading(true);
      if (action === "complete") await stockTransferAPI.complete(transferId, body);
      toast.success("Đã cập nhật trạng thái chuyển kho");
      await fetchBranchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể cập nhật chuyển kho");
    } finally {
      setBranchLoading(false);
    }
  };

  // ── Modal submit handlers ──
  const submitApprove = async () => {
    try {
      setModalLoading(true);
      const approvedItems = approveModal.items.map((item) => ({
        variantSku: item.variantSku,
        quantity: Number(item.approvedQuantity) || 0,
      }));
      await stockTransferAPI.approve(approveModal.transfer._id, { approvedItems });
      toast.success("Đã duyệt yêu cầu chuyển kho");
      setApproveModal({ open: false, transfer: null, items: [] });
      await fetchBranchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể duyệt transfer");
    } finally {
      setModalLoading(false);
    }
  };

  const submitReceive = async () => {
    try {
      setModalLoading(true);
      await stockTransferAPI.confirmReceived(receiveModal.transfer._id, {
        notes: receiveModal.notes,
      });
      toast.success("Đã xác nhận nhận hàng");
      setReceiveModal({ open: false, transfer: null, items: [], notes: "" });
      await fetchBranchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể nhận hàng");
    } finally {
      setModalLoading(false);
    }
  };

  const submitShip = async () => {
    try {
      setModalLoading(true);
      await stockTransferAPI.confirmShipment(shipModal.transfer._id, {
        trackingNumber: shipModal.trackingNumber,
        carrier: shipModal.carrier,
      });
      toast.success("Đã xác nhận vận chuyển");
      setShipModal({ open: false, transfer: null, trackingNumber: "", carrier: "" });
      await fetchBranchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể xuất hàng");
    } finally {
      setModalLoading(false);
    }
  };

  const submitReject = async () => {
    try {
      setModalLoading(true);
      await stockTransferAPI.reject(rejectModal.transfer._id, { reason: rejectModal.reason });
      toast.success("Đã từ chối yêu cầu chuyển kho");
      setRejectModal({ open: false, transfer: null, reason: "" });
      await fetchBranchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể từ chối transfer");
    } finally {
      setModalLoading(false);
    }
  };

  const submitCancel = async () => {
    try {
      setModalLoading(true);
      await stockTransferAPI.cancel(cancelModal.transfer._id, { reason: cancelModal.reason });
      toast.success("Đã hủy yêu cầu chuyển kho");
      setCancelModal({ open: false, transfer: null, reason: "" });
      await fetchBranchData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể hủy transfer");
    } finally {
      setModalLoading(false);
    }
  };

  const renderInternalTransferSection = () => {
    if (step === 1) {
      return (
        <Card className="max-w-3xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center">
              <RefreshCw className="w-6 h-6 mr-2" />
              Chuyển vị trí nội bộ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label>SKU *</Label>
              <Input
                placeholder="Nhập mã SKU biến thể"
                value={sku}
                onChange={(event) => setSku(event.target.value.toUpperCase())}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="flex items-center">
                  <MapPin className="w-4 h-4 mr-1 text-red-500" />
                  Vị trí xuất *
                </Label>
                <Input
                  placeholder="Ví dụ: WH-HCM-A-01-01-01"
                  value={fromLocationCode}
                  onChange={(event) =>
                    setFromLocationCode(event.target.value.toUpperCase())
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="flex items-center">
                  <MapPin className="w-4 h-4 mr-1 text-green-500" />
                  Đến vị trí *
                </Label>
                <Input
                  placeholder="Ví dụ: WH-HCM-B-02-01-01"
                  value={toLocationCode}
                  onChange={(event) =>
                    setToLocationCode(event.target.value.toUpperCase())
                  }
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label>Số Lượng *</Label>
              <Input
                type="number"
                placeholder="0"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                min="1"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Lý do</Label>
              <Input
                placeholder="Lý do di chuyển (tùy chọn)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label>Ghi chú</Label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Ghi chú thêm..."
                className="w-full mt-1 p-2 border rounded-md"
                rows="2"
              />
            </div>

            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => navigate("/warehouse-staff")}>
                Hủy
              </Button>
              <Button onClick={validateTransfer} disabled={loading}>
                {loading ? "Đang kiểm tra..." : "Tiếp tục"}
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (step === 2) {
      return (
        <Card className="max-w-3xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center">
              <AlertCircle className="w-6 h-6 mr-2 text-yellow-500" />
              Xác nhận chuyển nội bộ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-gray-50 p-4 rounded-lg space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">SKU:</span>
                <span className="font-semibold">{sku}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Số Lượng:</span>
                <span className="font-semibold text-lg">{quantity}</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
              <div className="text-center flex-1">
                <MapPin className="w-6 h-6 text-red-500 mx-auto mb-1" />
                <p className="font-bold text-lg">{fromLocationCode}</p>
                <p className="text-sm text-gray-600">{fromLocation?.zoneName || "-"}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Khả dụng: {availableQty}
                </p>
              </div>
              <ArrowRight className="w-8 h-8 text-blue-500 mx-4" />
              <div className="text-center flex-1">
                <MapPin className="w-6 h-6 text-green-500 mx-auto mb-1" />
                <p className="font-bold text-lg">{toLocationCode}</p>
                <p className="text-sm text-gray-600">{toLocation?.zoneName || "-"}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Trống: {(toLocation?.capacity || 0) - (toLocation?.currentLoad || 0)}/
                  {toLocation?.capacity || 0}
                </p>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep(1)}>
                Quay lại
              </Button>
              <Button
                onClick={handleInternalTransfer}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? "Đang xử lý..." : "Xác nhận chuyển"}
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center text-green-600">
            <CheckCircle className="w-6 h-6 mr-2" />
            Chuyển kho hoàn tất
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center py-6">
            <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-4" />
            <h3 className="text-2xl font-bold mb-2">Hoàn thành</h3>
            <p className="text-gray-600">
              Đã chuyển {quantity} sản phẩm {sku} thành công
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between p-3 bg-green-50 rounded-lg">
              <span>Từ:</span>
              <span className="font-medium">{fromLocationCode}</span>
            </div>
            <div className="flex justify-between p-3 bg-green-50 rounded-lg">
              <span>Đến:</span>
              <span className="font-medium">{toLocationCode}</span>
            </div>
            <div className="flex justify-between p-3 bg-green-50 rounded-lg">
              <span>Số lượng:</span>
              <span className="font-medium">{quantity}</span>
            </div>
            {transferResult?.message && (
              <div className="text-sm text-gray-600">{transferResult.message}</div>
            )}
          </div>

          <div className="flex space-x-3 pt-4 border-t">
            <Button variant="outline" className="flex-1" onClick={resetInternalForm}>
              Tạo mới
            </Button>
            <Button onClick={() => navigate("/warehouse-staff")} className="flex-1">
              Về bảng điều khiển
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quản Lý Chuyển Kho</h1>
          <p className="text-gray-600">Chuyển kho nội bộ và liên chi nhánh</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 w-full max-w-[520px]">
          <TabsTrigger value="internal">
            <RefreshCw className="w-4 h-4 mr-2" />
            Nội bộ
          </TabsTrigger>
          <TabsTrigger value="branch">
            <Truck className="w-4 h-4 mr-2" />
            Liên chi nhánh
          </TabsTrigger>
        </TabsList>

        <TabsContent value="internal" className="mt-6">
          {renderInternalTransferSection()}
        </TabsContent>

        <TabsContent value="branch" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <ClipboardList className="w-5 h-5 mr-2" />
                Tạo yêu cầu chuyển kho
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Chọn kho nguồn và kho đích, thêm SKU và số lượng. Kho nguồn trùng với chi nhánh
                đang làm việc sẽ được kiểm tra tồn trước khi gửi; các trường hợp khác máy chủ vẫn
                xác thực khi tạo phiếu.
              </p>
            </CardHeader>
            {!isGlobalAdmin && (
              <div className="mx-6 mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                Chỉ Global Admin mới có thể tạo yêu cầu chuyển kho. Bạn vẫn có thể xem danh
                sách và xác nhận phiếu được giao.
              </div>
            )}
            <CardContent className={isGlobalAdmin ? "space-y-4" : "hidden"}>
              {!isGlobalAdmin && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Tài khoản của bạn không có quyền <strong>transfer.create</strong>. Bạn vẫn có thể
                  xem danh sách phiếu; vui lòng liên hệ quản trị để được cấp quyền tạo yêu cầu.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Từ kho</Label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={transferForm.fromStoreId}
                    onChange={(event) =>
                      setTransferForm((prev) => ({
                        ...prev,
                        fromStoreId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Chọn kho xuất</option>
                    {stores.map((store) => (
                      <option key={store._id} value={store._id}>
                        {store.code} - {store.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Đến kho</Label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={transferForm.toStoreId}
                    onChange={(event) =>
                      setTransferForm((prev) => ({
                        ...prev,
                        toStoreId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Chọn kho nhập</option>
                    {stores.map((store) => (
                      <option key={store._id} value={store._id}>
                        {store.code} - {store.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label>Lý do</Label>
                <select
                  className="w-full mt-1 p-2 border rounded-md"
                  value={transferForm.reason}
                  onChange={(event) =>
                    setTransferForm((prev) => ({ ...prev, reason: event.target.value }))
                  }
                >
                  {TRANSFER_REASONS.map((reasonOption) => (
                    <option key={reasonOption.value} value={reasonOption.value}>
                      {reasonOption.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>Danh sách sản phẩm</Label>
                <div className="space-y-2 mt-2">
                  {transferForm.items.map((item, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                      <div className="md:col-span-7">
                        <Input
                          placeholder="Mã SKU (ví dụ: 00001234)"
                          value={item.variantSku}
                          onChange={(event) =>
                            updateTransferItem(
                              index,
                              "variantSku",
                              event.target.value.toUpperCase()
                            )
                          }
                        />
                      </div>
                      <div className="md:col-span-3">
                        <Input
                          type="number"
                          min="1"
                          placeholder="Số lượng"
                          value={item.requestedQuantity}
                          onChange={(event) =>
                            updateTransferItem(
                              index,
                              "requestedQuantity",
                              event.target.value
                            )
                          }
                          className={
                            item.requestedQuantity !== "" &&
                            Number(item.requestedQuantity) <= 0
                              ? "border-red-400 focus:ring-red-400"
                              : ""
                          }
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => removeTransferItem(index)}
                          disabled={transferForm.items.length === 1}
                        >
                          Xóa
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="ghost" className="mt-2" onClick={addTransferItem}>
                  + Thêm dòng
                </Button>
              </div>

              <div>
                <Label>Ghi chú</Label>
                <textarea
                  className="w-full mt-1 p-2 border rounded-md"
                  rows={2}
                  value={transferForm.notes}
                  onChange={(event) =>
                    setTransferForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={submitTransferRequest}
                  disabled={branchLoading || !isGlobalAdmin}
                >
                  {branchLoading ? "Đang gửi..." : "Tạo yêu cầu"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Tổng</p>
                <p className="text-xl font-bold">{branchSummary.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Đã tạo</p>
                <p className="text-xl font-bold text-blue-600">{branchSummary.created}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Đang Vận Chuyển</p>
                <p className="text-xl font-bold text-indigo-600">{branchSummary.inTransit}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Legacy</p>
                <p className="text-xl font-bold text-amber-700">{branchSummary.legacy}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Đã Hủy</p>
                <p className="text-xl font-bold text-zinc-700">{branchSummary.cancelled}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Hoàn Thành</p>
                <p className="text-xl font-bold text-green-600">{branchSummary.completed}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center">
                  <PackageCheck className="w-5 h-5 mr-2" />
                  Danh sách yêu cầu
                </CardTitle>
              </div>
              <div className="flex flex-col md:flex-row gap-2">
                <Input
                  placeholder="Tìm theo số phiếu hoặc SKU"
                  value={transferSearch}
                  onChange={(event) => setTransferSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      fetchBranchData({ search: transferSearch });
                    }
                  }}
                />
                <select
                  className="p-2 border rounded-md text-sm md:w-[180px]"
                  value={transferStatusFilter}
                  onChange={(event) => setTransferStatusFilter(event.target.value)}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  onClick={() => fetchBranchData({ search: transferSearch })}
                  disabled={branchLoading}
                >
                  Tìm kiếm
                </Button>
                <Button variant="outline" onClick={fetchBranchData} disabled={branchLoading}>
                  Làm mới
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {branchLoading ? (
                <div className="text-center py-8 text-gray-500">Đang tải danh sách...</div>
              ) : transfers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  Không tìm thấy yêu cầu nào
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã phiếu</TableHead>
                      <TableHead>Lộ trình</TableHead>
                      <TableHead>Nội dung</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Ngày tạo</TableHead>
                      <TableHead>Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfers.map((transfer) => (
                      <TableRow key={transfer._id} className="align-top">
                        <TableCell className="font-medium">
                          {transfer.transferNumber}
                        </TableCell>
                        <TableCell>
                          <div>{transfer.fromStore?.storeCode || "-"}</div>
                          <div className="text-gray-500">
                            {"-> " + (transfer.toStore?.storeCode || "-")}
                            {(isGlobalAdmin ||
                              allowedBranches.includes(String(transfer.fromStore?.storeId || ""))) &&
                              canConfirmShipment &&
                              transfer.status === "CREATED" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTransferAction(transfer, "ship")}
                                >
                                  <Truck className="w-4 h-4 mr-1" />
                                  Xác nhận gửi hàng
                                </Button>
                              )}

                            {(isGlobalAdmin ||
                              allowedBranches.includes(String(transfer.toStore?.storeId || ""))) &&
                              canConfirmReceived &&
                              transfer.status === "IN_TRANSIT" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTransferAction(transfer, "receive")}
                                >
                                  <PackageCheck className="w-4 h-4 mr-1" />
                                  Xác nhận nhận hàng
                                </Button>
                              )}

                            {isGlobalAdmin && transfer.status === "CREATED" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleTransferAction(transfer, "cancel")}
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Hủy
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{getTransferItemSummary(transfer.items)}</div>
                          <div className="text-gray-500">
                            {TRANSFER_REASON_LABELS[transfer.reason] || transfer.reason}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              TRANSFER_STATUS_META.badges[transfer.status] ||
                              "bg-zinc-100 text-zinc-800"
                            }
                          >
                            {TRANSFER_STATUS_META.labels[transfer.status] || transfer.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDateTime(transfer.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {canApproveTransfers && transfer.status === "PENDING" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleTransferAction(transfer, "approve")}
                                >
                                  Duyệt
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTransferAction(transfer, "reject")}
                                >
                                  Từ chối
                                </Button>
                              </>
                            )}

                            {canOperateTransfers && transfer.status === "APPROVED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleTransferAction(transfer, "ship")}
                              >
                                <Truck className="w-4 h-4 mr-1" />
                                Vận chuyển
                              </Button>
                            )}

                            {canOperateTransfers && transfer.status === "IN_TRANSIT" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleTransferAction(transfer, "receive")}
                              >
                                Nhận hàng
                              </Button>
                            )}

                            {canApproveTransfers && transfer.status === "RECEIVED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleTransferAction(transfer, "complete")}
                              >
                                Hoàn tất
                              </Button>
                            )}

                            {canApproveTransfers &&
                              (transfer.status === "PENDING" ||
                                transfer.status === "APPROVED") && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTransferAction(transfer, "cancel")}
                                >
                                  <XCircle className="w-4 h-4 mr-1" />
                                  Hủy
                                </Button>
                              )}
                          </div>
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

      {/* ── Approve Modal ── */}
      <Dialog open={approveModal.open} onOpenChange={(open) => !open && setApproveModal({ open: false, transfer: null, items: [] })}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Duyệt yêu cầu chuyển kho</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Xác nhận số lượng duyệt cho từng sản phẩm. Mặc định là số lượng yêu cầu ban đầu.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Tên sản phẩm</TableHead>
                  <TableHead className="text-center">Yêu cầu</TableHead>
                  <TableHead className="text-center">Duyệt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approveModal.items.map((item, idx) => (
                  <TableRow key={item.variantSku}>
                    <TableCell className="font-mono text-sm">{item.variantSku}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="text-center">{item.requestedQuantity}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        max={item.requestedQuantity}
                        value={item.approvedQuantity}
                        onChange={(e) => {
                          const next = [...approveModal.items];
                          next[idx] = { ...next[idx], approvedQuantity: e.target.value };
                          setApproveModal((prev) => ({ ...prev, items: next }));
                        }}
                        className="w-24 text-center"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveModal({ open: false, transfer: null, items: [] })} disabled={modalLoading}>
              Hủy
            </Button>
            <Button onClick={submitApprove} disabled={modalLoading}>
              {modalLoading ? "Đang xử lý..." : "Xác nhận duyệt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Receive Modal ── */}
      <Dialog open={approveModal.open && receiveModal.open} onOpenChange={(open) => !open && setReceiveModal({ open: false, transfer: null, items: [], notes: "" })}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Xác nhận nhận hàng</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Nhập số lượng thực tế nhận được. Nếu khác với số lượng duyệt, vui lòng ghi lý do.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-center">Đã duyệt</TableHead>
                  <TableHead className="text-center">Thực nhận</TableHead>
                  <TableHead>Lý do chênh lệch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiveModal.items.map((item, idx) => (
                  <TableRow key={item.variantSku}>
                    <TableCell className="font-mono text-sm">{item.variantSku}</TableCell>
                    <TableCell className="text-center">{item.approvedQuantity}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        max={item.approvedQuantity}
                        value={item.receivedQuantity}
                        onChange={(e) => {
                          const next = [...receiveModal.items];
                          next[idx] = { ...next[idx], receivedQuantity: e.target.value };
                          setReceiveModal((prev) => ({ ...prev, items: next }));
                        }}
                        className="w-24 text-center"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder="Lý do (nếu thiếu)"
                        value={item.reason}
                        onChange={(e) => {
                          const next = [...receiveModal.items];
                          next[idx] = { ...next[idx], reason: e.target.value };
                          setReceiveModal((prev) => ({ ...prev, items: next }));
                        }}
                        disabled={Number(item.receivedQuantity) === item.approvedQuantity}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveModal({ open: false, transfer: null, items: [] })} disabled={modalLoading}>
              Hủy
            </Button>
            <Button onClick={submitReceive} disabled={modalLoading}>
              {modalLoading ? "Đang xử lý..." : "Xác nhận nhận hàng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Ship Modal ── */}
      <Dialog
        open={receiveModal.open}
        onOpenChange={(open) =>
          !open && setReceiveModal({ open: false, transfer: null, items: [], notes: "" })
        }
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Xác nhận nhận hàng</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Xác nhận bước này sẽ trừ tồn kho tại kho nguồn và cộng tồn kho tại kho đích.
            </p>
            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">
                {(receiveModal.transfer?.fromStore?.storeCode || "-") +
                  " -> " +
                  (receiveModal.transfer?.toStore?.storeCode || "-")}
              </div>
              <div className="mt-2 space-y-1 text-sm text-gray-600">
                {(receiveModal.transfer?.items || []).map((item) => (
                  <div key={item.variantSku}>
                    {item.variantSku}: {Number(item.requestedQuantity) || 0}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Ghi chú (tùy chọn)</Label>
              <textarea
                className="w-full mt-1 p-2 border rounded-md"
                rows={3}
                value={receiveModal.notes}
                onChange={(event) =>
                  setReceiveModal((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setReceiveModal({ open: false, transfer: null, items: [], notes: "" })
              }
              disabled={modalLoading}
            >
              Hủy
            </Button>
            <Button onClick={submitReceive} disabled={modalLoading}>
              {modalLoading ? "Đang xử lý..." : "Xác nhận nhận hàng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shipModal.open} onOpenChange={(open) => !open && setShipModal({ open: false, transfer: null, trackingNumber: "", carrier: "" })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" /> Xác nhận vận chuyển
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Mã vận đơn (tùy chọn)</Label>
              <Input
                placeholder="VD: VNP123456789"
                value={shipModal.trackingNumber}
                onChange={(e) => setShipModal((prev) => ({ ...prev, trackingNumber: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Đơn vị vận chuyển (tùy chọn)</Label>
              <Input
                placeholder="VD: GHTK, GHN, ViettelPost..."
                value={shipModal.carrier}
                onChange={(e) => setShipModal((prev) => ({ ...prev, carrier: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipModal({ open: false, transfer: null, trackingNumber: "", carrier: "" })} disabled={modalLoading}>
              Hủy
            </Button>
            <Button onClick={submitShip} disabled={modalLoading}>
              {modalLoading ? "Đang xử lý..." : "Xác nhận xuất hàng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Modal ── */}
      <Dialog open={rejectModal.open} onOpenChange={(open) => !open && setRejectModal({ open: false, transfer: null, reason: "" })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="w-5 h-5" /> Từ chối yêu cầu
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label>Lý do từ chối (tùy chọn)</Label>
            <textarea
              className="w-full mt-1 p-2 border rounded-md"
              rows={3}
              placeholder="Nhập lý do từ chối..."
              value={rejectModal.reason}
              onChange={(e) => setRejectModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectModal({ open: false, transfer: null, reason: "" })} disabled={modalLoading}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={submitReject} disabled={modalLoading}>
              {modalLoading ? "Đang xử lý..." : "Xác nhận từ chối"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Modal ── */}
      <Dialog open={cancelModal.open} onOpenChange={(open) => !open && setCancelModal({ open: false, transfer: null, reason: "" })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hủy yêu cầu chuyển kho</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Lý do hủy (tùy chọn)</Label>
            <textarea
              className="w-full mt-1 p-2 border rounded-md"
              rows={3}
              placeholder="Nhập lý do hủy..."
              value={cancelModal.reason}
              onChange={(e) => setCancelModal((prev) => ({ ...prev, reason: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelModal({ open: false, transfer: null, reason: "" })} disabled={modalLoading}>
              Hủy thao tác
            </Button>
            <Button variant="destructive" onClick={submitCancel} disabled={modalLoading}>
              {modalLoading ? "Đang xử lý..." : "Xác nhận hủy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TransferStockPage;
