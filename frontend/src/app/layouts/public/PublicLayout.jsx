import React, { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import Breadcrumb from "@/shared/ui/Breadcrumb";
import { useAuthStore } from "@/features/auth";
import {
  getAuthorizationSnapshot,
  hasPermissionSnapshot,
  isGlobalAdminAuthorization,
  resolveHomeRoute,
} from "@/features/auth/lib/authorization";
import { useCartStore } from "@/features/cart";
import { productTypeAPI } from "@/features/catalog";
import { SearchOverlay } from "@/features/search";
import PublicFooter from "./components/PublicFooter";
import PublicHeader from "./components/PublicHeader";
import PublicNavigationMenus from "./components/PublicNavigationMenus";

const stores = [
  {
    id: 1,
    name: "Ninh Kiều iSTORE - Chi nhánh Trần Hưng Đạo",
    district: "Ninh Kieu",
    address: "123 Tran Hung Dao, Phuong Cai Khe, Quan Ninh Kieu, TP. Can Tho",
    phone: "0292 3831 234",
    hours: "8:00 - 21:00 (Thu 2 - Chu Nhat)",
    isMain: true,
  },
  {
    id: 2,
    name: "Ninh Kiều iSTORE - Chi nhánh Mậu Thân",
    district: "Ninh Kieu",
    address: "456 Mau Than, Phuong An Hoa, Quan Ninh Kieu, TP. Can Tho",
    phone: "0292 3831 567",
    hours: "8:00 - 21:00 (Thu 2 - Chu Nhat)",
  },
  {
    id: 3,
    name: "Ninh Kieu iSTORE - Vincom Hung Vuong",
    district: "Ninh Kieu",
    address: "Vincom Plaza Xuan Khanh, 209 Duong 30/4, Phuong Xuan Khanh, Quan Ninh Kieu",
    phone: "0292 3831 890",
    hours: "9:00 - 22:00 (Thu 2 - Chu Nhat)",
  },
  {
    id: 4,
    name: "Ninh Kieu iSTORE - Cai Rang",
    district: "Cai Rang",
    address: "789 Tran Hoang Na, Phuong Thuong Thanh, Quan Cai Rang, TP. Can Tho",
    phone: "0292 3832 123",
    hours: "8:00 - 21:00 (Thu 2 - Chu Nhat)",
  },
  {
    id: 5,
    name: "Ninh Kieu iSTORE - Binh Thuy",
    district: "Binh Thuy",
    address: "321 Bui Huu Nghia, Phuong Binh Thuy, Quan Binh Thuy, TP. Can Tho",
    phone: "0292 3832 456",
    hours: "8:00 - 20:00 (Thu 2 - Chu Nhat)",
  },
  {
    id: 6,
    name: "Ninh Kieu iSTORE - O Mon",
    district: "O Mon",
    address: "654 Quoc Lo 91B, Phuong Chau Van Liem, Quan O Mon, TP. Can Tho",
    phone: "0292 3832 789",
    hours: "8:00 - 20:00 (Thu 2 - Chu Nhat)",
  },
];

const districts = ["Tất cả", "Ninh Kiều", "Cái Răng", "Bình Thủy", "Ô Môn"];

const FOOTER_FALLBACK_CATEGORY_LINKS = [
  {
    id: "all-products",
    name: "Tất cả sản phẩm",
    to: "/products?page=1",
    icon: "",
  },
];

const isLikelyImageUrl = (value = "") => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return true;
  if (trimmed.startsWith("/")) return true;
  return /\.(png|jpe?g|webp|svg|gif|avif)$/i.test(trimmed);
};

const PublicLayout = () => {
  const navigate = useNavigate();
  const { isAuthenticated, user, authz, authorization } = useAuthStore();
  const cartItemCount = useCartStore((state) => state.cartCount);
  const fetchCartCount = useCartStore((state) => state.fetchCartCount);

  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [contactMenuOpen, setContactMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [desktopStoreMenuOpen, setDesktopStoreMenuOpen] = useState(false);
  const [desktopSelectedDistrict, setDesktopSelectedDistrict] = useState(0);
  const [selectedDistrict, setSelectedDistrict] = useState(0);
  const [footerProductTypes, setFooterProductTypes] = useState([]);
  const snapshot = getAuthorizationSnapshot({ authz, authorization });
  const canManageCart =
    isGlobalAdminAuthorization({ user, authz, authorization }) ||
    hasPermissionSnapshot(snapshot, "cart.manage.self") ||
    !user; // Cho phép Guest sử dụng giỏ hàng (local)
  const canAccessCustomerSelfService = hasPermissionSnapshot(
    snapshot,
    [
      "cart.manage.self",
      "account.profile.update.self",
      "account.address.manage.self",
      "order.view.self",
      "promotion.apply.self",
      "review.create.self",
    ],
    { mode: "any" },
  );

  useEffect(() => {
    if (!isAuthenticated || !canManageCart) return;

    fetchCartCount();
  }, [canManageCart, fetchCartCount, isAuthenticated]);

  useEffect(() => {
    if (storeMenuOpen || contactMenuOpen || desktopStoreMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [contactMenuOpen, desktopStoreMenuOpen, storeMenuOpen]);

  useEffect(() => {
    let isMounted = true;

    const loadFooterProductTypes = async () => {
      try {
        const response = await productTypeAPI.getPublic({ limit: 12 });
        const items = response?.data?.data?.productTypes;
        if (!isMounted) return;
        setFooterProductTypes(Array.isArray(items) ? items : []);
      } catch {
        if (isMounted) setFooterProductTypes([]);
      }
    };

    loadFooterProductTypes();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleProfileNavigation = () => {
    const homeRoute = resolveHomeRoute({ user, authz, authorization });
    navigate(homeRoute || "/");
  };

  const filteredStores =
    selectedDistrict === 0
      ? stores
      : stores.filter((store) => store.district === districts[selectedDistrict]);

  const footerCategoryLinks =
    footerProductTypes.length > 0
      ? footerProductTypes.slice(0, 6).map((item, index) => {
          const typeId = String(item?._id || "").trim();
          const typeName = String(item?.name || `Danh mục ${index + 1}`).trim();
          const params = new URLSearchParams();

          if (typeId) {
            params.set("productType", typeId);
            params.set("productTypeName", typeName);
          } else {
            params.set("search", typeName);
          }

          params.set("page", "1");

          return {
            id: typeId || String(item?.slug || `footer-type-${index}`),
            name: typeName,
            icon: isLikelyImageUrl(item?.icon) ? String(item.icon).trim() : "",
            to: `/products?${params.toString()}`,
          };
        })
      : FOOTER_FALLBACK_CATEGORY_LINKS;

  return (
    <div className="min-h-screen flex flex-col relative pb-16 md:pb-0">
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      <PublicHeader
        isAuthenticated={isAuthenticated}
        user={user}
        cartItemCount={cartItemCount}
        canManageCart={canManageCart}
        navigate={navigate}
        handleProfileNavigation={handleProfileNavigation}
        setSearchOpen={setSearchOpen}
      />

      <Breadcrumb />

      <PublicNavigationMenus
        isAuthenticated={isAuthenticated}
        user={user}
        canManageCart={canManageCart}
        canAccessCustomerSelfService={canAccessCustomerSelfService}
        categoryMenuOpen={categoryMenuOpen}
        setCategoryMenuOpen={setCategoryMenuOpen}
        storeMenuOpen={storeMenuOpen}
        setStoreMenuOpen={setStoreMenuOpen}
        contactMenuOpen={contactMenuOpen}
        setContactMenuOpen={setContactMenuOpen}
        desktopStoreMenuOpen={desktopStoreMenuOpen}
        setDesktopStoreMenuOpen={setDesktopStoreMenuOpen}
        districts={districts}
        selectedDistrict={selectedDistrict}
        setSelectedDistrict={setSelectedDistrict}
        filteredStores={filteredStores}
        desktopSelectedDistrict={desktopSelectedDistrict}
        setDesktopSelectedDistrict={setDesktopSelectedDistrict}
        stores={stores}
        navigate={navigate}
        handleProfileNavigation={handleProfileNavigation}
      />

      <main className="flex-1 pt-20">
        <Outlet />
      </main>

      <PublicFooter
        footerCategoryLinks={footerCategoryLinks}
        setDesktopStoreMenuOpen={setDesktopStoreMenuOpen}
      />
    </div>
  );
};

export default PublicLayout;
