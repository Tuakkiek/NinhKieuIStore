// frontend/src/pages/customer/OrderDetailPage.jsx
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Loading } from "@/shared/ui/Loading";
import {
  Dialog,
  DialogContent,
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
import {
  ArrowLeft,
  MapPin,
  CreditCard,
  Package,
  XCircle,
  RotateCcw,
  Download,
  CheckCircle2,
  Printer,
  Copy,
  RefreshCw,
} from "lucide-react";

import { orderAPI } from "../api/orders.api";
import {
  formatPrice,
  formatDate,
  getStatusColor,
  getStatusText,
} from "@/shared/lib/utils";
import { getInterFontStylesheetTag, getPrimaryFontStack } from "@/shared/lib/typography";
import { toast } from "sonner";
import { InvoiceTemplate } from "@/features/pos";

const PlaceholderImg = "https://via.placeholder.com/80?text=No+Image";
const VNPAY_PENDING_KEY = "pending_vnpay_order";
const SEPAY_PENDING_KEY = "pending_sepay_order";

const OrderDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  // =============== STATES ===============
  const [order, setOrder] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCancellingVNPay, setIsCancellingVNPay] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showCancelVNPayDialog, setShowCancelVNPayDialog] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);

  const invoiceRef = useRef();

  // =============== FETCH ORDER ===============
  useEffect(() => {
    fetchOrder();
  }, [id]);

  const fetchOrder = async () => {
    setIsLoading(true);
    try {
      const response = await orderAPI.getById(id);
      setOrder(response?.data?.order || response?.data?.data?.order || null);
    } catch (error) {
      console.error("Lỗi tải đơn hàng:", error);
      toast.error("Không thể tải thông tin đơn hàng");
    } finally {
      setIsLoading(false);
    }
  };

  // =============== DERIVED VALUES (SAU KHI CÓ ORDER) ===============
  const isCancelled = order?.status === "CANCELLED";
  const isReturned = order?.status === "RETURNED";
  const isClickAndCollect = order?.fulfillmentType === "CLICK_AND_COLLECT";
  const isPaymentVerified =
    order?.paymentStatus === "PAID" &&
    ["VNPAY", "BANK_TRANSFER"].includes(order?.paymentMethod);

  const canExportInvoice =
    order?.paymentStatus === "PAID" && order?.orderSource === "ONLINE";

  const isPendingVNPayOrder =
    order?.paymentMethod === "VNPAY" &&
    order?.status === "PENDING_PAYMENT" &&
    !order?.paymentInfo?.vnpayVerified;

  const isPendingSepayOrder =
    order?.paymentMethod === "BANK_TRANSFER" &&
    order?.status === "PENDING_PAYMENT" &&
    order?.paymentStatus !== "PAID";

  const isPendingDeferredPayment = isPendingVNPayOrder || isPendingSepayOrder;

  // =============== COUNTDOWN 15 PHÚT CHO VNPAY ===============
  useEffect(() => {
    if (!isPendingDeferredPayment) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const fallbackExpiresAt = new Date(order?.createdAt || now).getTime() + 15 * 60 * 1000;
      const sepayExpiresAt = order?.paymentInfo?.sepayExpiresAt
        ? new Date(order.paymentInfo.sepayExpiresAt).getTime()
        : fallbackExpiresAt;
      const targetExpiresAt = isPendingSepayOrder ? sepayExpiresAt : fallbackExpiresAt;
      const remainingMs = targetExpiresAt - now;

      if (remainingMs <= 0) {
        setTimeRemaining("Đã hết hạn");
        fetchOrder();
        return;
      }

      const minutes = Math.floor(remainingMs / 60000);
      const seconds = Math.floor((remainingMs % 60000) / 1000);
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [
    isPendingDeferredPayment,
    isPendingSepayOrder,
    order?.createdAt,
    order?.paymentInfo?.sepayExpiresAt,
  ]);

  useEffect(() => {
    if (!order?._id) {
      return;
    }

    if (order.paymentMethod === "VNPAY") {
      const pending = localStorage.getItem(VNPAY_PENDING_KEY);
      if (pending) {
        try {
          const data = JSON.parse(pending);
          if (
            data.orderId === String(order._id) &&
            (order.paymentStatus === "PAID" || order.status === "CANCELLED")
          ) {
            localStorage.removeItem(VNPAY_PENDING_KEY);
          }
        } catch {
          localStorage.removeItem(VNPAY_PENDING_KEY);
        }
      }
    }

    if (order.paymentMethod === "BANK_TRANSFER") {
      const pending = localStorage.getItem(SEPAY_PENDING_KEY);
      if (pending) {
        try {
          const data = JSON.parse(pending);
          if (
            data.orderId === String(order._id) &&
            (order.paymentStatus === "PAID" || order.status === "CANCELLED")
          ) {
            localStorage.removeItem(SEPAY_PENDING_KEY);
          }
        } catch {
          localStorage.removeItem(SEPAY_PENDING_KEY);
        }
      }
    }
  }, [order?._id, order?.paymentMethod, order?.paymentStatus, order?.status]);

  // =============== HANDLERS ===============
  const handleCancelOrder = () => setShowCancelDialog(true);

  const handleConfirmCancel = async () => {
    setShowCancelDialog(false);
    setIsCancelling(true);
    try {
      await orderAPI.cancel(id);
      await fetchOrder();
      toast.success("Đã hủy đơn hàng thành công");
    } catch (error) {
      toast.error(error.response?.data?.message || "Hủy đơn hàng thất bại");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCancelVNPayOrder = () => setShowCancelVNPayDialog(true);

  const handleConfirmCancelVNPay = async () => {
    setShowCancelVNPayDialog(false);
    setIsCancellingVNPay(true);

    try {
      const isSepay = order?.paymentMethod === "BANK_TRANSFER";
      await orderAPI.cancel(id, {
        reason: isSepay
          ? "Khách hàng hủy đơn Chuyển khoản (SePay) chưa thanh toán"
          : "Khách hàng hủy đơn VNPay chưa thanh toán",
      });

      try {
        const pendingVnpay = localStorage.getItem(VNPAY_PENDING_KEY);
        if (pendingVnpay) {
          const data = JSON.parse(pendingVnpay);
          if (data.orderId === id) {
            localStorage.removeItem(VNPAY_PENDING_KEY);
          }
        }
      } catch {
        localStorage.removeItem(VNPAY_PENDING_KEY);
      }

      try {
        const pendingSepay = localStorage.getItem(SEPAY_PENDING_KEY);
        if (pendingSepay) {
          const data = JSON.parse(pendingSepay);
          if (data.orderId === id) {
            localStorage.removeItem(SEPAY_PENDING_KEY);
          }
        }
      } catch {
        localStorage.removeItem(SEPAY_PENDING_KEY);
      }

      await fetchOrder();
      toast.success(
        isSepay
          ? "Đã hủy đơn hàng Chuyển khoản (SePay) thành công"
          : "Đã hủy đơn hàng VNPay thành công"
      );

      setTimeout(() => navigate("/cart"), 2000);
    } catch (error) {
      toast.error(error.response?.data?.message || "Hủy đơn thất bại");
    } finally {
      setIsCancellingVNPay(false);
    }
  };

  const handlePrint = () => {
    const printContent = invoiceRef.current;
    const primaryFontStack = getPrimaryFontStack();
    const win = window.open("", "", "width=900,height=650");
    win.document.write("<html><head><title>Invoice</title>");
    win.document.write(getInterFontStylesheetTag());
    win.document.write(
      `<style>:root{--font-primary:${primaryFontStack};}body{font-family:var(--font-primary); padding:20px;}</style>`
    );
    win.document.write("</head><body>");
    win.document.write(print.innerHTML);
    win.document.write("</body></html>");
    win.document.close();
    win.focus();
    win.print();
    win.close();
    toast.success("Đã gửi lệnh in");
  };

  const handleExportInvoice = () => setShowInvoiceDialog(true);

  const handleCopySepayContent = async () => {
    const orderCode = String(order?.paymentInfo?.sepayOrderCode || "").trim();
    if (!orderCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(orderCode);
      toast.success("Đã sao chép nội dung chuyển khoản");
    } catch {
      toast.error("Không thể sao chép nội dung");
    }
  };

  const handleRefreshPaymentStatus = async () => {
    await fetchOrder();
    toast.info("Đã làm mới trạng thái thanh toán");
  };

  // =============== EARLY RETURNS ===============
  if (isLoading) return <Loading />;

  if (!order) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-lg">Không tìm thấy đơn hàng</p>
        <Button onClick={() => navigate("/profile")} className="mt-4">
          Quay lại trang cá nhân
        </Button>
      </div>
    );
  }

  // =============== HELPER FUNCTIONS ===============
  const getImageUrl = (path) => {
    if (!path) return "https://via.placeholder.com/100?text=No+Image";
    if (path.startsWith("http")) return path;
    const baseUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/api\/?$/, "");
    return `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  };

  const getVariantLabel = (item) => {
    const parts = [];
    if (item.variantColor) parts.push(item.variantColor);
    if (item.variantStorage) parts.push(item.variantStorage);
    if (item.variantName) parts.push(item.variantName);
    if (item.variantConnectivity) parts.push(item.variantConnectivity);
    if (item.variantCpuGpu) parts.push(item.variantCpuGpu);
    if (item.variantRam) parts.push(item.variantRam);
    return parts.length > 0 ? parts.join(" • ") : null;
  };

  const invoiceData = {
    customerName: order.shippingAddress?.fullName || "",
    customerPhone: order.shippingAddress?.phoneNumber || "",
    customerAddress: `${order.shippingAddress?.detailAddress || ""}, ${
      order.shippingAddress?.ward || ""
    }, ${order.shippingAddress?.province || ""}`,
    items: order.items.map((i) => ({ ...i, imei: i.imei || "N/A" })),
    totalAmount: order.totalAmount,
    paymentReceived: order.totalAmount,
    changeGiven: 0,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    staffName: "Hệ thống Online",
    cashierName:
      order.paymentMethod === "VNPAY"
        ? "VNPay"
        : order.paymentMethod === "BANK_TRANSFER"
        ? "Chuyển khoản (SePay)"
        : "COD",
  };

  // =============== RENDER ===============
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-6">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Quay lại
      </Button>

      {/* Thanh toán VNPay thành công */}
      {isPaymentVerified && !isCancelled && !isReturned && (
        <div className="mb-6 rounded-lg border-2 border-green-200 bg-green-50 p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <div>
              <h3 className="font-bold text-green-900 text-lg">
                Thanh toán thành công!
              </h3>
              <p className="text-sm text-green-700 mt-1">
                Đơn hàng đã được thanh toán qua{" "}
                {order.paymentMethod === "BANK_TRANSFER"
                  ? "Chuyển khoản (SePay)"
                  : "VNPay"}.
                Chúng tôi sẽ xử lý giao hàng sớm nhất.
              </p>
              {(order.paymentInfo?.vnpayTransactionNo ||
                order.paymentInfo?.sepayTransactionId) && (
                <p className="text-sm font-mono mt-2 text-gray-700">
                  Mã GD:{" "}
                  {order.paymentInfo.vnpayTransactionNo ||
                    order.paymentInfo.sepayTransactionId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Đơn bị hủy hoặc hoàn trả */}
      {(isCancelled || isReturned) && (
        <div
          className={`mb-6 rounded-lg border-2 p-6 ${
            isCancelled
              ? "bg-red-50 border-red-200"
              : "bg-orange-50 border-orange-200"
          }`}
        >
          <div className="flex items-center gap-4">
            {isCancelled ? (
              <XCircle className="w-10 h-10 text-red-600" />
            ) : (
              <RotateCcw className="w-10 h-10 text-orange-600" />
            )}
            <div>
              <h3 className="font-bold text-lg">
                {isCancelled
                  ? "Đơn hàng đã bị hủy"
                  : "Đơn hàng đã được hoàn trả"}
              </h3>
              <p className="text-sm mt-1">
                {isCancelled
                  ? "Không thể khôi phục đơn hàng này."
                  : "Sản phẩm đã được hoàn lại kho."}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* CỘT TRÁI - CHI TIẾT */}
        <div className="lg:col-span-2 space-y-6">
          {/* Thông tin đơn */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>Đơn hàng #{order.orderNumber}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatDate(order.createdAt)}
                  </p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p className="text-muted-foreground">
                      Hình thức nhận:{" "}
                      <span className="font-medium text-foreground">
                        {getStatusText(order.fulfillmentType || "HOME_DELIVERY")}
                      </span>
                    </p>
                    {order.assignedStore?.storeName && (
                      <p className="text-muted-foreground">
                        Cửa hàng xử lý:{" "}
                        <span className="font-medium text-foreground">
                          {order.assignedStore.storeName}
                        </span>
                      </p>
                    )}
                    {order.pickupInfo?.pickupCode && (
                      <p className="text-muted-foreground">
                        Mã nhận hàng:{" "}
                        <span className="font-semibold text-foreground">
                          {order.pickupInfo.pickupCode}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
                <Badge className={getStatusColor(order.status)}>
                  {getStatusText(order.status)}
                </Badge>
              </div>
            </CardHeader>
          </Card>

          {/* Danh sách sản phẩm */}
          <Card>
            <CardHeader>
              <CardTitle>Sản phẩm</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.items.map((item, idx) => {
                const img = item.images?.[0]
                  ? getImageUrl(item.images[0])
                  : PlaceholderImg;
                const label = getVariantLabel(item);
                return (
                  <div
                    key={item._id || idx}
                    className="flex gap-4 pb-4 border-b last:border-0"
                  >
                    <img
                      src={img}
                      alt={item.productName}
                      className="w-20 h-20 object-cover rounded bg-gray-100"
                      onError={(e) => (e.target.src = PlaceholderImg)}
                    />
                    <div className="flex-1">
                      <p className="font-medium">{item.productName}</p>
                      {label && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {label}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        SL: {item.quantity} × {formatPrice(item.price)}
                      </p>
                    </div>
                    <p className="font-medium text-right">
                      {formatPrice(item.total || item.price * item.quantity)}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Thông tin nhận hàng */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <MapPin className="w-5 h-5 mr-2" />
                {isClickAndCollect
                  ? "Thông tin nhận tại cửa hàng"
                  : "Địa chỉ giao hàng"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-2">
                Hình thức nhận:{" "}
                <span className="font-medium text-foreground">
                  {getStatusText(order.fulfillmentType || "HOME_DELIVERY")}
                </span>
              </p>

              {isClickAndCollect ? (
                <div className="space-y-1">
                  <p className="font-medium">
                    {order.assignedStore?.storeName || "Chưa gán cửa hàng"}
                  </p>
                  {order.assignedStore?.storePhone && (
                    <p className="text-sm text-muted-foreground">
                      {order.assignedStore.storePhone}
                    </p>
                  )}
                  {order.assignedStore?.storeAddress && (
                    <p className="text-sm text-muted-foreground">
                      {order.assignedStore.storeAddress}
                    </p>
                  )}
                  {order.pickupInfo?.pickupCode && (
                    <p className="text-sm text-primary font-semibold">
                      Mã nhận hàng: {order.pickupInfo.pickupCode}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="font-medium">
                    {order.shippingAddress?.fullName || "N/A"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {order.shippingAddress?.phoneNumber || "N/A"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {order.shippingAddress?.detailAddress || ""},{" "}
                    {order.shippingAddress?.ward || ""},{" "}
                    {order.shippingAddress?.province || ""}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phương thức thanh toán */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <CreditCard className="w-5 h-5 mr-2" />
                Phương thức thanh toán
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>{getStatusText(order.paymentMethod)}</p>
              {order.paymentMethod === "VNPAY" &&
                order.paymentInfo?.vnpayBankCode && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Ngân hàng: {order.paymentInfo.vnpayBankCode}
                  </p>
                )}
              {order.paymentMethod === "BANK_TRANSFER" &&
                order.paymentInfo?.sepayOrderCode && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    <p>Nội dung CK: {order.paymentInfo.sepayOrderCode}</p>
                    {order.paymentInfo?.sepayTransactionId && (
                      <p>Mã GD: {order.paymentInfo.sepayTransactionId}</p>
                    )}
                  </div>
                )}
            </CardContent>
          </Card>
        </div>

        {/* CỘT PHẢI - TỔNG TIỀN & NÚT HÀNH ĐỘNG */}
        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle>Tổng quan đơn hàng</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tạm tính</span>
                  <span>{formatPrice(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Phí ship</span>
                  <span
                    className={order.shippingFee === 0 ? "text-green-600" : ""}
                  >
                    {order.shippingFee === 0
                      ? "Miễn phí"
                      : formatPrice(order.shippingFee)}
                  </span>
                </div>
                {(order.promotionDiscount > 0 || order.discount > 0) && (
                  <div className="flex justify-between text-sm text-green-600 font-medium">
                    <span>
                      {order.promotionDiscount > 0 || order.appliedPromotion?.code
                        ? `Khuyến mãi ${order.appliedPromotion?.code ? `(${order.appliedPromotion.code})` : ""}`
                        : "Giảm giá"}
                    </span>
                    <span>
                      -{formatPrice(order.promotionDiscount || order.discount)}
                    </span>
                  </div>
                )}

                <div className="border-t pt-3">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Tổng cộng</span>
                    <span className="text-primary">
                      {formatPrice(order.totalAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Nút xuất hóa đơn */}
              {canExportInvoice && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleExportInvoice}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Xuất hóa đơn
                </Button>
              )}

              {/* Nút hủy đơn COD */}
              {order.status === "PENDING" &&
                order.paymentMethod === "COD" && (
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={handleCancelOrder}
                    disabled={isCancelling}
                  >
                    {isCancelling ? "Đang hủy..." : "Hủy đơn hàng"}
                  </Button>
                )}

              {/* Thông báo + nút hủy cho VNPay chưa thanh toán */}
              {isPendingDeferredPayment && (
                <div className="space-y-3">
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm">
                    <p className="font-medium text-orange-900">
                      Chờ thanh toán{" "}
                      {isPendingSepayOrder ? "Chuyển khoản (SePay)" : "VNPay"}
                    </p>
                    <p className="text-orange-700 mt-1">
                      Còn lại:{" "}
                      <span className="font-mono font-bold">
                        {timeRemaining || "..."}
                      </span>
                    </p>
                    <p className="text-xs text-orange-600 mt-1">
                      Đơn sẽ tự hủy nếu quá hạn
                    </p>
                  </div>

                  {isPendingSepayOrder && order.paymentInfo?.sepayQrUrl && (
                    <div className="rounded-lg border p-3">
                      <img
                        src={order.paymentInfo.sepayQrUrl}
                        alt="QR Chuyển khoản (SePay)"
                        className="mx-auto h-52 w-52 object-contain"
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Nội dung chuyển khoản: {order.paymentInfo?.sepayOrderCode}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="outline" onClick={handleCopySepayContent}>
                          <Copy className="w-4 h-4 mr-2" />
                          Copy
                        </Button>
                        <Button onClick={handleRefreshPaymentStatus}>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Làm mới
                        </Button>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={handleCancelVNPayOrder}
                    disabled={isCancellingVNPay}
                  >
                    {isCancellingVNPay ? "Đang hủy..." : "Hủy đơn hàng"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog in hóa đơn */}
      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hóa đơn #{order.orderNumber}</DialogTitle>
          </DialogHeader>
          <div ref={invoiceRef}>
            <InvoiceTemplate
              order={order}
              editableData={invoiceData}
              storeInfo={{}}
            />
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowInvoiceDialog(false)}
            >
              Đóng
            </Button>
            <Button onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" />
              In
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* AlertDialog hủy đơn thường */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận hủy đơn</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn hủy đơn hàng này?
              <br />
              <span className="text-red-600 font-medium">
                Hành động này không thể hoàn tác.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-red-600 hover:bg-red-700"
            >
              Xác nhận hủy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog hủy đơn VNPay */}
      <AlertDialog
        open={showCancelVNPayDialog}
        onOpenChange={setShowCancelVNPayDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hủy đơn chờ thanh toán online</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn sắp hủy đơn chờ thanh toán{" "}
              {isPendingSepayOrder ? "Chuyển khoản (SePay)" : "VNPay"}.
              <br />
              <span className="text-orange-600 font-medium">
                • Sản phẩm sẽ được giữ trong giỏ hàng
                <br />• Bạn có thể đặt lại bất kỳ lúc nào
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Giữ đơn</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancelVNPay}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Xác nhận hủy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OrderDetailPage;
