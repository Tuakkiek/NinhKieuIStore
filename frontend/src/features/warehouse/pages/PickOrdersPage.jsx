import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Package, MapPin, Navigation, CheckCircle, Printer, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { toast } from "sonner";
import { api } from "@/shared/lib/http/httpClient";
import { orderAPI } from "@/features/orders";
import { getStatusStage, getStatusText } from "@/shared/lib/utils";

import { useAuthStore, usePermission } from "@/features/auth";

const REASON_LABELS = {
  NO_INVENTORY_FOR_SKU: "Không có tồn kho",
  ZERO_QUANTITY: "Hết hàng",
  NOT_GOOD_STATUS: "Hàng không ở trạng thái bán được",
  MISSING_LOCATION_CODE: "Chưa gán vị trí kho",
  STORE_MISMATCH: "Khác chi nhánh",
  SKU_NOT_RESOLVED: "Thiếu SKU",
};

const getReasonLabel = (reason) => {
  const normalized = String(reason || "").trim();
  return REASON_LABELS[normalized] || "Không thể lấy hàng";
};

const getReasonBadgeClassName = (reason) => {
  const normalized = String(reason || "").trim();
  if (normalized === "SKU_NOT_RESOLVED") {
    return "bg-orange-100 text-orange-700 border border-orange-200";
  }
  if (normalized) {
    return "bg-red-100 text-red-700 border border-red-200";
  }
  return "";
};

const PickOrdersPage = () => {
  const navigate = useNavigate();
  const { user, activeBranchId, authz, authorization } = useAuthStore();
  const authSnapshot = authorization || authz || null;
  const requiresBranchAssignment = authSnapshot?.requiresBranchAssignment === true;
  const canReadOrders = usePermission("orders.read");
  const canReadWarehouse = usePermission("warehouse.read");
  const canWriteWarehouse = usePermission("warehouse.write");
  const canFinalizeOrder = usePermission(
    ["order.status.manage.warehouse", "order.status.manage"],
    { mode: "any" }
  );
  const canCompleteInStorePick = usePermission("order.pick.complete.instore");
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [step, setStep] = useState(1);
  const [orders, setOrders] = useState([]);
  const [filterMode, setFilterMode] = useState("MY_TASKS"); // MY_TASKS, ALL
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [pickList, setPickList] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [currentLocationIndex, setCurrentLocationIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [unpickableItems, setUnpickableItems] = useState([]);

  const parseApiErrorMessage = (error, fallbackMessage) => {
    const status = error?.response?.status;
    const backendMessage = error?.response?.data?.message;
    if (backendMessage) return backendMessage;
    if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
    if (status === 409) return "Dữ liệu đã thay đổi, vui lòng tải lại và thử lại.";
    if (status === 400) return "Dữ liệu gửi lên không hợp lệ.";
    return fallbackMessage;
  };

  const ensureBranchContext = () => {
    if (requiresBranchAssignment && !activeBranchId) {
      toast.error("Chưa chọn chi nhánh làm việc. Vui lòng chọn chi nhánh rồi thử lại.");
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (orderId) { loadPickList(orderId); } else { loadPendingOrders(); }
  }, [canCompleteInStorePick, orderId]);

  const loadPendingOrders = async () => {
    if (!canReadOrders) {
      setOrders([]);
      toast.error("Bạn không có quyền đọc danh sách đơn hàng.");
      return;
    }

    if (!ensureBranchContext()) {
      setOrders([]);
      return;
    }

    try {
      setLoading(true);
      const [confirmedResult, pickingResult] = await Promise.allSettled([
        orderAPI.getByStage("CONFIRMED", { limit: 200 }),
        orderAPI.getByStage("PICKING", { limit: 200 }),
      ]);

      const confirmedRes = confirmedResult.status === "fulfilled" ? confirmedResult.value : null;
      const pickingRes = pickingResult.status === "fulfilled" ? pickingResult.value : null;
      const merged = [
        ...(confirmedRes?.data?.orders || []),
        ...(pickingRes?.data?.orders || []),
      ];

      const uniqueById = Array.from(
        new Map(merged.map((order) => [order._id, order])).values()
      );
      const visibleOrders =
        !canCompleteInStorePick
          ? uniqueById.filter(
              (order) =>
                order.orderSource !== "IN_STORE" &&
                order.fulfillmentType !== "IN_STORE"
            )
          : uniqueById;
      setOrders(visibleOrders);

      if (confirmedResult.status === "rejected" || pickingResult.status === "rejected") {
        toast.error("Một phần dữ liệu đơn hàng không tải được. Danh sách đã hiển thị phần khả dụng.");
      }
    } catch (e) {
      toast.error(parseApiErrorMessage(e, "Không thể tải đơn hàng"));
    } finally { setLoading(false); }
  };

    const getFilteredOrders = () => {
      if (filterMode === "ALL") return orders;
      return orders.filter((o) => {
        const pickerId = o?.pickerInfo?.pickerId?._id || o?.pickerInfo?.pickerId;
        return pickerId?.toString() === user?._id?.toString();
      });
    };

  const loadPickList = async (id) => {
    if (!id) {
      toast.error("Không xác định được đơn hàng cần lấy hàng.");
      return;
    }

    if (!canReadWarehouse) {
      toast.error("Bạn không có quyền xem pick list của kho.");
      return;
    }

    if (!ensureBranchContext()) {
      return;
    }

    try {
      setLoading(true);
      const res = await api.get(`/warehouse/pick-list/${id}`);
      setSelectedOrder({
        _id: res.data.orderId,
        orderNumber: res.data.orderNumber,
        orderSource: res.data.orderSource,
        fulfillmentType: res.data.fulfillmentType,
        status: res.data.orderStatus,
        statusStage: getStatusStage(res.data.orderStatus),
      });

      const rawPickList = Array.isArray(res.data.pickList) ? res.data.pickList : [];
      const pickable = rawPickList
        .map((item) => ({
          ...item,
          locations: Array.isArray(item?.locations) ? item.locations : [],
        }))
        .filter((item) => item.locations.length > 0);

      const unpickable = rawPickList.filter((item) => !Array.isArray(item?.locations) || item.locations.length === 0);
      const unresolvedSkuCount = unpickable.filter((item) => item?.reason === "SKU_NOT_RESOLVED").length;

      setPickList(pickable);
      setUnpickableItems(unpickable);
      setCurrentItemIndex(0);
      setCurrentLocationIndex(0);

      if (pickable.length === 0) {
        setStep(3);
        const reasonCodes = Array.from(
          new Set(
            unpickable
              .map((item) => String(item?.reason || "").trim())
              .filter(Boolean)
          )
        );
        const reasonText = reasonCodes
          .map((code) => getReasonLabel(code))
          .join(", ");
        toast.error(
          unresolvedSkuCount > 0
            ? "Đơn hàng có sản phẩm thiếu SKU, chưa thể tạo pick list khả dụng"
            : reasonText
              ? `Không thể lấy hàng do: ${reasonText}`
              : "Không thể lấy hàng: chưa xác định được nguyên nhân"
        );
      } else {
        setStep(2);
      }
    } catch (e) {
      toast.error(parseApiErrorMessage(e, "Không thể tải pick list"));
    } finally { setLoading(false); }
  };

  const refreshSelectedOrderStatus = async () => {
    if (!selectedOrder?._id) return;
    try {
      const latestOrderRes = await orderAPI.getById(selectedOrder._id);
      const latestOrder = latestOrderRes?.data?.order;
      if (!latestOrder?._id) return;

      setSelectedOrder((prev) => ({
        ...(prev || {}),
        _id: latestOrder._id,
        orderNumber: latestOrder.orderNumber || prev?.orderNumber,
        orderSource: latestOrder.orderSource || prev?.orderSource,
        fulfillmentType: latestOrder.fulfillmentType || prev?.fulfillmentType,
        status: latestOrder.status || prev?.status,
        statusStage: getStatusStage(latestOrder.status || prev?.status || ""),
      }));
    } catch {
      // Keep pick flow resilient even if background refresh fails.
    }
  };

  const getNextStatusAfterPick = () => {
    if (!selectedOrder) return null;
    const isInStoreOrder =
      selectedOrder.orderSource === "IN_STORE" ||
      selectedOrder.fulfillmentType === "IN_STORE";

    return isInStoreOrder ? "PREPARING_SHIPMENT" : "PICKUP_COMPLETED";
  };

  const handleFinalizePick = async () => {
    if (!selectedOrder?._id) {
      toast.error("Không xác định được đơn hàng");
      return;
    }
    if (!canFinalizeOrder) {
      toast.error("Bạn không có quyền xác nhận hoàn tất xuất kho.");
      return;
    }
    if (!ensureBranchContext()) return;

    const nextStatus = getNextStatusAfterPick();
    if (!nextStatus) {
      toast.error("Không xác định được trạng thái tiếp theo");
      return;
    }

    setIsFinalizing(true);
    try {
      const latestOrderRes = await orderAPI.getById(selectedOrder._id);
      const latestStatus = String(latestOrderRes?.data?.order?.status || "").trim();
      const alreadyAdvancedStatuses = new Set([
        "PREPARING_SHIPMENT",
        "SHIPPING",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "PICKED_UP",
        "COMPLETED",
      ]);

      // Pick flow may already have promoted status in backend during /warehouse/pick.
      // In that case, skip manual status update to avoid permission conflicts.
      if (alreadyAdvancedStatuses.has(latestStatus)) {
        toast.success("Đơn đã được cập nhật trạng thái sau khi lấy hàng.");
        navigate("/warehouse-staff");
        return;
      }

      const basePayload = {
        note: "Warehouse completed picking, ready for POS staff handover",
        notifyPOS: true,
      };
      try {
        await api.put(`/orders/${selectedOrder._id}/status`, {
          ...basePayload,
          status: nextStatus,
        });
      } catch (firstError) {
        // Fallback for stricter state-machine rules in some deployments.
        if (nextStatus !== "PREPARING_SHIPMENT") {
          await api.put(`/orders/${selectedOrder._id}/status`, {
            ...basePayload,
            status: "PREPARING_SHIPMENT",
          });
        } else {
          throw firstError;
        }
      }

      toast.success(
        nextStatus === "PREPARING_SHIPMENT"
          ? "Đã báo POS staff nhận bàn giao"
          : "Đã cập nhật: Hoàn tất lấy hàng"
      );
      navigate("/warehouse-staff");
    } catch (e) {
      toast.error(parseApiErrorMessage(e, "Không thể cập nhật trạng thái đơn"));
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleReportIssue = async () => {
       const note = prompt("Nhập nội dung sự cố (Ví dụ: Hàng hỏng, không tìm thấy):");
       if (!note) return;

       try {
           setLoading(true);
           // Update note but keep status same or move to CONFIRMED pending review?
           // Just add note for now to Order Manager
           await orderAPI.updateStatus(selectedOrder._id, {
               status: selectedOrder.status, // Keep same status
               note: `SỰ CỐ KHO: ${note}`,
           });
           toast.success("Đã báo cáo sự cố");
       } catch {
           toast.error("Lỗi khi báo cáo sự cố");
       } finally {
           setLoading(false);
       }
  };

  const handlePickItem = async () => {
    if (!canWriteWarehouse) {
      toast.error("Bạn không có quyền xác nhận lấy hàng trong kho.");
      return;
    }
    if (!ensureBranchContext()) return;

    const item = pickList[currentItemIndex];
    const loc = item?.locations?.[currentLocationIndex];
    const quantity = Number(loc?.pickQty || loc?.quantity || 0);

    if (!item || !loc) {
      toast.error("Không tìm thấy thông tin vị trí lấy hàng");
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Số lượng lấy hàng không hợp lệ");
      return;
    }

    if (!selectedOrder?._id) {
      toast.error("Không xác định được đơn hàng để thực hiện lấy hàng.");
      return;
    }

    try {
      setLoading(true);
      await api.post("/warehouse/pick", {
        orderId: selectedOrder._id,
        sku: item.sku,
        locationCode: loc.locationCode,
        quantity,
      });
      await refreshSelectedOrderStatus();
      toast.success(`Đã lấy ${quantity} ${item.productName}`);

      if (currentLocationIndex < item.locations.length - 1) {
        setCurrentLocationIndex(currentLocationIndex + 1);
      } else if (currentItemIndex < pickList.length - 1) {
        setCurrentItemIndex(currentItemIndex + 1);
        setCurrentLocationIndex(0);
      } else {
        setStep(3);
      }
    } catch (e) {
      toast.error(parseApiErrorMessage(e, "Lỗi khi lấy hàng"));
    } finally {
      setLoading(false);
    }
  };

  if (step === 1) {
    const displayOrders = getFilteredOrders();

    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="max-w-4xl mx-auto">
          <CardHeader>
              <div className="flex justify-between items-center">
                  <CardTitle className="flex items-center"><Package className="w-6 h-6 mr-2" />Chọn Đơn Hàng Cần Xuất Kho</CardTitle>
                  <div className="flex space-x-2">
                      <Button variant={filterMode === "MY_TASKS" ? "default" : "outline"} onClick={() => setFilterMode("MY_TASKS")} size="sm">
                          Được giao cho tôi
                      </Button>
                      <Button variant={filterMode === "ALL" ? "default" : "outline"} onClick={() => setFilterMode("ALL")} size="sm">
                          Tất cả
                      </Button>
                  </div>
              </div>
          </CardHeader>
          <CardContent>
            {loading ? (<div className="text-center py-8"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" /><p className="mt-4 text-gray-600">Đang tải...</p></div>
            ) : displayOrders.length === 0 ? (<p className="text-center text-gray-500 py-12">Không có đơn hàng nào</p>
            ) : (
              <div className="space-y-3">
                {displayOrders.map((order) => (
                  <div key={order._id} onClick={() => loadPickList(order._id)} className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 cursor-pointer transition-all">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">Đơn hàng: {order.orderNumber}</p>
                        <p className="text-sm text-gray-600">Khách: {order.shippingAddress?.fullName || "N/A"}</p>
                        <p className="text-sm text-gray-600">
                          Hình thức: {getStatusText(order.fulfillmentType || "HOME_DELIVERY")}
                        </p>
                        {(order.pickerInfo?.pickerName || order.pickerInfo?.pickerId?.fullName) && (
                          <p className="text-xs text-blue-600 font-medium tracking-tight">
                            Người lấy hàng: {order.pickerInfo?.pickerName || order.pickerInfo?.pickerId?.fullName}{" "}
                            {(order.pickerInfo?.pickerId?._id || order.pickerInfo?.pickerId) === user?._id &&
                              "(Tôi)"}
                          </p>
                        )}
                        {order.assignedStore?.storeName && (
                          <p className="text-xs text-gray-500">
                            Cửa hàng xử lý: {order.assignedStore.storeName}
                          </p>
                        )}
                        {order.pickupInfo?.pickupCode && (
                          <p className="text-xs font-semibold text-blue-700">
                            Mã nhận: {order.pickupInfo.pickupCode}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">{order.items?.length || 0} sản phẩm</p>
                      </div>
                      <Badge variant="outline">
                        {getStatusText(order.statusStage || getStatusStage(order.status))}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 2 && pickList.length > 0) {
    const item = pickList[currentItemIndex];
    const loc = item?.locations?.[currentLocationIndex];

    if (!item || !loc) {
      return (
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-2xl mx-auto">
            <CardContent className="p-6 text-center">
              <p className="text-gray-600 mb-4">Không thể xác định vị trí lấy hàng cho mục hiện tại.</p>
              <Button onClick={() => { setCurrentItemIndex(0); setCurrentLocationIndex(0); }}>Tải lại bước lấy hàng</Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    const progress = Math.round(((currentItemIndex + (currentLocationIndex + 1) / item.locations.length) / pickList.length) * 100);

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Card><CardContent className="p-4">
            <div className="flex items-center justify-between mb-2"><span className="text-sm font-medium">Đơn: {selectedOrder.orderNumber}</span><Badge>{progress}%</Badge></div>
            <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-green-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
          </CardContent></Card>

          <Card>
            <CardHeader><CardTitle><Package className="w-5 h-5 mr-2 inline" />{item.productName}</CardTitle><p className="text-sm text-gray-600">SKU: {item.sku}</p></CardHeader>
            <CardContent className="space-y-6">
              {item.serializedTrackingEnabled && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                  Dòng hàng serialized.
                  {item.assignedDevicesCount > 0
                    ? ` Đã gán ${item.assignedDevicesCount}/${item.requiredQty} thiết bị cho đơn.`
                    : " Hệ thống sẽ tự gán thiết bị khả dụng khi xác nhận lấy hàng nếu chưa chọn thủ công."}
                </div>
              )}

              <div className="bg-blue-50 p-6 rounded-lg text-center">
                <p className="text-sm text-gray-600 mb-2">Số lượng cần lấy</p>
                <p className="text-5xl font-bold text-blue-600">{Number(loc.pickQty || loc.quantity || 0)}</p>
              </div>

              <div className="border-2 border-green-500 rounded-lg p-6 bg-green-50">
                <div className="flex items-center mb-2"><MapPin className="w-5 h-5 text-green-600 mr-2" /><span className="text-lg font-semibold">Vị trí lấy hàng</span></div>
                <p className="text-3xl font-bold text-green-600">{loc.locationCode}</p>
                <p className="text-sm text-gray-700 mt-1">{loc.zoneName}</p>
                <div className="bg-white p-4 rounded-lg mt-4">
                  <div className="flex items-center mb-2"><Navigation className="w-4 h-4 text-blue-600 mr-2" /><span className="font-medium text-sm">Hướng dẫn:</span></div>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                    <li>Đi đến {loc.zoneName}</li><li>Tìm Dãy {loc.aisle}</li><li>Tầng {loc.shelf}</li><li>Ô {loc.bin}</li>
                  </ol>
                </div>
              </div>

              <div className="flex space-x-3 pt-4 border-t">
                <Button variant="outline" onClick={() => { if (currentLocationIndex > 0) setCurrentLocationIndex(currentLocationIndex - 1); else if (currentItemIndex > 0) { setCurrentItemIndex(currentItemIndex - 1); setCurrentLocationIndex(pickList[currentItemIndex - 1].locations.length - 1); } else setStep(1); }} className="flex-1">Quay lại</Button>
                <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50" onClick={handleReportIssue}>
                     <AlertTriangle className="w-4 h-4 mr-2" />
                     Báo sự cố
                </Button>
                <Button onClick={handlePickItem} disabled={loading} className="flex-1">
                  {loading ? "Đang xử lý..." : "Đã lấy hàng"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (step === 3) {
    const isFullSuccess = unpickableItems.length === 0;
    const isPartial = pickList.length > 0 && unpickableItems.length > 0;
    const isFailed = pickList.length === 0;
    const hasMissingSku = unpickableItems.some((item) => item?.reason === "SKU_NOT_RESOLVED");
    const unpickableReasonCodes = Array.from(
      new Set(
        unpickableItems
          .map((item) => String(item?.reason || "").trim())
          .filter(Boolean)
      )
    );
    const nextStatus = getNextStatusAfterPick();
    const nextStatusLabel =
      nextStatus === "PREPARING_SHIPMENT" ? "POS bàn giao cho khách" : "Đã hoàn tất lấy hàng";

    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className={`flex items-center ${isFailed ? "text-red-600" : isPartial ? "text-yellow-600" : "text-green-600"}`}>
              {isFailed ? <AlertTriangle className="w-6 h-6 mr-2" /> : <CheckCircle className="w-6 h-6 mr-2" />}
              {isFailed ? "Không Thể Lấy Hàng" : isPartial ? "Hoàn Tất Có Cảnh Báo" : "Đã Lấy Đủ Hàng"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center py-8">
              {isFailed ? (
                <AlertTriangle className="w-24 h-24 text-red-500 mx-auto mb-4" />
              ) : isPartial ? (
                <AlertTriangle className="w-24 h-24 text-yellow-500 mx-auto mb-4" />
              ) : (
                <CheckCircle className="w-24 h-24 text-green-500 mx-auto mb-4" />
              )}
              <h3 className="text-2xl font-bold mb-2">
                {isFailed ? "Thiếu vị trí kho!" : "Hoàn tất!"}
              </h3>
              <p className="text-gray-600">
                {isFailed
                  ? hasMissingSku
                    ? `Đơn hàng ${selectedOrder.orderNumber} có sản phẩm thiếu SKU, cần bổ sung dữ liệu trước khi xuất kho.`
                    : `Đơn hàng ${selectedOrder.orderNumber} không thể lấy hàng với dữ liệu tồn kho hiện tại.`
                  : `Đã xử lý xong yêu cầu lấy hàng cho đơn ${selectedOrder.orderNumber}`}
              </p>
              {isFailed && unpickableReasonCodes.length > 0 && (
                <div className="mt-3 text-left max-w-md mx-auto">
                  <p className="text-sm font-medium text-red-700 mb-1">Không thể lấy hàng do:</p>
                  <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                    {unpickableReasonCodes.map((code) => (
                      <li key={code}>
                        {getReasonLabel(code)}
                        <span className="text-xs text-red-500 ml-1">({code})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!isFailed && (
                <p className="text-sm mt-2 text-blue-700 font-medium">
                  Trạng thái tiếp theo: {nextStatusLabel}
                </p>
              )}
              {isPartial && (
                <p className="text-sm mt-2 text-yellow-700">
                  Còn sản phẩm thiếu vị trí kho, chưa thể chuyển sang bước tiếp theo.
                </p>
              )}
            </div>
            <div className="space-y-2">
              {pickList.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100">
                  <div>
                    <p className="font-medium">* {item.productName || "Sản phẩm không tên"}</p>
                    <p className="text-sm text-gray-600">SKU: {item.sku}</p>
                    {item.serializedTrackingEnabled && (
                      <p className="text-xs font-medium text-blue-700">
                        Serialized • Đã gán {item.assignedDevicesCount || 0}/{item.requiredQty}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline">{item.requiredQty} chiếc</Badge>
                </div>
              ))}
              {unpickableItems.map((item, i) => (
                <div
                  key={`u-${i}`}
                  className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200"
                >
                  <div>
                    <p className="font-medium text-red-700">! {item.productName || "Sản phẩm không tên"}</p>
                    <p className="text-sm text-gray-600">SKU: {item.sku || "N/A"}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={getReasonBadgeClassName(item?.reason)}
                    title={`${getReasonLabel(item?.reason)}\n(code: ${String(item?.reason || "UNKNOWN")})`}
                  >
                    {getReasonLabel(item?.reason)}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="flex space-x-3 pt-4 border-t">
              <Button variant="outline" className="flex-1" disabled={!isFullSuccess}>
                <Printer className="w-4 h-4 mr-2" />
                In phiếu xuất
              </Button>
              {isFullSuccess ? (
                <Button onClick={handleFinalizePick} className="flex-1" disabled={isFinalizing || !canFinalizeOrder}>
                  {isFinalizing ? "Đang cập nhật..." : "Xác nhận hoàn tất"}
                </Button>
              ) : (
                <Button onClick={() => navigate("/warehouse-staff")} className="flex-1">
                  Quay về Dashboard
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
};

export default PickOrdersPage;
