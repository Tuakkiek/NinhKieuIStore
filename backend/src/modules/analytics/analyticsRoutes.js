import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import { resolveAccessContext } from "../../middleware/authz/resolveAccessContext.js";
import { authorize } from "../../middleware/authz/authorize.js";
import { requireStepUp } from "../../middleware/authz/requireStepUp.js";
import { withScopedRepository } from "../../middleware/authz/withScopedRepository.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import salesAnalyticsService from "./salesAnalyticsService.js";
import { getEmployeeKPI, getPersonalStats } from "./analyticsController.js";

const router = express.Router();

const resolveKpiScopeMode = (req) => {
  const view = String(req.query?.view || "").trim().toLowerCase();
  if (view === "global") return "global";
  if (view === "assigned") return "assigned";
  if (view === "branch") return "branch";
  
  if (req.authz?.isGlobalAdmin) return "global";
  return "branch";
};

const resolveKpiAction = (req) => {
  const mode = resolveKpiScopeMode(req);
  if (mode === "global") return AUTHZ_ACTIONS.ANALYTICS_READ_GLOBAL;
  if (mode === "assigned") return AUTHZ_ACTIONS.ANALYTICS_READ_ASSIGNED;
  return AUTHZ_ACTIONS.ANALYTICS_READ_BRANCH;
};

const requireGlobalAnalytics = authorize(AUTHZ_ACTIONS.ANALYTICS_READ_GLOBAL, {
  scopeMode: "global",
  resourceType: "ANALYTICS",
});

router.use(protect, resolveAccessContext);

router.get("/top-sellers/:category", requireGlobalAnalytics, async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 10 } = req.query;

    const topSellers = await salesAnalyticsService.getTopSellersByCategory(
      category,
      parseInt(limit, 10)
    );

    res.json({
      success: true,
      data: topSellers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/top-sellers", requireGlobalAnalytics, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const topSellers = await salesAnalyticsService.getTopSellers(parseInt(limit, 10));

    res.json({
      success: true,
      data: topSellers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/product/:productId", requireGlobalAnalytics, async (req, res) => {
  try {
    const { productId } = req.params;
    const { variantId } = req.query;

    const salesData = await salesAnalyticsService.getProductSales(productId, variantId || null);

    if (!salesData) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy dữ liệu bán hàng",
      });
    }

    res.json({
      success: true,
      data: salesData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/sales-by-time", requireGlobalAnalytics, requireStepUp(AUTHZ_ACTIONS.ANALYTICS_READ_GLOBAL, { actionGroup: 'FINANCIAL_EXPORT' }), async (req, res) => {
  try {
    const { category, startDate, endDate, period = "daily" } = req.query;

    if (!category || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Thiếu tham số: category, startDate, endDate",
      });
    }

    const salesData = await salesAnalyticsService.getSalesByTimePeriod(
      category,
      new Date(startDate),
      new Date(endDate),
      period
    );

    res.json({
      success: true,
      data: salesData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.delete(
  "/reset/:productId",
  requireGlobalAnalytics,
  authorize(AUTHZ_ACTIONS.ANALYTICS_MANAGE_GLOBAL, {
    scopeMode: "global",
    resourceType: "ANALYTICS",
  }),
  async (req, res) => {
  try {
    const { productId } = req.params;
    const { variantId } = req.query;

    await salesAnalyticsService.resetSalesData(productId, variantId || null);

    res.json({
      success: true,
      message: "Đã đặt lại dữ liệu bán hàng",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get(
  "/dashboard",
  requireGlobalAnalytics,
  async (req, res) => {
  try {
    const { category } = req.query;

    const topSellers = category
      ? await salesAnalyticsService.getTopSellersByCategory(category, 10)
      : await salesAnalyticsService.getTopSellers(10);

    const totalRevenue = topSellers.reduce(
      (sum, item) => sum + (item.revenue?.total || 0),
      0
    );
    const totalSales = topSellers.reduce((sum, item) => sum + (item.sales?.total || 0), 0);

    res.json({
      success: true,
      data: {
        topSellers,
        summary: {
          totalRevenue,
          totalSales,
          averageOrderValue: totalSales > 0 ? totalRevenue / totalSales : 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
  }
);

router.get(
  "/employee/kpi",
  authorize(resolveKpiAction, {
    scopeMode: resolveKpiScopeMode,
    requireActiveBranchFor: ["branch"],
    resourceType: "ANALYTICS",
  }),
  withScopedRepository(["Order"], {
    mode: (req) => req.authz.scopeMode,
  }),
  getEmployeeKPI
);

router.get(
  "/employee/personal",
  authorize(AUTHZ_ACTIONS.ANALYTICS_READ_PERSONAL, {
    scopeMode: (req) =>
      req.authz?.permissions?.has(AUTHZ_ACTIONS.TASK_UPDATE) ? "task" : "branch",
    requireActiveBranchFor: ["branch"],
    resourceType: "ANALYTICS",
    audit: false,
  }),
  getPersonalStats
);

export default router;
