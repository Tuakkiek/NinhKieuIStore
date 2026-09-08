import mongoose from "mongoose";
import StoreInventory from "./StoreInventory.js";
import Store from "../store/Store.js";
import StockMovement from "../warehouse/StockMovement.js";
import { omniLog } from "../../utils/logger.js";
import { analyzeReplenishmentNeeds } from "./replenishmentService.js";
import { runReplenishmentSnapshotJob } from "./replenishmentScheduler.js";
import { getLatestReplenishmentSnapshot } from "./replenishmentSnapshotService.js";
import {
  analyzeDemandPredictions,
  predictDemandForSku,
} from "./predictiveAllocationService.js";

const parseBool = (value) => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes"].includes(String(value).toLowerCase());
};

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

export const checkAvailability = async (req, res) => {
  try {
    const { productId, variantSku } = req.params;
    const { province } = req.query;

    const storeFilter = { status: "ACTIVE" };
    
    // ── KILL-SWITCH: Use req.authz.activeBranchId ──
    if (!req.authz?.isGlobalAdmin && req.authz?.activeBranchId) {
      storeFilter._id = req.authz.activeBranchId;
    } else if (!req.authz?.isGlobalAdmin) {
      return res.json({ success: true, available: false, stores: [] });
    }

    if (province) {
      storeFilter["address.province"] = province;
    }

    const stores = await Store.find(storeFilter)
      .select("_id name code address services")
      .lean();
    const storeIds = stores.map((store) => store._id);

    if (storeIds.length === 0) {
      return res.json({
        success: true,
        available: false,
        stores: [],
      });
    }

    const inventoryRows = await StoreInventory.find({
      productId,
      variantSku,
      storeId: { $in: storeIds },
      available: { $gt: 0 },
    }).lean();

    const storeMap = new Map(stores.map((store) => [String(store._id), store]));

    const results = inventoryRows
      .map((row) => {
        const store = storeMap.get(String(row.storeId));
        if (!store) {
          return null;
        }

        return {
          storeId: store._id,
          storeCode: store.code,
          storeName: store.name,
          address: store.address,
          available: row.available,
          status: row.status,
          supportsClickAndCollect: !!store.services?.clickAndCollect,
          supportsHomeDelivery: !!store.services?.homeDelivery,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.available - a.available);

    res.json({
      success: true,
      available: results.length > 0,
      stores: results,
    });
  } catch (error) {
    omniLog.error("checkAvailability failed", {
      productId: req.params.productId,
      variantSku: req.params.variantSku,
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể kiểm tra tồn kho",
      error: error.message,
    });
  }
};

export const getByStore = async (req, res) => {
  try {
    let { storeId } = req.params;
    const { status, limit = 200, page = 1 } = req.query;

    // ── KILL-SWITCH: Use req.authz.activeBranchId ──
    if (!req.authz?.isGlobalAdmin) {
      if (req.authz?.activeBranchId) {
        storeId = req.authz.activeBranchId;
      } else {
        return res.status(403).json({
          success: false,
          message: "Tài khoản không thuộc về chi nhánh nào",
        });
      }
    }

    const filter = { storeId };
    if (status) {
      filter.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      StoreInventory.find(filter)
        .populate("productId", "name model")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      StoreInventory.countDocuments(filter),
    ]);

    res.json({
      success: true,
      items,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    omniLog.error("getByStore failed", {
      storeId: req.params.storeId,
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể lấy tồn kho của cửa hàng",
      error: error.message,
    });
  }
};

export const getConsolidatedInventory = async (req, res) => {
  try {
    const { sku, productId, lowStockOnly, threshold = 10 } = req.query;
    const lowStockThreshold = Math.max(1, Number(threshold) || 10);

    const match = {};
    if (sku) {
      match.variantSku = String(sku).trim();
    }
    if (productId) {
      match.productId = mongoose.Types.ObjectId.isValid(productId)
        ? new mongoose.Types.ObjectId(productId)
        : productId;
    }

    // ── KILL-SWITCH: Use req.authz.activeBranchId ──
    if (!req.authz?.isGlobalAdmin) {
      if (req.authz?.activeBranchId) {
         match.storeId = new mongoose.Types.ObjectId(req.authz.activeBranchId);
      } else {
         return res.json({
           success: true,
           inventory: [],
           summary: {
             totalSKUs: 0,
             totalValue: 0,
             totalSellValue: 0,
             totalCostValue: 0,
             lowStockCount: 0,
           },
         });
      }
    }

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "_id",
          as: "store",
        },
      },
      { $unwind: "$store" },
      {
        $group: {
          _id: "$variantSku",
          productId: { $first: "$productId" },
          totalQuantity: { $sum: "$quantity" },
          totalReserved: { $sum: "$reserved" },
          totalAvailable: { $sum: "$available" },
          basePrice: { $max: "$basePrice" },
          originalPrice: { $max: "$originalPrice" },
          sellingPrice: { $max: "$sellingPrice" },
          costPrice: { $max: "$costPrice" },
          price: { $max: "$price" },
          locations: {
            $push: {
              storeId: "$storeId",
              storeName: "$store.name",
              storeCode: "$store.code",
              quantity: "$quantity",
              reserved: "$reserved",
              available: "$available",
              status: "$status",
              minStock: "$minStock",
            },
          },
        },
      },
      {
        $lookup: {
          from: "universalvariants",
          localField: "_id",
          foreignField: "sku",
          as: "variant",
        },
      },
      {
        $unwind: {
          path: "$variant",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "universalproducts",
          localField: "productId",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: {
          path: "$product",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          productId: 1,
          totalQuantity: 1,
          totalReserved: 1,
          totalAvailable: 1,
          locations: 1,
          variant: {
            sku: "$variant.sku",
            color: "$variant.color",
            variantName: "$variant.variantName",
            price: { $ifNull: ["$sellingPrice", "$price"] },
            sellingPrice: { $ifNull: ["$sellingPrice", "$price"] },
            originalPrice: { $ifNull: ["$basePrice", "$originalPrice"] },
            basePrice: { $ifNull: ["$basePrice", "$originalPrice"] },
            costPrice: "$costPrice",
            stock: "$variant.stock",
          },
          product: {
            _id: "$product._id",
            name: "$product.name",
            model: "$product.model",
            slug: "$product.slug",
            baseSlug: "$product.baseSlug",
          },
        },
      },
      { $sort: { totalAvailable: 1, _id: 1 } },
    ];

    let inventory = await StoreInventory.aggregate(pipeline, { skipBranchIsolation: true });

    if (parseBool(lowStockOnly)) {
      inventory = inventory.filter(
        (item) => Number(item.totalAvailable) < lowStockThreshold
      );
    }

    const totalValue = inventory.reduce((sum, item) => {
      const qty = Number(item.totalQuantity) || 0;
      const price =
        Number(item?.variant?.sellingPrice ?? item?.variant?.price) || 0;
      return sum + qty * price;
    }, 0);
    const totalCostValue = inventory.reduce((sum, item) => {
      const qty = Number(item.totalQuantity) || 0;
      const price = Number(item?.variant?.costPrice) || 0;
      return sum + qty * price;
    }, 0);

    res.json({
      success: true,
      inventory,
      summary: {
        totalSKUs: inventory.length,
        totalValue,
        totalSellValue: totalValue,
        totalCostValue,
        lowStockCount: inventory.filter(
          (item) => Number(item.totalAvailable) < lowStockThreshold
        ).length,
      },
    });
  } catch (error) {
    omniLog.error("getConsolidatedInventory failed", {
      error: error.message,
      query: req.query,
    });

    res.status(500).json({
      success: false,
      message: "Không thể tổng hợp tồn kho",
      error: error.message,
    });
  }
};

export const getStoreInventoryComparison = async (req, res) => {
  try {
    const stores = await Store.find({ status: "ACTIVE" })
      .select("_id code name type capacity")
      .lean();

    const groupedStats = await StoreInventory.aggregate([
      {
        $group: {
          _id: "$storeId",
          totalSKUs: { $sum: 1 },
          totalQuantity: { $sum: "$quantity" },
          totalReserved: { $sum: "$reserved" },
          totalAvailable: { $sum: "$available" },
          outOfStockSKUs: {
            $sum: {
              $cond: [{ $lte: ["$available", 0] }, 1, 0],
            },
          },
          lowStockSKUs: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ["$available", 0] },
                    { $lt: ["$available", "$minStock"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ], { skipBranchIsolation: true });

    const statsByStore = new Map(
      groupedStats.map((item) => [String(item._id), item])
    );

    const comparison = stores.map((store) => {
      const stats = statsByStore.get(String(store._id)) || {
        totalSKUs: 0,
        totalQuantity: 0,
        totalReserved: 0,
        totalAvailable: 0,
        outOfStockSKUs: 0,
        lowStockSKUs: 0,
      };

      return {
        storeId: store._id,
        storeCode: store.code,
        storeName: store.name,
        storeType: store.type,
        capacity: store.capacity,
        stats,
      };
    });

    const needsAttention = comparison.filter(
      (entry) => entry.stats.outOfStockSKUs > 0 || entry.stats.lowStockSKUs > 5
    );

    res.json({
      success: true,
      comparison,
      needsAttention,
    });
  } catch (error) {
    omniLog.error("getStoreInventoryComparison failed", {
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể so sánh tồn kho giữa các cửa hàng",
      error: error.message,
    });
  }
};

export const getLowStockAlerts = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));

    const alerts = await StoreInventory.aggregate([
      {
        $match: {
          $expr: { $lte: ["$available", "$minStock"] },
        },
      },
      {
        $lookup: {
          from: "stores",
          localField: "storeId",
          foreignField: "_id",
          as: "store",
        },
      },
      {
        $unwind: {
          path: "$store",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "universalproducts",
          localField: "productId",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: {
          path: "$product",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "universalvariants",
          localField: "variantSku",
          foreignField: "sku",
          as: "variant",
        },
      },
      {
        $unwind: {
          path: "$variant",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          storeId: "$storeId",
          storeCode: "$store.code",
          storeName: "$store.name",
          productId: "$productId",
          productName: "$product.name",
          variantSku: "$variantSku",
          variantName: "$variant.variantName",
          color: "$variant.color",
          quantity: "$quantity",
          reserved: "$reserved",
          available: "$available",
          minStock: "$minStock",
          status: "$status",
          priority: {
            $cond: [{ $lte: ["$available", 0] }, "CRITICAL", "HIGH"],
          },
        },
      },
      { $sort: { available: 1, minStock: -1 } },
      { $limit: limit },
    ]);

    res.json({
      success: true,
      alerts,
      summary: {
        total: alerts.length,
        critical: alerts.filter((item) => item.priority === "CRITICAL").length,
        high: alerts.filter((item) => item.priority === "HIGH").length,
      },
    });
  } catch (error) {
    omniLog.error("getLowStockAlerts failed", {
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể lấy cảnh báo tồn kho thấp",
      error: error.message,
    });
  }
};

export const getReplenishmentRecommendations = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 100));
    const surplusThreshold = Math.max(
      0,
      Number(req.query.surplusThreshold) || 20
    );
    const criticalOnly = parseBool(req.query.criticalOnly);
    let storeId = req.query.storeId ? String(req.query.storeId).trim() : undefined;
    const source = String(req.query.source || "snapshot")
      .trim()
      .toLowerCase();
    const useLive = source === "live" || source === "realtime";

    // ── KILL-SWITCH: Use req.authz.activeBranchId ──
    if (!req.authz?.isGlobalAdmin) {
      if (req.authz?.activeBranchId) {
         storeId = req.authz.activeBranchId;
      } else {
         return res.status(403).json({ success: false, message: "No store assigned" });
      }
    }

    if (!useLive) {
      const latestSnapshotData = await getLatestReplenishmentSnapshot({
        limit,
        criticalOnly,
        storeId,
      });

      if (latestSnapshotData?.snapshot) {
        return res.json({
          success: true,
          recommendations: latestSnapshotData.recommendations || [],
          summary: latestSnapshotData.snapshot.summary || {},
          snapshot: {
            snapshotDateKey: latestSnapshotData.snapshot.snapshotDateKey,
            generatedAt: latestSnapshotData.snapshot.generatedAt,
            source: latestSnapshotData.snapshot.source,
          },
          dataSource: "SNAPSHOT",
        });
      }
    }

    const result = await analyzeReplenishmentNeeds({
      limit,
      surplusThreshold,
      criticalOnly,
      storeId,
    });

    res.json({
      success: true,
      recommendations: result.recommendations,
      summary: result.summary,
      snapshot: null,
      dataSource: "LIVE",
    });
  } catch (error) {
    omniLog.error("getReplenishmentRecommendations failed", {
      error: error.message,
      query: req.query,
    });

    res.status(500).json({
      success: false,
      message: "Không thể lấy đề xuất bổ sung tồn kho",
      error: error.message,
    });
  }
};

export const runReplenishmentSnapshotNow = async (req, res) => {
  try {
    const result = await runReplenishmentSnapshotJob({
      source: "MANUAL",
      initiatedBy: req.user?._id ? String(req.user._id) : "SYSTEM",
      storeId: !req.authz?.isGlobalAdmin ? req.authz?.activeBranchId : undefined, // ── KILL-SWITCH: Use authz context ──
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || "Không thể tạo replenishment snapshot",
      });
    }

    return res.json({
      success: true,
      message: "Đã tạo replenishment snapshot",
      result,
    });
  } catch (error) {
    omniLog.error("runReplenishmentSnapshotNow failed", {
      error: error.message,
      userId: req.user?._id,
    });

    return res.status(500).json({
      success: false,
      message: "Không thể tạo replenishment snapshot",
      error: error.message,
    });
  }
};

export const getDemandPredictions = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 100));
    const daysAhead = Math.max(1, Math.min(60, Number(req.query.daysAhead) || 7));
    const historicalDays = Math.max(
      7,
      Math.min(365, Number(req.query.historicalDays) || 90)
    );
    const storeId = req.query.storeId ? String(req.query.storeId).trim() : undefined;
    const variantSku = req.query.variantSku
      ? String(req.query.variantSku).trim()
      : undefined;
    const lowStockOnly = parseBool(req.query.lowStockOnly);

    const result = await analyzeDemandPredictions({
      limit,
      daysAhead,
      historicalDays,
      storeId,
      variantSku,
      lowStockOnly,
    });

    return res.json({
      success: true,
      predictions: result.predictions,
      summary: result.summary,
      config: result.config,
    });
  } catch (error) {
    omniLog.error("getDemandPredictions failed", {
      error: error.message,
      query: req.query,
    });

    return res.status(500).json({
      success: false,
      message: "Không thể dự đoán nhu cầu tồn kho",
      error: error.message,
    });
  }
};

export const getSkuDemandPrediction = async (req, res) => {
  try {
    const variantSku = String(req.params.variantSku || "").trim();
    if (!variantSku) {
      return res.status(400).json({
        success: false,
        message: "variantSku is required",
      });
    }

    const daysAhead = Math.max(1, Math.min(60, Number(req.query.daysAhead) || 7));
    const historicalDays = Math.max(
      7,
      Math.min(365, Number(req.query.historicalDays) || 90)
    );
    const storeId = req.query.storeId ? String(req.query.storeId).trim() : undefined;

    const result = await predictDemandForSku({
      variantSku,
      storeId,
      daysAhead,
      historicalDays,
    });

    return res.json({
      success: true,
      variantSku: variantSku.toUpperCase(),
      predictions: result.predictions,
      summary: result.summary,
      config: result.config,
    });
  } catch (error) {
    omniLog.error("getSkuDemandPrediction failed", {
      error: error.message,
      variantSku: req.params.variantSku,
      query: req.query,
    });

    return res.status(500).json({
      success: false,
      message: "Không thể dự đoán nhu cầu cho SKU",
      error: error.message,
    });
  }
};

export const getRecentStockMovements = async (req, res) => {
  try {
    const { type, sku, days = 7, limit = 100 } = req.query;
    const lookbackDays = Math.max(1, Number(days) || 7);
    const maxRows = Math.max(1, Math.min(500, Number(limit) || 100));

    const filter = {
      createdAt: {
        $gte: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000),
      },
    };

    if (type) {
      filter.type = String(type).trim().toUpperCase();
    }

    if (sku) {
      filter.sku = String(sku).trim();
    }

    const movements = await StockMovement.find(filter)
      .sort({ createdAt: -1 })
      .limit(maxRows)
      .lean();

    const summaryByType = movements.reduce((acc, movement) => {
      const key = movement.type || "UNKNOWN";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const totalQuantity = movements.reduce(
      (sum, movement) => sum + toPositiveNumber(movement.quantity, 0),
      0
    );

    res.json({
      success: true,
      movements,
      summary: {
        total: movements.length,
        totalQuantity,
        byType: summaryByType,
      },
    });
  } catch (error) {
    omniLog.error("getRecentStockMovements failed", {
      error: error.message,
    });

    res.status(500).json({
      success: false,
      message: "Không thể lấy lịch sử biến động tồn kho",
      error: error.message,
    });
  }
};

export default {
  checkAvailability,
  getByStore,
  getConsolidatedInventory,
  getStoreInventoryComparison,
  getLowStockAlerts,
  getReplenishmentRecommendations,
  runReplenishmentSnapshotNow,
  getDemandPredictions,
  getSkuDemandPrediction,
  getRecentStockMovements,
};
