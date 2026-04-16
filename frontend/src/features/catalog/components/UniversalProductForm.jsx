// ============================================
// FILE: frontend/src/components/shared/UniversalProductForm.jsx
// ✅ Form tổng quát cho TẤT CẢ sản phẩm - SIÊU ĐỘN GIẢN
// ============================================

import React, { useState, useEffect } from "react";
import { Button } from "@/shared/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { brandAPI, productTypeAPI, universalProductAPI } from "../api/catalog.api";
import { useAuthStore, usePermission } from "@/features/auth";

const INSTALLMENT_BADGE_OPTIONS = [
  { value: "NONE", label: "Không hiển thị" },
  { value: "Trả góp 0%", label: "Trả góp 0%" },
  { value: "Trả góp 0%, trả trước 0đ", label: "Trả góp 0%, trả trước 0đ" },
];

const TRACKING_MODE_OPTIONS = [
  { value: "NONE", label: "Không (Quản lý số lượng)" },
  { value: "SERIALIZED", label: "Theo Serial/IMEI (Từng máy)" },
];

const IDENTIFIER_POLICY_OPTIONS = [
  { value: "NONE", label: "Không" },
  { value: "IMEI", label: "IMEI" },
  { value: "SERIAL", label: "Serial Number" },
  { value: "IMEI_OR_SERIAL", label: "IMEI hoặc Serial" },
  { value: "IMEI_AND_SERIAL", label: "Cả IMEI và Serial" },
];

const UniversalProductForm = ({
  open,
  onOpenChange,
  mode = "edit",
  product,
  onSave = () => {},
}) => {
  const { user } = useAuthStore();
  const isEdit = mode === "edit";
  const canEditInventory = usePermission("inventory.write");
  const canEditVariantStock = isEdit && canEditInventory;
  const [activeTab, setActiveTab] = useState("basic");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // DROPDOWN DATA
  const [brands, setBrands] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [selectedProductType, setSelectedProductType] = useState(null);

  // FORM DATA
  const [formData, setFormData] = useState({
    name: "",
    model: "",
    brand: "",
    productType: "",
    condition: "NEW",
    status: "COMING_SOON",
    installmentBadge: "NONE",
    description: "",
    featuredImages: [""],
    videoUrl: "",
    afterSalesConfig: {
      trackingMode: "",
      identifierPolicy: "",
      warrantyMonths: "",
      warrantyTerms: "",
    },
    specifications: {},
    variants: [
      {
        color: "",
        images: [""],
        options: [
          {
            variantName: "",
            basePrice: "",
          },
        ],
      },
    ],
  });

  // LOAD BRANDS & PRODUCT TYPES
  useEffect(() => {
    if (open) {
      loadBrandsAndTypes();
    }
  }, [open]);

  const loadBrandsAndTypes = async () => {
    try {
      const [brandsRes, typesRes] = await Promise.all([
        brandAPI.getAll({ status: "ACTIVE", limit: 100 }),
        productTypeAPI.getAll({ status: "ACTIVE", limit: 100 }),
      ]);

      setBrands(brandsRes.data.data.brands || []);
      setProductTypes(typesRes.data.data.productTypes || []);

      console.log("✅ Loaded brands:", brandsRes.data.data.brands.length);
      console.log("✅ Loaded product types:", typesRes.data.data.productTypes.length);
    } catch (error) {
      console.error("❌ Load brands/types error:", error);
      toast.error("Lỗi tải dữ liệu");
    }
  };

  // LOAD PRODUCT DATA (EDIT MODE)
  useEffect(() => {
    if (open && isEdit && product) {
      console.log("📝 Loading product for edit:", product);

      // Parse variants
      const colorGroups = {};
      const variants = Array.isArray(product.variants) ? product.variants : [];

      variants.forEach((variant) => {
        const colorKey = variant.color?.trim().toLowerCase() || "unknown";
        if (!colorGroups[colorKey]) {
          colorGroups[colorKey] = {
            color: variant.color || "",
            images: Array.isArray(variant.images) ? variant.images : [""],
            options: [],
          };
        }

        colorGroups[colorKey].options.push({
          variantName: variant.variantName || "",
          sku: variant.sku || "",
          basePrice: String(
            variant.basePrice ?? variant.originalPrice ?? variant.price ?? ""
          ),
        });
      });

      const populatedVariants =
        Object.values(colorGroups).length > 0
          ? Object.values(colorGroups)
          : [
              {
                color: "",
                images: [""],
                options: [
                  { variantName: "", basePrice: "" },
                ],
              },
            ];

      setFormData({
        name: product.name || "",
        model: product.model || "",
        brand: product.brand?._id || product.brand || "",
        productType: product.productType?._id || product.productType || "",
        condition: product.condition || "NEW",
        status: product.status || "COMING_SOON",
        installmentBadge: product.installmentBadge || "NONE",
        description: product.description || "",
        featuredImages: Array.isArray(product.featuredImages)
          ? product.featuredImages
          : [""],
        videoUrl: product.videoUrl || "",
        afterSalesConfig: {
          trackingMode: product.afterSalesConfig?.trackingMode || "",
          identifierPolicy: product.afterSalesConfig?.identifierPolicy || "",
          warrantyMonths: product.afterSalesConfig?.warrantyMonths ?? "",
          warrantyTerms: product.afterSalesConfig?.warrantyTerms || "",
        },
        specifications: product.specifications || {},
        variants: populatedVariants,
      });

      // Load product type specs
      if (product.productType?._id || product.productType) {
        loadProductTypeSpecs(product.productType._id || product.productType);
      }
    } else if (open && !isEdit) {
      // CREATE MODE
      setFormData({
        name: "",
        model: "",
        brand: "",
        productType: "",
        condition: "NEW",
        status: "COMING_SOON",
        installmentBadge: "NONE",
        description: "",
        featuredImages: [""],
        videoUrl: "",
        afterSalesConfig: {
          trackingMode: "",
          identifierPolicy: "",
          warrantyMonths: "",
          warrantyTerms: "",
        },
        specifications: {},
        variants: [
          {
            color: "",
            images: [""],
            options: [
              {
                variantName: "",
                basePrice: "",
              },
            ],
          },
        ],
      });
      setSelectedProductType(null);
    }
  }, [open, isEdit, product]);

  // LOAD PRODUCT TYPE SPECS
  const loadProductTypeSpecs = async (productTypeId) => {
    try {
      const response = await productTypeAPI.getOne(productTypeId);
      const type = response.data.data.productType;
      setSelectedProductType(type);

      console.log("✅ Loaded product type specs:", type.specFields);

      // Initialize specs
      const specs = {};
      (type.specFields || []).forEach((field) => {
        if (!formData.specifications[field.key]) {
          specs[field.key] = "";
        }
      });

      setFormData((prev) => ({
        ...prev,
        specifications: { ...specs, ...prev.specifications },
      }));
    } catch (error) {
      console.error("❌ Load product type specs error:", error);
    }
  };

  // HANDLERS
  const handleProductTypeChange = (productTypeId) => {
    setFormData({ ...formData, productType: productTypeId, specifications: {} });
    loadProductTypeSpecs(productTypeId);
  };

  const handleSpecChange = (key, value) => {
    setFormData({
      ...formData,
      specifications: { ...formData.specifications, [key]: value },
    });
  };

  const addVariant = () => {
    setFormData({
      ...formData,
      variants: [
        ...formData.variants,
        {
          color: "",
          images: [""],
          options: [
            { variantName: "", basePrice: "" },
          ],
        },
      ],
    });
  };

  const removeVariant = (vIdx) => {
    setFormData({
      ...formData,
      variants: formData.variants.filter((_, i) => i !== vIdx),
    });
  };

  const handleVariantChange = (vIdx, field, value) => {
    const updated = [...formData.variants];
    updated[vIdx][field] = value;
    setFormData({ ...formData, variants: updated });
  };

  const addVariantImage = (vIdx) => {
    const updated = [...formData.variants];
    updated[vIdx].images.push("");
    setFormData({ ...formData, variants: updated });
  };

  const removeVariantImage = (vIdx, imgIdx) => {
    const updated = [...formData.variants];
    updated[vIdx].images = updated[vIdx].images.filter((_, i) => i !== imgIdx);
    setFormData({ ...formData, variants: updated });
  };

  const handleVariantImageChange = (vIdx, imgIdx, value) => {
    const updated = [...formData.variants];
    updated[vIdx].images[imgIdx] = value;
    setFormData({ ...formData, variants: updated });
  };

  const addVariantOption = (vIdx) => {
    const updated = [...formData.variants];
    updated[vIdx].options.push({
      variantName: "",
      basePrice: "",
    });
    setFormData({ ...formData, variants: updated });
  };

  const removeVariantOption = (vIdx, oIdx) => {
    const updated = [...formData.variants];
    updated[vIdx].options = updated[vIdx].options.filter((_, i) => i !== oIdx);
    setFormData({ ...formData, variants: updated });
  };

  const handleVariantOptionChange = (vIdx, oIdx, field, value) => {
    if (field === "stock" && !canEditVariantStock) {
      return;
    }

    if (field === "price" || field === "originalPrice") {
      const price =
        field === "price"
          ? Number(value)
          : Number(formData.variants[vIdx].options[oIdx].price);
      const originalPrice =
        field === "originalPrice"
          ? Number(value)
          : Number(formData.variants[vIdx].options[oIdx].originalPrice);

      if (price > originalPrice && originalPrice > 0) {
        toast.error("Giá bán không được lớn hơn giá gốc");
        return;
      }
    }

    const updated = [...formData.variants];
    updated[vIdx].options[oIdx][field] = value;
    setFormData({ ...formData, variants: updated });
  };

  // VALIDATE & SUBMIT
  const validateForm = () => {
    if (!formData.name?.trim()) {
      toast.error("Vui lòng nhập tên sản phẩm");
      setActiveTab("basic");
      return false;
    }
    if (!formData.model?.trim()) {
      toast.error("Vui lòng nhập model");
      setActiveTab("basic");
      return false;
    }
    if (!formData.brand) {
      toast.error("Vui lòng chọn hãng sản xuất");
      setActiveTab("basic");
      return false;
    }
    if (!formData.productType) {
      toast.error("Vui lòng chọn loại sản phẩm");
      setActiveTab("basic");
      return false;
    }
    if (!formData.variants?.length) {
      toast.error("Vui lòng thêm ít nhất một biến thể");
      setActiveTab("variants");
      return false;
    }

    // Validate variants
    for (let i = 0; i < formData.variants.length; i++) {
      const variant = formData.variants[i];
      if (!variant.color?.trim()) {
        toast.error(`Vui lòng nhập màu sắc cho biến thể ${i + 1}`);
        setActiveTab("variants");
        return false;
      }
      if (!variant.options?.length) {
        toast.error(`Vui lòng thêm ít nhất một phiên bản cho biến thể ${i + 1}`);
        setActiveTab("variants");
        return false;
      }

      for (let j = 0; j < variant.options.length; j++) {
        const option = variant.options[j];
        if (!option.variantName?.trim()) {
          toast.error(
            `Vui lòng nhập tên biến thể cho phiên bản ${j + 1} của màu ${i + 1}`
          );
          setActiveTab("variants");
          return false;
        }

        const basePrice = Number(option.basePrice);
        const price = basePrice;
        const originalPrice = basePrice;

        if (!option.basePrice?.trim() || isNaN(basePrice) || basePrice < 0) {
          toast.error(`Giá bán không hợp lệ ở biến thể ${i + 1}, phiên bản ${j + 1}`);
          setActiveTab("variants");
          return false;
        }

        if (false) {
          toast.error(`Giá gốc không hợp lệ ở biến thể ${i + 1}, phiên bản ${j + 1}`);
          setActiveTab("variants");
          return false;
        }

        if (false) {
          toast.error(`Giá bán > giá gốc ở biến thể ${i + 1}, phiên bản ${j + 1}`);
          setActiveTab("variants");
          return false;
        }
      }
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const payload = {
        name: formData.name.trim(),
        model: formData.model.trim(),
        brand: formData.brand,
        productType: formData.productType,
        condition: formData.condition,
        installmentBadge: formData.installmentBadge,
        description: formData.description?.trim() || "",
        featuredImages: formData.featuredImages.filter((url) => url?.trim()),
        videoUrl: formData.videoUrl?.trim() || "",
        afterSalesConfig: {
          trackingMode: formData.afterSalesConfig?.trackingMode || null,
          identifierPolicy: formData.afterSalesConfig?.identifierPolicy || null,
          warrantyMonths:
            formData.afterSalesConfig?.warrantyMonths === ""
              ? null
              : Number(formData.afterSalesConfig?.warrantyMonths) || 0,
          warrantyTerms: formData.afterSalesConfig?.warrantyTerms?.trim() || "",
        },
        specifications: formData.specifications,
        variants: formData.variants.map((v) => ({
          color: v.color.trim(),
          images: v.images.filter((img) => img?.trim()),
          options: v.options.map((opt) => ({
            variantName: opt.variantName.trim(),
            basePrice: Number(opt.basePrice),
          })),
        })),
        createdBy: user._id,
      };

      console.log("📤 Submitting universal product:", payload);

      if (isEdit) {
        await universalProductAPI.update(product._id, payload);
        toast.success("Cập nhật sản phẩm thành công");
      } else {
        const response = await universalProductAPI.create(payload);
        toast.success("Tạo sản phẩm thành công");
        console.log("✅ Product created:", response.data);
      }

      onOpenChange(false);
      onSave();
    } catch (error) {
      console.error("❌ Submit error:", error.response?.data || error);
      toast.error(error.response?.data?.message || "Lưu sản phẩm thất bại");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[70vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="p-6 border-b">
          <DialogTitle className="text-2xl font-bold">
            {isEdit ? "Cập nhật sản phẩm" : "Thêm sản phẩm mới"}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? "Chỉnh sửa thông tin sản phẩm" : "Tạo sản phẩm mới"}
          </DialogDescription>
        </DialogHeader>

        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="basic">Cơ bản</TabsTrigger>
                <TabsTrigger value="specs">Thông số</TabsTrigger>
                <TabsTrigger value="variants">Biến thể</TabsTrigger>
              </TabsList>

              {/* TAB CƠ BẢN */}
              <TabsContent value="basic" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>
                      Tên sản phẩm <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Model <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      value={formData.model}
                      onChange={(e) =>
                        setFormData({ ...formData, model: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Hãng sản xuất <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.brand}
                      onValueChange={(value) =>
                        setFormData({ ...formData, brand: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn hãng" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {brands.map((brand) => (
                          <SelectItem key={brand._id} value={brand._id}>
                            {brand.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Loại sản phẩm <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.productType}
                      onValueChange={handleProductTypeChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn loại sản phẩm" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {productTypes.map((type) => (
                          <SelectItem key={type._id} value={type._id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Tình trạng</Label>
                    <Select
                      value={formData.condition}
                      onValueChange={(value) =>
                        setFormData({ ...formData, condition: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NEW">Mới 100%</SelectItem>
                        <SelectItem value="LIKE_NEW">Like new</SelectItem>
                        <SelectItem value="USED">Đã sử dụng</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Trạng thái</Label>
                    <Select
                      value={formData.status}
                      disabled
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AVAILABLE">Còn hàng</SelectItem>
                        <SelectItem value="OUT_OF_STOCK">Hết hàng</SelectItem>
                        <SelectItem value="DISCONTINUED">Ngừng kinh doanh</SelectItem>
                        <SelectItem value="PRE_ORDER">Đặt trước</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Trả góp 0%</Label>
                    <Select
                      value={formData.installmentBadge}
                      onValueChange={(value) =>
                        setFormData({ ...formData, installmentBadge: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INSTALLMENT_BADGE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Mô tả</Label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    rows={4}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Nhập mô tả sản phẩm..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 border rounded-lg p-4 bg-slate-50/70">
                  <div className="space-y-2">
                    <Label>Chế độ theo dõi</Label>
                    <Select
                      value={formData.afterSalesConfig?.trackingMode || "NONE"}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          afterSalesConfig: {
                            ...formData.afterSalesConfig,
                            trackingMode: value,
                          },
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Auto managed" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRACKING_MODE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Chính sách định danh</Label>
                    <Select
                      value={formData.afterSalesConfig?.identifierPolicy || "NONE"}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          afterSalesConfig: {
                            ...formData.afterSalesConfig,
                            identifierPolicy: value,
                          },
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {IDENTIFIER_POLICY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Số tháng bảo hành</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.afterSalesConfig?.warrantyMonths ?? ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          afterSalesConfig: {
                            ...formData.afterSalesConfig,
                            warrantyMonths: e.target.value,
                          },
                        })
                      }
                      placeholder="Ví dụ: 12"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2 xl:col-span-1">
                    <Label>Điều khoản bảo hành</Label>
                    <textarea
                      value={formData.afterSalesConfig?.warrantyTerms || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          afterSalesConfig: {
                            ...formData.afterSalesConfig,
                            warrantyTerms: e.target.value,
                          },
                        })
                      }
                      rows={3}
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Điều khoản bảo hành riêng cho sản phẩm..."
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>URL Ảnh Nổi Bật</Label>
                  {formData.featuredImages.map((url, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={url}
                        onChange={(e) => {
                          const updated = [...formData.featuredImages];
                          updated[idx] = e.target.value;
                          setFormData({ ...formData, featuredImages: updated });
                        }}
                        placeholder="https://example.com/image.jpg"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const updated = formData.featuredImages.filter(
                            (_, i) => i !== idx
                          );
                          setFormData({
                            ...formData,
                            featuredImages: updated.length ? updated : [""],
                          });
                        }}
                        disabled={formData.featuredImages.length === 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFormData({
                        ...formData,
                        featuredImages: [...formData.featuredImages, ""],
                      });
                    }}
                  >
                    <Plus className="w-4 h-4 mr-2" /> Thêm ảnh
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>URL Video</Label>
                  <Input
                    value={formData.videoUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, videoUrl: e.target.value })
                    }
                    placeholder="https://youtube.com/watch?v=..."
                  />
                </div>
              </TabsContent>

              {/* TAB THÔNG SỐ */}
              <TabsContent value="specs" className="mt-4">
                {!selectedProductType ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Vui lòng chọn loại sản phẩm ở tab Cơ bản
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedProductType.specFields?.map((field) => (
                      <div key={field.key} className="space-y-2">
                        <Label>
                          {field.label}{" "}
                          {field.required && <span className="text-red-500">*</span>}
                        </Label>

                        {field.type === "select" ? (
                          <Select
                            value={formData.specifications[field.key] || ""}
                            onValueChange={(value) =>
                              handleSpecChange(field.key, value)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={field.placeholder} />
                            </SelectTrigger>
                            <SelectContent>
                              {field.options?.map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : field.type === "textarea" ? (
                          <textarea
                            value={formData.specifications[field.key] || ""}
                            onChange={(e) =>
                              handleSpecChange(field.key, e.target.value)
                            }
                            rows={3}
                            className="w-full px-3 py-2 border rounded-md"
                            placeholder={field.placeholder}
                            required={field.required}
                          />
                        ) : (
                          <Input
                            type={field.type === "number" ? "number" : "text"}
                            value={formData.specifications[field.key] || ""}
                            onChange={(e) =>
                              handleSpecChange(field.key, e.target.value)
                            }
                            placeholder={field.placeholder}
                            required={field.required}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* TAB BIẾN THỂ */}
              <TabsContent value="variants" className="mt-4">
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="text-lg font-semibold">Biến thể sản phẩm</h3>
                    <Button type="button" variant="outline" onClick={addVariant}>
                      <Plus className="w-4 h-4 mr-2" /> Thêm màu
                    </Button>
                  </div>

                  {formData.variants.map((variant, vIdx) => (
                    <div
                      key={vIdx}
                      className="rounded-lg p-4 space-y-4 border shadow-sm"
                    >
                      {/* COLOR & IMAGES */}
                      <div className="flex items-center justify-between pb-3 border-b">
                        <div className="space-y-2 flex-1 mr-4">
                          <Label>
                            Màu sắc <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            value={variant.color}
                            onChange={(e) =>
                              handleVariantChange(vIdx, "color", e.target.value)
                            }
                            placeholder="VD: Black, White"
                            required
                          />
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => removeVariant(vIdx)}
                        >
                          <Trash2 className="w-4 h-4 mr-1" /> Xóa màu
                        </Button>
                      </div>

                      {/* IMAGES */}
                      <div className="space-y-2">
                        <Label>URL Ảnh</Label>
                        {variant.images.map((img, imgIdx) => (
                          <div key={imgIdx} className="flex items-center gap-2">
                            <Input
                              value={img}
                              onChange={(e) =>
                                handleVariantImageChange(vIdx, imgIdx, e.target.value)
                              }
                              placeholder="https://example.com/image.jpg"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeVariantImage(vIdx, imgIdx)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addVariantImage(vIdx)}
                        >
                          <Plus className="w-4 h-4 mr-2" /> Thêm ảnh
                        </Button>
                      </div>

                      {/* OPTIONS (VARIANT NAMES) */}
                      <div className="space-y-3 pt-3 border-t">
                        <Label className="text-base font-semibold">
                          Phiên bản con
                        </Label>

                        {variant.options.map((opt, oIdx) => (
                          <div
                            key={oIdx}
                            className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 border rounded-md bg-gray-50"
                          >
                            <div className="space-y-2">
                              <Label>
                                Tên biến thể <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                value={opt.variantName}
                                onChange={(e) =>
                                  handleVariantOptionChange(
                                    vIdx,
                                    oIdx,
                                    "variantName",
                                    e.target.value
                                  )
                                }
                                placeholder="VD: 128GB, GPS 40mm"
                                required
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Giá gốc</Label>
                              <Input
                                type="number"
                                value={opt.basePrice || ""}
                                onChange={(e) =>
                                  handleVariantOptionChange(
                                    vIdx,
                                    oIdx,
                                    "basePrice",
                                    e.target.value
                                  )
                                }
                                required
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Giá bán</Label>
                              <Input
                                type="number"
                                value={opt.basePrice || ""}
                                onChange={(e) =>
                                  handleVariantOptionChange(
                                    vIdx,
                                    oIdx,
                                    "basePrice",
                                    e.target.value
                                  )
                                }
                                disabled
                                required
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Số lượng</Label>
                              <Input
                                type="number"
                                value=""
                                min="0"
                                onChange={() => {}}
                                disabled
                              />
                            </div>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeVariantOption(vIdx, oIdx)}
                              className="text-red-500"
                            >
                              <Trash2 className="w-5 h-5" />
                            </Button>
                          </div>
                        ))}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addVariantOption(vIdx)}
                        >
                          <Plus className="w-4 h-4 mr-2" /> Thêm phiên bản
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!canEditVariantStock && (
                    <p className="text-sm text-muted-foreground">
                      Quyền cập nhật số lượng tồn kho thuộc về Quản lý kho.
                    </p>
                  )}

                </div>
              </TabsContent>
            </Tabs>

            {/* BUTTONS */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo mới"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UniversalProductForm;

