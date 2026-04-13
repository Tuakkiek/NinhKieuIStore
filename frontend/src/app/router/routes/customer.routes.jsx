import React from "react";
import { Route } from "react-router-dom";
import PublicLayout from "@/app/layouts/public/PublicLayout";
import ProtectedRoute from "@/app/router/guards/ProtectedRoute";
import { CartPage } from "@/features/cart";
import { ProfilePage } from "@/features/account";
import { CheckoutPage } from "@/features/checkout";
import { OrderDetailPage } from "@/features/orders";
import { AddEmailPage } from "@/features/auth";

const customerRoutes = (
  <Route element={<PublicLayout />}>
    <Route
      path="/cart"
      element={
        <ProtectedRoute allowedPermissions={["cart.manage.self"]}>
          <CartPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/cart/checkout"
      element={
        <ProtectedRoute allowedPermissions={["cart.manage.self", "promotion.apply.self"]}>
          <CheckoutPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/orders/:id"
      element={
        <ProtectedRoute allowedPermissions={["order.view.self"]}>
          <OrderDetailPage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/profile"
      element={
        <ProtectedRoute
          allowedPermissions={["account.profile.update.self", "account.address.manage.self"]}
        >
          <ProfilePage />
        </ProtectedRoute>
      }
    />
    <Route
      path="/profile/add-email"
      element={
        <ProtectedRoute allowedPermissions={["account.profile.update.self"]}>
          <AddEmailPage />
        </ProtectedRoute>
      }
    />
  </Route>
);

export default customerRoutes;
