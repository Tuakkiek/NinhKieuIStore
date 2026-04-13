import Device from "./Device.js";
import DeviceLifecycleHistory from "./DeviceLifecycleHistory.js";
import {
  INVENTORY_STATES,
  SERVICE_STATES,
  ensureIdentifierPolicySatisfied,
  getNormalizedLookupKeys,
  isSerializedConfig,
  normalizeImei,
  normalizeSerialNumber,
  resolveAfterSalesConfigByProductId,
  validateIdentifierFormat,
} from "./afterSalesConfig.js";

export const buildError = (message, status = 400, code = "DEVICE_VALIDATION_ERROR") => {
  const error = new Error(message);
  error.httpStatus = status;
  error.code = code;
  return error;
};

export const getActorName = (user = {}) =>
  user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim() || "System";

export const ensureSparseUniqueness = async ({
  imeiNormalized,
  serialNumberNormalized,
  session,
} = {}) => {
  const orConditions = [];
  if (imeiNormalized) orConditions.push({ imeiNormalized });
  if (serialNumberNormalized) orConditions.push({ serialNumberNormalized });
  if (!orConditions.length) return;

  const existing = await Device.findOne({ $or: orConditions })
    .setOptions({ skipBranchIsolation: true })
    .session(session);

  if (!existing) return;

  if (imeiNormalized && existing.imeiNormalized === imeiNormalized) {
    throw buildError(`IMEI ${imeiNormalized} already exists`, 409, "DEVICE_IMEI_DUPLICATE");
  }
  if (serialNumberNormalized && existing.serialNumberNormalized === serialNumberNormalized) {
    throw buildError(
      `Serial number ${serialNumberNormalized} already exists`,
      409,
      "DEVICE_SERIAL_DUPLICATE"
    );
  }
};

export const createLifecycleEvent = async ({
  deviceId,
  storeId,
  eventType,
  fromInventoryState,
  toInventoryState,
  fromServiceState,
  toServiceState,
  orderId,
  orderItemId,
  referenceType = "",
  referenceId = "",
  actorId = null,
  actorName = "System",
  note = "",
  metadata = {},
  session = null,
} = {}) => {
  if (!deviceId || !storeId || !eventType) return null;

  const [entry] = await DeviceLifecycleHistory.create(
    [
      {
        deviceId,
        storeId,
        eventType,
        fromInventoryState,
        toInventoryState,
        fromServiceState,
        toServiceState,
        orderId,
        orderItemId,
        referenceType,
        referenceId,
        actorId,
        actorName,
        note,
        metadata,
      },
    ],
    { session }
  );

  return entry;
};

const normalizeSerializedUnit = (unit = {}) => {
  const imei = String(unit?.imei || "").trim();
  const serialNumber = String(unit?.serialNumber || "").trim();
  const imeiNormalized = normalizeImei(imei);
  const serialNumberNormalized = normalizeSerialNumber(serialNumber);

  return {
    imei,
    serialNumber,
    imeiNormalized,
    serialNumberNormalized,
    lookupKeys: getNormalizedLookupKeys({ imei, serialNumber }),
  };
};

export const normalizeSerializedUnitForPersistence = (unit = {}) => {
  return normalizeSerializedUnit(unit);
};

export const registerSerializedUnits = async ({
  storeId,
  warehouseLocationId = null,
  warehouseLocationCode = "",
  productId,
  variantId = null,
  variantSku,
  productName,
  variantName = "",
  basePrice = 0,
  originalPrice = 0,
  sellingPrice = 0,
  costPrice = 0,
  serializedUnits = [],
  notes = "",
  actor = {},
  session = null,
} = {}) => {
  if (!storeId || !productId || !variantSku) {
    throw buildError("Missing storeId, productId, or variantSku");
  }

  const productConfig = await resolveAfterSalesConfigByProductId({ productId, session });
  if (!productConfig || !isSerializedConfig(productConfig.config)) {
    return [];
  }

  if (!Array.isArray(serializedUnits) || serializedUnits.length === 0) {
    throw buildError("Serialized units are required for this product", 400, "DEVICE_UNITS_REQUIRED");
  }

  const createdDevices = [];
  const seenKeys = new Set();

  for (const unit of serializedUnits) {
    const normalizedUnit = normalizeSerializedUnit(unit);
    const policyError = ensureIdentifierPolicySatisfied(productConfig.config, normalizedUnit);
    if (policyError) {
      throw buildError(policyError, 400, "DEVICE_IDENTIFIER_POLICY");
    }

    const formatError = validateIdentifierFormat(normalizedUnit);
    if (formatError) {
      throw buildError(formatError, 400, "DEVICE_IDENTIFIER_INVALID");
    }

    for (const key of normalizedUnit.lookupKeys) {
      if (seenKeys.has(key)) {
        throw buildError(
          `Duplicate identifier ${key} in the same request`,
          400,
          "DEVICE_IDENTIFIER_DUPLICATE_REQUEST"
        );
      }
      seenKeys.add(key);
    }

    await ensureSparseUniqueness({
      imeiNormalized: normalizedUnit.imeiNormalized,
      serialNumberNormalized: normalizedUnit.serialNumberNormalized,
      session,
    });

    const [device] = await Device.create(
      [
        {
          storeId,
          warehouseLocationId,
          warehouseLocationCode,
          productId,
          variantId,
          variantSku,
          productName,
          variantName,
          basePrice: Number(basePrice) || 0,
          originalPrice: Number(originalPrice) || Number(basePrice) || 0,
          sellingPrice:
            Number(sellingPrice) ||
            Number(originalPrice) ||
            Number(basePrice) ||
            0,
          costPrice: Number(costPrice) || 0,
          priceUpdatedAt: new Date(),
          imei: normalizedUnit.imei,
          imeiNormalized: normalizedUnit.imeiNormalized || undefined,
          serialNumber: normalizedUnit.serialNumber,
          serialNumberNormalized: normalizedUnit.serialNumberNormalized || undefined,
          lookupKeys: normalizedUnit.lookupKeys,
          inventoryState: INVENTORY_STATES.IN_STOCK,
          serviceState: SERVICE_STATES.NONE,
          notes: String(notes || "").trim(),
        },
      ],
      { session }
    );

    await createLifecycleEvent({
      deviceId: device._id,
      storeId,
      eventType: "RECEIVED",
      toInventoryState: INVENTORY_STATES.IN_STOCK,
      toServiceState: SERVICE_STATES.NONE,
      actorId: actor?._id || null,
      actorName: getActorName(actor),
      note: String(notes || "").trim(),
      referenceType: "RECEIPT",
      referenceId: variantSku,
      session,
    });

    createdDevices.push(device);
  }

  return createdDevices;
};

const buildAssignmentSnapshot = (device, actor, mode) => ({
  deviceId: device._id,
  imei: device.imei || "",
  serialNumber: device.serialNumber || "",
  assignedAt: new Date(),
  assignedBy: actor?._id || null,
  mode,
});

export const assignDevicesToOrderItem = async ({
  storeId,
  order,
  orderItem,
  requestedDeviceIds = [],
  requestedQuantity = null,
  actor = {},
  session = null,
  locationId = null,
  mode = "AUTO",
} = {}) => {
  if (!order || !orderItem || !storeId) {
    throw buildError("Missing order, order item, or storeId");
  }

  const productConfig = await resolveAfterSalesConfigByProductId({
    productId: orderItem.productId,
    session,
  });
  if (!productConfig || !isSerializedConfig(productConfig.config)) {
    return [];
  }

  const quantityNeeded = Math.max(0, Number(requestedQuantity ?? orderItem.quantity) || 0);
  if (quantityNeeded <= 0) {
    return Array.isArray(orderItem.deviceAssignments) ? orderItem.deviceAssignments : [];
  }

  const existingAssignments = Array.isArray(orderItem.deviceAssignments)
    ? [...orderItem.deviceAssignments]
    : [];
  const assignmentSlotsLeft = Math.max(0, Number(orderItem.quantity || 0) - existingAssignments.length);
  if (quantityNeeded > assignmentSlotsLeft) {
    throw buildError(
      `Serialized device assignment exceeds remaining quantity for ${orderItem.productName || orderItem.variantSku}`,
      400,
      "DEVICE_ASSIGNMENT_EXCEEDS_QUANTITY"
    );
  }

  const baseFilter = {
    storeId,
    variantSku: orderItem.variantSku,
    inventoryState: INVENTORY_STATES.IN_STOCK,
  };
  if (locationId) baseFilter.warehouseLocationId = locationId;

  let devices = [];
  if (Array.isArray(requestedDeviceIds) && requestedDeviceIds.length > 0) {
    devices = await Device.find({
      ...baseFilter,
      _id: { $in: requestedDeviceIds },
    })
      .sort({ receivedAt: 1, createdAt: 1 })
      .session(session);

    if (devices.length !== requestedDeviceIds.length) {
      throw buildError(
        "One or more selected devices are unavailable in this branch/location",
        400,
        "DEVICE_SELECTION_INVALID"
      );
    }
  } else {
    devices = await Device.find(baseFilter)
      .sort({ receivedAt: 1, createdAt: 1 })
      .limit(quantityNeeded)
      .session(session);
  }

  if (devices.length !== quantityNeeded) {
    throw buildError(
      `Not enough serialized devices available for ${orderItem.productName || orderItem.variantSku}`,
      400,
      "DEVICE_STOCK_SHORTAGE"
    );
  }

  const now = new Date();
  for (const device of devices) {
    const previousInventoryState = device.inventoryState;
    device.inventoryState = INVENTORY_STATES.RESERVED;
    device.reservedFor = {
      orderId: order._id,
      orderItemId: orderItem._id,
      assignedAt: now,
      assignedBy: actor?._id || null,
      mode,
    };
    await device.save({ session });

    await createLifecycleEvent({
      deviceId: device._id,
      storeId,
      orderId: order._id,
      orderItemId: orderItem._id,
      eventType: "ASSIGNED_TO_ORDER",
      fromInventoryState: previousInventoryState,
      toInventoryState: INVENTORY_STATES.RESERVED,
      fromServiceState: device.serviceState,
      toServiceState: device.serviceState,
      actorId: actor?._id || null,
      actorName: getActorName(actor),
      note: `Assigned to order ${order.orderNumber || order._id}`,
      referenceType: "ORDER",
      referenceId: String(order._id),
      metadata: {
        variantSku: orderItem.variantSku,
      },
      session,
    });

    existingAssignments.push(buildAssignmentSnapshot(device, actor, mode));
  }

  orderItem.deviceAssignments = existingAssignments;
  const primaryAssignment = existingAssignments[0] || {};
  orderItem.imei = primaryAssignment.imei || orderItem.imei || "";
  orderItem.serialNumber = primaryAssignment.serialNumber || orderItem.serialNumber || "";

  return existingAssignments;
};

export const activateWarrantyForOrder = async (payload = {}) => {
  const module = await import("../warranty/warrantyService.js");
  return module.activateWarrantyForOrder(payload);
};

export const releaseOrderDevices = async ({
  order,
  actor = {},
  session = null,
  toInventoryState = INVENTORY_STATES.IN_STOCK,
  toServiceState = null,
  eventType = "DEVICE_RELEASED",
  note = "",
} = {}) => {
  if (!order) return [];

  const updatedDevices = [];
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const assignments = Array.isArray(item.deviceAssignments) ? item.deviceAssignments : [];
    for (const assignment of assignments) {
      const device = await Device.findById(assignment.deviceId)
        .setOptions({ skipBranchIsolation: true })
        .session(session);
      if (!device) continue;

      const previousInventoryState = device.inventoryState;
      const previousServiceState = device.serviceState;
      device.inventoryState = toInventoryState;
      if (toServiceState) {
        device.serviceState = toServiceState;
      }
      device.reservedFor = undefined;
      await device.save({ session });

      await createLifecycleEvent({
        deviceId: device._id,
        storeId: device.storeId,
        orderId: order._id,
        orderItemId: item._id,
        eventType,
        fromInventoryState: previousInventoryState,
        toInventoryState: device.inventoryState,
        fromServiceState: previousServiceState,
        toServiceState: device.serviceState,
        actorId: actor?._id || null,
        actorName: getActorName(actor),
        note,
        referenceType: "ORDER",
        referenceId: String(order._id),
        session,
      });

      updatedDevices.push(device);
    }
  }

  return updatedDevices;
};

export const getPublicWarrantyLookup = async (payload = {}) => {
  const module = await import("../warranty/warrantyService.js");
  return module.getPublicWarrantyLookup(payload);
};

export const resolveSerializedItemFlags = async ({ items = [], session = null } = {}) => {
  const results = new Map();
  for (const item of items) {
    const productId = item?.productId;
    if (!productId) continue;
    const key = String(productId);
    if (results.has(key)) continue;
    const resolved = await resolveAfterSalesConfigByProductId({ productId, session });
    results.set(key, {
      isSerialized: Boolean(resolved && isSerializedConfig(resolved.config)),
      config: resolved?.config || null,
    });
  }
  return results;
};

export default {
  activateWarrantyForOrder,
  assignDevicesToOrderItem,
  buildError,
  createLifecycleEvent,
  getActorName,
  getPublicWarrantyLookup,
  ensureSparseUniqueness,
  normalizeSerializedUnitForPersistence,
  registerSerializedUnits,
  releaseOrderDevices,
  resolveSerializedItemFlags,
};
