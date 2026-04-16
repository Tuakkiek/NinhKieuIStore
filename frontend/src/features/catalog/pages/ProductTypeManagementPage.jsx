// ============================================
// FILE: frontend/src/pages/admin/ProductTypeManagementPage.jsx
// ✅ Responsive UI - Quản lý loại sản phẩm với specs động
// ============================================
// FILE: frontend/src/pages/admin/ProductTypeManagementPage.jsx
// ✅ Responsive UI - Quản lý loại sản phẩm với specs động
// ============================================

import React, { useState, useEffect } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { toast } from "sonner";
import { Plus, Search, Edit, Trash2, Package, Settings, X, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { productTypeAPI } from "../api/catalog.api";
import { useAuthStore } from "@/features/auth";
import { Loading } from "@/shared/ui/Loading";

const PRODUCT_TYPE_DELETE_BLOCKED_MESSAGE =
  "This product type cannot be deleted because it is currently in use by one or more products.";

const TRACKING_MODE_OPTIONS = ["NONE", "SERIALIZED"];
const IDENTIFIER_POLICY_OPTIONS = [
  "NONE",
  "IMEI",
  "SERIAL",
  "IMEI_OR_SERIAL",
  "IMEI_AND_SERIAL",
];

const ProductTypeManagementPage = () => {
  const { user } = useAuthStore();
  const [productTypes, setProductTypes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [currentMode, setCurrentMode] = useState(null);
  const [currentProductType, setCurrentProductType] = useState(null);
  const [expandedFields, setExpandedFields] = useState({});
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    icon: "",
    specFields: [],
    afterSalesDefaults: {
      trackingMode: "",
      identifierPolicy: "",
      warrantyMonths: 12,
      warrantyTerms: "",
    },
    status: "ACTIVE",
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState(null);

  useEffect(() => {
    fetchProductTypes();
  }, [searchQuery]);

  const fetchProductTypes = async () => {
    setIsLoading(true);
    try {
      const response = await productTypeAPI.getAll({ search: searchQuery });
      setProductTypes(response.data.data.productTypes || []);
    } catch (error) {
      console.error("❌ Fetch product types error:", error);
      toast.error("Lỗi tải danh sách loại sản phẩm");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setCurrentMode("create");
    setCurrentProductType(null);
    setFormData({
      name: "",
      description: "",
      icon: "",
      specFields: [
        {
          key: "colors",
          label: "Màu sắc",
          type: "text",
          required: false,
          options: [],
          placeholder: "VD: Black, White",
        },
      ],
      afterSalesDefaults: {
        trackingMode: "",
        identifierPolicy: "",
        warrantyMonths: 12,
        warrantyTerms: "",
      },
      status: "ACTIVE",
    });
    setExpandedFields({});
    setShowModal(true);
  };

  const handleEdit = (productType) => {
    setCurrentMode("edit");
    setCurrentProductType(productType);
    setFormData({
      name: productType.name || "",
      description: productType.description || "",
      icon: productType.icon || "",
      specFields: productType.specFields || [],
      afterSalesDefaults: {
        trackingMode: productType.afterSalesDefaults?.trackingMode || "",
        identifierPolicy:
          productType.afterSalesDefaults?.identifierPolicy || "",
        warrantyMonths: productType.afterSalesDefaults?.warrantyMonths ?? 12,
        warrantyTerms: productType.afterSalesDefaults?.warrantyTerms || "",
      },
      status: productType.status || "ACTIVE",
    });
    setExpandedFields({});
    setShowModal(true);
  };

  const handleDelete = (productType) => {
    const associatedProductsCount = Number(
      productType?.associatedProductsCount || 0
    );
    if (associatedProductsCount > 0) {
      toast.error(PRODUCT_TYPE_DELETE_BLOCKED_MESSAGE);
      return;
    }
    setTypeToDelete(productType);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!typeToDelete) return;

    try {
      await productTypeAPI.delete(typeToDelete._id);
      toast.success("Xóa loại sản phẩm thành công");
      fetchProductTypes();
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Xóa loại sản phẩm thất bại"
      );
    } finally {
      setShowDeleteDialog(false);
      setTypeToDelete(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      toast.error("Tên loại sản phẩm là bắt buộc");
      return;
    }
    const payload = {
      ...formData,
      afterSalesDefaults: {
        ...formData.afterSalesDefaults,
        trackingMode: formData.afterSalesDefaults?.trackingMode || null,
        identifierPolicy: formData.afterSalesDefaults?.identifierPolicy || null,
        warrantyMonths: Number(formData.afterSalesDefaults?.warrantyMonths) || 0,
      },
      createdBy: user._id,
    };
    try {
      if (currentMode === "create") {
        await productTypeAPI.create(payload);
        toast.success("Tạo loại sản phẩm thành công");
      } else {
        await productTypeAPI.update(currentProductType._id, payload);
        toast.success("Cập nhật loại sản phẩm thành công");
      }
      setShowModal(false);
      fetchProductTypes();
    } catch (error) {
      toast.error(error.response?.data?.message || "Lưu loại sản phẩm thất bại");
    }
  };

  const addSpecField = () => {
    const newIndex = formData.specFields.length;
    setFormData({
      ...formData,
      specFields: [
        ...formData.specFields,
        { key: "", label: "", type: "text", required: false, options: [], placeholder: "" },
      ],
    });
    setExpandedFields((prev) => ({ ...prev, [newIndex]: true }));
  };

  const removeSpecField = (index) => {
    setFormData({ ...formData, specFields: formData.specFields.filter((_, i) => i !== index) });
    setExpandedFields((prev) => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < index) next[ki] = v;
        else if (ki > index) next[ki - 1] = v;
      });
      return next;
    });
  };

  const updateSpecField = (index, field, value) => {
    const updated = [...formData.specFields];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, specFields: updated });
  };

  const updateSpecOptions = (index, optionsString) => {
    const updated = [...formData.specFields];
    updated[index].options = optionsString.split(",").map((s) => s.trim()).filter(Boolean);
    setFormData({ ...formData, specFields: updated });
  };

  const toggleField = (index) => {
    setExpandedFields((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-4 lg:p-6">
      {/* ─── HEADER ─── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold">Quản lý loại sản phẩm</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Định nghĩa loại sản phẩm và thông số kỹ thuật
          </p>
        </div>
        <Button onClick={handleCreate} className="w-full sm:w-auto shrink-0">
          <Plus className="w-4 h-4 mr-2" />
          <span>Thêm loại sản phẩm</span>
        </Button>
      </div>

      {/* ─── SEARCH ─── */}
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Tìm kiếm loại sản phẩm..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 w-full"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ─── LIST ─── */}
      {isLoading ? (
        <Loading />
      ) : productTypes.length === 0 ? (
        <div className="text-center py-16 border rounded-xl">
          <Package className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">
            {searchQuery ? "Không tìm thấy loại sản phẩm" : "Chưa có loại sản phẩm nào"}
          </p>
          {!searchQuery && (
            <Button variant="outline" size="sm" onClick={handleCreate} className="mt-4">
              <Plus className="w-4 h-4 mr-2" /> Tạo đầu tiên
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {productTypes.map((type) => {
            const count = Number(type.associatedProductsCount || 0);
            const blocked = count > 0;
            return (
              <div
                key={type._id}
                className="border rounded-xl p-4 hover:shadow-md transition-shadow bg-card flex flex-col gap-3"
              >
                {/* Card Header */}
                <div className="flex items-start gap-3">
                  {type.icon ? (
                    <img
                      src={type.icon}
                      alt={type.name}
                      className="w-11 h-11 object-contain rounded-lg shrink-0 border"
                    />
                  ) : (
                    <div className="w-11 h-11 bg-muted rounded-lg flex items-center justify-center shrink-0">
                      <Settings className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate leading-tight">{type.name}</h3>
                    <span
                      className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                        type.status === "ACTIVE"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {type.status === "ACTIVE" ? "Hoạt động" : "Không hoạt động"}
                    </span>
                  </div>
                </div>

                {/* Description */}
                {type.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 leading-snug">
                    {type.description}
                  </p>
                )}

                {/* Spec tags */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Thông số ({type.specFields?.length || 0})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {type.specFields?.slice(0, 4).map((field, idx) => (
                      <span
                        key={idx}
                        className="text-xs bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full"
                      >
                        {field.label}
                      </span>
                    ))}
                    {(type.specFields?.length || 0) > 4 && (
                      <span className="text-xs text-muted-foreground px-1 self-center">
                        +{type.specFields.length - 4}
                      </span>
                    )}
                  </div>
                </div>

                {/* Usage info */}
                <p className={`text-xs flex items-center gap-1 ${blocked ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {blocked && <AlertCircle className="w-3 h-3 shrink-0" />}
                  {blocked ? `Đang dùng bởi ${count} sản phẩm` : "Chưa có sản phẩm liên kết"}
                </p>

                {/* Actions */}
                <div className="flex gap-2 mt-auto pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(type)}
                    className="flex-1 h-8 text-xs"
                  >
                    <Edit className="w-3.5 h-3.5 mr-1.5" /> Sửa
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(type)}
                    disabled={blocked}
                    title={blocked ? PRODUCT_TYPE_DELETE_BLOCKED_MESSAGE : "Xóa loại sản phẩm"}
                    className="h-8 w-8 p-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── MODAL ─── */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[92dvh] overflow-y-auto p-4 sm:p-6 rounded-xl">
          <DialogHeader className="mb-1">
            <DialogTitle className="text-lg sm:text-xl">
              {currentMode === "create" ? "Thêm loại sản phẩm mới" : "Cập nhật loại sản phẩm"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Định nghĩa loại sản phẩm và các trường thông số kỹ thuật
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Basic info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">
                  Tên loại sản phẩm <span className="text-red-500">*</span>
                </Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="VD: Smartphone, Laptop, TV..."
                  required
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">URL Icon</Label>
                <Input
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="https://example.com/icon.png"
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-sm">Mô tả</Label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Mô tả ngắn về loại sản phẩm..."
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Trạng thái</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Hoạt động</SelectItem>
                    <SelectItem value="INACTIVE">Không hoạt động</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 border rounded-xl p-4 bg-slate-50/70">
              <div className="space-y-1.5">
                <Label className="text-sm">Chế độ theo dõi</Label>
                <Select
                  value={formData.afterSalesDefaults?.trackingMode || "NONE"}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      afterSalesDefaults: {
                        ...prev.afterSalesDefaults,
                        trackingMode: value,
                      },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACKING_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm"></Label>
                <Select
                  value={formData.afterSalesDefaults?.identifierPolicy || "NONE"}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      afterSalesDefaults: {
                        ...prev.afterSalesDefaults,
                        identifierPolicy: value,
                      },
                    }))
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IDENTIFIER_POLICY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Warranty months</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.afterSalesDefaults?.warrantyMonths ?? 12}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      afterSalesDefaults: {
                        ...prev.afterSalesDefaults,
                        warrantyMonths: e.target.value,
                      },
                    }))
                  }
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
                <Label className="text-sm">Warranty terms</Label>
                <textarea
                  value={formData.afterSalesDefaults?.warrantyTerms || ""}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      afterSalesDefaults: {
                        ...prev.afterSalesDefaults,
                        warrantyTerms: e.target.value,
                      },
                    }))
                  }
                  rows={3}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Điều khoản bảo hành mặc định cho nhóm sản phẩm này..."
                />
              </div>
            </div>

            {/* Spec Fields */}
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold">Thông số kỹ thuật</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formData.specFields.length} trường đã định nghĩa
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addSpecField} className="h-8 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Thêm trường
                </Button>
              </div>

              {formData.specFields.length === 0 && (
                <div className="text-center py-6 border-2 border-dashed rounded-lg text-muted-foreground text-sm">
                  Chưa có thông số nào. Nhấn <strong>Thêm trường</strong> để bắt đầu.
                </div>
              )}

              <div className="space-y-2">
                {formData.specFields.map((field, index) => {
                  const isExpanded = expandedFields[index] !== false;
                  const hasKey = field.key || field.label;
                  return (
                    <div key={index} className="border rounded-lg overflow-hidden bg-muted/30">
                      {/* Collapsed header */}
                      <div
                        className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-muted/60 transition-colors"
                        onClick={() => toggleField(index)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                            #{index + 1}
                          </span>
                          <span className="text-sm font-medium truncate">
                            {field.label || field.key || (
                              <span className="text-muted-foreground italic">Trường chưa đặt tên</span>
                            )}
                          </span>
                          {field.key && (
                            <span className="hidden sm:inline text-xs text-muted-foreground font-mono truncate">
                              [{field.key}]
                            </span>
                          )}
                          <span className="text-xs bg-background border px-1.5 py-0.5 rounded shrink-0">
                            {field.type}
                          </span>
                          {field.required && (
                            <span className="text-xs text-red-500 shrink-0">*</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeSpecField(index); }}
                            className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          }
                        </div>
                      </div>

                      {/* Expanded body */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t bg-background/60">
                          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                            {/* Key */}
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Key (code)</Label>
                              <Input
                                value={field.key}
                                onChange={(e) => updateSpecField(index, "key", e.target.value)}
                                placeholder="screenSize"
                                className="h-8 text-xs font-mono"
                              />
                            </div>
                            {/* Label */}
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Label</Label>
                              <Input
                                value={field.label}
                                onChange={(e) => updateSpecField(index, "label", e.target.value)}
                                placeholder="Kích thước màn hình"
                                className="h-8 text-xs"
                              />
                            </div>
                            {/* Type */}
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Kiểu dữ liệu</Label>
                              <Select
                                value={field.type}
                                onValueChange={(value) => updateSpecField(index, "type", value)}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="text">Text</SelectItem>
                                  <SelectItem value="number">Number</SelectItem>
                                  <SelectItem value="select">Select</SelectItem>
                                  <SelectItem value="textarea">Textarea</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {/* Placeholder */}
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Placeholder</Label>
                              <Input
                                value={field.placeholder}
                                onChange={(e) => updateSpecField(index, "placeholder", e.target.value)}
                                placeholder="VD: 6.7 inch"
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateSpecField(index, "required", e.target.checked)}
                                className="rounded"
                              />
                              <span className="text-xs text-muted-foreground">Bắt buộc nhập</span>
                            </label>

                            {field.type === "select" && (
                              <div className="flex-1 space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  Options (phân cách bằng dấu phẩy)
                                </Label>
                                <Input
                                  value={field.options.join(", ")}
                                  onChange={(e) => updateSpecOptions(index, e.target.value)}
                                  placeholder="128GB, 256GB, 512GB"
                                  className="h-8 text-xs"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowModal(false)}
                className="w-full sm:w-auto"
              >
                Hủy
              </Button>
              <Button type="submit" className="w-full sm:w-auto">
                {currentMode === "create" ? "Tạo mới" : "Cập nhật"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa loại sản phẩm</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa loại sản phẩm{" "}
              <strong>{typeToDelete?.name}</strong>?
              <br />
              <span className="text-red-600 font-medium">
                Hành động này không thể hoàn tác.
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

export default ProductTypeManagementPage;
