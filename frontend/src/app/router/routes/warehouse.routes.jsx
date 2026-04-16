import React from "react";
import { Navigate, Route } from "react-router-dom";
import DashboardLayout from "@/app/layouts/dashboard/DashboardLayout";
import ProtectedRoute from "@/app/router/guards/ProtectedRoute";
import { DeviceManagementPage } from "@/features/afterSales";
import {
  WarehouseProductsPage,
  ProductDetailPage,
} from "@/features/catalog";
import {
  WarehouseConfigPage,
  WarehouseVisualizerPage,
  WarehouseStaffDashboard,
  ReceiveGoodsPage,
  PickOrdersPage,
  TransferStockPage,
} from "@/features/warehouse";

const warehouseRoutes = (
  <>

    <Route
      element={
        <ProtectedRoute
          allowedPermissions={[
            "product.read",
            "product.create",
            "product.update",
            "product.delete",
          ]}
        >
          <DashboardLayout />
        </ProtectedRoute>
      }
    >
      <Route path="/warehouse/products" element={<WarehouseProductsPage />} />
      <Route path="/warehouse/products/:productSlug" element={<ProductDetailPage />} />
    </Route>

    <Route
      element={
        <ProtectedRoute
          allowedPermissions={[
            "warehouse.read",
            "warehouse.write",
            "inventory.read",
            "inventory.write",
            "transfer.read",
            "transfer.create",
            "transfer.approve",
            "transfer.ship",
            "transfer.receive",
          ]}
        >
          <DashboardLayout />
        </ProtectedRoute>
      }
    >
      <Route path="/warehouse-staff" element={<WarehouseStaffDashboard />} />
      <Route path="/warehouse-staff/receive-goods" element={<ReceiveGoodsPage />} />
      <Route path="/warehouse-staff/transfer" element={<TransferStockPage />} />
      <Route
        path="/warehouse-staff/create-transfer"
        element={<Navigate to="/warehouse-staff/transfer?tab=branch" replace />}
      />
      <Route path="/warehouse-staff/devices" element={<DeviceManagementPage />} />
    </Route>

    <Route
      element={
        <ProtectedRoute
          allowedPermissions={[
            "orders.read",
            "warehouse.read",
            "warehouse.write",
            "order.status.manage.warehouse",
            "order.status.manage",
          ]}
        >
          <DashboardLayout />
        </ProtectedRoute>
      }
    >
      <Route path="/warehouse-staff/pick-orders" element={<PickOrdersPage />} />
    </Route>
  </>
);

export default warehouseRoutes;
