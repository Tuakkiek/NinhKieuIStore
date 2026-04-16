import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Package, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ProductCard, ProductFilters } from "@/features/catalog";
import { Loading } from "@/shared/ui/Loading";
import { searchAPI } from "../api/search.api";
import { usePermission } from "@/features/auth";
import {
  createEmptyFilters,
  toggleFilterValue,
  useProductFilters,
} from "../hooks/useProductFilters";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

const SEARCH_AVAILABLE_FILTERS = {
  condition: ["NEW", "LIKE_NEW"],
  storage: ["64GB", "128GB", "256GB", "512GB", "1TB"],
};

const ITEMS_PER_PAGE = 12;

const SearchResultsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchQuery = searchParams.get("s")?.trim() || "";
  const pageParam = Math.max(
    1,
    Number.parseInt(searchParams.get("page") || "1", 10) || 1,
  );

  const [allProducts, setAllProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showMobileFilter, setShowMobileFilter] = useState(false);
  const [correctedQuery, setCorrectedQuery] = useState(null);
  const [extractedAttributes, setExtractedAttributes] = useState(null);
  const [filters, setFilters] = useState(() =>
    createEmptyFilters(SEARCH_AVAILABLE_FILTERS),
  );
  const [priceRange, setPriceRange] = useState({ min: "", max: "" });

  const canManageProducts = usePermission(["product.update", "product.delete"], {
    mode: "any",
  });

  useEffect(() => {
    setFilters(createEmptyFilters(SEARCH_AVAILABLE_FILTERS));
    setPriceRange({ min: "", max: "" });
  }, [searchQuery]);

  useEffect(() => {
    if (!searchQuery) {
      navigate("/", { replace: true });
      return;
    }

    const fetchSearchResults = async () => {
      setIsLoading(true);

      try {
        const response = await searchAPI.search({
          q: searchQuery,
          limit: 100,
        });

        if (response?.data?.success) {
          const data = response.data.data || {};
          setAllProducts(Array.isArray(data.results) ? data.results : []);
          setCorrectedQuery(data.correctedQuery || null);
          setExtractedAttributes(data.extractedAttributes || null);
        } else {
          setAllProducts([]);
          setCorrectedQuery(null);
          setExtractedAttributes(null);
        }
      } catch (error) {
        console.error("SearchResultsPage: search error", error);
        setAllProducts([]);
        setCorrectedQuery(null);
        setExtractedAttributes(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSearchResults();
  }, [searchQuery, navigate]);

  const { filteredProducts, effectiveFilters, activeFiltersCount } =
    useProductFilters({
      products: allProducts,
      filters,
      priceRange,
      fallbackFilters: SEARCH_AVAILABLE_FILTERS,
    });

  useEffect(() => {
    if (pageParam !== 1) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("page", "1");
        return next;
      });
    }
  }, [filters, priceRange, pageParam, setSearchParams]);

  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const currentProducts = useMemo(
    () =>
      filteredProducts.slice(
        (pageParam - 1) * ITEMS_PER_PAGE,
        pageParam * ITEMS_PER_PAGE,
      ),
    [filteredProducts, pageParam],
  );

  useEffect(() => {
    if (pageParam > 1 && totalPages > 0 && pageParam > totalPages) {
      setSearchParams({ s: searchQuery, page: String(totalPages) });
    }
  }, [pageParam, totalPages, searchQuery, setSearchParams]);

  const handleFilterChange = (type, value) => {
    setFilters((prev) => toggleFilterValue(prev, type, value));
  };

  const handlePriceChange = (nextRange) => {
    setPriceRange(nextRange);
  };

  const handleClearFilters = () => {
    setFilters(createEmptyFilters(effectiveFilters));
    setPriceRange({ min: "", max: "" });
  };

  const handlePageChange = (nextPage) => {
    setSearchParams({ s: searchQuery, page: String(nextPage) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (isLoading) return <Loading />;

  return (
    <div className="min-h-screen bg-gray-50 pt-6 pb-12">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold">
            Kết quả tìm kiếm:{" "}
            <span className="text-blue-600">"{searchQuery}"</span>
          </h1>

          {correctedQuery && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span className="text-gray-600">
                Da tu dong sua thanh:{" "}
                <span className="text-blue-600 font-medium">{correctedQuery}</span>
              </span>
            </div>
          )}

          {extractedAttributes && (
            <div className="mt-2 flex flex-wrap gap-2">
              {extractedAttributes.storage && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                  {extractedAttributes.storage}
                </span>
              )}
              {extractedAttributes.color && (
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                  Mau: {extractedAttributes.color}
                </span>
              )}
              {extractedAttributes.model && (
                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                  Model: {extractedAttributes.model}
                </span>
              )}
            </div>
          )}

          <p className="text-gray-600 mt-2">
            Tìm thấy <strong>{filteredProducts.length}</strong> sản phẩm
          </p>
        </div>

        <div className="flex gap-8">
          <aside className="hidden lg:block w-80 flex-shrink-0">
            <div className="sticky top-24 bg-white rounded-xl shadow-sm p-5">
              <ProductFilters
                filters={filters}
                onFilterChange={handleFilterChange}
                priceRange={priceRange}
                onPriceChange={handlePriceChange}
                availableFilters={effectiveFilters}
                onClearFilters={handleClearFilters}
                activeFiltersCount={activeFiltersCount}
                hideCategory={true}
              />
            </div>
          </aside>

          <main className="flex-1">
            <div className="mb-5 lg:hidden">
              <Button
                variant="outline"
                size="lg"
                className="w-full h-12 flex items-center justify-center gap-3 text-base font-medium"
                onClick={() => setShowMobileFilter(true)}
              >
                <SlidersHorizontal className="w-5 h-5" />
                Bo loc
                {activeFiltersCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    {activeFiltersCount}
                  </span>
                )}
              </Button>
            </div>

            <Sheet open={showMobileFilter} onOpenChange={setShowMobileFilter}>
              <SheetContent side="left" className="w-[90vw] sm:w-[400px] p-0">
                <SheetHeader className="sticky top-0 bg-white border-b z-10 px-6 py-5">
                  <div className="flex items-center justify-between">
                    <SheetTitle className="text-xl font-bold">
                      Bo loc tim kiem
                    </SheetTitle>
                    <button
                      onClick={() => setShowMobileFilter(false)}
                      className="p-2 hover:bg-gray-100 rounded-full transition"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                </SheetHeader>

                <div className="px-6 pt-4 pb-36 overflow-y-auto">
                  <ProductFilters
                    filters={filters}
                    onFilterChange={handleFilterChange}
                    priceRange={priceRange}
                    onPriceChange={handlePriceChange}
                    availableFilters={effectiveFilters}
                    onClearFilters={handleClearFilters}
                    activeFiltersCount={activeFiltersCount}
                    hideCategory={true}
                  />
                </div>

                <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-2xl z-20">
                  <div className="flex gap-3 max-w-md mx-auto">
                    <Button
                      size="lg"
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => setShowMobileFilter(false)}
                    >
                      Xem {filteredProducts.length.toLocaleString("vi-VN")} ket qua
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            {currentProducts.length > 0 ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                  {currentProducts.map((product) => (
                    <div key={product._id} className="relative">
                      <ProductCard product={product} showVariantsBadge={true} />
                      {canManageProducts && product._relevance > 0 && (
                        <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold">
                          {product._relevance}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="mt-12 flex justify-center items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      disabled={pageParam === 1}
                      onClick={() => handlePageChange(pageParam - 1)}
                    >
                      Truoc
                    </Button>

                    {Array.from({ length: Math.min(totalPages, 7) }, (_, index) => {
                      const page = index + 1;
                      if (totalPages > 7 && index === 6) {
                        return <span key="dots">...</span>;
                      }
                      return (
                        <Button
                          key={page}
                          variant={pageParam === page ? "default" : "outline"}
                          onClick={() => handlePageChange(page)}
                        >
                          {page}
                        </Button>
                      );
                    })}

                    {totalPages > 7 && (
                      <Button
                        variant={pageParam === totalPages ? "default" : "outline"}
                        onClick={() => handlePageChange(totalPages)}
                      >
                        {totalPages}
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      disabled={pageParam === totalPages}
                      onClick={() => handlePageChange(pageParam + 1)}
                    >
                      Sau
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                <Package className="w-20 h-20 text-gray-300 mx-auto mb-6" />
                <h3 className="text-2xl font-bold text-gray-800 mb-3">
                  Khong tim thay san pham nao
                </h3>
                <p className="text-gray-500 mb-8 max-w-md mx-auto">
                  Thu thay doi tu khoa hoac bo bot bo loc de xem them ket qua.
                </p>
                <Button onClick={handleClearFilters} size="lg">
                  Xoa bo loc va thu lai
                </Button>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default SearchResultsPage;
