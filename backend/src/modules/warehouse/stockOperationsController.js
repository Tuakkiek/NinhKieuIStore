<<<<<<< HEAD
// ============================================
// FILE: backend/src/modules/warehouse/stockOperationsController.js
// Controllers cho xuất kho, chuyển kho, kiểm kê
// ============================================

import Inventory from "./Inventory.js";
import WarehouseLocation from "./WarehouseLocation.js";
import StockMovement from "./StockMovement.js";
import CycleCount from "./CycleCount.js";
import Order from "../order/Order.js";
import { UniversalVariant } from "../product/UniversalProduct.js";
import mongoose from "mongoose";
import {
  getActiveWarehouseBranchId,
  ensureWarehouseWriteBranchId,
  resolveWarehouseStore,
} from "./warehouseContext.js";
import {
  assignDevicesToOrderItem,
  resolveSerializedItemFlags,
} from "../device/deviceService.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import { hasPermission } from "../../authz/policyEngine.js";

const getActorName = (user) =>
  user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim() || "Unknown";

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeSkuStrict = (value) => String(value || "").trim();
const normalizeSkuLoose = (value) => String(value || "").trim().replace(/^0+/, "");
const normalizeSku = normalizeSkuStrict;
const normalizeObjectId = (value) => String(value || "").trim();
const requestHasPermission = (req, permission, mode = "branch") =>
  hasPermission(req?.authz, permission, { mode });
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveSkuFromOrderItemSnapshot = (item = {}) =>
  normalizeSku(
    item?.sku ||
      item?.variantSku ||
      item?.productSku ||
      item?.variant?.sku ||
      item?.product?.sku ||
      item?.snapshot?.variantSku ||
      item?.snapshot?.sku
  );

const createOrderItemSkuResolver = ({ session = null, activeStoreId = "" } = {}) => {
  const skuCache = new Map();

  const assertInventoryRowIntegrity = (row, location = null) => {
    if (!row?.storeId) {
      throw new Error("DATA_CORRUPTION: Inventory missing storeId");
    }
    if (location?.storeId && String(row.storeId) !== String(location.storeId)) {
      throw new Error("DATA_CORRUPTION: store mismatch between inventory and location");
    }
  };

  const readCache = (key) => (skuCache.has(key) ? skuCache.get(key) : null);
  const writeCache = (key, sku) => {
    const normalized = normalizeSku(sku);
    skuCache.set(key, normalized);
    return normalized;
  };

  const findSkuByVariantId = async (variantId) => {
    const normalizedVariantId = normalizeObjectId(variantId);
    if (!normalizedVariantId) return "";

    const cacheKey = `variant:${normalizedVariantId}`;
    const cached = readCache(cacheKey);
    if (cached !== null) return cached;

    const query = UniversalVariant.findById(normalizedVariantId).select("sku");
    if (session) {
      query.session(session);
    }

    const variant = await query;
    return writeCache(cacheKey, variant?.sku);
  };

  const findSkuByProductInventory = async (productId) => {
    const normalizedProductId = normalizeObjectId(productId);
    if (!normalizedProductId) return "";

    const cacheKey = `inventory-product:${activeStoreId || "auto"}:${normalizedProductId}`;
    const cached = readCache(cacheKey);
    if (cached !== null) return cached;

    const inventoryFilter = {
      productId: normalizedProductId,
      quantity: { $gt: 0 },
      status: "GOOD",
    };
    if (activeStoreId) {
      inventoryFilter.storeId = activeStoreId;
    }

    const query = Inventory.find(inventoryFilter)
      .select("sku quantity")
      .sort({ quantity: -1 })
      .limit(10);
    if (session) {
      query.session(session);
    }

    const inventoryRows = await query;
    const distinctSkus = Array.from(
      new Set(
        (Array.isArray(inventoryRows) ? inventoryRows : [])
          .map((row) => normalizeSku(row?.sku))
          .filter(Boolean)
      )
    );

    if (distinctSkus.length !== 1) {
      return writeCache(cacheKey, "");
    }

    return writeCache(cacheKey, distinctSkus[0]);
  };

  return async (item = {}) => {
    const directSku = resolveSkuFromOrderItemSnapshot(item);
    if (directSku) return directSku;

    const byVariant = await findSkuByVariantId(item?.variantId);
    if (byVariant) return byVariant;

    const byProductInventory = await findSkuByProductInventory(item?.productId);
    if (byProductInventory) return byProductInventory;

    return "";
  };
};

const resolveUnpickableReason = ({
  hasAnyInventoryRows,
  hasAnyStoreRows,
  hasPositiveQuantityRows,
  hasGoodAndPositiveRows,
  hasGoodAndPositiveWithLocationRows,
  hasOtherStoreRows,
}) => {
  if (!hasAnyInventoryRows) return "NO_INVENTORY_FOR_SKU";
  if (!hasAnyStoreRows && hasOtherStoreRows) return "STORE_MISMATCH";
  if (!hasPositiveQuantityRows) return "ZERO_QUANTITY";
  if (!hasGoodAndPositiveRows) return "NOT_GOOD_STATUS";
  if (!hasGoodAndPositiveWithLocationRows) return "MISSING_LOCATION_CODE";
  return "NO_INVENTORY_FOR_SKU";
};

const sumQuantityBySku = (items = [], skuSelector) => {
  const result = new Map();

  for (const item of items) {
    const sku = normalizeSku(skuSelector(item));
    const quantity = Number(item?.quantity) || 0;
    if (!sku || quantity <= 0) continue;

    result.set(sku, (result.get(sku) || 0) + quantity);
  }

  return result;
};

const buildRequiredQuantityBySku = async (orderItems = [], resolveOrderItemSku) => {
  const result = new Map();
  const safeItems = Array.isArray(orderItems) ? orderItems : [];

  for (const item of safeItems) {
    const resolvedSku = resolveOrderItemSku
      ? await resolveOrderItemSku(item)
      : item?.sku || item?.variantSku;
    const sku = normalizeSku(resolvedSku);
    const quantity = Number(item?.quantity) || 0;
    if (!sku || quantity <= 0) continue;

    result.set(sku, (result.get(sku) || 0) + quantity);
  }

  return result;
};

const upsertPickedItems = (items = [], { sku, quantity, locationCode }) => {
  const normalizedSku = normalizeSku(sku);
  const normalizedLocationCode = String(locationCode || "").trim();
  const pickedQty = Number(quantity) || 0;
  const pickedItems = Array.isArray(items) ? [...items] : [];

  const existingIndex = pickedItems.findIndex(
    (item) =>
      normalizeSku(item?.sku) === normalizedSku &&
      String(item?.locationCode || "").trim() === normalizedLocationCode
  );

  if (existingIndex >= 0) {
    const currentQty = Number(pickedItems[existingIndex]?.quantity) || 0;
    pickedItems[existingIndex].quantity = currentQty + pickedQty;
    return pickedItems;
  }

  pickedItems.push({
    sku: normalizedSku,
    quantity: pickedQty,
    locationCode: normalizedLocationCode,
  });

  return pickedItems;
};

const isOrderPickCompleted = async (
  orderItems = [],
  pickedItems = [],
  { resolveOrderItemSku = null } = {}
) => {
  const requiredBySku = await buildRequiredQuantityBySku(orderItems, resolveOrderItemSku);
  if (requiredBySku.size === 0) return false;

  const pickedBySku = sumQuantityBySku(pickedItems, (item) => item?.sku);
  for (const [sku, requiredQty] of requiredBySku.entries()) {
    if ((pickedBySku.get(sku) || 0) < requiredQty) {
      return false;
    }
  }

  return true;
};

const appendStatusHistory = (order, status, updatedBy, note) => {
  if (!Array.isArray(order.statusHistory)) {
    order.statusHistory = [];
  }

  order.statusHistory.push({
    status,
    updatedBy,
    updatedAt: new Date(),
    note,
  });
};

// ============================================
// PHẦN 1: XUẤT KHO (PICK)
// ============================================

/**
 * Lấy danh sách pick cho đơn hàng
 * GET /api/warehouse/pick-list/:orderId
 */
export const getPickList = async (req, res) => {
  try {
    const { orderId } = req.params;
    const activeStoreId = getActiveWarehouseBranchId(req);

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    const pickList = [];
    const resolveOrderItemSku = createOrderItemSkuResolver({ activeStoreId });
    const serializedFlags = await resolveSerializedItemFlags({
      items: order.items,
    });

    for (const item of Array.isArray(order.items) ? order.items : []) {
      const sku = await resolveOrderItemSku(item);
      const strictSku = normalizeSkuStrict(sku);
      const looseSku = normalizeSkuLoose(sku);
      const itemId = String(item?._id || "");
      const itemFlag = serializedFlags.get(String(item.productId || "")) || {};
      const productName = item?.name || item?.productName || "Unnamed item";
      const requiredQty = Number(item?.quantity) || 0;

      if (!sku) {
        pickList.push({
          sku: "",
          productName,
          requiredQty,
          serializedTrackingEnabled: Boolean(itemFlag.isSerialized),
          assignedDevicesCount: Array.isArray(item.deviceAssignments)
            ? item.deviceAssignments.length
            : 0,
          locations: [],
          fulfilled: false,
          reason: "SKU_NOT_RESOLVED",
        });
        console.log("[pick-debug]", {
          stage: "pick-list",
          orderId: String(order._id),
          itemId,
          originalSku: sku,
          normalizedSku: strictSku,
          inventoryFound: false,
          reason: "SKU_NOT_RESOLVED",
        });
        continue;
      }

      // Step 1: strict SKU + active store scope for primary picking candidates.
      const inventoryFilter = { sku: strictSku };
      if (activeStoreId) {
        inventoryFilter.storeId = activeStoreId;
      }
      console.log("[pick-debug]", {
        stage: "pick-list",
        subStage: "before-inventory-query",
        orderId: String(order._id),
        itemId,
        originalSku: sku,
        normalizedSku: strictSku,
        looseSku,
        activeStoreId,
        inventoryFilter,
      });

      let scopedRows = await Inventory.find(inventoryFilter)
        .populate("locationId", "locationCode zoneName aisle shelf bin")
        .sort({ quantity: -1 });
      let matchedSku = strictSku;

      // Step 2: SAFE loose fallback only when strict has no rows and loose can identify exactly one SKU.
      if (scopedRows.length === 0 && looseSku && looseSku !== strictSku) {
        const fallbackFilter = {
          sku: { $regex: `^0*${escapeRegex(looseSku)}$` },
        };
        if (activeStoreId) {
          fallbackFilter.storeId = activeStoreId;
        }
        const fallbackRows = await Inventory.find(fallbackFilter)
          .populate("locationId", "locationCode zoneName aisle shelf bin")
          .sort({ quantity: -1 });
        const distinctFallbackSkus = Array.from(
          new Set(fallbackRows.map((row) => normalizeSkuStrict(row?.sku)).filter(Boolean))
        );
        if (distinctFallbackSkus.length === 1) {
          scopedRows = fallbackRows;
          matchedSku = distinctFallbackSkus[0];
          console.log("[pick-debug]", {
            stage: "pick-list",
            subStage: "sku-fallback-used",
            orderId: String(order._id),
            itemId,
            strictSku,
            looseSku,
            matchedSku,
          });
        } else {
          console.log("[pick-debug]", {
            stage: "pick-list",
            subStage: "sku-fallback-rejected",
            orderId: String(order._id),
            itemId,
            strictSku,
            looseSku,
            distinctFallbackSkus,
          });
        }
      }

      // Diagnostics set to explain exactly why item became unpickable.
      const globalRowsFilter = { sku: matchedSku };
      const scopedRowsFilter = { sku: matchedSku };
      if (activeStoreId) {
        scopedRowsFilter.storeId = activeStoreId;
      }

      const [allRowsAnyStore, allRowsScopedStore] = await Promise.all([
        Inventory.find(globalRowsFilter).select("storeId quantity status locationCode locationId").lean(),
        Inventory.find(scopedRowsFilter).select("storeId quantity status locationCode locationId").lean(),
      ]);

      const hasAnyInventoryRows = allRowsAnyStore.length > 0;
      const hasAnyStoreRows = allRowsScopedStore.length > 0;
      const hasOtherStoreRows =
        !hasAnyStoreRows &&
        allRowsAnyStore.some((row) => normalizeObjectId(row?.storeId) !== normalizeObjectId(activeStoreId));
      const hasPositiveQuantityRows = allRowsScopedStore.some((row) => (Number(row?.quantity) || 0) > 0);
      const hasGoodAndPositiveRows = allRowsScopedStore.some(
        (row) => row?.status === "GOOD" && (Number(row?.quantity) || 0) > 0
      );
      const hasGoodAndPositiveWithLocationRows = allRowsScopedStore.some(
        (row) =>
          row?.status === "GOOD" &&
          (Number(row?.quantity) || 0) > 0 &&
          String(row?.locationCode || "").trim()
      );

      const inventoryItems = scopedRows.filter(
        (row) => row?.status === "GOOD" && (Number(row?.quantity) || 0) > 0
      );
      console.log("[pick-debug]", {
        stage: "pick-list",
        subStage: "after-inventory-query",
        orderId: String(order._id),
        itemId,
        originalSku: sku,
        normalizedSku: matchedSku,
        scopedRows: scopedRows.length,
        inventoryCandidates: inventoryItems.length,
      });

      let remainingQty = requiredQty;
      const locations = [];
      let missingLocationCount = 0;

      for (const inv of inventoryItems) {
        if (remainingQty <= 0) break;

        const availableQty = Number.isFinite(inv.quantity) ? inv.quantity : 0;
        if (availableQty <= 0) continue;

        const resolvedLocationCode = inv.locationCode || inv.locationId?.locationCode || "";
        if (!resolvedLocationCode) {
          missingLocationCount += 1;
          console.log("[pick-debug]", {
            stage: "pick-list",
            subStage: "skip-location",
            orderId: String(order._id),
            itemId,
            originalSku: sku,
            normalizedSku: matchedSku,
            inventoryId: String(inv?._id || ""),
            reason: "MISSING_LOCATION_CODE",
          });
          continue;
        }

        const pickQty = Math.min(availableQty, remainingQty);
        locations.push({
          locationCode: resolvedLocationCode,
          zoneName: inv.locationId?.zoneName || "",
          aisle: inv.locationId?.aisle || "",
          shelf: inv.locationId?.shelf || "",
          bin: inv.locationId?.bin || "",
          availableQty,
          pickQty,
        });

        remainingQty -= pickQty;
      }

      const reason =
        remainingQty <= 0
          ? undefined
          : resolveUnpickableReason({
              hasAnyInventoryRows,
              hasAnyStoreRows,
              hasPositiveQuantityRows,
              hasGoodAndPositiveRows,
              hasGoodAndPositiveWithLocationRows:
                hasGoodAndPositiveWithLocationRows && missingLocationCount === 0,
              hasOtherStoreRows,
            });

      pickList.push({
        sku: matchedSku,
        productName,
        requiredQty,
        serializedTrackingEnabled: Boolean(itemFlag.isSerialized),
        assignedDevicesCount: Array.isArray(item.deviceAssignments)
          ? item.deviceAssignments.length
          : 0,
        locations,
        fulfilled: remainingQty <= 0,
        ...(remainingQty > 0 ? { reason } : {}),
      });

      if (remainingQty > 0) {
        console.log("[pick-debug]", {
          stage: "pick-list",
          subStage: "item-unpickable",
          orderId: String(order._id),
          itemId,
          originalSku: sku,
          normalizedSku: matchedSku,
          inventoryFound: locations.length > 0,
          reason,
        });
      }
    }

    res.json({
      success: true,
      orderId: order._id,
      orderNumber: order.orderNumber,
      orderSource: order.orderSource,
      fulfillmentType: order.fulfillmentType,
      orderStatus: order.status,
      pickList,
    });
  } catch (error) {
    console.error("Error getting pick list:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách pick",
      error: error.message,
    });
  }
};

/**
 * Xác nhận lấy hàng
 * POST /api/warehouse/pick
 */
export const pickItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const { orderId, sku, locationCode, quantity, deviceIds = [] } = req.body;
    const pickQty = toPositiveInteger(quantity);
    const actorName = getActorName(req.user);
    const normalizedSku = normalizeSku(sku);
    const normalizedLocationCode = String(locationCode || "").trim();

    if (!normalizedSku || !normalizedLocationCode || !pickQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Dữ liệu lấy hàng không hợp lệ (sku, locationCode, quantity)",
      });
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    const resolveOrderItemSku = createOrderItemSkuResolver({
      session,
      activeStoreId,
    });
    let orderItem = null;
    for (const item of Array.isArray(order.items) ? order.items : []) {
      const itemSku = normalizeSku(await resolveOrderItemSku(item));
      if (!orderItem && itemSku === normalizedSku) {
        orderItem = item;
      }
    }
    if (!orderItem) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: `KhÃ´ng tÃ¬m tháº¥y SKU ${normalizedSku} trong Ä‘Æ¡n hÃ ng`,
      });
    }

    if (!normalizeSku(orderItem?.variantSku) && !normalizeSku(orderItem?.sku)) {
      orderItem.variantSku = normalizedSku;
    }

    const isInStoreOrder =
      order.orderSource === "IN_STORE" || order.fulfillmentType === "IN_STORE";
    if (isInStoreOrder) {
      const assignedPickerId = order?.pickerInfo?.pickerId?.toString();
      const actorId = req.user?._id?.toString();

      if (!requestHasPermission(req, AUTHZ_ACTIONS.ORDER_PICK_COMPLETE_INSTORE, "branch")) {
        await session.abortTransaction();
        return res.status(403).json({
          success: false,
          message: "Đơn IN_STORE chỉ cho Warehouse Manager thao tác xuất kho",
        });
      }

      if (assignedPickerId && actorId && assignedPickerId !== actorId) {
        await session.abortTransaction();
        return res.status(403).json({
          success: false,
          message: "Đơn này đã được gán cho Warehouse Manager khác",
        });
      }
    }

    // Tìm inventory
    const location = await WarehouseLocation.findOne({
      storeId: activeStoreId,
      locationCode: normalizedLocationCode,
    }).session(session);
    if (!location) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Không tìm thấy vị trí" });
    }

    const inventory = await Inventory.findOne({
      sku: normalizedSku,
      storeId: activeStoreId,
      locationId: location._id,
    }).session(session);

    const availableQty = Number.isFinite(inventory?.quantity) ? inventory.quantity : 0;

    if (!inventory || availableQty < pickQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Không đủ hàng tại ${normalizedLocationCode}. Tồn: ${availableQty}`,
      });
    }

    if (String(inventory.productId || "") !== String(orderItem.productId || "")) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        code: "PRODUCT_MISMATCH",
        message: "PRODUCT_MISMATCH",
      });
    }

    // Trừ tồn kho
    inventory.quantity = availableQty - pickQty;
    await inventory.save({ session });

    // Cập nhật location
    const currentLoad = Number.isFinite(location.currentLoad) ? location.currentLoad : 0;
    location.currentLoad = Math.max(0, currentLoad - pickQty);
    await location.save({ session });

    // Ghi log
    const movement = new StockMovement({
      storeId: activeStoreId,
      type: "OUTBOUND",
      sku: normalizedSku,
      productId: inventory.productId,
      productName: inventory.productName,
      fromLocationId: location._id,
      fromLocationCode: normalizedLocationCode,
      quantity: pickQty,
      referenceType: "ORDER",
      referenceId: orderId,
      performedBy: req.user._id,
      performedByName: actorName,
    });
    await movement.save({ session });

    const serializedFlags = await resolveSerializedItemFlags({
      items: [orderItem],
      session,
    });
    const serializedTrackingEnabled =
      serializedFlags.get(String(orderItem.productId || ""))?.isSerialized || false;

    if (serializedTrackingEnabled) {
      if (Array.isArray(deviceIds) && deviceIds.length > 0 && deviceIds.length !== pickQty) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Sá»‘ lÆ°á»£ng deviceIds pháº£i báº±ng ${pickQty} cho SKU serialized`,
        });
      }

      await assignDevicesToOrderItem({
        storeId: activeStoreId,
        order,
        orderItem,
        requestedDeviceIds: Array.isArray(deviceIds) ? deviceIds : [],
        requestedQuantity: pickQty,
        actor: req.user,
        session,
        locationId: location._id,
        mode: Array.isArray(deviceIds) && deviceIds.length > 0 ? "MANUAL" : "AUTO",
      });
    }

    const shippedNote = `Xuat kho ${pickQty} ${normalizedSku} tai ${normalizedLocationCode}`;
    const pickedItems = upsertPickedItems(order?.shippedByInfo?.items, {
      sku: normalizedSku,
      quantity: pickQty,
      locationCode: normalizedLocationCode,
    });
    const pickCompleted = await isOrderPickCompleted(order.items, pickedItems, {
      resolveOrderItemSku,
    });
    const now = new Date();

    order.shippedByInfo = {
      ...order.shippedByInfo,
      shippedBy: req.user._id,
      shippedByName: actorName,
      shippedAt: now,
      shippedNote: shippedNote,
      items: pickedItems,
    };

    let historyStatus = order.status;
    let historyNote = shippedNote;

    if (pickCompleted && ["CONFIRMED", "PROCESSING", "PREPARING"].includes(order.status)) {
      order.status = "PREPARING_SHIPMENT";
      historyStatus = "PREPARING_SHIPMENT";
      historyNote = "Xuat kho hoan tat, san sang ban giao";

      order.pickerInfo = {
        ...order.pickerInfo,
        pickerId: order.pickerInfo?.pickerId || req.user._id,
        pickerName: order.pickerInfo?.pickerName || actorName,
        pickedAt: order.pickerInfo?.pickedAt || now,
        note: order.pickerInfo?.note || "",
      };
    }

    appendStatusHistory(order, historyStatus, req.user._id, historyNote);
    await order.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: `Đã lấy ${pickQty} ${inventory.productName}`,
      remaining: inventory.quantity,
      serializedTrackingEnabled,
      assignedDevicesCount: Array.isArray(orderItem.deviceAssignments)
        ? orderItem.deviceAssignments.length
        : 0,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error picking item:", error);
    res.status(500).json({ success: false, message: "Lỗi khi lấy hàng", error: error.message });
  } finally {
    session.endSession();
  }
};

// ============================================
// PHẦN 2: CHUYỂN KHO
// ============================================

/**
 * Chuyển hàng giữa các vị trí
 * POST /api/warehouse/transfer
 */
export const transferStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const { sku, fromLocationCode, toLocationCode, quantity, reason, notes } = req.body;
    const transferQty = toPositiveInteger(quantity);
    const actorName = getActorName(req.user);

    if (!sku?.trim() || !fromLocationCode?.trim() || !toLocationCode?.trim() || !transferQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "Dữ liệu chuyển kho không hợp lệ (sku, fromLocationCode, toLocationCode, quantity)",
      });
    }

    // Validate locations
    const fromLocation = await WarehouseLocation.findOne({
      storeId: activeStoreId,
      locationCode: fromLocationCode,
    }).session(session);
    const toLocation = await WarehouseLocation.findOne({
      storeId: activeStoreId,
      locationCode: toLocationCode,
    }).session(session);

    if (!fromLocation || !toLocation) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Không tìm thấy vị trí kho" });
    }

    // Check source inventory
    const fromInventory = await Inventory.findOne({
      storeId: activeStoreId,
      sku,
      locationId: fromLocation._id,
    })
      .select("storeId sku quantity productId productName locationId locationCode status")
      .session(session);
    if (!fromInventory?.storeId) {
      throw new Error("DATA_CORRUPTION: Inventory missing storeId");
    }
    if (String(fromInventory.storeId) !== String(fromLocation.storeId)) {
      throw new Error("DATA_CORRUPTION: store mismatch between inventory and location");
    }
    const sourceAvailableQty = Number.isFinite(fromInventory?.quantity) ? fromInventory.quantity : 0;
    if (!fromInventory || sourceAvailableQty < transferQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Không đủ hàng tại ${fromLocationCode}. Tồn: ${sourceAvailableQty}`,
      });
    }

    // Check destination capacity
    if (!toLocation.canAccommodate(transferQty)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Vị trí đích không đủ chỗ" });
    }

    // Trừ source
    fromInventory.quantity = sourceAvailableQty - transferQty;
    await fromInventory.save({ session });
    const fromCurrentLoad = Number.isFinite(fromLocation.currentLoad) ? fromLocation.currentLoad : 0;
    fromLocation.currentLoad = Math.max(0, fromCurrentLoad - transferQty);
    await fromLocation.save({ session });

    // Cộng destination
    let toInventory = await Inventory.findOne({
      storeId: activeStoreId,
      sku,
      locationId: toLocation._id,
    })
      .select("storeId sku quantity productId productName locationId locationCode status")
      .session(session);
    if (toInventory) {
      const destinationQty = Number.isFinite(toInventory.quantity) ? toInventory.quantity : 0;
      toInventory.quantity = destinationQty + transferQty;
      await toInventory.save({ session });
    } else {
      toInventory = new Inventory({
        storeId: activeStoreId,
        sku,
        productId: fromInventory.productId,
        productName: fromInventory.productName,
        locationId: toLocation._id,
        locationCode: toLocationCode,
        quantity: transferQty,
        status: fromInventory.status,
      });
      await toInventory.save({ session });
    }
    const toCurrentLoad = Number.isFinite(toLocation.currentLoad) ? toLocation.currentLoad : 0;
    toLocation.currentLoad = toCurrentLoad + transferQty;
    await toLocation.save({ session });

    // Ghi log
    const movement = new StockMovement({
      storeId: activeStoreId,
      type: "TRANSFER",
      sku,
      productId: fromInventory.productId,
      productName: fromInventory.productName,
      fromLocationId: fromLocation._id,
      fromLocationCode,
      toLocationId: toLocation._id,
      toLocationCode,
      quantity: transferQty,
      referenceType: "TRANSFER",
      referenceId: `TF-${Date.now()}`,
      performedBy: req.user._id,
      performedByName: actorName,
      notes: `${reason || ""} ${notes || ""}`.trim(),
    });
    await movement.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: `Đã chuyển ${transferQty} từ ${fromLocationCode} đến ${toLocationCode}`,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error transferring stock:", error);
    res.status(500).json({ success: false, message: "Lỗi khi chuyển kho", error: error.message });
  } finally {
    session.endSession();
  }
};

// ============================================
// PHẦN 3: KIỂM KÊ (CYCLE COUNT)
// ============================================

/**
 * Tạo phiếu kiểm kê
 * POST /api/warehouse/cycle-count
 */
export const createCycleCount = async (req, res) => {
  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    const activeStore = await resolveWarehouseStore(req, { branchId: activeStoreId });
    const { scope, zones, aisles, notes } = req.body;

    const count = await CycleCount.countDocuments();
    const countNumber = `CC-${activeStore.code}-${new Date().getFullYear()}-${String(
      count + 1
    ).padStart(4, "0")}`;

    // Lấy danh sách items cần kiểm
    const filter = { status: "ACTIVE" };
    if (zones?.length) filter.zone = { $in: zones };
    if (aisles?.length) filter.aisle = { $in: aisles };

    const locations = await WarehouseLocation.find(filter);
    const items = [];

    for (const loc of locations) {
      const inventoryItems = await Inventory.find({ storeId: activeStoreId, locationId: loc._id })
        .select("storeId sku productId productName locationId locationCode quantity status")
        .lean();
      for (const inv of inventoryItems) {
        if (!inv?.storeId) {
          throw new Error("DATA_CORRUPTION: Inventory missing storeId");
        }
        if (String(inv.storeId) !== String(loc.storeId)) {
          throw new Error("DATA_CORRUPTION: store mismatch between inventory and location");
        }
        items.push({
          sku: inv.sku,
          productId: inv.productId,
          productName: inv.productName,
          locationId: loc._id,
          locationCode: loc.locationCode,
          systemQuantity: inv.quantity,
          countedQuantity: null,
          variance: null,
          status: "PENDING",
        });
      }
    }

    const cycleCount = new CycleCount({
      storeId: activeStoreId,
      countNumber,
      scope:
        typeof scope === "object" && scope
          ? {
              warehouse: scope.warehouse || activeStore.code,
              zone: scope.zone || null,
              aisle: scope.aisle || null,
            }
          : {
              warehouse: activeStore.code,
              zone: zones?.[0] || null,
              aisle: aisles?.[0] || null,
            },
      countDate: new Date(),
      assignedTo: [
        {
          userId: req.user._id,
          userName: getActorName(req.user),
        },
      ],
      items,
      status: "IN_PROGRESS",
      createdBy: req.user._id,
      createdByName: getActorName(req.user),
      notes,
    });

    await cycleCount.save();

    res.status(201).json({
      success: true,
      message: `Đã tạo phiếu kiểm kê ${countNumber} với ${items.length} mục`,
      cycleCount,
    });
  } catch (error) {
    console.error("Error creating cycle count:", error);
    res.status(500).json({ success: false, message: "Lỗi khi tạo phiếu kiểm kê", error: error.message });
  }
};

/**
 * Lấy danh sách phiếu kiểm kê
 * GET /api/warehouse/cycle-count
 */
export const getCycleCounts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [cycleCounts, total] = await Promise.all([
      CycleCount.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      CycleCount.countDocuments(filter),
    ]);

    res.json({
      success: true,
      cycleCounts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Error getting cycle counts:", error);
    res.status(500).json({ success: false, message: "Lỗi khi lấy danh sách kiểm kê", error: error.message });
  }
};

/**
 * Cập nhật kết quả kiểm kê cho 1 item
 * PUT /api/warehouse/cycle-count/:id/update-item
 */
export const updateCycleCountItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { sku, locationCode, countedQuantity } = req.body;

    const cycleCount = await CycleCount.findById(id);
    if (!cycleCount) {
      return res.status(404).json({ success: false, message: "Không tìm thấy phiếu kiểm kê" });
    }

    const item = cycleCount.items.find((i) => i.sku === sku && i.locationCode === locationCode);
    if (!item) {
      return res.status(404).json({ success: false, message: "Không tìm thấy mục kiểm kê" });
    }

    item.countedQuantity = countedQuantity;
    item.variance = countedQuantity - item.systemQuantity;
    item.status = item.variance === 0 ? "MATCHED" : "VARIANCE";
    item.countedAt = new Date();
    item.countedBy = req.user._id;

    await cycleCount.save();

    res.json({ success: true, message: "Đã cập nhật", item });
  } catch (error) {
    console.error("Error updating cycle count item:", error);
    res.status(500).json({ success: false, message: "Lỗi khi cập nhật kiểm kê", error: error.message });
  }
};

/**
 * Hoàn thành kiểm kê
 * PUT /api/warehouse/cycle-count/:id/complete
 */
export const completeCycleCount = async (req, res) => {
  try {
    const cycleCount = await CycleCount.findById(req.params.id);
    if (!cycleCount) {
      return res.status(404).json({ success: false, message: "Không tìm thấy phiếu kiểm kê" });
    }

    // Tính summary
    const totalLocations = cycleCount.items.length;
    const matchedLocations = cycleCount.items.filter((item) => item.variance === 0).length;
    const varianceLocations = cycleCount.items.filter(
      (item) => item.variance !== 0 && item.countedQuantity !== null
    ).length;
    const totalVariance = cycleCount.items.reduce(
      (sum, item) => sum + (Number(item.variance) || 0),
      0
    );

    cycleCount.summary = {
      totalLocations,
      matchedLocations,
      varianceLocations,
      totalVariance,
    };
    cycleCount.status = "COMPLETED";
    cycleCount.completedAt = new Date();

    await cycleCount.save();

    res.json({ success: true, message: "Đã hoàn thành kiểm kê", cycleCount });
  } catch (error) {
    console.error("Error completing cycle count:", error);
    res.status(500).json({ success: false, message: "Lỗi khi hoàn thành kiểm kê", error: error.message });
  }
};

/**
 * Duyệt kiểm kê và điều chỉnh tồn kho
 * PUT /api/warehouse/cycle-count/:id/approve
 */
export const approveCycleCount = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const cycleCount = await CycleCount.findById(req.params.id).session(session);
    if (!cycleCount) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Không tìm thấy phiếu kiểm kê" });
    }

    if (cycleCount.status !== "COMPLETED") {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Phiếu chưa hoàn thành" });
    }

    // Điều chỉnh tồn kho cho các mục có chênh lệch
    for (const item of cycleCount.items) {
      if (item.variance && item.variance !== 0) {
        const inventory = await Inventory.findOne({
          storeId: activeStoreId,
          sku: item.sku,
          locationId: item.locationId,
        }).session(session);

        if (inventory) {
          inventory.quantity = item.countedQuantity;
          await inventory.save({ session });

          // Ghi log adjustment
          const movement = new StockMovement({
            storeId: activeStoreId,
            type: "ADJUSTMENT",
            sku: item.sku,
            productId: item.productId,
            productName: item.productName,
            toLocationId: item.locationId,
            toLocationCode: item.locationCode,
            quantity: Math.abs(item.variance),
            referenceType: "CYCLE_COUNT",
            referenceId: cycleCount.countNumber,
            performedBy: req.user._id,
            performedByName: getActorName(req.user),
            notes: `Điều chỉnh kiểm kê: ${item.variance > 0 ? "+" : ""}${item.variance}`,
          });
          await movement.save({ session });
        }
      }
    }

    cycleCount.status = "APPROVED";
    cycleCount.approvedBy = req.user._id;
    cycleCount.approvedByName = getActorName(req.user);
    cycleCount.approvedAt = new Date();
    await cycleCount.save({ session });

    await session.commitTransaction();

    res.json({ success: true, message: "Đã duyệt và điều chỉnh tồn kho", cycleCount });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error approving cycle count:", error);
    res.status(500).json({ success: false, message: "Lỗi khi duyệt kiểm kê", error: error.message });
  } finally {
    session.endSession();
  }
};

export default {
  getPickList,
  pickItem,
  transferStock,
  createCycleCount,
  getCycleCounts,
  updateCycleCountItem,
  completeCycleCount,
  approveCycleCount,
};


=======
// ============================================
// FILE: backend/src/modules/warehouse/stockOperationsController.js
// Controllers cho xuất kho, chuyển kho, kiểm kê
// ============================================

import Inventory from "./Inventory.js";
import WarehouseLocation from "./WarehouseLocation.js";
import StockMovement from "./StockMovement.js";
import CycleCount from "./CycleCount.js";
import Order from "../order/Order.js";
import { UniversalVariant } from "../product/UniversalProduct.js";
import mongoose from "mongoose";
import {
  getActiveWarehouseBranchId,
  ensureWarehouseWriteBranchId,
  resolveWarehouseStore,
} from "./warehouseContext.js";
import {
  assignDevicesToOrderItem,
  resolveSerializedItemFlags,
} from "../device/deviceService.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import { hasPermission } from "../../authz/policyEngine.js";

const getActorName = (user) =>
  user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim() || "Unknown";

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeSkuStrict = (value) => String(value || "").trim();
const normalizeSkuLoose = (value) => String(value || "").trim().replace(/^0+/, "");
const normalizeSku = normalizeSkuStrict;
const normalizeObjectId = (value) => String(value || "").trim();
const requestHasPermission = (req, permission, mode = "branch") =>
  hasPermission(req?.authz, permission, { mode });
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveSkuFromOrderItemSnapshot = (item = {}) =>
  normalizeSku(
    item?.sku ||
      item?.variantSku ||
      item?.productSku ||
      item?.variant?.sku ||
      item?.product?.sku ||
      item?.snapshot?.variantSku ||
      item?.snapshot?.sku
  );

const createOrderItemSkuResolver = ({ session = null, activeStoreId = "" } = {}) => {
  const skuCache = new Map();

  const assertInventoryRowIntegrity = (row, location = null) => {
    if (!row?.storeId) {
      throw new Error("DATA_CORRUPTION: Inventory missing storeId");
    }
    if (location?.storeId && String(row.storeId) !== String(location.storeId)) {
      throw new Error("DATA_CORRUPTION: store mismatch between inventory and location");
    }
  };

  const readCache = (key) => (skuCache.has(key) ? skuCache.get(key) : null);
  const writeCache = (key, sku) => {
    const normalized = normalizeSku(sku);
    skuCache.set(key, normalized);
    return normalized;
  };

  const findSkuByVariantId = async (variantId) => {
    const normalizedVariantId = normalizeObjectId(variantId);
    if (!normalizedVariantId) return "";

    const cacheKey = `variant:${normalizedVariantId}`;
    const cached = readCache(cacheKey);
    if (cached !== null) return cached;

    const query = UniversalVariant.findById(normalizedVariantId).select("sku");
    if (session) {
      query.session(session);
    }

    const variant = await query;
    return writeCache(cacheKey, variant?.sku);
  };

  const findSkuByProductInventory = async (productId) => {
    const normalizedProductId = normalizeObjectId(productId);
    if (!normalizedProductId) return "";

    const cacheKey = `inventory-product:${activeStoreId || "auto"}:${normalizedProductId}`;
    const cached = readCache(cacheKey);
    if (cached !== null) return cached;

    const inventoryFilter = {
      productId: normalizedProductId,
      quantity: { $gt: 0 },
      status: "GOOD",
    };
    if (activeStoreId) {
      inventoryFilter.storeId = activeStoreId;
    }

    const query = Inventory.find(inventoryFilter)
      .select("sku quantity")
      .sort({ quantity: -1 })
      .limit(10);
    if (session) {
      query.session(session);
    }

    const inventoryRows = await query;
    const distinctSkus = Array.from(
      new Set(
        (Array.isArray(inventoryRows) ? inventoryRows : [])
          .map((row) => normalizeSku(row?.sku))
          .filter(Boolean)
      )
    );

    if (distinctSkus.length !== 1) {
      return writeCache(cacheKey, "");
    }

    return writeCache(cacheKey, distinctSkus[0]);
  };

  return async (item = {}) => {
    const directSku = resolveSkuFromOrderItemSnapshot(item);
    if (directSku) return directSku;

    const byVariant = await findSkuByVariantId(item?.variantId);
    if (byVariant) return byVariant;

    const byProductInventory = await findSkuByProductInventory(item?.productId);
    if (byProductInventory) return byProductInventory;

    return "";
  };
};

const resolveUnpickableReason = ({
  hasAnyInventoryRows,
  hasAnyStoreRows,
  hasPositiveQuantityRows,
  hasGoodAndPositiveRows,
  hasGoodAndPositiveWithLocationRows,
  hasOtherStoreRows,
}) => {
  if (!hasAnyInventoryRows) return "NO_INVENTORY_FOR_SKU";
  if (!hasAnyStoreRows && hasOtherStoreRows) return "STORE_MISMATCH";
  if (!hasPositiveQuantityRows) return "ZERO_QUANTITY";
  if (!hasGoodAndPositiveRows) return "NOT_GOOD_STATUS";
  if (!hasGoodAndPositiveWithLocationRows) return "MISSING_LOCATION_CODE";
  return "NO_INVENTORY_FOR_SKU";
};

const sumQuantityBySku = (items = [], skuSelector) => {
  const result = new Map();

  for (const item of items) {
    const sku = normalizeSku(skuSelector(item));
    const quantity = Number(item?.quantity) || 0;
    if (!sku || quantity <= 0) continue;

    result.set(sku, (result.get(sku) || 0) + quantity);
  }

  return result;
};

const buildRequiredQuantityBySku = async (orderItems = [], resolveOrderItemSku) => {
  const result = new Map();
  const safeItems = Array.isArray(orderItems) ? orderItems : [];

  for (const item of safeItems) {
    const resolvedSku = resolveOrderItemSku
      ? await resolveOrderItemSku(item)
      : item?.sku || item?.variantSku;
    const sku = normalizeSku(resolvedSku);
    const quantity = Number(item?.quantity) || 0;
    if (!sku || quantity <= 0) continue;

    result.set(sku, (result.get(sku) || 0) + quantity);
  }

  return result;
};

const upsertPickedItems = (items = [], { sku, quantity, locationCode }) => {
  const normalizedSku = normalizeSku(sku);
  const normalizedLocationCode = String(locationCode || "").trim();
  const pickedQty = Number(quantity) || 0;
  const pickedItems = Array.isArray(items) ? [...items] : [];

  const existingIndex = pickedItems.findIndex(
    (item) =>
      normalizeSku(item?.sku) === normalizedSku &&
      String(item?.locationCode || "").trim() === normalizedLocationCode
  );

  if (existingIndex >= 0) {
    const currentQty = Number(pickedItems[existingIndex]?.quantity) || 0;
    pickedItems[existingIndex].quantity = currentQty + pickedQty;
    return pickedItems;
  }

  pickedItems.push({
    sku: normalizedSku,
    quantity: pickedQty,
    locationCode: normalizedLocationCode,
  });

  return pickedItems;
};

const isOrderPickCompleted = async (
  orderItems = [],
  pickedItems = [],
  { resolveOrderItemSku = null } = {}
) => {
  const requiredBySku = await buildRequiredQuantityBySku(orderItems, resolveOrderItemSku);
  if (requiredBySku.size === 0) return false;

  const pickedBySku = sumQuantityBySku(pickedItems, (item) => item?.sku);
  for (const [sku, requiredQty] of requiredBySku.entries()) {
    if ((pickedBySku.get(sku) || 0) < requiredQty) {
      return false;
    }
  }

  return true;
};

const appendStatusHistory = (order, status, updatedBy, note) => {
  if (!Array.isArray(order.statusHistory)) {
    order.statusHistory = [];
  }

  order.statusHistory.push({
    status,
    updatedBy,
    updatedAt: new Date(),
    note,
  });
};

// ============================================
// PHẦN 1: XUẤT KHO (PICK)
// ============================================

/**
 * Lấy danh sách pick cho đơn hàng
 * GET /api/warehouse/pick-list/:orderId
 */
export const getPickList = async (req, res) => {
  try {
    const { orderId } = req.params;
    const activeStoreId = getActiveWarehouseBranchId(req);

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    const pickList = [];
    const resolveOrderItemSku = createOrderItemSkuResolver({ activeStoreId });
    const serializedFlags = await resolveSerializedItemFlags({
      items: order.items,
    });

    for (const item of Array.isArray(order.items) ? order.items : []) {
      const sku = await resolveOrderItemSku(item);
      const strictSku = normalizeSkuStrict(sku);
      const looseSku = normalizeSkuLoose(sku);
      const itemId = String(item?._id || "");
      const itemFlag = serializedFlags.get(String(item.productId || "")) || {};
      const productName = item?.name || item?.productName || "Unnamed item";
      const requiredQty = Number(item?.quantity) || 0;

      if (!sku) {
        pickList.push({
          sku: "",
          productName,
          requiredQty,
          serializedTrackingEnabled: Boolean(itemFlag.isSerialized),
          assignedDevicesCount: Array.isArray(item.deviceAssignments)
            ? item.deviceAssignments.length
            : 0,
          locations: [],
          fulfilled: false,
          reason: "SKU_NOT_RESOLVED",
        });
        console.log("[pick-debug]", {
          stage: "pick-list",
          orderId: String(order._id),
          itemId,
          originalSku: sku,
          normalizedSku: strictSku,
          inventoryFound: false,
          reason: "SKU_NOT_RESOLVED",
        });
        continue;
      }

      // Step 1: strict SKU + active store scope for primary picking candidates.
      const inventoryFilter = { sku: strictSku };
      if (activeStoreId) {
        inventoryFilter.storeId = activeStoreId;
      }
      console.log("[pick-debug]", {
        stage: "pick-list",
        subStage: "before-inventory-query",
        orderId: String(order._id),
        itemId,
        originalSku: sku,
        normalizedSku: strictSku,
        looseSku,
        activeStoreId,
        inventoryFilter,
      });

      let scopedRows = await Inventory.find(inventoryFilter)
        .populate("locationId", "locationCode zoneName aisle shelf bin")
        .sort({ quantity: -1 });
      let matchedSku = strictSku;

      // Step 2: SAFE loose fallback only when strict has no rows and loose can identify exactly one SKU.
      if (scopedRows.length === 0 && looseSku && looseSku !== strictSku) {
        const fallbackFilter = {
          sku: { $regex: `^0*${escapeRegex(looseSku)}$` },
        };
        if (activeStoreId) {
          fallbackFilter.storeId = activeStoreId;
        }
        const fallbackRows = await Inventory.find(fallbackFilter)
          .populate("locationId", "locationCode zoneName aisle shelf bin")
          .sort({ quantity: -1 });
        const distinctFallbackSkus = Array.from(
          new Set(fallbackRows.map((row) => normalizeSkuStrict(row?.sku)).filter(Boolean))
        );
        if (distinctFallbackSkus.length === 1) {
          scopedRows = fallbackRows;
          matchedSku = distinctFallbackSkus[0];
          console.log("[pick-debug]", {
            stage: "pick-list",
            subStage: "sku-fallback-used",
            orderId: String(order._id),
            itemId,
            strictSku,
            looseSku,
            matchedSku,
          });
        } else {
          console.log("[pick-debug]", {
            stage: "pick-list",
            subStage: "sku-fallback-rejected",
            orderId: String(order._id),
            itemId,
            strictSku,
            looseSku,
            distinctFallbackSkus,
          });
        }
      }

      // Diagnostics set to explain exactly why item became unpickable.
      const globalRowsFilter = { sku: matchedSku };
      const scopedRowsFilter = { sku: matchedSku };
      if (activeStoreId) {
        scopedRowsFilter.storeId = activeStoreId;
      }

      const [allRowsAnyStore, allRowsScopedStore] = await Promise.all([
        Inventory.find(globalRowsFilter).select("storeId quantity status locationCode locationId").lean(),
        Inventory.find(scopedRowsFilter).select("storeId quantity status locationCode locationId").lean(),
      ]);

      const hasAnyInventoryRows = allRowsAnyStore.length > 0;
      const hasAnyStoreRows = allRowsScopedStore.length > 0;
      const hasOtherStoreRows =
        !hasAnyStoreRows &&
        allRowsAnyStore.some((row) => normalizeObjectId(row?.storeId) !== normalizeObjectId(activeStoreId));
      const hasPositiveQuantityRows = allRowsScopedStore.some((row) => (Number(row?.quantity) || 0) > 0);
      const hasGoodAndPositiveRows = allRowsScopedStore.some(
        (row) => row?.status === "GOOD" && (Number(row?.quantity) || 0) > 0
      );
      const hasGoodAndPositiveWithLocationRows = allRowsScopedStore.some(
        (row) =>
          row?.status === "GOOD" &&
          (Number(row?.quantity) || 0) > 0 &&
          String(row?.locationCode || "").trim()
      );

      const inventoryItems = scopedRows.filter(
        (row) => row?.status === "GOOD" && (Number(row?.quantity) || 0) > 0
      );
      console.log("[pick-debug]", {
        stage: "pick-list",
        subStage: "after-inventory-query",
        orderId: String(order._id),
        itemId,
        originalSku: sku,
        normalizedSku: matchedSku,
        scopedRows: scopedRows.length,
        inventoryCandidates: inventoryItems.length,
      });

      let remainingQty = requiredQty;
      const locations = [];
      let missingLocationCount = 0;

      for (const inv of inventoryItems) {
        if (remainingQty <= 0) break;

        const availableQty = Number.isFinite(inv.quantity) ? inv.quantity : 0;
        if (availableQty <= 0) continue;

        const resolvedLocationCode = inv.locationCode || inv.locationId?.locationCode || "";
        if (!resolvedLocationCode) {
          missingLocationCount += 1;
          console.log("[pick-debug]", {
            stage: "pick-list",
            subStage: "skip-location",
            orderId: String(order._id),
            itemId,
            originalSku: sku,
            normalizedSku: matchedSku,
            inventoryId: String(inv?._id || ""),
            reason: "MISSING_LOCATION_CODE",
          });
          continue;
        }

        const pickQty = Math.min(availableQty, remainingQty);
        locations.push({
          locationCode: resolvedLocationCode,
          zoneName: inv.locationId?.zoneName || "",
          aisle: inv.locationId?.aisle || "",
          shelf: inv.locationId?.shelf || "",
          bin: inv.locationId?.bin || "",
          availableQty,
          pickQty,
        });

        remainingQty -= pickQty;
      }

      const reason =
        remainingQty <= 0
          ? undefined
          : resolveUnpickableReason({
              hasAnyInventoryRows,
              hasAnyStoreRows,
              hasPositiveQuantityRows,
              hasGoodAndPositiveRows,
              hasGoodAndPositiveWithLocationRows:
                hasGoodAndPositiveWithLocationRows && missingLocationCount === 0,
              hasOtherStoreRows,
            });

      pickList.push({
        sku: matchedSku,
        productName,
        requiredQty,
        serializedTrackingEnabled: Boolean(itemFlag.isSerialized),
        assignedDevicesCount: Array.isArray(item.deviceAssignments)
          ? item.deviceAssignments.length
          : 0,
        locations,
        fulfilled: remainingQty <= 0,
        ...(remainingQty > 0 ? { reason } : {}),
      });

      if (remainingQty > 0) {
        console.log("[pick-debug]", {
          stage: "pick-list",
          subStage: "item-unpickable",
          orderId: String(order._id),
          itemId,
          originalSku: sku,
          normalizedSku: matchedSku,
          inventoryFound: locations.length > 0,
          reason,
        });
      }
    }

    res.json({
      success: true,
      orderId: order._id,
      orderNumber: order.orderNumber,
      orderSource: order.orderSource,
      fulfillmentType: order.fulfillmentType,
      orderStatus: order.status,
      pickList,
    });
  } catch (error) {
    console.error("Error getting pick list:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách pick",
      error: error.message,
    });
  }
};

/**
 * Xác nhận lấy hàng
 * POST /api/warehouse/pick
 */
export const pickItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const { orderId, sku, locationCode, quantity, deviceIds = [] } = req.body;
    const pickQty = toPositiveInteger(quantity);
    const actorName = getActorName(req.user);
    const normalizedSku = normalizeSku(sku);
    const normalizedLocationCode = String(locationCode || "").trim();

    if (!normalizedSku || !normalizedLocationCode || !pickQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Dữ liệu lấy hàng không hợp lệ (sku, locationCode, quantity)",
      });
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    const resolveOrderItemSku = createOrderItemSkuResolver({
      session,
      activeStoreId,
    });
    let orderItem = null;
    for (const item of Array.isArray(order.items) ? order.items : []) {
      const itemSku = normalizeSku(await resolveOrderItemSku(item));
      if (!orderItem && itemSku === normalizedSku) {
        orderItem = item;
      }
    }
    if (!orderItem) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: `KhÃ´ng tÃ¬m tháº¥y SKU ${normalizedSku} trong Ä‘Æ¡n hÃ ng`,
      });
    }

    if (!normalizeSku(orderItem?.variantSku)) {
      orderItem.variantSku = normalizedSku;
    }

    const isInStoreOrder =
      order.orderSource === "IN_STORE" || order.fulfillmentType === "IN_STORE";
    if (isInStoreOrder) {
      const assignedPickerId = order?.pickerInfo?.pickerId?.toString();
      const actorId = req.user?._id?.toString();

      if (!requestHasPermission(req, AUTHZ_ACTIONS.ORDER_PICK_COMPLETE_INSTORE, "branch")) {
        await session.abortTransaction();
        return res.status(403).json({
          success: false,
          message: "Đơn IN_STORE chỉ cho Warehouse Manager thao tác xuất kho",
        });
      }

      if (assignedPickerId && actorId && assignedPickerId !== actorId) {
        await session.abortTransaction();
        return res.status(403).json({
          success: false,
          message: "Đơn này đã được gán cho Warehouse Manager khác",
        });
      }
    }

    // Tìm inventory
    const location = await WarehouseLocation.findOne({
      storeId: activeStoreId,
      locationCode: normalizedLocationCode,
    }).session(session);
    if (!location) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Không tìm thấy vị trí" });
    }

    const inventory = await Inventory.findOne({
      sku: normalizedSku,
      storeId: activeStoreId,
      locationId: location._id,
    }).session(session);

    const availableQty = Number.isFinite(inventory?.quantity) ? inventory.quantity : 0;

    if (!inventory || availableQty < pickQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Không đủ hàng tại ${normalizedLocationCode}. Tồn: ${availableQty}`,
      });
    }

    if (String(inventory.productId || "") !== String(orderItem.productId || "")) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        code: "PRODUCT_MISMATCH",
        message: "PRODUCT_MISMATCH",
      });
    }

    // Trừ tồn kho
    inventory.quantity = availableQty - pickQty;
    await inventory.save({ session });

    // Cập nhật location
    const currentLoad = Number.isFinite(location.currentLoad) ? location.currentLoad : 0;
    location.currentLoad = Math.max(0, currentLoad - pickQty);
    await location.save({ session });

    // Ghi log
    const movement = new StockMovement({
      storeId: activeStoreId,
      type: "OUTBOUND",
      sku: normalizedSku,
      productId: inventory.productId,
      productName: inventory.productName,
      fromLocationId: location._id,
      fromLocationCode: normalizedLocationCode,
      quantity: pickQty,
      referenceType: "ORDER",
      referenceId: orderId,
      performedBy: req.user._id,
      performedByName: actorName,
    });
    await movement.save({ session });

    const serializedFlags = await resolveSerializedItemFlags({
      items: [orderItem],
      session,
    });
    const serializedTrackingEnabled =
      serializedFlags.get(String(orderItem.productId || ""))?.isSerialized || false;

    if (serializedTrackingEnabled) {
      if (Array.isArray(deviceIds) && deviceIds.length > 0 && deviceIds.length !== pickQty) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Sá»‘ lÆ°á»£ng deviceIds pháº£i báº±ng ${pickQty} cho SKU serialized`,
        });
      }

      await assignDevicesToOrderItem({
        storeId: activeStoreId,
        order,
        orderItem,
        requestedDeviceIds: Array.isArray(deviceIds) ? deviceIds : [],
        requestedQuantity: pickQty,
        actor: req.user,
        session,
        locationId: location._id,
        mode: Array.isArray(deviceIds) && deviceIds.length > 0 ? "MANUAL" : "AUTO",
      });
    }

    const shippedNote = `Xuat kho ${pickQty} ${normalizedSku} tai ${normalizedLocationCode}`;
    const pickedItems = upsertPickedItems(order?.shippedByInfo?.items, {
      sku: normalizedSku,
      quantity: pickQty,
      locationCode: normalizedLocationCode,
    });
    const pickCompleted = await isOrderPickCompleted(order.items, pickedItems, {
      resolveOrderItemSku,
    });
    const now = new Date();

    order.shippedByInfo = {
      ...order.shippedByInfo,
      shippedBy: req.user._id,
      shippedByName: actorName,
      shippedAt: now,
      shippedNote: shippedNote,
      items: pickedItems,
    };

    let historyStatus = order.status;
    let historyNote = shippedNote;

    if (pickCompleted && ["CONFIRMED", "PROCESSING", "PREPARING"].includes(order.status)) {
      order.status = "PREPARING_SHIPMENT";
      historyStatus = "PREPARING_SHIPMENT";
      historyNote = "Xuat kho hoan tat, san sang ban giao";

      order.pickerInfo = {
        ...order.pickerInfo,
        pickerId: order.pickerInfo?.pickerId || req.user._id,
        pickerName: order.pickerInfo?.pickerName || actorName,
        pickedAt: order.pickerInfo?.pickedAt || now,
        note: order.pickerInfo?.note || "",
      };
    }

    appendStatusHistory(order, historyStatus, req.user._id, historyNote);
    await order.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: `Đã lấy ${pickQty} ${inventory.productName}`,
      remaining: inventory.quantity,
      serializedTrackingEnabled,
      assignedDevicesCount: Array.isArray(orderItem.deviceAssignments)
        ? orderItem.deviceAssignments.length
        : 0,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("❌ [WAREHOUSE_ERROR] Error picking item:", error);
    const status = error.httpStatus || error.status || 500;
    res.status(status).json({
      success: false,
      code: error.code || "PICK_FAILED",
      message: error.message || "Lỗi khi lấy hàng",
    });
  } finally {
    session.endSession();
  }
};

// ============================================
// PHẦN 2: CHUYỂN KHO
// ============================================

/**
 * Chuyển hàng giữa các vị trí
 * POST /api/warehouse/transfer
 */
export const transferStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const { sku, fromLocationCode, toLocationCode, quantity, reason, notes } = req.body;
    const transferQty = toPositiveInteger(quantity);
    const actorName = getActorName(req.user);

    if (!sku?.trim() || !fromLocationCode?.trim() || !toLocationCode?.trim() || !transferQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "Dữ liệu chuyển kho không hợp lệ (sku, fromLocationCode, toLocationCode, quantity)",
      });
    }

    // Validate locations
    const fromLocation = await WarehouseLocation.findOne({
      storeId: activeStoreId,
      locationCode: fromLocationCode,
    }).session(session);
    const toLocation = await WarehouseLocation.findOne({
      storeId: activeStoreId,
      locationCode: toLocationCode,
    }).session(session);

    if (!fromLocation || !toLocation) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Không tìm thấy vị trí kho" });
    }

    // Check source inventory
    const fromInventory = await Inventory.findOne({
      storeId: activeStoreId,
      sku,
      locationId: fromLocation._id,
    })
      .select("storeId sku quantity productId productName locationId locationCode status")
      .session(session);
    if (!fromInventory?.storeId) {
      throw new Error("DATA_CORRUPTION: Inventory missing storeId");
    }
    if (String(fromInventory.storeId) !== String(fromLocation.storeId)) {
      throw new Error("DATA_CORRUPTION: store mismatch between inventory and location");
    }
    const sourceAvailableQty = Number.isFinite(fromInventory?.quantity) ? fromInventory.quantity : 0;
    if (!fromInventory || sourceAvailableQty < transferQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Không đủ hàng tại ${fromLocationCode}. Tồn: ${sourceAvailableQty}`,
      });
    }

    // Check destination capacity
    if (!toLocation.canAccommodate(transferQty)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Vị trí đích không đủ chỗ" });
    }

    // Trừ source
    fromInventory.quantity = sourceAvailableQty - transferQty;
    await fromInventory.save({ session });
    const fromCurrentLoad = Number.isFinite(fromLocation.currentLoad) ? fromLocation.currentLoad : 0;
    fromLocation.currentLoad = Math.max(0, fromCurrentLoad - transferQty);
    await fromLocation.save({ session });

    // Cộng destination
    let toInventory = await Inventory.findOne({
      storeId: activeStoreId,
      sku,
      locationId: toLocation._id,
    })
      .select("storeId sku quantity productId productName locationId locationCode status")
      .session(session);
    if (toInventory) {
      const destinationQty = Number.isFinite(toInventory.quantity) ? toInventory.quantity : 0;
      toInventory.quantity = destinationQty + transferQty;
      await toInventory.save({ session });
    } else {
      toInventory = new Inventory({
        storeId: activeStoreId,
        sku,
        productId: fromInventory.productId,
        productName: fromInventory.productName,
        locationId: toLocation._id,
        locationCode: toLocationCode,
        quantity: transferQty,
        status: fromInventory.status,
      });
      await toInventory.save({ session });
    }
    const toCurrentLoad = Number.isFinite(toLocation.currentLoad) ? toLocation.currentLoad : 0;
    toLocation.currentLoad = toCurrentLoad + transferQty;
    await toLocation.save({ session });

    // Ghi log
    const movement = new StockMovement({
      storeId: activeStoreId,
      type: "TRANSFER",
      sku,
      productId: fromInventory.productId,
      productName: fromInventory.productName,
      fromLocationId: fromLocation._id,
      fromLocationCode,
      toLocationId: toLocation._id,
      toLocationCode,
      quantity: transferQty,
      referenceType: "TRANSFER",
      referenceId: `TF-${Date.now()}`,
      performedBy: req.user._id,
      performedByName: actorName,
      notes: `${reason || ""} ${notes || ""}`.trim(),
    });
    await movement.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: `Đã chuyển ${transferQty} từ ${fromLocationCode} đến ${toLocationCode}`,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error transferring stock:", error);
    res.status(500).json({ success: false, message: "Lỗi khi chuyển kho", error: error.message });
  } finally {
    session.endSession();
  }
};

// ============================================
// PHẦN 3: KIỂM KÊ (CYCLE COUNT)
// ============================================

/**
 * Tạo phiếu kiểm kê
 * POST /api/warehouse/cycle-count
 */
export const createCycleCount = async (req, res) => {
  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    const activeStore = await resolveWarehouseStore(req, { branchId: activeStoreId });
    const { scope, zones, aisles, notes } = req.body;

    const count = await CycleCount.countDocuments();
    const countNumber = `CC-${activeStore.code}-${new Date().getFullYear()}-${String(
      count + 1
    ).padStart(4, "0")}`;

    // Lấy danh sách items cần kiểm
    const filter = { status: "ACTIVE" };
    if (zones?.length) filter.zone = { $in: zones };
    if (aisles?.length) filter.aisle = { $in: aisles };

    const locations = await WarehouseLocation.find(filter);
    const items = [];

    for (const loc of locations) {
      const inventoryItems = await Inventory.find({ storeId: activeStoreId, locationId: loc._id })
        .select("storeId sku productId productName locationId locationCode quantity status")
        .lean();
      for (const inv of inventoryItems) {
        if (!inv?.storeId) {
          throw new Error("DATA_CORRUPTION: Inventory missing storeId");
        }
        if (String(inv.storeId) !== String(loc.storeId)) {
          throw new Error("DATA_CORRUPTION: store mismatch between inventory and location");
        }
        items.push({
          sku: inv.sku,
          productId: inv.productId,
          productName: inv.productName,
          locationId: loc._id,
          locationCode: loc.locationCode,
          systemQuantity: inv.quantity,
          countedQuantity: null,
          variance: null,
          status: "PENDING",
        });
      }
    }

    const cycleCount = new CycleCount({
      storeId: activeStoreId,
      countNumber,
      scope:
        typeof scope === "object" && scope
          ? {
              warehouse: scope.warehouse || activeStore.code,
              zone: scope.zone || null,
              aisle: scope.aisle || null,
            }
          : {
              warehouse: activeStore.code,
              zone: zones?.[0] || null,
              aisle: aisles?.[0] || null,
            },
      countDate: new Date(),
      assignedTo: [
        {
          userId: req.user._id,
          userName: getActorName(req.user),
        },
      ],
      items,
      status: "IN_PROGRESS",
      createdBy: req.user._id,
      createdByName: getActorName(req.user),
      notes,
    });

    await cycleCount.save();

    res.status(201).json({
      success: true,
      message: `Đã tạo phiếu kiểm kê ${countNumber} với ${items.length} mục`,
      cycleCount,
    });
  } catch (error) {
    console.error("Error creating cycle count:", error);
    res.status(500).json({ success: false, message: "Lỗi khi tạo phiếu kiểm kê", error: error.message });
  }
};

/**
 * Lấy danh sách phiếu kiểm kê
 * GET /api/warehouse/cycle-count
 */
export const getCycleCounts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [cycleCounts, total] = await Promise.all([
      CycleCount.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      CycleCount.countDocuments(filter),
    ]);

    res.json({
      success: true,
      cycleCounts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Error getting cycle counts:", error);
    res.status(500).json({ success: false, message: "Lỗi khi lấy danh sách kiểm kê", error: error.message });
  }
};

/**
 * Cập nhật kết quả kiểm kê cho 1 item
 * PUT /api/warehouse/cycle-count/:id/update-item
 */
export const updateCycleCountItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { sku, locationCode, countedQuantity } = req.body;

    const cycleCount = await CycleCount.findById(id);
    if (!cycleCount) {
      return res.status(404).json({ success: false, message: "Không tìm thấy phiếu kiểm kê" });
    }

    const item = cycleCount.items.find((i) => i.sku === sku && i.locationCode === locationCode);
    if (!item) {
      return res.status(404).json({ success: false, message: "Không tìm thấy mục kiểm kê" });
    }

    item.countedQuantity = countedQuantity;
    item.variance = countedQuantity - item.systemQuantity;
    item.status = item.variance === 0 ? "MATCHED" : "VARIANCE";
    item.countedAt = new Date();
    item.countedBy = req.user._id;

    await cycleCount.save();

    res.json({ success: true, message: "Đã cập nhật", item });
  } catch (error) {
    console.error("Error updating cycle count item:", error);
    res.status(500).json({ success: false, message: "Lỗi khi cập nhật kiểm kê", error: error.message });
  }
};

/**
 * Hoàn thành kiểm kê
 * PUT /api/warehouse/cycle-count/:id/complete
 */
export const completeCycleCount = async (req, res) => {
  try {
    const cycleCount = await CycleCount.findById(req.params.id);
    if (!cycleCount) {
      return res.status(404).json({ success: false, message: "Không tìm thấy phiếu kiểm kê" });
    }

    // Tính summary
    const totalLocations = cycleCount.items.length;
    const matchedLocations = cycleCount.items.filter((item) => item.variance === 0).length;
    const varianceLocations = cycleCount.items.filter(
      (item) => item.variance !== 0 && item.countedQuantity !== null
    ).length;
    const totalVariance = cycleCount.items.reduce(
      (sum, item) => sum + (Number(item.variance) || 0),
      0
    );

    cycleCount.summary = {
      totalLocations,
      matchedLocations,
      varianceLocations,
      totalVariance,
    };
    cycleCount.status = "COMPLETED";
    cycleCount.completedAt = new Date();

    await cycleCount.save();

    res.json({ success: true, message: "Đã hoàn thành kiểm kê", cycleCount });
  } catch (error) {
    console.error("Error completing cycle count:", error);
    res.status(500).json({ success: false, message: "Lỗi khi hoàn thành kiểm kê", error: error.message });
  }
};

/**
 * Duyệt kiểm kê và điều chỉnh tồn kho
 * PUT /api/warehouse/cycle-count/:id/approve
 */
export const approveCycleCount = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const cycleCount = await CycleCount.findById(req.params.id).session(session);
    if (!cycleCount) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Không tìm thấy phiếu kiểm kê" });
    }

    if (cycleCount.status !== "COMPLETED") {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Phiếu chưa hoàn thành" });
    }

    // Điều chỉnh tồn kho cho các mục có chênh lệch
    for (const item of cycleCount.items) {
      if (item.variance && item.variance !== 0) {
        const inventory = await Inventory.findOne({
          storeId: activeStoreId,
          sku: item.sku,
          locationId: item.locationId,
        }).session(session);

        if (inventory) {
          inventory.quantity = item.countedQuantity;
          await inventory.save({ session });

          // Ghi log adjustment
          const movement = new StockMovement({
            storeId: activeStoreId,
            type: "ADJUSTMENT",
            sku: item.sku,
            productId: item.productId,
            productName: item.productName,
            toLocationId: item.locationId,
            toLocationCode: item.locationCode,
            quantity: Math.abs(item.variance),
            referenceType: "CYCLE_COUNT",
            referenceId: cycleCount.countNumber,
            performedBy: req.user._id,
            performedByName: getActorName(req.user),
            notes: `Điều chỉnh kiểm kê: ${item.variance > 0 ? "+" : ""}${item.variance}`,
          });
          await movement.save({ session });
        }
      }
    }

    cycleCount.status = "APPROVED";
    cycleCount.approvedBy = req.user._id;
    cycleCount.approvedByName = getActorName(req.user);
    cycleCount.approvedAt = new Date();
    await cycleCount.save({ session });

    await session.commitTransaction();

    res.json({ success: true, message: "Đã duyệt và điều chỉnh tồn kho", cycleCount });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error approving cycle count:", error);
    res.status(500).json({ success: false, message: "Lỗi khi duyệt kiểm kê", error: error.message });
  } finally {
    session.endSession();
  }
};

export default {
  getPickList,
  pickItem,
  transferStock,
  createCycleCount,
  getCycleCounts,
  updateCycleCountItem,
  completeCycleCount,
  approveCycleCount,
};


>>>>>>> origin/Tien
