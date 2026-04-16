// ============================================
// FILE: frontend/src/pages/admin/BrandManagementPage.jsx
// ✅ Quản lý hãng sản xuất
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
import { Plus, Search, Edit, Trash2, Package } from "lucide-react";
import { brandAPI } from "../api/catalog.api";
import { useAuthStore } from "@/features/auth";
import { Loading } from "@/shared/ui/Loading";

const BrandManagementPage = () => {
  const { user } = useAuthStore();
  const [brands, setBrands] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [currentMode, setCurrentMode] = useState(null);
  const [currentBrand, setCurrentBrand] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    logo: "",
    description: "",
    website: "",
    status: "ACTIVE",
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [brandToDelete, setBrandToDelete] = useState(null);

  useEffect(() => {
    fetchBrands();
  }, [searchQuery]);

  const fetchBrands = async () => {
    setIsLoading(true);
    try {
      const response = await brandAPI.getAll({ search: searchQuery });
      setBrands(response.data.data.brands || []);
    } catch (error) {
      console.error("❌ Fetch brands error:", error);
      toast.error("Lỗi tải danh sách hãng");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setCurrentMode("create");
    setCurrentBrand(null);
    setFormData({
      name: "",
      logo: "",
      description: "",
      website: "",
      status: "ACTIVE",
    });
    setShowModal(true);
  };

  const handleEdit = (brand) => {
    setCurrentMode("edit");
    setCurrentBrand(brand);
    setFormData({
      name: brand.name || "",
      logo: brand.logo || "",
      description: brand.description || "",
      website: brand.website || "",
      status: brand.status || "ACTIVE",
    });
    setShowModal(true);
  };

  const handleDelete = (brand) => {
    setBrandToDelete(brand);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!brandToDelete) return;

    try {
      await brandAPI.delete(brandToDelete._id);
      toast.success("Xóa hãng thành công");
      fetchBrands();
    } catch (error) {
      console.error("❌ Delete brand error:", error);
      toast.error(error.response?.data?.message || "Xóa hãng thất bại");
    } finally {
      setShowDeleteDialog(false);
      setBrandToDelete(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name?.trim()) {
      toast.error("Tên hãng là bắt buộc");
      return;
    }

    const payload = {
      ...formData,
      createdBy: user._id,
    };

    try {
      if (currentMode === "create") {
        await brandAPI.create(payload);
        toast.success("Tạo hãng thành công");
      } else {
        await brandAPI.update(currentBrand._id, payload);
        toast.success("Cập nhật hãng thành công");
      }
      setShowModal(false);
      fetchBrands();
    } catch (error) {
      console.error("❌ Submit brand error:", error);
      toast.error(error.response?.data?.message || "Lưu hãng thất bại");
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Quản lý hãng sản xuất</h1>
          <p className="text-muted-foreground">
            Quản lý danh sách hãng sản xuất sản phẩm
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="w-4 h-4 mr-2" /> Thêm hãng
        </Button>
      </div>

      {/* SEARCH */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Tìm kiếm hãng..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* BRANDS LIST */}
      {isLoading ? (
        <Loading />
      ) : brands.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {searchQuery ? "Không tìm thấy hãng" : "Chưa có hãng nào"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {brands.map((brand) => (
            <div
              key={brand._id}
              className="border rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {brand.logo ? (
                    <img
                      src={brand.logo}
                      alt={brand.name}
                      className="w-12 h-12 object-contain rounded"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center">
                      <Package className="w-6 h-6 text-gray-400" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold">{brand.name}</h3>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        brand.status === "ACTIVE"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {brand.status === "ACTIVE" ? "Hoạt động" : "Không hoạt động"}
                    </span>
                  </div>
                </div>
              </div>

              {brand.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {brand.description}
                </p>
              )}

              {brand.website && (
                <a
                  href={brand.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline block mb-3"
                >
                  {brand.website}
                </a>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(brand)}
                  className="flex-1"
                >
                  <Edit className="w-4 h-4 mr-1" /> Sửa
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(brand)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {currentMode === "create" ? "Thêm hãng mới" : "Cập nhật hãng"}
            </DialogTitle>
            <DialogDescription>
              Điền thông tin hãng sản xuất
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>
                Tên hãng <span className="text-red-500">*</span>
              </Label>
              <Input
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="VD: Apple, Samsung, LG..."
                required
              />
            </div>

            <div className="space-y-2">
              <Label>URL Logo</Label>
              <Input
                value={formData.logo}
                onChange={(e) =>
                  setFormData({ ...formData, logo: e.target.value })
                }
                placeholder="https://example.com/logo.png"
              />
            </div>

            <div className="space-y-2">
              <Label>Mô tả</Label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={3}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Mô tả ngắn về hãng..."
              />
            </div>

            <div className="space-y-2">
              <Label>Website</Label>
              <Input
                value={formData.website}
                onChange={(e) =>
                  setFormData({ ...formData, website: e.target.value })
                }
                placeholder="https://www.apple.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Trạng thái</Label>
              <Select
                value={formData.status}
                onValueChange={(value) =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Hoạt động</SelectItem>
                  <SelectItem value="INACTIVE">Không hoạt động</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowModal(false)}
              >
                Hủy
              </Button>
              <Button type="submit">
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
            <AlertDialogTitle>Xác nhận xóa hãng</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa hãng <strong>{brandToDelete?.name}</strong>?
              <br />
              <span className="text-red-600 font-medium">
                Hành động này không thể hoàn tác và có thể ảnh hưởng đến sản phẩm liên quan.
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

export default BrandManagementPage;
