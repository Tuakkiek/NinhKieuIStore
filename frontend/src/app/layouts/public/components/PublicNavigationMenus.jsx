import React from "react";
import { Link } from "react-router-dom";
import { Clock, MapPin, Menu, Phone, User, X } from "lucide-react";
import { CategoryDropdown } from "@/features/catalog";

const PublicNavigationMenus = ({
  isAuthenticated,
  user,
  canManageCart,
  canAccessCustomerSelfService,
  categoryMenuOpen,
  setCategoryMenuOpen,
  storeMenuOpen,
  setStoreMenuOpen,
  contactMenuOpen,
  setContactMenuOpen,
  desktopStoreMenuOpen,
  setDesktopStoreMenuOpen,
  districts,
  selectedDistrict,
  setSelectedDistrict,
  filteredStores,
  desktopSelectedDistrict,
  setDesktopSelectedDistrict,
  stores,
  navigate,
  handleProfileNavigation,
}) => (
      <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40">
        <div
          className={`grid h-16 ${
            isAuthenticated && canAccessCustomerSelfService
              ? "grid-cols-5"
              : "grid-cols-4"
          }`}
        >
          <Link
            to="/"
            className="flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-red-500 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            <span className="text-[10px] font-medium">Trang ch\u1ee7</span>
          </Link>

          <button
            onClick={() => setCategoryMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-red-500 transition-colors"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">Danh m\u1ee5c</span>
          </button>

          {isAuthenticated && canAccessCustomerSelfService && (
            <button
              onClick={() => setStoreMenuOpen(!storeMenuOpen)}
              className="flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-red-500 transition-colors"
            >
              <MapPin className="w-5 h-5" />
              <span className="text-[10px] font-medium">C\u1eeda h\u00e0ng</span>
            </button>
          )}

          <button
            onClick={() => setContactMenuOpen(!contactMenuOpen)}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-red-500 transition-colors"
          >
            <Phone className="w-5 h-5" />
            <span className="text-[10px] font-medium">Li\u00ean h\u1ec7</span>
          </button>

          {isAuthenticated ? (
            <button
              onClick={handleProfileNavigation}
              className="flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-red-500 transition-colors"
            >
              <User className="w-5 h-5" />
              <span className="text-[10px] font-medium">T\u00e0i kho\u1ea3n</span>
            </button>
          ) : (
            <button
              onClick={() => navigate("/login")}
              className="flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-red-500 transition-colors"
            >
              <User className="w-5 h-5" />
              <span className="text-[10px] font-medium">\u0110\u0103ng nh\u1eadp</span>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Category Menu - Using CategoryDropdown */}
      {categoryMenuOpen && (
        <div className="md:hidden">
          <CategoryDropdown
            isMobileMenu={true}
            isOpen={categoryMenuOpen}
            onClose={() => setCategoryMenuOpen(false)}
          />
        </div>
      )}

      {/* Mobile Store Menu */}
      {storeMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bottom-16 z-50 bg-black/50"
          onClick={() => setStoreMenuOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white text-gray-900 p-4 flex items-center justify-between border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center gap-3">
                <MapPin className="w-6 h-6 text-red-500" />
                <span className="text-lg font-semibold">C\u1eeda h\u00e0ng</span>
              </div>
              <button
                onClick={() => setStoreMenuOpen(false)}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              <div className="w-1/3 bg-gray-50 overflow-y-auto border-r border-gray-200">
                {districts.map((districtName, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedDistrict(idx)}
                    className={`w-full text-left px-3 py-4 border-b border-gray-200 transition-colors ${
                      selectedDistrict === idx
                        ? "bg-white text-black font-semibold"
                        : "text-gray-600 hover:text-black hover:bg-gray-100"
                    }`}
                  >
                    <span className="text-xs font-medium">{districtName}</span>
                  </button>
                ))}
              </div>
              <div className="flex-1 bg-white overflow-y-auto">
                <div className="p-4">
                  <h2 className="text-gray-900 text-lg font-bold mb-4">
                    {districts[selectedDistrict]}
                  </h2>
                  {filteredStores.length > 0 ? (
                    <div className="space-y-3">
                      {filteredStores.map((store) => (
                        <div
                          key={store.id}
                          className="bg-gray-50 rounded-xl p-4 border border-gray-200"
                        >
                          <div className="flex items-start gap-3 mb-3">
                            <div className="bg-white rounded-lg p-2 flex-shrink-0 border border-gray-200">
                              <MapPin className="w-5 h-5 text-red-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-gray-900 text-sm font-semibold mb-1 flex items-center gap-2">
                                {store.name}
                                {store.isMain && (
                                  <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                                    Ch\u00ednh
                                  </span>
                                )}
                              </h3>
                              <p className="text-gray-600 text-xs">
                                Qu\u1eadn {store.district}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                              <p className="text-gray-700 text-xs leading-relaxed">
                                {store.address}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" />
                              <a
                                href={`tel:${store.phone}`}
                                className="text-blue-600 text-xs hover:underline"
                              >
                                {store.phone}
                              </a>
                            </div>
                            <div className="flex items-start gap-2">
                              <Clock className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
                              <p className="text-gray-700 text-xs">
                                {store.hours}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                store.address
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 bg-black text-white rounded-full py-2 px-4 text-xs font-semibold hover:bg-gray-800 transition-colors text-center"
                            >
                              Ch\u1ec9 \u0111\u01b0\u1eddng
                            </a>
                            <a
                              href={`tel:${store.phone}`}
                              className="flex-1 bg-white text-black rounded-full py-2 px-4 text-xs font-semibold hover:bg-gray-100 transition-colors text-center border border-gray-300"
                            >
                              G\u1ecdi ngay
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                      <MapPin className="w-16 h-16 mb-4" />
                      <p className="text-sm">Kh\u00f4ng c\u00f3 c\u1eeda h\u00e0ng</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Mobile Contact Menu */}
      {contactMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bottom-16 z-50 bg-black/50"
          onClick={() => setContactMenuOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white text-gray-900 p-4 flex items-center justify-between border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center gap-3">
                <Phone className="w-6 h-6 text-red-500" />
                <div>
                  <span className="text-lg font-semibold">T\u1ed5ng \u0111\u00e0i h\u1ed7 tr\u1ee3</span>
                  <p className="text-xs text-gray-600">(T\u1eeb 8:00-21:00)</p>
                </div>
              </div>
              <button
                onClick={() => setContactMenuOpen(false)}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-white p-4">
              <div className="space-y-3">
                <a
                  href="tel:1900633909"
                  className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition-colors block"
                >
                  <p className="text-gray-600 text-xs mb-2">
                    Hotline b\u00e1n h\u00e0ng:
                  </p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-red-500" />
                    <span className="text-red-500 font-bold text-base">
                      1900.633.909 (B\u1ea5m ph\u00edm 1)
                    </span>
                  </div>
                </a>
                <a
                  href="tel:0932640089"
                  className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition-colors block"
                >
                  <p className="text-gray-600 text-xs mb-2">
                    Kh\u00e1ch h\u00e0ng doanh nghi\u1ec7p:
                  </p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-red-500" />
                    <span className="text-red-500 font-bold text-base">
                      0932.640.089
                    </span>
                  </div>
                </a>
                <a
                  href="tel:1900633909"
                  className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition-colors block"
                >
                  <p className="text-gray-600 text-xs mb-2">
                    Hotline b\u1ea3o h\u00e0nh, k\u1ef9 thu\u1eadt:
                  </p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-red-500" />
                    <span className="text-red-500 font-bold text-base">
                      1900.633.909 (B\u1ea5m ph\u00edm 2)
                    </span>
                  </div>
                </a>
                <a
                  href="tel:1900633909"
                  className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition-colors block"
                >
                  <p className="text-gray-600 text-xs mb-2">
                    Hotline h\u1ed7 tr\u1ee3 ph\u1ea7n m\u1ec1m:
                  </p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-red-500" />
                    <span className="text-red-500 font-bold text-base">
                      1900.633.909 (B\u1ea5m ph\u00edm 3)
                    </span>
                  </div>
                </a>
                <a
                  href="tel:0977649939"
                  className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition-colors block"
                >
                  <p className="text-gray-600 text-xs mb-2">
                    Hotline t\u01b0 v\u1ea5n tr\u1ea3 g\u00f3p:
                  </p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-red-500" />
                    <span className="text-red-500 font-bold text-base">
                      0977.649.939
                    </span>
                  </div>
                </a>
                <a
                  href="tel:0981000731"
                  className="bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition-colors block"
                >
                  <p className="text-gray-600 text-xs mb-2">
                    Hotline ph\u1ea3n \u00e1nh ch\u1ea5t l\u01b0\u1ee3ng d\u1ecbch v\u1ee5:
                  </p>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-red-500" />
                    <span className="text-red-500 font-bold text-base">
                      0981.000.731
                    </span>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Store Menu Overlay */}
      {desktopStoreMenuOpen && (
        <div
          className="hidden md:block fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
          onClick={() => setDesktopStoreMenuOpen(false)}
        >
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black rounded-2xl w-full max-w-5xl max-h-[85vh] flex overflow-hidden shadow-2xl border border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 bg-black/95 backdrop-blur-sm text-white p-6 flex items-center justify-between border-b border-gray-800 z-10">
              <div className="flex items-center gap-4">
                <MapPin className="w-7 h-7" />
                <span className="text-2xl font-semibold">
                  H\u1ec7 Th\u1ed1ng C\u1eeda H\u00e0ng
                </span>
              </div>
              <button
                onClick={() => setDesktopStoreMenuOpen(false)}
                className="text-white hover:text-gray-400 transition-colors p-2 hover:bg-white/10 rounded-full"
              >
                <X className="w-7 h-7" />
              </button>
            </div>

            {/* Main Content */}
            <div className="flex w-full mt-20">
              {/* Left Sidebar - Districts */}
              <div className="w-64 bg-neutral-900 overflow-y-auto border-r border-gray-800">
                {districts.map((districtName, idx) => (
                  <button
                    key={idx}
                    onClick={() => setDesktopSelectedDistrict(idx)}
                    className={`w-full text-left px-6 py-4 border-b border-gray-800 transition-all duration-200 ${
                      desktopSelectedDistrict === idx
                        ? "bg-black text-white font-semibold"
                        : "text-gray-400 hover:text-white hover:bg-neutral-800"
                    }`}
                  >
                    <span className="text-sm">{districtName}</span>
                  </button>
                ))}
              </div>

              {/* Right Content - Stores */}
              <div className="flex-1 bg-black overflow-y-auto">
                <div className="p-6">
                  <h2 className="text-white text-xl font-bold mb-6">
                    {districts[desktopSelectedDistrict]}
                  </h2>

                  {(desktopSelectedDistrict === 0
                    ? stores
                    : stores.filter(
                        (store) =>
                          store.district === districts[desktopSelectedDistrict]
                      )
                  ).length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                      {(desktopSelectedDistrict === 0
                        ? stores
                        : stores.filter(
                            (store) =>
                              store.district ===
                              districts[desktopSelectedDistrict]
                          )
                      ).map((store) => (
                        <div
                          key={store.id}
                          className="bg-neutral-900 rounded-xl p-5 border border-gray-800 hover:border-gray-600 transition-all duration-200 hover:shadow-lg"
                        >
                          <div className="flex items-start gap-3 mb-4">
                            <div className="bg-white rounded-lg p-2.5 flex-shrink-0">
                              <MapPin className="w-6 h-6 text-red-500" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <h3 className="text-white text-base font-semibold mb-1 flex items-center gap-2 flex-wrap">
                                {store.name}
                                {store.isMain && (
                                  <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                                    Ch\u00ednh
                                  </span>
                                )}
                              </h3>
                              <p className="text-gray-400 text-sm">
                                Qu\u1eadn {store.district}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-3">
                            {/* Address */}
                            <div className="flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0 mt-1" />
                              <p className="text-gray-300 text-sm leading-relaxed">
                                {store.address}
                              </p>
                            </div>

                            {/* Phone */}
                            <div className="flex items-center gap-2">
                              <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" />
                              <a
                                href={`tel:${store.phone}`}
                                className="text-blue-400 text-sm hover:underline"
                              >
                                {store.phone}
                              </a>
                            </div>

                            {/* Hours */}
                            <div className="flex items-start gap-2">
                              <Clock className="w-4 h-4 text-gray-500 flex-shrink-0 mt-1" />
                              <p className="text-gray-300 text-sm">
                                {store.hours}
                              </p>
                            </div>
                          </div>

                          {/* Buttons */}
                          <div className="mt-4 pt-4 border-t border-gray-800 flex gap-2">
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                store.address
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 bg-white text-black rounded-full py-2.5 px-4 text-sm font-semibold hover:bg-gray-200 transition-colors text-center"
                            >
                              Ch\u1ec9 \u0111\u01b0\u1eddng
                            </a>

                            <a
                              href={`tel:${store.phone}`}
                              className="flex-1 bg-neutral-800 text-white rounded-full py-2.5 px-4 text-sm font-semibold hover:bg-neutral-700 transition-colors text-center border border-gray-700"
                            >
                              G\u1ecdi ngay
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                      <MapPin className="w-20 h-20 mb-4" />
                      <p className="text-base">
                        Kh\u00f4ng c\u00f3 c\u1eeda h\u00e0ng trong khu v\u1ef1c n\u00e0y
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </>
);

export default PublicNavigationMenus;
