// ============================================
// FILE: frontend/src/components/admin/homepage/SectionEditorModal.jsx
// Modal for editing section configuration
// ============================================

import React, { useState, useEffect } from "react";
import { useHomeLayoutStore } from "../../state/homeLayout.store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/ui/dialog";
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
import { Textarea } from "@/shared/ui/textarea";
import ImageUploader from "./ImageUploader";
import { toast } from "sonner";
import { productTypeAPI } from "@/features/catalog";

const SectionEditorModal = ({ section, open, onClose }) => {
  const { updateSectionConfig } = useHomeLayoutStore();
  const [formData, setFormData] = useState({
    title: "",
    config: {},
  });
  const [productTypes, setProductTypes] = useState([]);
  const [loadingProductTypes, setLoadingProductTypes] = useState(false);

  const normalizeText = (value = "") =>
    String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  useEffect(() => {
    if (section) {
      setFormData({
        title: section.title || "",
        config: section.config || {},
      });
    }
  }, [section]);

  useEffect(() => {
    if (!open) return;
    if (section?.type !== "category-section") return;

    const loadProductTypes = async () => {
      try {
        setLoadingProductTypes(true);
        const response = await productTypeAPI.getAll({ status: "ACTIVE", limit: 100 });
        const items = response?.data?.data?.productTypes;
        setProductTypes(Array.isArray(items) ? items : []);
      } catch (error) {
        console.error("Failed to load product types for editor:", error);
        setProductTypes([]);
      } finally {
        setLoadingProductTypes(false);
      }
    };

    loadProductTypes();
  }, [open, section?.type]);

  useEffect(() => {
    if (section?.type !== "category-section") return;
    if (!productTypes.length) return;

    setFormData((prev) => {
      const currentId = String(prev?.config?.categoryId || "").trim();
      if (currentId) return prev;

      const currentName = String(
        prev?.config?.categoryName || prev?.config?.categoryFilter || ""
      ).trim();
      if (!currentName) return prev;

      const normalizedCurrentName = normalizeText(currentName);
      const matchedType = productTypes.find((type) => {
        const byName = normalizeText(type?.name || "") === normalizedCurrentName;
        const bySlug = normalizeText(type?.slug || "") === normalizedCurrentName;
        return byName || bySlug;
      });

      if (!matchedType?._id) return prev;

      return {
        ...prev,
        config: {
          ...prev.config,
          categoryId: matchedType._id,
          categoryName: matchedType.name || currentName,
          categoryFilter: matchedType.name || currentName,
        },
      };
    });
  }, [section?.type, productTypes]);

  const handleSave = () => {
    if (!section) return;

    updateSectionConfig(section.id, formData.config, formData.title);
    toast.success("Đã cập nhật section");
    onClose();
  };

  const renderConfigFields = () => {
    if (!section) return null;

    switch (section.type) {
      case "hero":
      case "secondary-banners":
        return (
          <>
            <div className="space-y-4">
              <div>
                <Label>Banner Images</Label>
                <ImageUploader
                  images={formData.config.images || []}
                  onChange={(images) =>
                    setFormData({
                      ...formData,
                      config: { ...formData.config, images },
                    })
                  }
                />
              </div>

              <div>
                <Label>Links (1 per line, matching image order)</Label>
                <Textarea
                  value={(formData.config.links || []).join("\n")}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        links: e.target.value.split("\n").filter(Boolean),
                      },
                    })
                  }
                  rows={5}
                  placeholder="/dien-thoai&#10;/may-tinh-bang&#10;/macbook"
                />
              </div>
            </div>
          </>
        );

      case "deals-grid":
        return (
          <>
            <div className="space-y-4">
              <div>
                <Label>Deal Images (6 ảnh)</Label>
                <p className="text-xs text-gray-500 mb-2">
                  Hiển thị trong lưới deals
                </p>
                <ImageUploader
                  images={
                    formData.config.dealImages || formData.config.images || []
                  }
                  onChange={(images) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        images,
                        dealImages: images,
                      },
                    })
                  }
                />
              </div>

              <div>
                <Label>Deal Links (1 per line)</Label>
                <Textarea
                  value={(
                    formData.config.dealLinks ||
                    formData.config.links ||
                    []
                  ).join("\n")}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        links: e.target.value.split("\n").filter(Boolean),
                        dealLinks: e.target.value.split("\n").filter(Boolean),
                      },
                    })
                  }
                  rows={6}
                  placeholder="/products?category=iPhone&#10;/products?category=iPad"
                />
              </div>
            </div>
          </>
        );

      case "magic-deals":
        return (
          <>
            <div className="space-y-4">
              <div>
                <Label>Banner chính (bên trái)</Label>
                <p className="text-xs text-gray-500 mb-2">
                  Chỉ upload 1 ảnh banner cho phần bên trái. 8 sản phẩm bên phải
                  sẽ tự động hiển thị sản phẩm có % giảm giá cao nhất.
                </p>
                <ImageUploader
                  images={formData.config.images?.slice(0, 1) || []}
                  onChange={(images) =>
                    setFormData({
                      ...formData,
                      config: {
                        ...formData.config,
                        images: images.slice(0, 1), // Chỉ lấy 1 ảnh
                      },
                    })
                  }
                />
              </div>

              <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
                <strong className="text-blue-900">Lưu ý:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-blue-800">
                  <li>Banner bên trái: Có thể tùy chỉnh</li>
                  <li>8 sản phẩm bên phải: Tự động hiển thị top giảm giá</li>
                  <li>Click vào sản phẩm để xem chi tiết</li>
                </ul>
              </div>
            </div>
          </>
        );
      case "products-new":
      case "products-topSeller":
        return (
          <div>
            <Label>Product Limit</Label>
            <Input
              type="number"
              min="1"
              max="100"
              value={formData.config.limit || 10}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  config: {
                    ...formData.config,
                    limit: parseInt(e.target.value) || 10,
                  },
                })
              }
            />
          </div>
        );

      case "category-section":
        return (
          <>
            <div>
              <Label>Category</Label>
              <Select
                value={
                  formData.config.categoryId ||
                  (() => {
                    const currentName = String(
                      formData.config.categoryName ||
                        formData.config.categoryFilter ||
                        ""
                    ).trim();
                    if (!currentName) return "";
                    const normalizedCurrentName = normalizeText(currentName);
                    const matched = productTypes.find(
                      (type) =>
                        normalizeText(type?.name || "") === normalizedCurrentName ||
                        normalizeText(type?.slug || "") === normalizedCurrentName
                    );
                    return matched?._id || "";
                  })()
                }
                onValueChange={(value) => {
                  const selectedType = productTypes.find(
                    (type) => String(type?._id) === String(value)
                  );
                  setFormData({
                    ...formData,
                    config: {
                      ...formData.config,
                      categoryId: value,
                      categoryName: selectedType?.name || formData.config.categoryName || "",
                      // Keep field for backward compatibility with existing data.
                      categoryFilter:
                        selectedType?.name || formData.config.categoryFilter || "",
                    },
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loadingProductTypes
                        ? "Đang tải danh mục..."
                        : "Select category"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {productTypes.length > 0 ? (
                    productTypes.map((type) => (
                      <SelectItem key={type._id} value={type._id}>
                        {type.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__no_type__" disabled>
                      No product types found
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Product Limit</Label>
              <Input
                type="number"
                min="1"
                max="100"
                value={formData.config.limit || 10}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: {
                      ...formData.config,
                      limit: parseInt(e.target.value) || 10,
                    },
                  })
                }
              />
            </div>
          </>
        );

      case "iphone-showcase":
        return (
          <div>
            <Label>Showcase Items (JSON format)</Label>
            <Textarea
              value={JSON.stringify(
                formData.config.showcaseItems || [],
                null,
                2
              )}
              onChange={(e) => {
                try {
                  const items = JSON.parse(e.target.value);
                  setFormData({
                    ...formData,
                    config: { ...formData.config, showcaseItems: items },
                  });
                } catch {
                  // Invalid JSON, ignore
                }
              }}
              rows={10}
              className="font-mono text-xs"
            />
            <p className="text-xs text-gray-500 mt-1">
              Format: [{`{title, subtitle, image, link}`}, ...]
            </p>
          </div>
        );
      case "short-videos":
        return (
          <>
            <div>
              <Label>Số lượng video hiển thị</Label>
              <Input
                type="number"
                min="1"
                max="20"
                value={formData.config.videoLimit || 6}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: {
                      ...formData.config,
                      videoLimit: parseInt(e.target.value) || 6,
                    },
                  })
                }
              />
              <p className="text-xs text-gray-500 mt-1">Từ 1 đến 20 video</p>
            </div>

            <div>
              <Label>Loại video</Label>
              <Select
                value={formData.config.videoType || "latest"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, videoType: value },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn loại video" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Mới nhất</SelectItem>
                  <SelectItem value="trending">
                    Trending (7 ngày gần đây)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
              <strong className="text-blue-900">Lưu ý:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1 text-blue-800">
                <li>
                  <strong>Mới nhất:</strong> Hiển thị video được upload gần đây
                  nhất
                </li>
                <li>
                  <strong>Trending:</strong> Hiển thị video có lượt xem/thích
                  cao trong 7 ngày qua
                </li>
                <li>Video phải có status = "PUBLISHED" mới hiển thị</li>
              </ul>
            </div>
          </>
        );
      default:
        return (
          <div className="text-gray-500 text-sm">
            No configuration needed for this section type.
          </div>
        );
    }
  };

  if (!section) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Section: {section.type}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Section Title */}
          <div>
            <Label>Section Title (Display Name)</Label>
            <Input
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="e.g., Sản phẩm mới"
            />
          </div>

          {/* Config Fields */}
          {renderConfigFields()}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={handleSave}>Lưu thay đổi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SectionEditorModal;
