import React, { useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import {
  Star,
  ShoppingCart,
  ChevronRight,
  ChevronLeft,
  Play,
  Shield,
  Check,
} from "lucide-react";
import { useCartStore } from "@/features/cart";
import { useAuthStore } from "@/features/auth";
import { universalProductAPI } from "../api/catalog.api";
import SlideInPanel from "../components/SlideInPanel";
import QuickSpecs from "../components/QuickSpecs";
import { SpecificationsTab } from "../components/SpecificationsTab";
import { WarrantyTab } from "../components/WarrantyTab";
import { ReviewsTab } from "../components/ReviewsTab";
import SimilarProducts from "../components/SimilarProducts";
import AddToCartModal from "../components/AddToCartModal";
import {
  formatWarrantyDuration,
  isSerializedProduct,
  resolveAfterSalesConfig,
} from "@/features/afterSales/utils/afterSales";

// ✅ Map ProductType slug to category path for URL generation
const PRODUCT_TYPE_TO_CATEGORY = {
  smartphone: "dien-thoai",
  tablet: "may-tinh-bang",
  laptop: "macbook",
  smartwatch: "apple-watch",
  headphone: "tai-nghe",
  tv: "tivi",
  monitor: "man-hinh",
  keyboard: "ban-phim",
  mouse: "chuot",
  speaker: "loa",
  camera: "may-anh",
  "gaming-console": "may-choi-game",
  accessories: "phu-kien",
};

const getVariantStorageLabel = (variantName = "") => {
  const match = String(variantName).match(/^([\d]+(?:GB|TB))/i);
  return match ? match[1].toUpperCase() : ""; // Return empty string if no storage found
};

const VARIANT_KEY_FIELD = {
  iPhone: "storage",
  iPad: "storage",
  Mac: "storage",
  AirPods: "variantName",
  AppleWatch: "variantName",
  Accessory: "variantName",
  Accessories: "variantName",
};

const ProductDetailPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const topRef = useRef(null);


  const pathParts = location.pathname.split("/").filter(Boolean);
  
  // ✅ FIX: Handle warehouse route /warehouse/products/:slug
  let categorySlug, fullSlug;
  
  if (pathParts[0] === "warehouse" && pathParts[1] === "products") {
    categorySlug = "warehouse";
    fullSlug = pathParts[2]; // Slug is at index 2
  } else {
    // Standard routes: /category/slug
    categorySlug = pathParts[0];
    fullSlug = pathParts.slice(1).join("/");
  }
  const categoryInfo = null;
  const sku = searchParams.get("sku");

  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddToCartModal, setShowAddToCartModal] = useState(false);
  const [activeMediaTab, setActiveMediaTab] = useState("variant"); // 'variant' | 'featured' | 'video'
  const [showSpecsPanel, setShowSpecsPanel] = useState(false);
  const [showWarrantyPanel, 
    setShowWarrantyPanel] = useState(false);
  const productSource = "universal";

  const {
    addToCart,
    isLoading: cartLoading,
    setSelectedForCheckout,
  } = useCartStore();
  const { user, isAuthenticated } = useAuthStore();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [fullSlug]);

  // Get images based on active media tab
  const getCurrentMainImages = () => {
    if (activeMediaTab === "featured" && product?.featuredImages?.length > 0) {
      return product.featuredImages.filter(Boolean);
    }

    if (activeMediaTab === "video") {
      return [];
    }

    // Default: variant images
    return selectedVariant?.images?.filter(Boolean) || [];
  };

  useEffect(() => {
    const fetchProductData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Strip storage suffix from URL slug (e.g., "iphone-17-pro-max-512gb" → "iphone-17-pro-max")
        const stripStorageSuffix = (slug) => {
          // Replace suffix like -256gb, -1tb, etc. with empty string
          return slug.replace(/-(\d+(?:gb|tb))$/i, "");
        };
        
        const baseSlug = stripStorageSuffix(fullSlug);
        console.log("🔍 Fetching universal product:", baseSlug);
        
        const response = await universalProductAPI.getBySlug(baseSlug);
        const data = response?.data?.data;
        
        if (!data?.product) {
          throw new Error("Không tìm thấy sản phẩm");
        }

        const fetchedProduct = data.product;
        const fetchedVariants = data.variants || fetchedProduct.variants || [];

        setProduct(fetchedProduct);
        setVariants(fetchedVariants);

        // Select variant
        let variantToSelect = null;
        if (sku) {
          variantToSelect = fetchedVariants.find((v) => v.sku === sku);
        }
        if (!variantToSelect && fetchedVariants.length > 0) {
          // Default: pick first in stock, or just first
          variantToSelect = fetchedVariants.find(v => v.stock > 0) || fetchedVariants[0];
        }

        if (variantToSelect) {
          setSelectedVariant(variantToSelect);
        }

        // Set default media tab
        setActiveMediaTab("variant");
        setSelectedImage(0);
      } catch (err) {
        console.error("❌ Error fetching product:", err);
        setError(err.response?.data?.message || err.message || "Không thể tải sản phẩm");
      } finally {
        setIsLoading(false);
      }
    };

    fetchProductData();
    }, [fullSlug, sku]);

  const handleVariantSelect = (variant) => {
    if (!variant) return;

    const storage = getVariantStorageLabel(variant.variantName).toLowerCase();
    
    // ✅ FIX: Preserve warehouse context if present
    let url;
    if (categorySlug === "warehouse") {
       url = `/warehouse/products/${product.baseSlug || product.slug}?sku=${variant.sku}`;
    } else {
      const categoryPath =
        PRODUCT_TYPE_TO_CATEGORY[product.productType?.slug] || "products";
      const baseSlug = product.baseSlug || product.slug;
      
      // Only append storage if it's a valid storage string
      const storageSuffix = storage ? `-${storage}` : "";
      url = `/${categoryPath}/${baseSlug}${storageSuffix}?sku=${variant.sku}`;
    }

    window.history.replaceState(null, "", url);
    updateVariantUI(variant);
  };

  const updateVariantUI = (variant) => {
    const currentImageUrl = selectedVariant?.images?.[selectedImage];
    const newImageIndex = variant.images?.indexOf(currentImageUrl);
    const finalImageIndex = newImageIndex >= 0 ? newImageIndex : 0;
    setSelectedVariant(variant);
    setSelectedImage(finalImageIndex);

    // Reset về tab variant khi đổi màu
    setActiveMediaTab("variant");
  };

  const handleAddToCart = async (isBuyNow = false) => {
    // ... code kiểm tra đăng nhập giữ nguyên ...
    // ✅ KIỂM TRA ĐĂNG NHẬP TRƯỚC
    if (!isAuthenticated || !user) {
      const currentPath = location.pathname + location.search;
      sessionStorage.setItem("redirectAfterLogin", currentPath);

      navigate("/login", {
        state: {
          from: currentPath,
          message: "Vui lòng đăng nhập để thêm sản phẩm vào giỏ hàng",
        },
      });
      return;
    }

    if (!selectedVariant || !product) {
      console.error("❌ Missing product or variant");
      return;
    }

    // ✅ SỬA PHẦN NÀY
    let productType = "Product";
    if (typeof product.productType === "object" && product.productType?.name) {
      productType = product.productType.name;
    } else if (product.productType) {
      productType = String(product.productType);
    }

    console.log("Adding universal product to cart:", {
      productType,
      productTypeObject: product.productType,
      variantId: selectedVariant._id,
      variantName: selectedVariant.variantName,
    });
    if (!productType) {
      alert("Lỗi: Không xác định được loại sản phẩm");
      console.error("❌ productType is undefined", { 
        product, 
        categoryInfo,
        productSource 
      });
      return;
    }

    // ... phần còn lại giữ nguyên ...
    if (!selectedVariant._id) {
      alert("Lỗi: Không xác định được variant ID");
      console.error("❌ variantId is undefined", selectedVariant);
      return;
    }

    // ✅ THÊM SẢN PHẨM VÀO GIỎ
    const result = await addToCart(selectedVariant._id, 1, productType);

    if (result.success) {
      if (isBuyNow) {
        // ✅ MUA NGAY: SET SELECTED + REDIRECT ĐẾN CHECKOUT
        setSelectedForCheckout([selectedVariant._id]);
        navigate("/cart/checkout");
      } else {
        // ✅ THÊM VÀO GIỎ: HIỂN thị MODAL
        setShowAddToCartModal(true);
      }
    } else {
      // ✅ CHI TIẾT LỖI 403 / AUTHZ
      const errorMsg = result.message || "Không thể thêm sản phẩm vào giỏ hàng";
      const errorCode = result.code || result.errorCode || "";
      
      console.warn("[Cart Error]", { errorCode, errorMsg });
      
      if (errorCode === "AUTHZ_BRANCH_FORBIDDEN" || errorCode === "AUTHZ_ACTION_DENIED") {
        alert("Lỗi phân quyền. Vui lòng đăng nhập lại hoặc liên hệ quản trị viên.");
      } else {
        alert(errorMsg);
      }
    }
  };
  const formatPrice = (price) => {
    return new Intl.NumberFormat("vi-VN").format(price) + "đ";
  };

  const getDiscountPercent = () => {
    if (!selectedVariant) return 0;
    const { price, originalPrice } = selectedVariant;
    return originalPrice > price
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : 0;
  };

  const getGroupedVariants = () => {
    const grouped = {};
    variants.forEach((v) => {
      const color = v.color || "Không rõ";
      if (!grouped[color]) grouped[color] = [];
      grouped[color].push(v);
    });
    return grouped;
  };

  const getVariantDisplayName = (variant) => {
    if (!variant) return "";

    const variantName = String(variant.variantName || "").trim();
    const cpuGpuAttr = String(variant?.attributes?.cpuGpu || "").trim();
    const isLegacyMacVariant =
      Boolean(cpuGpuAttr) && /^\d+\s*(GB|TB)\b/i.test(variantName);

    if (isLegacyMacVariant) {
      return cpuGpuAttr;
    }

    if (variantName) {
      return variantName;
    }

    return String(variant?.attributes?.storage || "").trim() || "Mac dinh";
  };

  const getVariantKeyOptions = () => {
    if (!product || !selectedVariant) return [];
    
    // ✅ UPDATED: Support both universal and legacy products
    let keyField = "storage";
    if (productSource === "universal") {
      const filtered = variants.filter((v) => v.color === selectedVariant.color);
      return [...new Set(filtered.map((v) => getVariantDisplayName(v)).filter(Boolean))];
    } else {
      // Legacy products: use VARIANT_KEY_FIELD mapping
      keyField = VARIANT_KEY_FIELD[product.category] || "storage";
      const filtered = variants.filter((v) => v.color === selectedVariant.color);
      return [...new Set(filtered.map((v) => v[keyField]))].sort((a, b) => {
        const parseStorage = (str) => {
          const num = parseInt(str);
          if (str?.includes("TB")) return num * 1000;
          return num || 0;
        };
        const aNum = parseStorage(a) || 0;
        const bNum = parseStorage(b) || 0;
        return aNum - bNum;
      });
    }
  };

  const handleReviewStatsChange = useCallback(({ averageRating, totalReviews }) => {
    setProduct((prev) => {
      if (!prev) return prev;

      const normalizedAverage = Number(averageRating) || 0;
      const normalizedTotal = Number(totalReviews) || 0;

      if (
        prev.averageRating === normalizedAverage &&
        prev.totalReviews === normalizedTotal
      ) {
        return prev;
      }

      return {
        ...prev,
        averageRating: normalizedAverage,
        totalReviews: normalizedTotal,
      };
    });
  }, []);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
        </div>
      </div>
    );
  }

  if (error || !product || !selectedVariant) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <h2 className="text-2xl font-bold mb-4">
          {error || "Không tìm thấy sản phẩm"}
        </h2>
      </div>
    );
  }

  const discount = getDiscountPercent();
  const groupedVariants = getGroupedVariants();
  const variantKeyOptions = getVariantKeyOptions();
  const selectedVariantName = getVariantDisplayName(selectedVariant);
  const afterSalesConfig = resolveAfterSalesConfig(product);
  const warrantyDurationLabel = formatWarrantyDuration(afterSalesConfig.warrantyMonths);
  const serializedTrackingEnabled = isSerializedProduct(product);

  return (
    <div ref={topRef} className="bg-gray-50 min-h-screen">
      <div className="container mx-auto px-2 sm:px-4 py-4">
        {/* Back Button */}
        {(categorySlug === "warehouse" || location.state?.canGoBack) && (
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors font-medium"
          >
            <ChevronLeft className="w-5 h-5" />
            Quay lại danh sách
          </button>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          {/* LEFT: Image Gallery - 7 cols */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-lg overflow-hidden lg:sticky lg:top-4">
              {/* Main Image */}
              <div className="relative aspect-square sm:aspect-video bg-white">
                {" "}
                {/* 16:9 Aspect Ratio */}
                {activeMediaTab === "video" && product.videoUrl ? (
                  // Hiển thị video
                  <div className="w-full h-full p-8">
                    {product.videoUrl.includes("youtube.com") ||
                    product.videoUrl.includes("youtu.be") ? (
                      <iframe
                        src={product.videoUrl.replace("watch?v=", "embed/")}
                        className="w-full h-full rounded-lg"
                        allowFullScreen
                        title="Product Video"
                      />
                    ) : (
                      <video
                        src={product.videoUrl}
                        controls
                        className="w-full h-full rounded-lg"
                      />
                    )}
                  </div>
                ) : (
                  // Hiển thị ảnh (featured hoặc variant)
                  <>
                    {(() => {
                      const currentImages = getCurrentMainImages();
                      return currentImages.length > 0 ? (
                        <img
                          src={
                            currentImages[selectedImage] || "/placeholder.png"
                          }
                          alt={product.name}
                          className="w-full h-full object-contain p-8"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          Không có ảnh
                        </div>
                      );
                    })()}

                    {/* Navigation Arrows */}
                    {(() => {
                      const currentImages = getCurrentMainImages();
                      return (
                        currentImages.length > 1 &&
                        activeMediaTab !== "video" && (
                          <>
                            <button
                              onClick={() => {
                                const images = getCurrentMainImages();
                                setSelectedImage((prev) =>
                                  prev > 0 ? prev - 1 : images.length - 1
                                );
                              }}
                              className="absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 bg-white/90 hover:bg-white rounded-full shadow-lg flex items-center justify-center transition-all"
                            >
                              <ChevronLeft className="w-6 h-6 text-gray-700" />
                            </button>
                            <button
                              onClick={() => {
                                const images = getCurrentMainImages();
                                setSelectedImage((prev) =>
                                  prev < images.length - 1 ? prev + 1 : 0
                                );
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full shadow-lg flex items-center justify-center transition-all"
                            >
                              <ChevronRight className="w-6 h-6 text-gray-700" />
                            </button>

                            {/* Image Counter */}
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-sm">
                              {selectedImage + 1}/{currentImages.length}
                            </div>
                          </>
                        )
                      );
                    })()}
                  </>
                )}
              </div>

              {/* Thumbnail Navigation */}
              <div className="p-2 sm:p-4 border-t bg-gray-50">
                <div
                  className="flex gap-1 sm:gap-2 overflow-x-auto pb-2 -mx-2 px-2 sm:mx-0 sm:px-0"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {/* Tab Nổi bật */}
                  {product.featuredImages?.filter(Boolean).length > 0 && (
                    <button
                      onClick={() => {
                        setActiveMediaTab("featured");
                        setSelectedImage(0);
                      }}
                      className={`flex-shrink-0 w-16 h-16 border-2 rounded-lg flex flex-col items-center justify-center transition-all bg-white ${
                        activeMediaTab === "featured"
                          ? "border-red-600 ring-2 ring-red-200"
                          : "border-gray-300 hover:border-red-500"
                      }`}
                    >
                      <Star
                        className={`w-5 h-5 ${
                          activeMediaTab === "featured"
                            ? "text-red-600"
                            : "text-gray-600"
                        }`}
                      />
                      <span
                        className={`text-xs mt-1 ${
                          activeMediaTab === "featured"
                            ? "text-red-600 font-semibold"
                            : "text-gray-600"
                        }`}
                      >
                        Nổi bật
                      </span>
                    </button>
                  )}

                  {/* Tab Video */}
                  {product.videoUrl && (
                    <button
                      onClick={() => {
                        setActiveMediaTab("video");
                        setSelectedImage(0);
                      }}
                      className={`flex-shrink-0 w-16 h-16 border-2 rounded-lg flex flex-col items-center justify-center transition-all bg-white ${
                        activeMediaTab === "video"
                          ? "border-red-600 ring-2 ring-red-200"
                          : "border-gray-300 hover:border-red-500"
                      }`}
                    >
                      <Play
                        className={`w-5 h-5 ${
                          activeMediaTab === "video"
                            ? "text-red-600"
                            : "text-gray-600"
                        }`}
                      />
                      <span
                        className={`text-xs mt-1 ${
                          activeMediaTab === "video"
                            ? "text-red-600 font-semibold"
                            : "text-gray-600"
                        }`}
                      >
                        Video
                      </span>
                    </button>
                  )}

                  {/* Image thumbnails của variant */}
                  {(() => {
                    const variantImages =
                      selectedVariant?.images?.filter(Boolean) || [];
                    return variantImages.slice(0, 6).map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setActiveMediaTab("variant");
                          setSelectedImage(idx);
                        }}
                        className={`flex-shrink-0 w-16 h-16 border-2 rounded-lg overflow-hidden transition-all ${
                          selectedImage === idx && activeMediaTab === "variant"
                            ? "border-red-600 ring-2 ring-red-200"
                            : "border-gray-300 hover:border-gray-400"
                        }`}
                      >
                        <img
                          src={img}
                          alt=""
                          className="w-full h-full object-contain p-1"
                        />
                      </button>
                    ));
                  })()}

                  {/* More images indicator */}
                  {(() => {
                    const variantImages =
                      selectedVariant?.images?.filter(Boolean) || [];
                    return (
                      variantImages.length > 6 && (
                        <button
                          onClick={() => setActiveMediaTab("variant")}
                          className="flex-shrink-0 w-16 h-16 sm:w-16 sm:h-16  border-2 border-gray-300 rounded-lg flex items-center justify-center bg-white hover:border-red-500 transition-all"
                        >
                          <span className="text-sm font-semibold text-gray-600">
                            +{variantImages.length - 6}
                          </span>
                        </button>
                      )
                    );
                  })()}
                </div>
              </div>

              <div className="hidden lg:block">
                {/* Quick Specs Section */}
                <div className="p-4 bg-gray-50 border-t">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-gray-900">
                      Thông số nổi bật
                    </h3>
                    <button
                      onClick={() => setShowSpecsPanel(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                    >
                      Xem tất cả
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <QuickSpecs specifications={product.specifications} />
                </div>

                {/* Warranty Quick Info */}
                <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-blue-600" />
                      <span className="font-bold text-gray-900">
                        Chính sách bảo hành
                      </span>
                    </div>
                    <button
                      onClick={() => setShowWarrantyPanel(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                    >
                      Chi tiết
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-gray-700">{warrantyDurationLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-gray-700">
                        {serializedTrackingEnabled ? "Theo dõi từng thiết bị" : "Bảo hành theo sản phẩm"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Product Info - 5 cols */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-lg p-4 sm:p-6">
              {/* Product Title & Meta */}
              <div className="mb-4">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
                  {product.name}
                </h1>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    <span className="font-semibold">
                      {product.averageRating.toFixed(1)}
                    </span>
                    <span className="text-gray-600">
                      {product.totalReviews} đánh giá
                    </span>
                  </div>
                </div>
              </div>

              {/* Variant Name Selection */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold mb-3">Biến thể</h3>
                <div className="flex flex-wrap gap-2">
                  {variantKeyOptions.map((option) => {
                    // ✅ UPDATED: Find variant differently for universal vs legacy
                    const candidates = variants.filter(
                      (v) =>
                        v.color === selectedVariant.color &&
                        getVariantDisplayName(v) === option
                    );
                    const variant =
                      candidates.find((v) => v.stock > 0) || candidates[0];
                    const isSelected = selectedVariantName === option;
                    const hasStock = variant?.stock > 0;

                    return (
                      <button
                        key={option}
                        onClick={() =>
                          hasStock && handleVariantSelect(variant)
                        }
                        disabled={!hasStock}
                        className={`relative px-6 py-3 border-2 rounded-lg font-medium transition-all ${
                          isSelected
                            ? "border-red-600 bg-red-50 text-red-600"
                            : hasStock
                            ? "border-gray-300 hover:border-red-400"
                            : "border-gray-200 text-gray-400 cursor-not-allowed opacity-50"
                        }`}
                      >
                        {option}
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color Selection */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold mb-3">Màu sắc</h3>
                <div className="grid grid-cols-2 gap-3">
                  {Object.keys(groupedVariants).map((color) => {
                    const isSelected = selectedVariant.color === color;
                    const hasStock = groupedVariants[color].some(
                      (v) => v.stock > 0
                    );
                    
                    // ✅ UPDATED: Preserve storage preference for both universal and legacy
                    const preferredVariant = groupedVariants[color].find(
                      (v) =>
                        getVariantDisplayName(v) === selectedVariantName &&
                        v.stock > 0
                    );
                    
                    const availableVariant =
                      preferredVariant ||
                      groupedVariants[color].find((v) => v.stock > 0) ||
                      groupedVariants[color][0];

                    const sampleImage = availableVariant?.images?.[0];

                    return (
                      <button
                        key={color}
                        onClick={() =>
                          hasStock &&
                          handleVariantSelect(availableVariant)
                        }
                        disabled={!hasStock}
                        className={`relative flex items-center gap-3 p-3 border-2 rounded-lg transition-all ${
                          isSelected
                            ? "border-red-600 bg-red-50"
                            : hasStock
                            ? "border-gray-300 hover:border-red-400"
                            : "border-gray-200 opacity-50 cursor-not-allowed"
                        }`}
                      >
                        {/* Color Image */}
                        <div className="w-12 h-12 flex-shrink-0 bg-white rounded-lg overflow-hidden">
                          {sampleImage && (
                            <img
                              src={sampleImage}
                              alt={color}
                              className="w-full h-full object-contain"
                            />
                          )}
                        </div>
                        {/* Color Name */}
                        <span
                          className={`text-sm font-medium flex-1 text-left ${
                            isSelected ? "text-red-600" : "text-gray-900"
                          }`}
                        >
                          {color}
                        </span>
                        {/* Check Mark */}
                        {isSelected && (
                          <div className="w-5 h-5 bg-red-600 rounded-full flex items-center justify-center flex-shrink-0">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Price Section */}
              <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-5 mb-6 border border-red-100">
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="text-2xl sm:text-3xl font-bold text-red-600">
                    {formatPrice(selectedVariant.price)}
                  </span>
                  {selectedVariant.originalPrice > selectedVariant.price && (
                    <>
                      <span className="text-lg text-gray-500 line-through">
                        {formatPrice(selectedVariant.originalPrice)}
                      </span>
                      <span className="bg-red-600 text-white px-2 py-1 rounded text-sm font-semibold">
                        -{discount}%
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Promotion Box */}
              <div className="bg-pink-50 rounded-xl p-4 mb-6 border border-pink-200">
                <div className="flex items-center gap-2 mb-3">
                  <div className="bg-red-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                    🔥 Khuyến mãi đặc biệt
                  </div>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-red-600 mt-1">•</span>
                    <span>Giảm ngay 2.800.000đ áp dụng đến 06/11</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-600 mt-1">•</span>
                    <span>AirPods giảm đến 500.000đ khi mua kèm iPhone</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-600 mt-1">•</span>
                    <span>
                      Giảm thêm đến 250k khi mua kèm SIM
                      {/* <button className="text-blue-600 hover:underline">
                        Xem chi tiết
                      </button> */}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-600 mt-1">•</span>
                    <span>Trả góp 0%</span>
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
                {/* NÚT THÊM VÀO GIỎ */}
                <button
                  onClick={() => handleAddToCart(false)} // ← false = không phải mua ngay
                  disabled={cartLoading || selectedVariant.stock === 0}
                  className="flex-1 bg-white hover:bg-gray-50 text-red-600 font-bold py-4 px-6 rounded-lg text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border-2 border-red-600 shadow-lg hover:shadow-xl"
                >
                  <ShoppingCart className="w-5 h-5" />
                  {cartLoading ? "Đang thêm..." : "Thêm vào giỏ"}
                </button>

                {/* NÚT MUA NGAY */}
                <button
                  onClick={() => handleAddToCart(true)} // ← true = mua ngay
                  disabled={cartLoading || selectedVariant.stock === 0}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-6 rounded-lg text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg hover:shadow-xl"
                >
                  {selectedVariant.stock === 0 ? "Hết hàng" : "Mua ngay"}
                </button>
              </div>

              {/* Stock Warning */}
              {selectedVariant.stock > 0 && selectedVariant.stock <= 5 && (
                <div className="bg-orange-50 border-l-4 border-orange-500 p-3 rounded mb-4">
                  <p className="text-sm text-orange-700 font-medium">
                    ⚠️ Chỉ còn {selectedVariant.stock} sản phẩm!
                  </p>
                </div>
              )}

              {/* ===== THÊM SPECS & WARRANTY CHO MOBILE ===== */}
              <div className="lg:hidden space-y-4 mt-6">
                {/* Quick Specs Mobile */}
                <div className="p-4 bg-gray-50 rounded-lg border">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-gray-900">
                      Thông số nổi bật
                    </h3>
                    <button
                      onClick={() => setShowSpecsPanel(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                    >
                      Xem tất cả
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <QuickSpecs specifications={product.specifications} />
                </div>

                {/* Warranty Mobile */}
                <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-blue-600" />
                      <span className="font-bold text-gray-900">
                        Chính sách bảo hành
                      </span>
                    </div>
                    <button
                      onClick={() => setShowWarrantyPanel(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                    >
                      Chi tiết
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-gray-700">{warrantyDurationLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-gray-700">
                        {serializedTrackingEnabled ? "Theo dõi từng thiết bị" : "Bảo hành theo sản phẩm"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Similar Products Section */}
      <div className="mt-4 sm:mt-8">
        <SimilarProducts
          productId={product._id}
          category={product.category}
          currentProduct={product} // ← THÊM prop này để tính điểm tốt hơn
        />
      </div>

      {/* Reviews Section - Độc lập */}
      <div className="mt-4 sm:mt-8 bg-white rounded-lg p-4 sm:p-8 sm:px-24">
        <h2 className="text-2xl font-bold mb-6">Đánh giá sản phẩm</h2>
        <ReviewsTab
          productId={product._id}
          product={product}
          onReviewStatsChange={handleReviewStatsChange}
        />
      </div>

      {/* Slide-in Panels */}
      <SlideInPanel
        isOpen={showSpecsPanel}
        onClose={() => setShowSpecsPanel(false)}
        title="Thông số kỹ thuật"
      >
        <SpecificationsTab specifications={product.specifications} />
      </SlideInPanel>

      <SlideInPanel
        isOpen={showWarrantyPanel}
        onClose={() => setShowWarrantyPanel(false)}
        title="Chính sách & Bảo hành"
      >
        <WarrantyTab product={product} />
      </SlideInPanel>

      {/* Add to Cart Modal */}
      <AddToCartModal
        isOpen={showAddToCartModal}
        onClose={() => setShowAddToCartModal(false)}
        product={product}
        variant={selectedVariant}
      />
    </div>
  );
};

export default ProductDetailPage;
