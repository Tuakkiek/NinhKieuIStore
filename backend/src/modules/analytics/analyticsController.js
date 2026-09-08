import {
  getPOSStaffStats,
  getShipperStats,
  getCashierStats,
  getTopPerformers,
  getPersonalStats as getPersonalStatsService,
} from "./employeeAnalyticsService.js";

const resolveScopedOptions = (req) => {
  const scopeMode = req.authz?.scopeMode || "branch";
  const branchId = req.authz?.activeBranchId || "";

  // ── KILL-SWITCH: Fail-closed on empty branch for branch-scoped analytics ──
  if (scopeMode === "branch" && !branchId) {
    throw new Error("ANALYTICS_BRANCH_REQUIRED: Cannot read branch analytics without active branch context");
  }

  return {
    startDate: req.query?.startDate || null,
    endDate: req.query?.endDate || null,
    orderRepo: req.scopedRepos?.Order || null,
    scopeMode,
    branchId,
  };
};

export const getEmployeeKPI = async (req, res) => {
  try {
    const scopedOptions = resolveScopedOptions(req);

    const [
      posStaffPerformance,
      shipperPerformance,
      cashierPerformance,
      topPerformers,
    ] = await Promise.all([
      getPOSStaffStats(scopedOptions),
      getShipperStats(scopedOptions),
      getCashierStats(scopedOptions),
      getTopPerformers(scopedOptions),
    ]);

    const posStaffRevenue = posStaffPerformance.map((staff) => ({
      name: staff.name,
      value: staff.revenue,
    }));

    const shipperSuccessRate = shipperPerformance.map((shipper) => ({
      name: shipper.name,
      successRate: shipper.successRate,
    }));

    res.json({
      success: true,
      data: {
        view: req.authz?.scopeMode || "branch",
        activeBranchId: req.authz?.activeBranchId || null,
        posStaffPerformance,
        shipperPerformance,
        cashierPerformance,
        ...topPerformers,
        posStaffRevenue,
        shipperSuccessRate,
      },
    });
  } catch (error) {
    console.error("Get Employee KPI error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Lỗi lấy thống kê nhân viên",
    });
  }
};

export const getPersonalStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const { period = "today" } = req.query;

    const scopeMode = req.authz?.scopeMode || "branch";
    const branchId = scopeMode === "branch" ? req.authz?.activeBranchId : "";

    const stats = await getPersonalStatsService(userId, period, {
      branchId,
    });

    res.json({
      success: true,
      data: {
        view: scopeMode,
        activeBranchId: branchId || null,
        ...stats,
      },
    });
  } catch (error) {
    console.error("Get Personal Stats error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Lỗi lấy thống kê cá nhân",
    });
  }
};

export default {
  getEmployeeKPI,
  getPersonalStats,
};
