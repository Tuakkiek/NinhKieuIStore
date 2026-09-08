import mongoose from "mongoose";
import GoodsReceipt from "./GoodsReceipt.js";
import PurchaseOrder from "./PurchaseOrder.js";
import Inventory from "./Inventory.js";
import WarehouseLocation from "./WarehouseLocation.js";
import StockMovement from "./StockMovement.js";
import { UniversalVariant } from "../product/UniversalProduct.js";
import StoreInventory from "../inventory/StoreInventory.js";
import Store from "../store/Store.js";
import {
  ensureWarehouseWriteBranchId,
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
  resolveVariantPricingSnapshot,
  updateCurrentPricingForSku,
} from "../product/productPricingService.js";

const RECEIVABLE_PO_STATUSES = new Set(["CONFIRMED", "PARTIAL"]);
const DEFAULT_STORE_MIN_STOCK = 5;

const getActorName = (user) =>
  user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim() || "Unknown";

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const toNonNegativeInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const toNonNegativeMoney = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const normalizeQualityStatus = (value) => {
  const allowed = new Set(["GOOD", "DAMAGED", "EXPIRED"]);
  return allowed.has(value) ? value : "GOOD";
};

const calculateSellableQuantity = ({
  receivedQuantity,
  damagedQuantity,
  qualityStatus,
}) => {
  if (qualityStatus !== "GOOD") return 0;
  return Math.max(0, receivedQuantity - damagedQuantity);
};

const buildStoreAllocationPlan = async ({
  productId,
  variantSku,
  receivedQuantity,
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
    .session(session);

  const inventoryByStore = new Map(
    currentInventories.map((item) => [String(item.storeId), item])
  );

  let remaining = receivedQuantity;
  const rawAllocations = [];

  for (const store of stores) {
    if (remaining <= 0) break;

    const inventory = inventoryByStore.get(String(store._id));
    const currentQuantity = Number(inventory?.quantity) || 0;
    const minStock = Number(inventory?.minStock ?? DEFAULT_STORE_MIN_STOCK);
    const minTarget =
      Number.isFinite(minStock) && minStock > 0
        ? Math.floor(minStock)
        : DEFAULT_STORE_MIN_STOCK;
    const deficit = Math.max(0, minTarget - currentQuantity);

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

  return Array.from(mergedAllocations.values()).filter(
    (allocation) => allocation.quantity > 0
  );
};

const syncStoreInventory = async ({
  productId,
  variantSku,
  receivedQuantity,
  pricingSnapshot = null,
  session,
}) => {
  if (!productId || !variantSku || receivedQuantity <= 0) return [];

  const allocationPlan = await buildStoreAllocationPlan({
    productId,
    variantSku,
    receivedQuantity,
    session,
  });

  const distribution = [];

  for (const allocation of allocationPlan) {
    let storeInventory = await StoreInventory.findOne({
      productId,
      variantSku,
      storeId: allocation.storeId,
    }).session(session);

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

const generateGrnNumber = async ({ session, storeCode }) => {
  const year = new Date().getFullYear();
  const normalizedStoreCode = String(storeCode || "BRANCH").trim().toUpperCase();
  const prefix = `GRN-${normalizedStoreCode}-${year}-`;
  const countInYear = await GoodsReceipt.countDocuments({
    grnNumber: { $regex: `^${prefix}` },
  }).session(session);

  let sequence = countInYear + 1;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${prefix}${String(sequence).padStart(4, "0")}`;
    const existing = await GoodsReceipt.findOne({ grnNumber: candidate })
      .select("_id")
      .session(session);
    if (!existing) return candidate;
    sequence += 1;
  }

  return `${prefix}${Date.now()}`;
};

const resolveReceiptSnapshot = async ({
  poItem,
  storeId,
  poNumber,
  session,
}) => {
  const [inventorySnapshot, latestMovement, variant] = await Promise.all([
    Inventory.findOne({
      storeId,
      sku: poItem.sku,
    })
      .sort({ updatedAt: -1 })
      .session(session),
    StockMovement.findOne({
      storeId,
      sku: poItem.sku,
      referenceType: "PO",
      referenceId: poNumber,
    })
      .sort({ createdAt: -1 })
      .session(session),
    UniversalVariant.findOne({
      sku: poItem.sku,
      productId: poItem.productId,
    }).session(session),
  ]);

  const variantSnapshot = variant
    ? resolveVariantPricingSnapshot(variant)
    : {
        basePrice: 0,
        originalPrice: 0,
        sellingPrice: 0,
        costPrice: 0,
        price: 0,
      };

  const movementSnapshot = latestMovement
    ? {
        basePrice: Number(latestMovement.basePrice) || variantSnapshot.basePrice,
        originalPrice:
          Number(latestMovement.originalPrice) || variantSnapshot.originalPrice,
        sellingPrice:
          Number(latestMovement.sellingPrice) || variantSnapshot.sellingPrice,
        costPrice: Number(latestMovement.costPrice) || variantSnapshot.costPrice,
        price: Number(latestMovement.price) || variantSnapshot.price,
      }
    : variantSnapshot;

  return {
    inventorySnapshot,
    latestMovement,
    snapshot: movementSnapshot,
  };
};

export const startGoodsReceipt = async (req, res) => {
  try {
    const { poId, poNumber } = req.body;

    let po = null;
    if (poId) {
      po = await PurchaseOrder.findById(poId);
    } else if (poNumber) {
      po = await PurchaseOrder.findOne({ poNumber: String(poNumber).trim() });
    }

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt hàng",
      });
    }

    if (!RECEIVABLE_PO_STATUSES.has(po.status)) {
      return res.status(400).json({
        success: false,
        message: "Đơn hàng chưa sẵn sàng để nhận hàng",
      });
    }

    const items = await Promise.all(
      po.items.map(async (item) => {
        const remainingQuantity = Math.max(
          0,
          (Number(item.orderedQuantity) || 0) - (Number(item.receivedQuantity) || 0)
        );
        const afterSalesContext = await resolveAfterSalesConfigByProductId({
          productId: item.productId,
        });
        const variant = await UniversalVariant.findOne({
          sku: item.sku,
          productId: item.productId,
        }).lean();
        const snapshot = resolveVariantPricingSnapshot(variant || {});

        return {
          sku: item.sku,
          productId: item.productId,
          productName: item.productName,
          orderedQuantity: item.orderedQuantity,
          receivedQuantity: item.receivedQuantity,
          damagedQuantity: item.damagedQuantity || 0,
          remainingQuantity,
          unitPrice: Number(item.unitPrice) || 0,
          costPrice: Number(item.unitPrice) || 0,
          basePrice: snapshot.basePrice,
          sellingPrice: snapshot.sellingPrice,
          serializedTrackingEnabled: Boolean(
            afterSalesContext && isSerializedConfig(afterSalesContext.config)
          ),
        };
      })
    );

    res.json({
      success: true,
      purchaseOrder: {
        _id: po._id,
        poNumber: po.poNumber,
        supplier: po.supplier,
        status: po.status,
        items,
        expectedDeliveryDate: po.expectedDeliveryDate,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi bắt đầu nhận hàng",
      error: error.message,
    });
  }
};

export const receiveItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    await resolveWarehouseStore(req, { branchId: activeStoreId, session });

    const {
      poId,
      sku,
      receivedQuantity,
      damagedQuantity = 0,
      locationCode,
      qualityStatus = "GOOD",
      sellingPrice,
      notes,
      serializedUnits = [],
    } = req.body;

    const actorName = getActorName(req.user);
    const receiveQty = toPositiveInteger(receivedQuantity);
    const damagedQty = toNonNegativeInteger(damagedQuantity);
    const normalizedSku = String(sku || "").trim();
    const normalizedLocationCode = String(locationCode || "").trim();
    const normalizedQualityStatus = normalizeQualityStatus(qualityStatus);
    const inboundSellingPrice = toNonNegativeMoney(sellingPrice);

    if (!poId || !normalizedSku || !normalizedLocationCode || !receiveQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Dữ liệu nhận hàng không hợp lệ",
      });
    }

    if (damagedQty === null || damagedQty > receiveQty) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Số lượng hư hỏng không hợp lệ",
      });
    }

    const po = await PurchaseOrder.findById(poId).session(session);
    if (!po) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt hàng",
      });
    }

    if (!RECEIVABLE_PO_STATUSES.has(po.status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Đơn hàng không ở trạng thái có thể nhận",
      });
    }

    const poItem = po.items.find((item) => item.sku === normalizedSku);
    if (!poItem) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy SKU trong đơn hàng",
      });
    }

    const remainingQuantity = Math.max(
      0,
      (Number(poItem.orderedQuantity) || 0) -
        (Number(poItem.receivedQuantity) || 0)
    );
    if (remainingQuantity <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "SKU này đã nhận đủ theo đơn hàng",
      });
    }

    if (receiveQty > remainingQuantity) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `So luong nhan vuot qua con lai (${remainingQuantity})`,
      });
    }

    const sellableQuantity = calculateSellableQuantity({
      receivedQuantity: receiveQty,
      damagedQuantity: damagedQty,
      qualityStatus: normalizedQualityStatus,
    });
    const costPrice = Number(poItem.unitPrice) || 0;

    if (sellableQuantity > 0 && (inboundSellingPrice === null || inboundSellingPrice <= 0)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Selling price is required for sellable quantity",
      });
    }

    const afterSalesContext = await resolveAfterSalesConfigByProductId({
      productId: poItem.productId,
      session,
    });
    const serializedTrackingEnabled = Boolean(
      afterSalesContext && isSerializedConfig(afterSalesContext.config)
    );

    if (serializedTrackingEnabled && sellableQuantity > 0) {
      if (!Array.isArray(serializedUnits) || serializedUnits.length !== sellableQuantity) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `SKU ${normalizedSku} requires ${sellableQuantity} serialized unit(s) for the sellable quantity`,
        });
      }
    }

    const variant = await UniversalVariant.findOne({
      sku: normalizedSku,
      productId: poItem.productId,
    }).session(session);
    if (!variant) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy biến thể SKU: ${normalizedSku}`,
      });
    }

    const inventoryQuantityDelta =
      normalizedQualityStatus === "GOOD" ? sellableQuantity : receiveQty;

    const location = await WarehouseLocation.findOne({
      storeId: activeStoreId,
      locationCode: normalizedLocationCode,
      status: "ACTIVE",
    }).session(session);
    if (!location) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy vị trí kho",
      });
    }

    const currentLoad = Number(location.currentLoad) || 0;
    const capacity = Number(location.capacity) || 0;
    if (currentLoad + inventoryQuantityDelta > capacity) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Vị trí kho không đủ chỗ",
      });
    }

    const { variant: pricedVariant, snapshot } = await updateCurrentPricingForSku({
      productId: poItem.productId,
      variantSku: normalizedSku,
      variantId: variant._id,
      costPrice,
      sellingPrice: sellableQuantity > 0 ? inboundSellingPrice : undefined,
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
        productId: poItem.productId,
        productName: poItem.productName,
        locationId: location._id,
        locationCode: location.locationCode,
        quantity: 0,
        status: normalizedQualityStatus,
        notes: String(notes || "").trim(),
      });
    }

    inventory.quantity = (Number(inventory.quantity) || 0) + inventoryQuantityDelta;
    inventory.lastReceived = new Date();
    inventory.status = normalizedQualityStatus;
    inventory.notes = String(notes || "").trim();
    applyPricingSnapshotToDocument(inventory, snapshot);
    await inventory.save({ session });

    location.currentLoad = currentLoad + inventoryQuantityDelta;
    await location.save({ session });

    const movementSnapshot =
      sellableQuantity > 0
        ? snapshot
        : {
            ...snapshot,
            price: 0,
            sellingPrice: 0,
          };

    await StockMovement.create(
      [
        {
          storeId: activeStoreId,
          type: "INBOUND",
          sku: normalizedSku,
          productId: poItem.productId,
          productName: poItem.productName,
          toLocationId: location._id,
          toLocationCode: location.locationCode,
          quantity: receiveQty,
          referenceType: "PO",
          referenceId: po.poNumber,
          performedBy: req.user._id,
          performedByName: actorName,
          qualityStatus: normalizedQualityStatus,
          notes: String(notes || "").trim(),
          ...movementSnapshot,
        },
      ],
      { session }
    );

    poItem.receivedQuantity = (Number(poItem.receivedQuantity) || 0) + receiveQty;
    poItem.damagedQuantity = (Number(poItem.damagedQuantity) || 0) + damagedQty;
    const hasAnyReceived = po.items.some(
      (item) => (Number(item.receivedQuantity) || 0) > 0
    );
    if (po.status === "CONFIRMED" && hasAnyReceived) {
      po.status = "PARTIAL";
    }
    await po.save({ session });

    let variantStockAfter = null;
    let distributedToStores = [];
    let registeredDevices = 0;
    let productStatusAfter = null;

    if (sellableQuantity > 0) {
      pricedVariant.stock = (Number(pricedVariant.stock) || 0) + sellableQuantity;
      await pricedVariant.save({ session });
      variantStockAfter = pricedVariant.stock;

      distributedToStores = await syncStoreInventory({
        productId: pricedVariant.productId,
        variantSku: normalizedSku,
        receivedQuantity: sellableQuantity,
        pricingSnapshot: snapshot,
        session,
      });

      if (serializedTrackingEnabled) {
        const createdDevices = await registerSerializedUnits({
          storeId: activeStoreId,
          warehouseLocationId: location._id,
          warehouseLocationCode: location.locationCode,
          productId: pricedVariant.productId,
          variantId: pricedVariant._id,
          variantSku: normalizedSku,
          productName: poItem.productName,
          variantName: pricedVariant.variantName || "",
          basePrice: snapshot.basePrice,
          originalPrice: snapshot.originalPrice,
          sellingPrice: snapshot.sellingPrice,
          costPrice: snapshot.costPrice,
          serializedUnits,
          notes,
          actor: req.user,
          session,
        });
        registeredDevices = createdDevices.length;
      }

      const recalculatedProduct = await recalculateProductAvailability({
        productId: poItem.productId,
        session,
      });
      productStatusAfter = recalculatedProduct?.status || null;
    }

    await session.commitTransaction();

    res.json({
      success: true,
      message: "Đã nhận hàng thành công",
      inventory,
      location: {
        locationCode: location.locationCode,
        currentLoad: location.currentLoad,
        capacity: location.capacity,
        fillRate: location.fillRate,
      },
      sync: {
        inventoryQuantityDelta,
        sellableQuantity,
        pricingSnapshot: snapshot,
        variantStockAfter,
        distributedToStores,
        serializedTrackingEnabled,
        registeredDevices,
        productStatusAfter,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: "Lỗi khi nhận hàng",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export const completeGoodsReceipt = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const activeStoreId = ensureWarehouseWriteBranchId(req);
    const activeStore = await resolveWarehouseStore(req, {
      branchId: activeStoreId,
      session,
    });

    const { poId, deliverySignature, notes } = req.body;
    if (!poId) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Thiếu poId",
      });
    }

    const po = await PurchaseOrder.findById(poId).session(session);
    if (!po) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt hàng",
      });
    }

    if (po.status === "COMPLETED") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Đơn đặt hàng đã hoàn tất trước đó",
      });
    }

    if (!RECEIVABLE_PO_STATUSES.has(po.status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Đơn hàng không ở trạng thái có thể hoàn tất nhận",
      });
    }

    const receivedPoItems = po.items.filter(
      (item) => (Number(item.receivedQuantity) || 0) > 0
    );
    if (receivedPoItems.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Đơn hàng chưa có SKU nào được nhận",
      });
    }

    const grnNumber = await generateGrnNumber({
      session,
      storeCode: activeStore.code,
    });

    const receivedItems = [];
    let totalQuantity = 0;
    let totalDamaged = 0;

    for (const poItem of receivedPoItems) {
      const { inventorySnapshot, latestMovement, snapshot } = await resolveReceiptSnapshot(
        {
          poItem,
          storeId: activeStoreId,
          poNumber: po.poNumber,
          session,
        }
      );

      const receivedQty = Number(poItem.receivedQuantity) || 0;
      const damagedQty = Number(poItem.damagedQuantity) || 0;
      const sellableQuantity = Math.max(0, receivedQty - damagedQty);
      const unitPrice = Number(poItem.unitPrice) || 0;

      receivedItems.push({
        sku: poItem.sku,
        productId: poItem.productId,
        productName: poItem.productName,
        orderedQuantity: poItem.orderedQuantity,
        receivedQuantity: receivedQty,
        damagedQuantity: damagedQty,
        locationId:
          inventorySnapshot?.locationId || latestMovement?.toLocationId || null,
        locationCode:
          inventorySnapshot?.locationCode || latestMovement?.toLocationCode || "",
        qualityStatus:
          inventorySnapshot?.status || latestMovement?.qualityStatus || "GOOD",
        unitPrice,
        costPrice: unitPrice,
        basePrice: Number(snapshot.basePrice) || 0,
        originalPrice: Number(snapshot.originalPrice) || Number(snapshot.basePrice) || 0,
        sellingPrice: sellableQuantity > 0 ? Number(snapshot.sellingPrice) || 0 : 0,
        totalPrice: receivedQty * unitPrice,
      });

      totalQuantity += receivedQty;
      totalDamaged += damagedQty;
    }

    const grn = new GoodsReceipt({
      storeId: activeStoreId,
      grnNumber,
      purchaseOrderId: po._id,
      poNumber: po.poNumber,
      supplier: po.supplier,
      items: receivedItems,
      totalQuantity,
      totalDamaged,
      receivedBy: req.user._id,
      receivedByName: getActorName(req.user),
      receivedDate: new Date(),
      deliverySignature,
      notes,
    });

    await grn.save({ session });

    const allReceived = po.items.every(
      (item) =>
        (Number(item.receivedQuantity) || 0) >=
        (Number(item.orderedQuantity) || 0)
    );

    po.status = allReceived ? "COMPLETED" : "PARTIAL";
    po.actualDeliveryDate = new Date();
    await po.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: "Đã hoàn tất nhận hàng",
      goodsReceipt: grn,
      purchaseOrder: po,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: "Lỗi khi hoàn tất nhận hàng",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export const getGoodsReceipts = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);

    const filter = {};
    if (search) {
      filter.$or = [
        { grnNumber: { $regex: search, $options: "i" } },
        { poNumber: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (pageNum - 1) * limitNum;

    const [goodsReceipts, total] = await Promise.all([
      GoodsReceipt.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      GoodsReceipt.countDocuments(filter),
    ]);

    res.json({
      success: true,
      goodsReceipts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách phiếu nhập kho",
      error: error.message,
    });
  }
};

export default {
  startGoodsReceipt,
  receiveItem,
  completeGoodsReceipt,
  getGoodsReceipts,
};
