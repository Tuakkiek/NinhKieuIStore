// ============================================
// FILE: frontend/src/components/shared/SearchOverlay.jsx
// Dynamic search overlay based on product types + universal products
// ============================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Package, Search, X } from "lucide-react";
import { productTypeAPI, universalProductAPI } from "@/features/catalog";

const TYPO_MAPPINGS = {
  ip: "iphone",
  ifone: "iphone",
  iphon: "iphone",
  ipadz: "ipad",
  macbok: "macbook",
  aripod: "airpods",
  wach: "watch",
  "tai nghe": "airpods",
  "may tinh bang": "ipad",
  "dien thoai": "iphone",
};

const DEFAULT_QUICK_LINKS = [
  {
    id: "all-products",
    name: "Tất cả sản phẩm",
    description: "Xem toàn bộ danh sách sản phẩm",
    icon: "",
    to: "/products?page=1",
  },
];

const DEFAULT_SUGGESTED_KEYWORDS = [
  "dien thoai",
  "tablet",
  "laptop",
  "tai nghe",
  "phu kien",
];

const normalizeText = (value = "") =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const isLikelyImageUrl = (value = "") => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return true;
  if (trimmed.startsWith("/")) return true;
  return /\.(png|jpe?g|webp|svg|gif|avif)$/i.test(trimmed);
};

const correctQuery = (rawQuery = "") => {
  let normalized = normalizeText(rawQuery);
  if (!normalized) return "";

  Object.entries(TYPO_MAPPINGS).forEach(([wrong, right]) => {
    const regex = new RegExp(`\\b${wrong}\\b`, "gi");
    normalized = normalized.replace(regex, right);
  });

  return normalized.replace(/\s+/g, " ").trim();
};

const getBestVariant = (variants = []) => {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  let selected = variants.find((item) => Number(item?.stock || 0) > 0);
  if (!selected) selected = variants[0];
  return selected || null;
};

const getDisplayImage = (product) => {
  const variant = getBestVariant(product?.variants);
  return (
    variant?.images?.[0] ||
    product?.featuredImages?.[0] ||
    product?.images?.[0] ||
    ""
  );
};

const getDisplayPrice = (product) => {
  const variant = getBestVariant(product?.variants);
  if (Number.isFinite(Number(variant?.price))) return Number(variant.price);
  if (Number.isFinite(Number(product?.price))) return Number(product.price);

  const variantPrices = (Array.isArray(product?.variants) ? product.variants : [])
    .map((item) => Number(item?.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  return variantPrices.length ? Math.min(...variantPrices) : 0;
};

const highlightText = (text, query) => {
  const source = String(text || "");
  const tokens = correctQuery(query).split(" ").filter(Boolean);
  if (!tokens.length) return source;

  const escapedTokens = tokens.map((token) =>
    token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const regex = new RegExp(`(${escapedTokens.join("|")})`, "gi");
  const parts = source.split(regex);

  return parts.map((part, index) => {
    const isMatch = tokens.some(
      (token) => normalizeText(part) === normalizeText(token)
    );
    if (!isMatch) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <mark
        key={`${part}-${index}`}
        className="bg-blue-500/20 text-blue-400 px-0.5 rounded"
      >
        {part}
      </mark>
    );
  });
};

const buildProductUrl = (product) => {
  const variant = getBestVariant(product?.variants);
  const baseSlug = product?.baseSlug || product?.slug || variant?.slug || "";
  if (!baseSlug) return "/products";
  if (variant?.sku) return `/products/${baseSlug}?sku=${variant.sku}`;
  return `/products/${baseSlug}`;
};

const SearchResultItem = ({ product, onClose, query }) => {
  const navigate = useNavigate();
  const image = getDisplayImage(product);
  const price = getDisplayPrice(product);

  const handleClick = () => {
    navigate(buildProductUrl(product));
    onClose();
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-4 p-3 bg-gray-900/30 rounded-lg hover:bg-gray-900/50 transition-all text-left w-full group"
    >
      <div className="w-16 h-16 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
        {image ? (
          <img
            src={image}
            alt={product?.name || "Product"}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform"
          />
        ) : (
          <div className="w-full h-full bg-gray-700 flex items-center justify-center">
            <Search className="w-6 h-6 text-gray-500" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="text-white font-medium text-sm group-hover:text-blue-400 transition-colors truncate">
          {highlightText(product?.name || product?.model || "", query)}
        </h4>
        <p className="text-gray-500 text-xs mt-0.5 truncate">
          {product?._categoryName || "Sản phẩm"}
        </p>
        <p className="text-blue-400 text-sm font-semibold mt-1">
          {new Intl.NumberFormat("vi-VN", {
            style: "currency",
            currency: "VND",
          }).format(price)}
        </p>
      </div>

      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
    </button>
  );
};

const SearchOverlay = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const searchInputRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [productTypes, setProductTypes] = useState([]);
  const [loadingProductTypes, setLoadingProductTypes] = useState(false);

  const correctedQuery = useMemo(() => correctQuery(searchQuery), [searchQuery]);

  const quickLinks = useMemo(() => {
    if (productTypes.length === 0) return DEFAULT_QUICK_LINKS;

    return productTypes.slice(0, 8).map((item, index) => {
      const typeId = String(item?._id || "").trim();
      const typeName = String(item?.name || "Sản phẩm").trim();
      const params = new URLSearchParams();

      if (typeId) {
        params.set("productType", typeId);
        params.set("productTypeName", typeName);
      } else {
        params.set("search", typeName);
      }
      params.set("page", "1");

      return {
        id: typeId || String(item?.slug || `product-type-${index}`),
        name: typeName,
        description: String(item?.description || "").trim(),
        icon: isLikelyImageUrl(item?.icon) ? String(item.icon).trim() : "",
        to: `/products?${params.toString()}`,
      };
    });
  }, [productTypes]);

  const loadProductTypes = useCallback(async () => {
    try {
      setLoadingProductTypes(true);
      const response = await productTypeAPI.getPublic({ limit: 100 });
      const items = response?.data?.data?.productTypes;
      setProductTypes(Array.isArray(items) ? items : []);
    } catch (error) {
      console.error("SearchOverlay: failed to load product types", error);
      setProductTypes([]);
    } finally {
      setLoadingProductTypes(false);
    }
  }, []);

  const searchProducts = useCallback(async (query) => {
    const normalizedQuery = correctQuery(query);
    if (!normalizedQuery) return [];

    const tokens = normalizedQuery.split(" ").filter(Boolean);
    const toScore = (product) => {
      const haystack = normalizeText(
        `${product?.name || ""} ${product?.model || ""} ${product?.productType?.name || ""}`
      );

      let score = 0;
      if (haystack.includes(normalizedQuery)) score += 60;

      tokens.forEach((token) => {
        if (haystack.includes(token)) score += 20;
      });

      if (Number(product?.salesCount) > 0) {
        score += Math.min(Number(product.salesCount), 20);
      }

      return score;
    };

    try {
      const mainResponse = await universalProductAPI.getAll({
        search: normalizedQuery,
        limit: 100,
        page: 1,
      });

      let products = mainResponse?.data?.data?.products || [];

      if (products.length < 3 && tokens.length > 1) {
        const fallbackResponse = await universalProductAPI.getAll({
          search: tokens[0],
          limit: 60,
          page: 1,
        });

        const fallbackProducts = fallbackResponse?.data?.data?.products || [];
        const existingIds = new Set(products.map((item) => String(item?._id || "")));
        fallbackProducts.forEach((item) => {
          const id = String(item?._id || "");
          if (id && !existingIds.has(id)) {
            existingIds.add(id);
            products.push(item);
          }
        });
      }

      return products
        .map((product) => ({
          ...product,
          _score: toScore(product),
          _categoryName: product?.productType?.name || "Sản phẩm",
        }))
        .sort((a, b) => {
          if (b._score !== a._score) return b._score - a._score;
          return new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0);
        })
        .slice(0, 10);
    } catch (error) {
      console.error("SearchOverlay: search error", error);
      return [];
    }
  }, []);

  const handleViewAll = useCallback(() => {
    const query = correctedQuery || correctQuery(searchQuery);
    if (!query) return;
    navigate(`/tim-kiem?s=${encodeURIComponent(query)}`);
    onClose();
  }, [correctedQuery, navigate, onClose, searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    loadProductTypes();
  }, [isOpen, loadProductTypes]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchProducts(searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, searchProducts]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!isOpen) return;
      if (event.key === "Escape") onClose();
      if (event.key === "Enter") handleViewAll();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleViewAll, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [isOpen]);

  const suggestedKeywords = useMemo(() => {
    if (productTypes.length > 0 && quickLinks.length > 0) {
      return quickLinks.slice(0, 5).map((item) => item.name);
    }
    return DEFAULT_SUGGESTED_KEYWORDS;
  }, [productTypes.length, quickLinks]);

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        isOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      <div
        className={`absolute top-0 left-0 right-0 bg-black shadow-2xl transform transition-all duration-500 ease-out ${
          isOpen ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
      >
        <div className="relative z-10">
          <div className="max-w-4xl mx-auto px-6 py-8">
            <div className="relative mb-8">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Tìm kiếm sản phẩm..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full bg-gray-900/50 text-gray-300 rounded-lg py-4 pl-12 pr-6 focus:outline-none focus:bg-gray-900 placeholder-gray-500 transition-colors"
                  />
                </div>
                <button
                  onClick={onClose}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {!searchQuery && (
              <div className="mb-8">
                <h3 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-4">
                  Danh mục sản phẩm
                </h3>
                <div className="space-y-1">
                  {quickLinks.map((link) => (
                    <Link
                      key={link.id}
                      to={link.to}
                      onClick={onClose}
                      className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors py-2.5 px-2 rounded-lg hover:bg-gray-900/30 group"
                    >
                      <div className="w-8 h-8 bg-gray-900/60 rounded-md border border-gray-800 overflow-hidden flex items-center justify-center flex-shrink-0">
                        {link.icon ? (
                          <img
                            src={link.icon}
                            alt={link.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Package className="w-4 h-4 text-gray-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm block truncate">{link.name}</span>
                        {link.description ? (
                          <span className="text-xs text-gray-600 block truncate">
                            {link.description}
                          </span>
                        ) : null}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-blue-500 transition-colors" />
                    </Link>
                  ))}
                  {loadingProductTypes && (
                    <p className="text-xs text-gray-500 px-2 py-1">
                      Đang tải danh mục sản phẩm...
                    </p>
                  )}
                </div>
              </div>
            )}

            {searchQuery && (
              <div>
                <h3 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-4">
                  {isSearching
                    ? "Đang tìm kiếm..."
                    : `Kết quả cho "${correctedQuery || searchQuery}"`}
                </h3>

                {isSearching ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                  </div>
                ) : searchResults.length > 0 ? (
                  <>
                    <div className="mb-4 flex justify-between items-center">
                      <p className="text-sm text-gray-400">
                        Tìm thấy {searchResults.length} sản phẩm
                      </p>
                      <button
                        onClick={handleViewAll}
                        className="text-sm text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                      >
                        Xem tất cả kết quả
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {searchResults.map((product) => (
                        <SearchResultItem
                          key={product._id}
                          product={product}
                          onClose={onClose}
                          query={searchQuery}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <Search className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                    <p className="text-gray-500 text-sm">
                      Không tìm thấy sản phẩm phù hợp với "{searchQuery}"
                    </p>
                    <p className="text-gray-600 text-xs mt-2 mb-4">
                      Thử với từ khóa khác
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {suggestedKeywords.map((item) => (
                        <button
                          key={item}
                          onClick={() => setSearchQuery(item)}
                          className="px-3 py-1.5 bg-gray-900/30 hover:bg-gray-900/50 rounded-full text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchOverlay;
