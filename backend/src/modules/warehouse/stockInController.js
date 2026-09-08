import mongoose from "mongoose";
import Inventory from "./Inventory.js";
import WarehouseLocation from "./WarehouseLocation.js";
import StockMovement from "./StockMovement.js";
import UniversalProduct, { UniversalVariant } from "../product/UniversalProduct.js";
import StoreInventory from "../inventory/StoreInventory.js";
import Store from "../store/Store.js";
import {
  ensureWarehouseWriteBranchId,
  getActiveWarehouseBranchId,
  resolveWarehouseScopeMode,
  resolveWarehouseStore,
} from "./warehouseContext.js";
import {
  isSerializedConfig,
  resolveAfterSalesConfigByProductId,
} from "../device/afterSalesConfig.js";
import { registerSerializedUnits } from "../device/deviceService.js";
import {
  applyPricingSnapshotToDocument,
  recalculateProductAvailability,
  updateCurrentPricingForSku,
} from "../product/productPricingService.js";

const DEFAULT_STORE_MIN_STOCK = 5;

const getActorName = (user) =>
  user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim() || "Unknown";

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const toNonNegativeMoney = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const syncStoreInventory = async ({
  productId,
  variantSku,
  receivedQuantity,
  pricingSnapshot = null,
  session,
}) => {
  if (!productId || !variantSku || receivedQuantity <= 0) return [];

  const stores = await Store.find({
    status: "ACTIVE",
    type: { $ne: "WAREHOUSE" },
  })
    .select("_id capacity.maxOrdersPerDay")
    .session(session);

  if (stores.length === 0) return [];

  const storeIds = stores.map((store) => store._id);
  const currentInventories = await StoreInventory.find({
    productId,
    variantSku,
    storeId: { $in: storeIds },
  })
    .select("storeId quantity minStock")
    .session(session)
    .setOptions({ skipBranchIsolation: true });

  const inventoryByStore = new Map(
    currentInventories.map((item) => [String(item.storeId), item])
  );

  let remaining = receivedQuantity;
  const rawAllocations = [];

  for (const store of stores) {
    if (remaining <= 0) break;

    const inventory = inventoryByStore.get(String(store._id));
    const currentQty = Number(inventory?.quantity) || 0;
    const minStock = Number(inventory?.minStock ?? DEFAULT_STORE_MIN_STOCK);
    const minTarget =
      Number.isFinite(minStock) && minStock > 0
        ? Math.floor(minStock)
        : DEFAULT_STORE_MIN_STOCK;
    const deficit = Math.max(0, minTarget - currentQty);

    if (deficit <= 0) continue;

    const allocation = Math.min(deficit, remaining);
    rawAllocations.push({ storeId: store._id, quantity: allocation });
    remaining -= allocation;
  }

  if (remaining > 0) {
    const weightedStores = stores.map((store) => ({
      storeId: store._id,
      weight: Math.max(1, Number(store.capacity?.maxOrdersPerDay) || 100),
    }));
    const totalWeight =
      weightedStores.reduce((sum, item) => sum + item.weight, 0) || 1;
    const remainingBeforeWeighted = remaining;
    let weightedAllocated = 0;

    for (let index = 0; index < weightedStores.length; index += 1) {
      if (remaining <= 0) break;

      const isLast = index === weightedStores.length - 1;
      let allocation = isLast
        ? remainingBeforeWeighted - weightedAllocated
        : Math.floor(
            (remainingBeforeWeighted * weightedStores[index].weight) / totalWeight
          );

      allocation = Math.min(allocation, remaining);
      if (allocation <= 0) continue;

      rawAllocations.push({
        storeId: weightedStores[index].storeId,
        quantity: allocation,
      });
      weightedAllocated += allocation;
      remaining -= allocation;
    }

    if (remaining > 0 && weightedStores.length > 0) {
      rawAllocations.push({
        storeId: weightedStores[0].storeId,
        quantity: remaining,
      });
    }
  }

  const mergedAllocations = new Map();
  for (const allocation of rawAllocations) {
    const key = String(allocation.storeId);
    const current = mergedAllocations.get(key);
    if (current) {
      current.quantity += allocation.quantity;
    } else {
      mergedAllocations.set(key, {
        storeId: allocation.storeId,
        quantity: allocation.quantity,
      });
    }
  }

  const distribution = [];

  for (const allocation of mergedAllocations.values()) {
    if (allocation.quantity <= 0) continue;

    let storeInventory = await StoreInventory.findOne({
      productId,
      variantSku,
      storeId: allocation.storeId,
    })
      .session(session)
      .setOptions({ skipBranchIsolation: true });

    if (!storeInventory) {
      storeInventory = new StoreInventory({
        productId,
        variantSku,
        storeId: allocation.storeId,
        quantity: 0,
        reserved: 0,
      });
    }

    storeInventory.quantity =
      (Number(storeInventory.quantity) || 0) + allocation.quantity;
    storeInventory.lastRestockDate = new Date();
    storeInventory.lastRestockQuantity = allocation.quantity;
    applyPricingSnapshotToDocument(storeInventory, pricingSnapshot || {});
    await storeInventory.save({ session });

    distribution.push({
      storeId: allocation.storeId,
      quantity: allocation.quantity,
      available: storeInventory.available,
      status: storeInventory.status,
    });
  }

  return distribution;
};

export const directStockIn = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const actorName = getActorName(req.user);

    if (items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Danh sách sản phẩm nhập kho không hợp lệ",
      });
    }

    const results = [];
    const activatedProducts = new Set();
    const batchReferenceId = `STOCKIN-${Date.now()}`;

    for (const item of items) {
      const normalizedSku = String(item?.sku || "").trim();
      const normalizedLocationCode = String(item?.locationCode || "").trim();
      const qty = toPositiveInteger(item?.quantity);
      const inboundCostPrice = toNonNegativeMoney(item?.costPrice);
      const inboundSellingPrice = toNonNegativeMoney(item?.sellingPrice);
      const notes = String(item?.notes || "").trim();
      const serializedUnits = Array.isArray(item?.serializedUnits)
        ? item.serializedUnits
        : [];

      if (
        !normalizedSku ||
        !normalizedLocationCode ||
        !qty ||
        inboundCostPrice === null ||
        inboundSellingPrice === null ||
        inboundSellingPrice <= 0
      ) {
        throw new Error(
          `Dữ liệu không hợp lệ cho SKU ${normalizedSku || "(trống)"}. Cần sku, quantity > 0, locationCode, costPrice >= 0, sellingPrice > 0`
        );
      }

      const variant = await UniversalVariant.findOne({ sku: normalizedSku }).session(
        session
      );
      if (!variant) {
        throw new Error(`Không tìm thấy biến thể SKU: ${normalizedSku}`);
      }

      const product = await UniversalProduct.findById(variant.productId).session(
        session
      );
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm cho SKU: ${normalizedSku}`);
      }
      const statusBeforeStockIn = String(product.status || "");

      const location = await WarehouseLocation.findOne({
        storeId: activeStoreId,
        locationCode: normalizedLocationCode,
        status: "ACTIVE",
      }).session(session);
      if (!location) {
        throw new Error(`Không tìm thấy vị trí kho: ${normalizedLocationCode}`);
      }

      const currentLoad = Number(location.currentLoad) || 0;
      const capacity = Number(location.capacity) || 0;
      if (capacity > 0 && currentLoad + qty > capacity) {
        throw new Error(
          `Vị trí kho ${normalizedLocationCode} không đủ chỗ (${currentLoad}/${capacity})`
        );
      }

      const afterSalesContext = await resolveAfterSalesConfigByProductId({
        productId: product._id,
        session,
      });
      const serializedTrackingEnabled = Boolean(
        afterSalesContext && isSerializedConfig(afterSalesContext.config)
      );

      if (serializedTrackingEnabled && serializedUnits.length !== qty) {
        throw new Error(
          `SKU ${normalizedSku} requires ${qty} serialized unit(s) with IMEI/serial information`
        );
      }

      const { variant: pricedVariant, snapshot } = await updateCurrentPricingForSku({
        productId: product._id,
        variantSku: normalizedSku,
        variantId: variant._id,
        costPrice: inboundCostPrice,
        sellingPrice: inboundSellingPrice,
        session,
      });

      let inventory = await Inventory.findOne({
        storeId: activeStoreId,
        sku: normalizedSku,
        locationId: location._id,
      }).session(session);

      if (!inventory) {
        inventory = new Inventory({
          storeId: activeStoreId,
          sku: normalizedSku,
          productId: product._id,
          productName: product.name,
          locationId: location._id,
          locationCode: location.locationCode,
          quantity: 0,
          status: "GOOD",
          notes,
        });
      }

      inventory.quantity = (Number(inventory.quantity) || 0) + qty;
      inventory.lastReceived = new Date();
      inventory.status = "GOOD";
      inventory.notes = notes;
      applyPricingSnapshotToDocument(inventory, snapshot);
      await inventory.save({ session });

      location.currentLoad = currentLoad + qty;
      await location.save({ session });

      pricedVariant.stock = (Number(pricedVariant.stock) || 0) + qty;
      await pricedVariant.save({ session });

      await StockMovement.create(
        [
          {
            storeId: activeStoreId,
            type: "INBOUND",
            sku: normalizedSku,
            productId: product._id,
            productName: product.name,
            toLocationId: location._id,
            toLocationCode: location.locationCode,
            quantity: qty,
            referenceType: "MANUAL",
            referenceId: batchReferenceId,
            performedBy: req.user._id,
            performedByName: actorName,
            qualityStatus: "GOOD",
            notes,
            ...snapshot,
          },
        ],
        { session }
      );

      const distributedToStores = await syncStoreInventory({
        productId: product._id,
        variantSku: normalizedSku,
        receivedQuantity: qty,
        pricingSnapshot: snapshot,
        session,
      });

      const createdDevices = serializedTrackingEnabled
        ? await registerSerializedUnits({
            storeId: activeStoreId,
            warehouseLocationId: location._id,
            warehouseLocationCode: location.locationCode,
            productId: product._id,
            variantId: pricedVariant._id,
            variantSku: normalizedSku,
            productName: product.name,
            variantName: pricedVariant.variantName || "",
            basePrice: snapshot.basePrice,
            originalPrice: snapshot.originalPrice,
            sellingPrice: snapshot.sellingPrice,
            costPrice: snapshot.costPrice,
            serializedUnits,
            notes,
            actor: req.user,
            session,
          })
        : [];

      const recalculatedProduct = await recalculateProductAvailability({
        productId: product._id,
        session,
      });
      const productActivated =
        String(recalculatedProduct?.status || "") === "IN_STOCK" &&
        statusBeforeStockIn !== "IN_STOCK";
      if (productActivated) {
        activatedProducts.add(String(product._id));
      }

      results.push({
        sku: normalizedSku,
        productName: product.name,
        quantity: qty,
        locationCode: normalizedLocationCode,
        variantStockAfter: pricedVariant.stock,
        inventoryQuantity: inventory.quantity,
        basePrice: snapshot.basePrice,
        costPrice: snapshot.costPrice,
        sellingPrice: snapshot.sellingPrice,
        referenceId: batchReferenceId,
        distributedToStores,
        serializedTrackingEnabled,
        registeredDevices: createdDevices.length,
        productActivated,
      });
    }

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: `Nhap kho thanh cong ${results.length} muc`,
      data: {
        items: results,
        referenceId: batchReferenceId,
        totalItems: results.length,
        totalQuantity: results.reduce((sum, item) => sum + item.quantity, 0),
        activatedProducts: activatedProducts.size,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: error.message || "Lỗi khi nhập kho",
    });
  } finally {
    session.endSession();
  }
};

export const getStockInHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, startDate, endDate } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);

    const filter = {
      type: "INBOUND",
      referenceType: "MANUAL",
    };

    const scopeMode = resolveWarehouseScopeMode(req);
    const activeBranchId = getActiveWarehouseBranchId(req);
    if (scopeMode === "branch") {
      filter.storeId = activeBranchId;
    }

    if (search) {
      filter.$or = [
        { sku: { $regex: search, $options: "i" } },
        { productName: { $regex: search, $options: "i" } },
        { performedByName: { $regex: search, $options: "i" } },
      ];
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (pageNum - 1) * limitNum;

    const [movements, total] = await Promise.all([
      StockMovement.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      StockMovement.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        movements,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy lịch sử nhập kho",
      error: error.message,
    });
  }
};

export default {
  directStockIn,
  getStockInHistory,
};
