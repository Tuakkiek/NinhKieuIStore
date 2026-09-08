import Store from "../modules/store/Store.js";
import StoreInventory from "../modules/inventory/StoreInventory.js";
import { trackOmnichannelEvent } from "../modules/monitoring/omnichannelMonitoringService.js";
import { readStaticBranchRoutingData, selectBranch } from "./selectBranch.js";
import { omniLog } from "../utils/logger.js";

const SKIP_BRANCH_ISOLATION = { skipBranchIsolation: true };
const { branches: staticBranches } = readStaticBranchRoutingData();

const getItemIdentity = (item = {}) => ({
  productId: item.productId,
  variantSku: item.variantSku,
  quantity: Number(item.quantity) || 0,
  name: item.name || item.productName,
});

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .replace(/[^a-zA-Z0-9.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();

const buildStoreInventoryQuery = (filter, session = null) => {
  const query = StoreInventory.findOne(filter).setOptions(SKIP_BRANCH_ISOLATION);
  if (session) {
    query.session(session);
  }
  return query;
};

const matchStaticBranch = (store = {}) => {
  const storeTokens = new Set(
    [
      store?.code,
      store?.name,
      store?.address?.province,
      store?.address?.district,
    ]
      .filter(Boolean)
      .map((value) => normalizeText(value)),
  );

  return (
    staticBranches.find((branch) => {
      const branchTokens = [
        branch.name,
        branch.code,
        branch.province,
        ...(Array.isArray(branch.aliases) ? branch.aliases : []),
      ]
        .filter(Boolean)
        .map((value) => normalizeText(value));

      return branchTokens.some((token) => storeTokens.has(token));
    }) || null
  );
};

const resolveStoreCoordinates = (store = {}) => {
  const lat = Number(store?.address?.coordinates?.lat);
  const lng = Number(store?.address?.coordinates?.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, matchedBranch: matchStaticBranch(store) };
  }

  const matchedBranch = matchStaticBranch(store);
  if (!matchedBranch) {
    return null;
  }

  return {
    lat: matchedBranch.lat,
    lng: matchedBranch.lng,
    matchedBranch,
  };
};

const mapStoreToRoutingBranch = (store = {}) => {
  const coordinates = resolveStoreCoordinates(store);
  if (!coordinates) {
    return null;
  }

  return {
    id: String(store._id),
    code: store.code,
    name: store.name,
    province: store.address?.province || coordinates.matchedBranch?.province || "",
    lat: coordinates.lat,
    lng: coordinates.lng,
    region: coordinates.matchedBranch?.region,
    isDefault: Boolean(store.isHeadquarters || coordinates.matchedBranch?.isDefault),
  };
};

const buildRoutingInventorySnapshot = async (storeIds, orderItems, session = null) => {
  const normalizedItems = Array.isArray(orderItems)
    ? orderItems
        .map((item) => ({
          productId: item?.productId,
          variantSku: item?.variantSku,
        }))
        .filter((item) => item.productId || item.variantSku)
    : [];

  if (!Array.isArray(storeIds) || storeIds.length === 0 || normalizedItems.length === 0) {
    return [];
  }

  const itemFilters = normalizedItems.map((item) => {
    const filter = {};
    if (item.productId) {
      filter.productId = item.productId;
    }
    if (item.variantSku) {
      filter.variantSku = item.variantSku;
    }
    return filter;
  });

  const query = StoreInventory.find(
    {
      storeId: { $in: storeIds },
      $or: itemFilters,
    },
    null,
    SKIP_BRANCH_ISOLATION,
  ).lean();

  if (session) {
    query.session(session);
  }

  const inventoryRows = await query;

  return inventoryRows.map((row) => ({
    branchId: String(row.storeId),
    productId: row.productId ? String(row.productId) : "",
    variantSku: row.variantSku || "",
    quantity: Number(row.available) || 0,
  }));
};

const hasAllItemsInStore = async (storeId, orderItems, session = null) => {
  for (const rawItem of orderItems) {
    const item = getItemIdentity(rawItem);

    if (!item.productId || !item.variantSku || item.quantity <= 0) {
      return false;
    }

    const inventory = await buildStoreInventoryQuery({
      productId: item.productId,
      variantSku: item.variantSku,
      storeId,
    }, session);

    if (!inventory || Number(inventory.available) < item.quantity) {
      return false;
    }
  }

  return true;
};

const scoreStoreByAdministrativeMatch = (store, customerAddress = {}) => {
  let score = 0;

  if (customerAddress?.province && store.address?.province === customerAddress.province) {
    score += 50;
  }

  if (customerAddress?.district && store.address?.district === customerAddress.district) {
    score += 30;
  }

  const maxOrdersPerDay = Number(store.capacity?.maxOrdersPerDay) || 1;
  const currentOrders = Number(store.capacity?.currentOrders) || 0;
  const usage = currentOrders / maxOrdersPerDay;

  if (usage < 0.5) {
    score += 20;
  } else if (usage < 0.8) {
    score += 10;
  }

  return score;
};

const findBestStoreLegacy = async (activeStores, orderItems, customerAddress = {}, session = null) => {
  const storesWithStock = [];

  for (const store of activeStores) {
    const hasStock = await hasAllItemsInStore(store._id, orderItems, session);
    if (hasStock) {
      storesWithStock.push(store);
    }
  }

  if (storesWithStock.length === 0) {
    return {
      success: false,
      message: "Sản phẩm tạm hết hàng, vui lòng liên hệ hotline",
      suggestPreOrder: true,
    };
  }

  const scoredStores = storesWithStock
    .map((store) => ({
      store,
      score: scoreStoreByAdministrativeMatch(store, customerAddress),
    }))
    .sort((left, right) => right.score - left.score);

  return {
    success: true,
    store: scoredStores[0].store,
    alternativeStores: scoredStores.slice(1, 3).map((entry) => entry.store),
    canReserve: true,
    routingDecision: {
      selectionType: "LEGACY_ADMINISTRATIVE_MATCH",
      reason: "legacy-province-district-scoring",
    },
  };
};

export const findBestStore = async (orderItems, customerAddress = {}, options = {}) => {
  const { session = null } = options;

  try {
    const storeQuery = Store.find({
      status: "ACTIVE",
      "services.homeDelivery": true,
    }).lean();

    if (session) {
      storeQuery.session(session);
    }

    const activeStores = await storeQuery;

    if (activeStores.length === 0) {
      omniLog.warn("findBestStore: no active stores found");
      return {
        success: false,
        message: "Không có cửa hàng khả dụng",
      };
    }

    const routingBranches = activeStores
      .map((store) => ({
        store,
        branch: mapStoreToRoutingBranch(store),
      }))
      .filter((entry) => entry.branch);

    if (!customerAddress?.province || routingBranches.length === 0) {
      return findBestStoreLegacy(activeStores, orderItems, customerAddress, session);
    }

    const storeIds = routingBranches.map((entry) => entry.store._id);
    const inventorySnapshot = await buildRoutingInventorySnapshot(storeIds, orderItems, session);
    let routingResult;
    try {
      routingResult = selectBranch(customerAddress.province, orderItems, {
        branches: routingBranches.map((entry) => entry.branch),
        inventory: inventorySnapshot,
        defaultBranchId:
          routingBranches.find((entry) => entry.branch.isDefault)?.branch.id ||
          routingBranches[0]?.branch.id,
      });
    } catch (routingError) {
      if (String(routingError?.message || "").includes("Unsupported province")) {
        omniLog.warn("findBestStore: unsupported province for Haversine routing, fallback to legacy", {
          province: customerAddress?.province,
          error: routingError.message,
        });
        return findBestStoreLegacy(activeStores, orderItems, {}, session);
      }
      throw routingError;
    }

    const storeById = new Map(routingBranches.map((entry) => [entry.branch.id, entry.store]));
    const selectedStore = storeById.get(routingResult.selectedBranch.branch.id);

    if (!selectedStore) {
      return findBestStoreLegacy(activeStores, orderItems, customerAddress, session);
    }

    const alternativeStores = routingResult.alternatives
      .map((candidate) => storeById.get(candidate.branch.id))
      .filter(Boolean);

    omniLog.debug("findBestStore: selected", {
      storeId: selectedStore?._id,
      storeCode: selectedStore?.code,
      selectionType: routingResult.selectionType,
      distanceKm: routingResult.selectedBranch.distanceKm,
      canFulfill: routingResult.canFulfill,
    });

    return {
      success: true,
      store: selectedStore,
      alternativeStores,
      canReserve: routingResult.canFulfill,
      routingDecision: routingResult,
    };
  } catch (error) {
    omniLog.error("findBestStore failed", { error: error.message });
    throw error;
  }
};

export const findNearestStoreWithStock = async (
  orderItems,
  customerProvince,
  customerDistrict
) => {
  try {
    const stores = await Store.find({
      status: "ACTIVE",
      "services.clickAndCollect": true,
      ...(customerProvince ? { "address.province": customerProvince } : {}),
    }).lean();

    const availableStores = [];

    for (const store of stores) {
      const hasStock = await hasAllItemsInStore(store._id, orderItems);
      if (!hasStock) {
        continue;
      }

      const priority =
        customerDistrict && store.address?.district === customerDistrict ? 2 : 1;

      availableStores.push({ store, priority });
    }

    availableStores.sort((a, b) => b.priority - a.priority);

    return availableStores.map((entry) => entry.store);
  } catch (error) {
    omniLog.error("findNearestStoreWithStock failed", {
      province: customerProvince,
      district: customerDistrict,
      error: error.message,
    });
    throw error;
  }
};

export const reserveInventory = async (storeId, orderItems, options = {}) => {
  const { session = null } = options;
  const itemCount = Array.isArray(orderItems) ? orderItems.length : 0;

  try {
    for (const rawItem of orderItems) {
      const item = getItemIdentity(rawItem);

      if (!item.productId || !item.variantSku || item.quantity <= 0) {
        throw new Error("Thông tin sản phẩm reserve không hợp lệ");
      }

      const inventory = await buildStoreInventoryQuery({
        productId: item.productId,
        variantSku: item.variantSku,
        storeId,
      }, session);

      if (!inventory || Number(inventory.available) < item.quantity) {
        throw new Error(`Không đủ hàng: ${item.name || item.variantSku}`);
      }

      inventory.reserved += item.quantity;
      await inventory.save({ session });

      omniLog.debug("reserveInventory: item reserved", {
        storeId,
        productId: item.productId,
        variantSku: item.variantSku,
        quantity: item.quantity,
        availableAfter: inventory.available,
      });
    }

    await trackOmnichannelEvent({
      eventType: "RESERVE_INVENTORY_SUCCESS",
      operation: "reserve_inventory",
      level: "DEBUG",
      success: true,
      storeId,
      itemCount,
    });

    return true;
  } catch (error) {
    await trackOmnichannelEvent({
      eventType: "RESERVE_INVENTORY_FAILED",
      operation: "reserve_inventory",
      level: "ERROR",
      success: false,
      storeId,
      itemCount,
      errorMessage: error.message,
    });

    omniLog.error("reserveInventory failed", {
      storeId,
      error: error.message,
    });
    throw error;
  }
};

export const releaseInventory = async (storeId, orderItems, options = {}) => {
  const { session = null } = options;
  const itemCount = Array.isArray(orderItems) ? orderItems.length : 0;

  try {
    for (const rawItem of orderItems) {
      const item = getItemIdentity(rawItem);
      if (!item.productId || !item.variantSku || item.quantity <= 0) {
        continue;
      }

      const inventory = await buildStoreInventoryQuery({
        productId: item.productId,
        variantSku: item.variantSku,
        storeId,
      }, session);

      if (!inventory) {
        continue;
      }

      inventory.reserved = Math.max(0, Number(inventory.reserved) - item.quantity);
      await inventory.save({ session });

      omniLog.debug("releaseInventory: item released", {
        storeId,
        productId: item.productId,
        variantSku: item.variantSku,
        quantity: item.quantity,
        availableAfter: inventory.available,
      });
    }

    await trackOmnichannelEvent({
      eventType: "RELEASE_INVENTORY_SUCCESS",
      operation: "release_inventory",
      level: "DEBUG",
      success: true,
      storeId,
      itemCount,
    });

    return true;
  } catch (error) {
    await trackOmnichannelEvent({
      eventType: "RELEASE_INVENTORY_FAILED",
      operation: "release_inventory",
      level: "ERROR",
      success: false,
      storeId,
      itemCount,
      errorMessage: error.message,
    });

    omniLog.error("releaseInventory failed", {
      storeId,
      error: error.message,
    });
    throw error;
  }
};

export const deductInventory = async (storeId, orderItems, options = {}) => {
  const { session = null } = options;
  const itemCount = Array.isArray(orderItems) ? orderItems.length : 0;

  try {
    for (const rawItem of orderItems) {
      const item = getItemIdentity(rawItem);
      if (!item.productId || !item.variantSku || item.quantity <= 0) {
        continue;
      }

      const inventory = await buildStoreInventoryQuery({
        productId: item.productId,
        variantSku: item.variantSku,
        storeId,
      }, session);

      if (!inventory) {
        continue;
      }

      inventory.quantity = Math.max(0, Number(inventory.quantity) - item.quantity);
      inventory.reserved = Math.max(0, Number(inventory.reserved) - item.quantity);
      await inventory.save({ session });

      omniLog.debug("deductInventory: item deducted", {
        storeId,
        productId: item.productId,
        variantSku: item.variantSku,
        quantity: item.quantity,
        quantityAfter: inventory.quantity,
        reservedAfter: inventory.reserved,
      });
    }

    await trackOmnichannelEvent({
      eventType: "DEDUCT_INVENTORY_SUCCESS",
      operation: "deduct_inventory",
      level: "DEBUG",
      success: true,
      storeId,
      itemCount,
    });

    return true;
  } catch (error) {
    await trackOmnichannelEvent({
      eventType: "DEDUCT_INVENTORY_FAILED",
      operation: "deduct_inventory",
      level: "ERROR",
      success: false,
      storeId,
      itemCount,
      errorMessage: error.message,
    });

    omniLog.error("deductInventory failed", {
      storeId,
      error: error.message,
    });
    throw error;
  }
};

export const restoreInventory = async (storeId, orderItems, options = {}) => {
  const { session = null } = options;
  const itemCount = Array.isArray(orderItems) ? orderItems.length : 0;

  try {
    for (const rawItem of orderItems) {
      const item = getItemIdentity(rawItem);
      if (!item.productId || !item.variantSku || item.quantity <= 0) {
        continue;
      }

      let inventory = await buildStoreInventoryQuery({
        productId: item.productId,
        variantSku: item.variantSku,
        storeId,
      }, session);

      if (!inventory) {
        inventory = new StoreInventory({
          productId: item.productId,
          variantSku: item.variantSku,
          storeId,
          quantity: 0,
          reserved: 0,
        });
      }

      inventory.quantity = (Number(inventory.quantity) || 0) + item.quantity;
      await inventory.save({ session });

      omniLog.debug("restoreInventory: item restored", {
        storeId,
        productId: item.productId,
        variantSku: item.variantSku,
        quantity: item.quantity,
        quantityAfter: inventory.quantity,
        availableAfter: inventory.available,
      });
    }

    await trackOmnichannelEvent({
      eventType: "RESTORE_INVENTORY_SUCCESS",
      operation: "restore_inventory",
      level: "DEBUG",
      success: true,
      storeId,
      itemCount,
    });

    return true;
  } catch (error) {
    await trackOmnichannelEvent({
      eventType: "RESTORE_INVENTORY_FAILED",
      operation: "restore_inventory",
      level: "ERROR",
      success: false,
      storeId,
      itemCount,
      errorMessage: error.message,
    });

    omniLog.error("restoreInventory failed", {
      storeId,
      error: error.message,
    });
    throw error;
  }
};

export default {
  findBestStore,
  findNearestStoreWithStock,
  reserveInventory,
  releaseInventory,
  deductInventory,
  restoreInventory,
};
