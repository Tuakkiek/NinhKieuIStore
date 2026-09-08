import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Loader2 } from "lucide-react";
import { afterSalesAPI } from "@/features/afterSales";
import { universalProductAPI } from "@/features/catalog";
import { isSerializedProduct } from "@/features/afterSales/utils/afterSales";
import InvoiceTemplate from "./InvoiceTemplate";

const toIdentifierLabel = (device) => device?.imei || device?.serialNumber || "N/A";

const EditInvoiceDialog = ({
  open,
  onOpenChange,
  order,
  onPrint,
  onConfirmPayment,
  isLoading,
}) => {
  const [editableData, setEditableData] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    items: [],
    totalAmount: 0,
    paymentReceived: 0,
    changeGiven: 0,
    orderNumber: "",
    createdAt: new Date(),
    staffName: "",
    cashierName: "",
  });
  const [showPreview, setShowPreview] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);

  useEffect(() => {
    if (!order) return;

    setEditableData({
      customerName: order.shippingAddress?.fullName || "",
      customerPhone: order.shippingAddress?.phoneNumber || "",
      customerAddress: `${order.shippingAddress?.detailAddress || ""}, ${order.shippingAddress?.ward || ""}, ${order.shippingAddress?.province || ""}`.trim(),
      items: (order.items || []).map((item) => ({
        ...item,
        imei: item.imei || "",
        serialNumber: item.serialNumber || "",
        deviceAssignments: Array.isArray(item.deviceAssignments) ? item.deviceAssignments : [],
        serializedTrackingEnabled: false,
        availableDevices: [],
      })),
      totalAmount: order.totalAmount,
      paymentReceived: order.posInfo?.paymentReceived || order.totalAmount,
      changeGiven: order.posInfo?.changeGiven || 0,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      staffName: order.posInfo?.staffName || "N/A",
      cashierName: order.posInfo?.cashierName || "Thu ngân",
    });
    setShowPreview(false);
  }, [order]);

  useEffect(() => {
    if (!open || !order?.items?.length) return;

    let cancelled = false;
    const hydrateSerializedItems = async () => {
      setLoadingDevices(true);
      try {
        const enrichedItems = await Promise.all(
          order.items.map(async (item) => {
            try {
              const productRes = await universalProductAPI.getById(item.productId);
              const product = productRes.data?.data?.product;
              const serializedTrackingEnabled = isSerializedProduct(product);
              if (!serializedTrackingEnabled) {
                return {
                  ...item,
                  imei: item.imei || "",
                  serialNumber: item.serialNumber || "",
                  deviceAssignments: Array.isArray(item.deviceAssignments)
                    ? item.deviceAssignments
                    : [],
                  serializedTrackingEnabled: false,
                  availableDevices: [],
                };
              }

              const deviceRes = await afterSalesAPI.getAvailableDevices({
                variantSku: item.variantSku,
                limit: Math.max(30, Number(item.quantity || 1) * 8),
              });

              const availableDevices = deviceRes.data?.data?.devices || [];
              const existingAssignments = Array.isArray(item.deviceAssignments)
                ? item.deviceAssignments
                : [];
              const mergedDevices = [...existingAssignments];
              for (const device of availableDevices) {
                if (!mergedDevices.some((entry) => String(entry.deviceId || entry._id) === String(device._id))) {
                  mergedDevices.push(device);
                }
              }

              return {
                ...item,
                imei: item.imei || existingAssignments[0]?.imei || "",
                serialNumber: item.serialNumber || existingAssignments[0]?.serialNumber || "",
                deviceAssignments: existingAssignments,
                serializedTrackingEnabled: true,
                availableDevices: mergedDevices,
              };
            } catch {
              return {
                ...item,
                imei: item.imei || "",
                serialNumber: item.serialNumber || "",
                deviceAssignments: Array.isArray(item.deviceAssignments) ? item.deviceAssignments : [],
                serializedTrackingEnabled: false,
                availableDevices: [],
              };
            }
          })
        );

        if (!cancelled) {
          setEditableData((prev) => ({ ...prev, items: enrichedItems }));
        }
      } finally {
        if (!cancelled) setLoadingDevices(false);
      }
    };

    hydrateSerializedItems();
    return () => {
      cancelled = true;
    };
  }, [open, order]);

  const handleChange = (field, value) => {
    setEditableData((prev) => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (index, field, value) => {
    setEditableData((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const handleSerializedDeviceChange = (itemIndex, slotIndex, deviceId) => {
    setEditableData((prev) => ({
      ...prev,
      items: prev.items.map((item, currentIndex) => {
        if (currentIndex !== itemIndex) return item;
        const selectedDevice = item.availableDevices.find(
          (device) => String(device._id || device.deviceId) === String(deviceId)
        );
        const nextAssignments = Array.from({ length: Number(item.quantity) || 0 }, (_, index) => {
          if (index === slotIndex) {
            return selectedDevice
              ? {
                  deviceId: selectedDevice._id || selectedDevice.deviceId,
                  imei: selectedDevice.imei || "",
                  serialNumber: selectedDevice.serialNumber || "",
                }
              : null;
          }
          return item.deviceAssignments[index] || null;
        }).filter(Boolean);

        return {
          ...item,
          deviceAssignments: nextAssignments,
          imei: nextAssignments[0]?.imei || "",
          serialNumber: nextAssignments[0]?.serialNumber || "",
        };
      }),
    }));
  };

  const handleConfirm = async () => {
    const success = onConfirmPayment ? await onConfirmPayment(editableData) : true;
    if (success) setShowPreview(true);
  };

  const handlePrint = () => onPrint(editableData);

  if (showPreview) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[95vh] max-w-[95vw] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Xem trước hóa đơn</DialogTitle>
          </DialogHeader>
          <InvoiceTemplate order={order} editableData={editableData} storeInfo={{}} />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Quay lại chỉnh sửa
            </Button>
            <Button onClick={handlePrint}>In hóa đơn</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] max-w-[95vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa hóa đơn</DialogTitle>
          <DialogDescription>Mã đơn: #{editableData.orderNumber}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Tên khách hàng</Label>
              <Input value={editableData.customerName} readOnly className="bg-muted" />
            </div>
            <div>
              <Label>Số điện thoại</Label>
              <Input value={editableData.customerPhone} readOnly className="bg-muted" />
            </div>
          </div>

          <div>
            <Label>Địa chỉ</Label>
            <Textarea
              value={editableData.customerAddress}
              onChange={(e) => handleChange("customerAddress", e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-4">
            <Label className="text-lg font-bold">Danh sách sản phẩm</Label>
            {loadingDevices ? (
              <div className="rounded-lg border border-dashed py-10 text-center text-slate-500">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                <p className="mt-2 text-sm">Đang tải thiết bị khả dụng...</p>
              </div>
            ) : (
              editableData.items.map((item, index) => (
                <div key={index} className="space-y-3 rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="font-medium">{item.productName}</p>
                    <p className="text-xs text-slate-500">
                      {item.variantSku} • SL: {item.quantity}
                    </p>
                  </div>

                  {item.serializedTrackingEnabled &&
                  Array.isArray(item.availableDevices) &&
                  item.availableDevices.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {Array.from({ length: Number(item.quantity) || 0 }, (_, slotIndex) => {
                        const currentValue =
                          item.deviceAssignments?.[slotIndex]?.deviceId ||
                          item.deviceAssignments?.[slotIndex]?._id ||
                          "";
                        const selectedIds = (item.deviceAssignments || [])
                          .map((entry, entryIndex) =>
                            entryIndex === slotIndex ? null : String(entry.deviceId || entry._id || "")
                          )
                          .filter(Boolean);

                        return (
                          <div key={slotIndex} className="space-y-2">
                            <Label>Thiết bị #{slotIndex + 1}</Label>
                            <Select
                              value={String(currentValue)}
                              onValueChange={(value) =>
                                handleSerializedDeviceChange(index, slotIndex, value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Chọn IMEI / serial" />
                              </SelectTrigger>
                              <SelectContent>
                                {item.availableDevices
                                  .filter((device) => {
                                    const id = String(device._id || device.deviceId);
                                    return !selectedIds.includes(id) || id === String(currentValue);
                                  })
                                  .map((device) => (
                                    <SelectItem
                                      key={String(device._id || device.deviceId)}
                                      value={String(device._id || device.deviceId)}
                                    >
                                      {toIdentifierLabel(device)}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {item.serializedTrackingEnabled && (
                        <div className="md:col-span-3 rounded-lg border border-dashed border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
                          Chưa có thiết bị đã đăng ký trong kho. Vui lòng nhập IMEI/Serial để tạo phiếu bảo hành.
                        </div>
                      )}
                      <div>
                        <Label className="text-xs">IMEI</Label>
                        <Input
                          value={item.imei}
                          onChange={(e) => handleItemChange(index, "imei", e.target.value)}
                          placeholder="Nhập IMEI"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Serial</Label>
                        <Input
                          value={item.serialNumber || ""}
                          onChange={(e) =>
                            handleItemChange(index, "serialNumber", e.target.value)
                          }
                          placeholder="Nhập serial"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Đơn giá</Label>
                        <Input type="number" value={item.price} readOnly className="bg-muted" />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Tiền khách đưa</Label>
              <Input
                type="number"
                value={editableData.paymentReceived}
                readOnly
                className="bg-muted"
              />
            </div>
            <div>
              <Label>Tiền thối lại</Label>
              <Input
                type="number"
                value={Math.max(0, editableData.paymentReceived - editableData.totalAmount)}
                disabled
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading || loadingDevices}>
            {isLoading ? "Đang xử lý..." : "Xác nhận thanh toán và xem hóa đơn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditInvoiceDialog;
