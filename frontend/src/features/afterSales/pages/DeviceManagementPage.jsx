import React, { useEffect, useMemo, useState } from "react";
import {
  Clock3,
  History,
  Loader2,
  Search,
  ShieldCheck,
  Smartphone,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { afterSalesAPI } from "../api/afterSales.api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

const INVENTORY_STATES = ["ALL", "IN_STOCK", "RESERVED", "SOLD", "RETURNED", "SCRAPPED"];
const SERVICE_STATES = ["ALL", "NONE", "UNDER_WARRANTY", "UNDER_REPAIR", "REPAIRED", "WARRANTY_VOID"];
const WARRANTY_STATUSES = ["ALL", "ACTIVE", "EXPIRED", "VOID", "REPLACED"];

const formatDate = (value, withTime = false) => {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("vi-VN", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" }).format(new Date(value));
};

const normalizePhone = (value) => String(value || "").replace(/\D+/g, "");

const buildEmptyUnits = (quantity) =>
  Array.from({ length: Math.max(0, Number(quantity) || 0) }).map(() => ({
    imei: "",
    serialNumber: "",
  }));

const isLikelyValidImei = (value) => {
  const digits = String(value || "").replace(/\s+/g, "");
  if (!digits) return false;
  return /^\d{15}$/.test(digits);
};

const DeviceManagementPage = () => {
  const [tab, setTab] = useState("devices");
  const [devices, setDevices] = useState([]);
  const [warranties, setWarranties] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [loadingWarranties, setLoadingWarranties] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deviceFilters, setDeviceFilters] = useState({
    identifier: "",
    variantSku: "",
    inventoryState: "ALL",
    serviceState: "ALL",
  });
  const [warrantyFilters, setWarrantyFilters] = useState({
    variantSku: "",
    status: "ALL",
  });
  const [serviceForm, setServiceForm] = useState({ serviceState: "NONE", notes: "" });
  const [warrantyForm, setWarrantyForm] = useState({ id: "", status: "ACTIVE", notes: "" });
  const [busy, setBusy] = useState(false);

  const [orderQuery, setOrderQuery] = useState("");
  const [eligibleOrders, setEligibleOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false);
  const [assignNotes, setAssignNotes] = useState("");
  const [orderAssignments, setOrderAssignments] = useState({});

  const selectedWarranty = useMemo(
    () => warranties.find((item) => String(item.deviceId) === String(selectedDevice?._id || "")) || null,
    [selectedDevice, warranties]
  );

  const stats = useMemo(
    () => ({
      totalDevices: devices.length,
      inStock: devices.filter((item) => item.inventoryState === "IN_STOCK").length,
      activeWarranty: warranties.filter((item) => item.status === "ACTIVE").length,
      totalWarranties: warranties.length,
    }),
    [devices, warranties]
  );

  const loadDevices = async () => {
    setLoadingDevices(true);
    try {
      const params = {};
      if (deviceFilters.identifier.trim()) params.identifier = deviceFilters.identifier.trim();
      if (deviceFilters.variantSku.trim()) params.variantSku = deviceFilters.variantSku.trim();
      if (deviceFilters.inventoryState !== "ALL") params.inventoryState = deviceFilters.inventoryState;
      if (deviceFilters.serviceState !== "ALL") params.serviceState = deviceFilters.serviceState;
      const res = await afterSalesAPI.listDevices(params);
      setDevices(res.data?.data?.devices || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tải danh sách thiết bị");
    } finally {
      setLoadingDevices(false);
    }
  };

  const loadWarranties = async () => {
    setLoadingWarranties(true);
    try {
      const params = {};
      if (warrantyFilters.variantSku.trim()) params.variantSku = warrantyFilters.variantSku.trim();
      if (warrantyFilters.status !== "ALL") params.status = warrantyFilters.status;
      const res = await afterSalesAPI.listWarranties(params);
      setWarranties(res.data?.data?.warranties || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tải hồ sơ bảo hành");
    } finally {
      setLoadingWarranties(false);
    }
  };

  const loadHistory = async (deviceId) => {
    if (!deviceId) {
      setHistory([]);
      return;
    }
    setLoadingHistory(true);
    try {
      const res = await afterSalesAPI.getDeviceHistory(deviceId);
      setHistory(res.data?.data?.history || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tải lịch sử thiết bị");
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, [deviceFilters.inventoryState, deviceFilters.serviceState]);

  useEffect(() => {
    loadWarranties();
  }, [warrantyFilters.status]);

  useEffect(() => {
    loadHistory(selectedDevice?._id);
    setServiceForm({
      serviceState: selectedDevice?.serviceState || "NONE",
      notes: "",
    });
  }, [selectedDevice]);

  useEffect(() => {
    setWarrantyForm({
      id: selectedWarranty?._id || "",
      status: selectedWarranty?.status || "ACTIVE",
      notes: "",
    });
  }, [selectedWarranty]);

  const loadEligibleOrders = async () => {
    setLoadingOrders(true);
    try {
      const q = String(orderQuery || "").trim();
      const params = {};
      if (q) {
        params.q = q;
        const phone = normalizePhone(q);
        if (phone.length >= 8) params.phone = phone;
      }
      const res = await afterSalesAPI.listEligibleOrdersForImeiAssignment(params);
      setEligibleOrders(res.data?.data?.orders || []);
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tải danh sách đơn đủ điều kiện");
    } finally {
      setLoadingOrders(false);
    }
  };

  const selectOrder = async (orderId) => {
    setLoadingOrderDetail(true);
    try {
      const res = await afterSalesAPI.getEligibleOrderForImeiAssignment(orderId);
      const order = res.data?.data?.order || null;
      setSelectedOrder(order);

      const initial = {};
      for (const item of order?.items || []) {
        if (!item.isSerialized) continue;
        initial[item.orderItemId] = {
          units: buildEmptyUnits(item.quantity),
        };
      }
      setOrderAssignments(initial);
      setAssignNotes("");
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể tải chi tiết đơn hàng");
    } finally {
      setLoadingOrderDetail(false);
    }
  };

  const updateUnitField = (orderItemId, index, field, value) => {
    setOrderAssignments((prev) => {
      const current = prev?.[orderItemId] || { units: [] };
      const nextUnits = [...(current.units || [])];
      if (!nextUnits[index]) nextUnits[index] = { imei: "", serialNumber: "" };
      nextUnits[index] = { ...nextUnits[index], [field]: value };
      return { ...prev, [orderItemId]: { ...current, units: nextUnits } };
    });
  };

  const handleAssignImei = async () => {
    if (!selectedOrder?.orderId) return toast.error("Vui lòng chọn đơn hàng");
    const serializedItems = (selectedOrder.items || []).filter((item) => item.isSerialized);
    if (!serializedItems.length) return toast.error("Đơn hàng này không có sản phẩm cần gán IMEI/Serial");

    const payloadAssignments = [];

    for (const item of serializedItems) {
      if (Number(item.existingAssignments || 0) > 0) {
        toast.error(`Sản phẩm ${item.productName || item.variantSku} đã có IMEI/Serial`);
        return;
      }

      const entry = orderAssignments?.[item.orderItemId];
      const units = Array.isArray(entry?.units) ? entry.units : [];
      if (units.length !== Number(item.quantity || 0)) {
        toast.error(`Số IMEI/Serial của ${item.productName || item.variantSku} phải bằng số lượng`);
        return;
      }

      for (let i = 0; i < units.length; i += 1) {
        const imei = String(units[i]?.imei || "").trim();
        const serialNumber = String(units[i]?.serialNumber || "").trim();
        if (!imei && !serialNumber) {
          toast.error(`Thiếu IMEI/Serial cho ${item.productName || item.variantSku} (dòng ${i + 1})`);
          return;
        }
        if (imei && !isLikelyValidImei(imei)) {
          toast.error(`IMEI không hợp lệ cho ${item.productName || item.variantSku} (dòng ${i + 1})`);
          return;
        }
        if (serialNumber && serialNumber.length < 4) {
          toast.error(`Serial quá ngắn cho ${item.productName || item.variantSku} (dòng ${i + 1})`);
          return;
        }
      }

      payloadAssignments.push({
        orderItemId: item.orderItemId,
        units: units.map((u) => ({
          imei: String(u.imei || "").trim(),
          serialNumber: String(u.serialNumber || "").trim(),
        })),
      });
    }

    setBusy(true);
    try {
      await afterSalesAPI.assignImeiToOrder({
        orderId: selectedOrder.orderId,
        assignments: payloadAssignments,
        notes: String(assignNotes || "").trim(),
      });
      toast.success("Đã gán IMEI/Serial và kích hoạt bảo hành");
      await selectOrder(selectedOrder.orderId);
      await loadWarranties();
      await loadDevices();
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể gán IMEI/Serial");
    } finally {
      setBusy(false);
    }
  };

  const handleServiceUpdate = async () => {
    if (!selectedDevice?._id) return toast.error("Chọn một thiết bị trước");
    setBusy(true);
    try {
      await afterSalesAPI.updateDeviceServiceState(selectedDevice._id, serviceForm);
      toast.success("Đã cập nhật trạng thái thiết bị");
      loadDevices();
      loadHistory(selectedDevice._id);
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể cập nhật trạng thái thiết bị");
    } finally {
      setBusy(false);
    }
  };

  const handleWarrantyUpdate = async () => {
    if (!warrantyForm.id) return toast.error("Thiết bị này chưa có hồ sơ bảo hành");
    setBusy(true);
    try {
      await afterSalesAPI.updateWarrantyStatus(warrantyForm.id, {
        status: warrantyForm.status,
        notes: warrantyForm.notes,
      });
      toast.success("Đã cập nhật hồ sơ bảo hành");
      loadWarranties();
      if (selectedDevice?._id) loadHistory(selectedDevice._id);
    } catch (error) {
      toast.error(error.response?.data?.message || "Không thể cập nhật bảo hành");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quản lý thiết bị & bảo hành</h1>
          <p className="mt-1 text-sm text-slate-500">
            Theo dõi IMEI/serial, vòng đời thiết bị và coverage sau bán.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Thiết bị</p><p className="text-2xl font-bold">{stats.totalDevices}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Trong kho</p><p className="text-2xl font-bold">{stats.inStock}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Hồ sơ BH</p><p className="text-2xl font-bold">{stats.totalWarranties}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">BH active</p><p className="text-2xl font-bold">{stats.activeWarranty}</p></CardContent></Card>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-[500px]">
          <TabsTrigger value="devices" className="gap-2"><Smartphone className="h-4 w-4" />Thiết bị</TabsTrigger>
          <TabsTrigger value="assign" className="gap-2"><Wrench className="h-4 w-4" />Gán IMEI theo đơn</TabsTrigger>
          <TabsTrigger value="warranties" className="gap-2"><ShieldCheck className="h-4 w-4" />Bảo hành</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Danh sách thiết bị</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Input value={deviceFilters.identifier} onChange={(e) => setDeviceFilters((p) => ({ ...p, identifier: e.target.value }))} placeholder="IMEI / Serial" />
                <Input value={deviceFilters.variantSku} onChange={(e) => setDeviceFilters((p) => ({ ...p, variantSku: e.target.value }))} placeholder="SKU" />
                <Select value={deviceFilters.inventoryState} onValueChange={(value) => setDeviceFilters((p) => ({ ...p, inventoryState: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INVENTORY_STATES.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={deviceFilters.serviceState} onValueChange={(value) => setDeviceFilters((p) => ({ ...p, serviceState: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SERVICE_STATES.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" onClick={loadDevices}>Làm mới</Button>
              </div>

              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Thiết bị</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Tồn kho</TableHead>
                      <TableHead>Hậu mãi</TableHead>
                      <TableHead>Vị trí</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingDevices ? (
                      <TableRow><TableCell colSpan={5} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></TableCell></TableRow>
                    ) : devices.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="py-10 text-center text-slate-500">Chưa có thiết bị phù hợp.</TableCell></TableRow>
                    ) : devices.map((device) => (
                      <TableRow key={device._id} className={`cursor-pointer ${selectedDevice?._id === device._id ? "bg-orange-50" : ""}`} onClick={() => setSelectedDevice(device)}>
                        <TableCell><div><p className="font-medium">{device.productName}</p><p className="font-mono text-xs text-slate-500">{device.imei || device.serialNumber || "N/A"}</p></div></TableCell>
                        <TableCell className="font-mono text-xs">{device.variantSku}</TableCell>
                        <TableCell>{device.inventoryState}</TableCell>
                        <TableCell>{device.serviceState}</TableCell>
                        <TableCell>{device.warehouseLocationCode || "N/A"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5 text-slate-500" />Chi tiết & cập nhật</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {!selectedDevice ? (
                  <div className="rounded-xl border border-dashed py-16 text-center text-slate-500">Chọn một thiết bị để xem chi tiết.</div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">IMEI</p><p className="mt-2 font-mono text-sm">{selectedDevice.imei || "N/A"}</p></div>
                      <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">Serial</p><p className="mt-2 font-mono text-sm">{selectedDevice.serialNumber || "N/A"}</p></div>
                      <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">Ngày nhập</p><p className="mt-2 text-sm">{formatDate(selectedDevice.receivedAt || selectedDevice.createdAt, true)}</p></div>
                      <div className="rounded-xl border bg-slate-50 p-4"><p className="text-xs text-slate-500">Khách hàng</p><p className="mt-2 text-sm">{selectedDevice.saleSnapshot?.customerName || "Chưa bán"}</p></div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Trạng thái hậu mãi</Label>
                        <Select value={serviceForm.serviceState} onValueChange={(value) => setServiceForm((p) => ({ ...p, serviceState: value }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{SERVICE_STATES.filter((state) => state !== "ALL").map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Ghi chú thiết bị</Label>
                        <Input value={serviceForm.notes} onChange={(e) => setServiceForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Ví dụ: Đang chờ kiểm tra" />
                      </div>
                    </div>
                    <Button onClick={handleServiceUpdate} disabled={busy}>Cập nhật trạng thái thiết bị</Button>

                    <div className="rounded-xl border bg-orange-50 p-4">
                      <p className="text-sm font-semibold">Hồ sơ bảo hành</p>
                      {selectedWarranty ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr_auto]">
                          <Select value={warrantyForm.status} onValueChange={(value) => setWarrantyForm((p) => ({ ...p, status: value }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{WARRANTY_STATUSES.filter((state) => state !== "ALL").map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input value={warrantyForm.notes} onChange={(e) => setWarrantyForm((p) => ({ ...p, notes: e.target.value }))} placeholder={`Hết hạn: ${formatDate(selectedWarranty.expiresAt)}`} />
                          <Button variant="outline" onClick={handleWarrantyUpdate} disabled={busy}>Lưu</Button>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">Thiết bị này chưa có hồ sơ bảo hành.</p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-slate-500" />Lịch sử vòng đời</CardTitle></CardHeader>
              <CardContent>
                {loadingHistory ? (
                  <div className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
                ) : history.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-16 text-center text-slate-500">Chưa có lịch sử cho thiết bị đang chọn.</div>
                ) : (
                  <div className="space-y-4">
                    {history.map((entry) => (
                      <div key={entry._id} className="flex gap-3 rounded-xl border p-4">
                        <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Clock3 className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <p className="font-medium">{entry.eventType}</p>
                          <p className="mt-1 text-sm text-slate-500">{entry.actorName || "System"} • {formatDate(entry.createdAt, true)}</p>
                          <p className="mt-2 text-sm text-slate-700">{entry.fromInventoryState || "N/A"} → {entry.toInventoryState || "N/A"}</p>
                          {entry.note ? <p className="mt-2 text-sm text-slate-600">{entry.note}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="assign" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Gán IMEI/Serial theo đơn hàng</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={orderQuery}
                    onChange={(e) => setOrderQuery(e.target.value)}
                    className="pl-10"
                    placeholder="Tìm theo SĐT hoặc Order ID / Order Number"
                  />
                </div>
                <Button variant="outline" onClick={loadEligibleOrders} disabled={loadingOrders}>
                  {loadingOrders ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tìm đơn"}
                </Button>
              </div>

              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã đơn</TableHead>
                      <TableHead>Khách</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-right">Chọn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingOrders ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                        </TableCell>
                      </TableRow>
                    ) : eligibleOrders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-slate-500">
                          Chưa có đơn phù hợp (IN_STORE: đã thanh toán & hoàn tất, ONLINE: sẵn sàng giao).
                        </TableCell>
                      </TableRow>
                    ) : (
                      eligibleOrders.map((order) => (
                        <TableRow key={order.orderId} className={selectedOrder?.orderId === order.orderId ? "bg-orange-50" : ""}>
                          <TableCell className="font-mono text-xs">{order.orderNumber || order.orderId}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{order.customerName || "N/A"}</p>
                              <p className="text-xs text-slate-500">{order.customerPhone || "N/A"}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm">{order.status}</p>
                            <p className="text-xs text-slate-500">{order.paymentStatus}</p>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" onClick={() => selectOrder(order.orderId)} disabled={loadingOrderDetail}>
                              Chọn
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chi tiết đơn & nhập IMEI</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {!selectedOrder ? (
                <div className="rounded-xl border border-dashed py-16 text-center text-slate-500">
                  Chọn một đơn hàng ở danh sách bên trên để bắt đầu gán IMEI/Serial.
                </div>
              ) : loadingOrderDetail ? (
                <div className="py-16 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border bg-slate-50 p-4">
                      <p className="text-xs text-slate-500">Đơn</p>
                      <p className="mt-2 font-mono text-sm">{selectedOrder.orderNumber || selectedOrder.orderId}</p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-4">
                      <p className="text-xs text-slate-500">Khách</p>
                      <p className="mt-2 text-sm">{selectedOrder.customerName || "N/A"}</p>
                      <p className="text-xs text-slate-500">{selectedOrder.customerPhone || "N/A"}</p>
                    </div>
                    <div className="rounded-xl border bg-slate-50 p-4">
                      <p className="text-xs text-slate-500">Trạng thái</p>
                      <p className="mt-2 text-sm">{selectedOrder.status}</p>
                      <p className="text-xs text-slate-500">{selectedOrder.paymentStatus}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Ghi chú (tuỳ chọn)</Label>
                    <Input value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} placeholder="Ví dụ: Gán IMEI trước khi bàn giao/đóng gói" />
                  </div>

                  <div className="space-y-4">
                    {(selectedOrder.items || []).map((item) => {
                      const isSerialized = Boolean(item.isSerialized);
                      const disabled = Number(item.existingAssignments || 0) > 0;
                      const entry = orderAssignments?.[item.orderItemId] || { units: buildEmptyUnits(item.quantity) };
                      const units = Array.isArray(entry.units) ? entry.units : buildEmptyUnits(item.quantity);

                      return (
                        <div key={item.orderItemId} className="rounded-xl border p-4">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="font-semibold">{item.productName || item.variantSku}</p>
                              <p className="text-xs text-slate-500">
                                SKU: <span className="font-mono">{item.variantSku || "N/A"}</span> • SL: {item.quantity}
                                {item.identifierPolicy ? ` • Policy: ${item.identifierPolicy}` : ""}
                              </p>
                            </div>
                            {!isSerialized ? (
                              <p className="text-xs text-slate-500">Không yêu cầu IMEI/Serial</p>
                            ) : disabled ? (
                              <p className="text-xs text-slate-500">Đã gán ({item.existingAssignments})</p>
                            ) : (
                              <p className="text-xs text-slate-500">Cần gán IMEI/Serial</p>
                            )}
                          </div>

                          {isSerialized ? (
                            <div className="mt-4 grid gap-3">
                              {units.map((unit, idx) => (
                                <div key={`${item.orderItemId}-${idx}`} className="grid gap-3 md:grid-cols-2">
                                  <Input
                                    value={unit.imei || ""}
                                    onChange={(e) => updateUnitField(item.orderItemId, idx, "imei", e.target.value)}
                                    placeholder={`IMEI ${idx + 1} (15 số)`}
                                    disabled={disabled || busy}
                                  />
                                  <Input
                                    value={unit.serialNumber || ""}
                                    onChange={(e) => updateUnitField(item.orderItemId, idx, "serialNumber", e.target.value)}
                                    placeholder={`Serial ${idx + 1} (tuỳ chọn nếu policy cho phép)`}
                                    disabled={disabled || busy}
                                  />
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <Button onClick={handleAssignImei} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Xác nhận gán IMEI & kích hoạt bảo hành"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warranties">
          <Card>
            <CardHeader><CardTitle>Danh sách hồ sơ bảo hành</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Input value={warrantyFilters.variantSku} onChange={(e) => setWarrantyFilters((p) => ({ ...p, variantSku: e.target.value }))} placeholder="Lọc theo SKU" />
                <Select value={warrantyFilters.status} onValueChange={(value) => setWarrantyFilters((p) => ({ ...p, status: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{WARRANTY_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" onClick={loadWarranties}>Làm mới</Button>
              </div>

              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Định danh</TableHead>
                      <TableHead>Hết hạn</TableHead>
                      <TableHead>Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingWarranties ? (
                      <TableRow><TableCell colSpan={4} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></TableCell></TableRow>
                    ) : warranties.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="py-10 text-center text-slate-500">Chưa có hồ sơ bảo hành phù hợp.</TableCell></TableRow>
                    ) : warranties.map((item) => (
                      <TableRow key={item._id}>
                        <TableCell><div><p className="font-medium">{item.productName}</p><p className="font-mono text-xs text-slate-500">{item.variantSku}</p></div></TableCell>
                        <TableCell className="font-mono text-xs">{item.imei || item.serialNumber || "N/A"}</TableCell>
                        <TableCell>{formatDate(item.expiresAt)}</TableCell>
                        <TableCell>{item.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DeviceManagementPage;
