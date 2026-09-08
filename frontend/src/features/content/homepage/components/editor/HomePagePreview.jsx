// ============================================
// FILE: frontend/src/components/admin/homepage/HomePagePreview.jsx
// Live preview of homepage with dynamic sections (no images)
// ============================================

import React from "react";
import { cn } from "@/shared/lib/utils";

const HomePagePreview = ({ sections, mode = "desktop" }) => {
  const enabledSections = sections
    ?.filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  const renderSection = (section) => {
    switch (section.type) {
      case "hero":
        return (
          <div className="aspect-[24/9] bg-gray-200 rounded-lg overflow-hidden relative">
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              Hero Banner
            </div>
          </div>
        );

      case "secondary-banners":
        return (
          <div className="grid grid-cols-2 gap-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="aspect-[21/9] bg-gray-200 rounded-lg overflow-hidden"
              >
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  Secondary Banner {i}
                </div>
              </div>
            ))}
          </div>
        );

      case "promo-strip":
        return (
          <div className="bg-gray-200 text-black text-center py-2 text-xs font-medium ">
            Promo Strip
          </div>
        );

      case "category-nav":
        return (
          <div className="bg-gray-100 rounded-lg p-4 text-center text-xs text-gray-600">
            Danh mục động từ Product Types
          </div>
        );
      case "deals-grid":
        return (
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="aspect-video bg-gray-200 rounded-lg overflow-hidden"
              >
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  Deal {i}
                </div>
              </div>
            ))}
          </div>
        );

      case "magic-deals":
        return (
          <div className="bg-gray-100 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Left banner */}
              <div className="md:col-span-2">
                <div className="aspect-[21/9] bg-gray-200 rounded-lg overflow-hidden">
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    Magic Deal
                  </div>
                </div>
              </div>

              {/* Right categories */}
              <div className="md:col-span-2">
                <div className="grid grid-cols-2 gap-2 h-full">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="aspect-square bg-gray-200 rounded-lg overflow-hidden"
                    >
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        Magic Deal {i}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case "products-new":
      case "products-topSeller":
      case "category-section": {
        const categoryName =
          section.config?.categoryName || section.config?.categoryFilter || "Category";
        return (
          <div>
            <h3 className="text-sm font-semibold mb-2">
              {section.title || categoryName}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="bg-white border rounded-lg p-2 space-y-1"
                >
                  <div className="aspect-square bg-gray-200 rounded" />
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-2 bg-gray-200 rounded w-1/2" />
                </div>
              ))}
            </div>
          </div>
        );
      }
      case "iphone-showcase":
        return (
          <div className="flex gap-2 overflow-x-auto">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex-shrink-0 w-32 aspect-[3/4] bg-gray-200 rounded-lg"
              >
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  iPhone Showcase {i}
                </div>
              </div>
            ))}
          </div>
        );

      default:
        return (
          <div className="bg-gray-100 rounded-lg p-4 text-center text-xs text-gray-500">
            {section.type}
          </div>
        );
    }
  };

  return (
    <div
      className={cn(
        "bg-white shadow-lg overflow-auto",
        mode === "mobile" ? "max-w-[375px] mx-auto" : "w-full"
      )}
    >
      <div className="space-y-4 p-4">
        {enabledSections?.map((section) => (
          <div key={section.id} className="space-y-2">
            {renderSection(section)}
          </div>
        ))}

        {!enabledSections?.length && (
          <div className="text-center py-12 text-gray-400">
            No enabled sections
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePagePreview;
