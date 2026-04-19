import React from "react";
import { Link } from "react-router-dom";
import { Search, ShoppingCart, User } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { CategoryDropdown } from "@/features/catalog";
const PublicHeader = ({
  isAuthenticated,
  user,
  cartItemCount,
  canManageCart,
  navigate,
  handleProfileNavigation,
  setSearchOpen,
}) => (
      <header className="fixed top-0 left-0 right-0 bg-black text-white py-3 px-4 md:py-4 md:px-6 z-40">
        <div className="max-w-7xl mx-auto">
          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between gap-3">
            <Link
              to="/"
              className="flex items-center justify-center transition-all duration-300 hover:scale-105"
            >
              <img
                src="/logo.jpg"
                alt="Ninh Kiều iSTORE"
                className="h-10 sm:h-12 w-auto rounded-full object-cover"
              />
            </Link>

            <div className="flex-1">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Bạn muốn..."
                  onClick={() => setSearchOpen(true)}
                  readOnly
                  className="w-full bg-white/10 text-white rounded-full py-2 px-4 pr-10 focus:outline-none placeholder-gray-400 text-sm cursor-pointer"
                />
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              </div>
            </div>

            {canManageCart && (
              <button
                onClick={() => navigate("/cart")}
                className="bg-white text-black rounded-full p-2.5 relative"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartItemCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center p-0 text-[10px] bg-red-500">
                    {cartItemCount}
                  </Badge>
                )}
              </button>
            )}
          </div>

          {/* Desktop Header */}
          <div className="hidden md:flex items-center justify-between gap-6">
            <Link
              to="/"
              className="flex items-center justify-center transition-all duration-300 hover:scale-105"
            >
              <img
                src="/logo.jpg"
                alt="Ninh Kiều iSTORE"
                className="h-16 w-auto rounded-[30px] object-cover"
              />
            </Link>

            <div className="flex-1 max-w-md">
              <div className="relative transition-all duration-300 hover:scale-105">
                <input
                  type="text"
                  placeholder="Tìm kiếm sản phẩm..."
                  onClick={() => setSearchOpen(true)}
                  readOnly
                  className="w-full bg-white text-black rounded-full py-3 px-6 pr-12 focus:outline-none transition-colors duration-300 hover:bg-gray-100 cursor-pointer"
                />
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-black w-5 h-5 transition-colors duration-300 hover:text-gray-700" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              {canManageCart && (
                <button
                  onClick={() => navigate("/cart")}
                  className="bg-white text-black rounded-full px-6 py-3 flex items-center gap-2 transition-all duration-300 hover:bg-gray-200 hover:scale-105 relative"
                >
                  <ShoppingCart className="w-5 h-5 transition-colors duration-300 hover:text-gray-700" />
                  <span className="font-medium transition-colors duration-300 hover:text-gray-700">
                    Giỏ hàng
                  </span>
                  {cartItemCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-red-500 hover:bg-red-600 transition-colors duration-300">
                      {cartItemCount}
                    </Badge>
                  )}
                </button>
              )}

              {isAuthenticated ? (
                <button
                  onClick={handleProfileNavigation}
                  className="bg-white text-black rounded-full px-6 py-3 flex items-center gap-2 transition-all duration-300 hover:bg-gray-200 hover:scale-105"
                >
                  <User className="w-5 h-5 transition-colors duration-300 hover:text-gray-700" />
                  <span className="font-medium transition-colors duration-300 hover:text-gray-700">
                    {user?.fullName}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => navigate("/login")}
                  className="bg-white text-black rounded-full px-6 py-3 flex items-center gap-2 transition-all duration-300 hover:bg-gray-200 hover:scale-105"
                >
                  <User className="w-5 h-5 transition-colors duration-300 hover:text-gray-700" />
                  <span className="font-medium transition-colors duration-300 hover:text-gray-700">
                    Đăng nhập
                  </span>
                </button>
              )}

              <CategoryDropdown />
            </div>
          </div>
        </div>
      </header>
);
export default PublicHeader;
