import React from "react";
import { Route } from "react-router-dom";
import PublicLayout from "@/app/layouts/public/PublicLayout";
import NotFoundPage from "@/app/router/NotFoundPage";
import { ForgotPasswordPage, LoginPage, RegisterPage, VerifyEmailPage } from "@/features/auth";
import { WarrantyLookupPage } from "@/features/afterSales";
import { ProductsPage, ProductDetailPage } from "@/features/catalog";
import { SearchResultsPage } from "@/features/search";
import { HomePage } from "@/features/content/homepage";
import { VideosPage } from "@/features/content/videos";
import { VNPayReturnPage } from "@/features/checkout";

const publicRoutes = (
  <>
    <Route element={<PublicLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/videos" element={<VideosPage />} />
      <Route path="/products" element={<ProductsPage />} />
      <Route path="/dien-thoai" element={<ProductsPage category="iPhone" />} />
      <Route path="/may-tinh-bang" element={<ProductsPage category="iPad" />} />
      <Route path="/macbook" element={<ProductsPage category="Mac" />} />
      <Route path="/tai-nghe" element={<ProductsPage category="AirPods" />} />
      <Route path="/apple-watch" element={<ProductsPage category="AppleWatch" />} />
      <Route path="/phu-kien" element={<ProductsPage category="Accessories" />} />
      <Route path="/tim-kiem" element={<SearchResultsPage />} />
      <Route path="/warranty-check" element={<WarrantyLookupPage />} />
      <Route path="/products/:productSlug" element={<ProductDetailPage />} />
      <Route path="/:categorySlug/:productSlug" element={<ProductDetailPage />} />
    </Route>

    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/verify-email" element={<VerifyEmailPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />

    <Route path="/payment/vnpay/return" element={<VNPayReturnPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </>
);

export default publicRoutes;

