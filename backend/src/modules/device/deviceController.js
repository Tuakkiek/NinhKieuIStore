import Device from "./Device.js";
import DeviceLifecycleHistory from "./DeviceLifecycleHistory.js";
import { SERVICE_STATES } from "./afterSalesConfig.js";
import {
  buildError,
  createLifecycleEvent,
  getActorName,
  ensureSparseUniqueness,
  normalizeSerializedUnitForPersistence,
  registerSerializedUnits,
  resolveSerializedItemFlags,
} from "./deviceService.js";
import mongoose from "mongoose";
import Order from "../order/Order.js";
import {
  ensureIdentifierPolicySatisfied,
  INVENTORY_STATES,
  isSerializedConfig,
  resolveAfterSalesConfigByProductId,
  validateIdentifierFormat,
} from "./afterSalesConfig.js";
import { activateWarrantyForOrder } from "../warranty/warrantyService.js";

const parsePagination = (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const normalizePhone = (value) => String(value || "").replace(/\D+/g, "");

const getCustomerSnapshotFromOrder = (order = {}) => ({
  name: String(order?.shippingAddress?.fullName || order?.customerName || "").trim(),
  phone: String(order?.shippingAddress?.phoneNumber || order?.customerPhone || "").trim(),
});

const isEligibleOrderForAssignment = (order = {}) => {
  // User requested "no constraints", ra đơn nào gán đơn đó luôn.
  // We only block if the order object is completely missing.
  return Boolean(order?._id);
};

const buildOrderListItem = (order = {}) => {
  const customer = getCustomerSnapshotFromOrder(order);
  const totalQty = (Array.isArray(order.items) ? order.items : []).reduce(
    (sum, item) => sum + (Number(item?.quantity) || 0),
    0
  );

  return {
    id: String(order._id),
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    orderSource: order.orderSource,
    fulfillmentType: order.fulfillmentType,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customerName: customer.name,
    customerPhone: customer.phone,
    itemCount: totalQty,
    createdAt: order.createdAt,
  };
};

export const listDevices = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    const variantSku = String(req.query.variantSku || "").trim();
    const inventoryState = String(req.query.inventoryState || "").trim().toUpperCase();
    const serviceState = String(req.query.serviceState || "").trim().toUpperCase();
    const identifier = String(req.query.identifier || "").trim();

    if (variantSku) filter.variantSku = variantSku;
    if (inventoryState) filter.inventoryState = inventoryState;
    if (serviceState) filter.serviceState = serviceState;
    if (identifier) {
      filter.$or = [
        { imei: { $regex: identifier, $options: "i" } },
        { serialNumber: { $regex: identifier, $options: "i" } },
      ];
    }

    const [devices, total] = await Promise.all([
      Device.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Device.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        devices,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
        },
      },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to load devices",
    });
  }
};

export const getDeviceById = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id).lean();
    if (!device) {
      throw buildError("Device not found", 404, "DEVICE_NOT_FOUND");
    }

    res.json({
      success: true,
      data: { device },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to load device detail",
    });
  }
};

export const getDeviceHistory = async (req, res) => {
  try {
    const history = await DeviceLifecycleHistory.find({ deviceId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: { history },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to load device history",
    });
  }
};

export const registerDevice = async (req, res) => {
  try {
    const payload = {
      storeId: req.body.storeId || req.authz?.activeBranchId,
      warehouseLocationId: req.body.warehouseLocationId,
      warehouseLocationCode: req.body.warehouseLocationCode,
      productId: req.body.productId,
      variantId: req.body.variantId,
      variantSku: req.body.variantSku,
      productName: req.body.productName,
      variantName: req.body.variantName,
      serializedUnits: Array.isArray(req.body.serializedUnits)
        ? req.body.serializedUnits
        : [{ imei: req.body.imei, serialNumber: req.body.serialNumber }],
      notes: req.body.notes,
      actor: req.user,
    };

    const devices = await registerSerializedUnits(payload);
    res.status(201).json({
      success: true,
      data: {
        devices,
      },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to register device",
    });
  }
};

export const importDevices = async (req, res) => {
  try {
    const {
      storeId,
      warehouseLocationId,
      warehouseLocationCode,
      productId,
      variantId,
      variantSku,
      productName,
      variantName,
      serializedUnits = [],
      notes,
    } = req.body;

    if (!Array.isArray(serializedUnits) || serializedUnits.length === 0) {
      throw buildError("serializedUnits is required", 400, "DEVICE_IMPORT_REQUIRED");
    }

    const devices = await registerSerializedUnits({
      storeId: storeId || req.authz?.activeBranchId,
      warehouseLocationId,
      warehouseLocationCode,
      productId,
      variantId,
      variantSku,
      productName,
      variantName,
      serializedUnits,
      notes,
      actor: req.user,
    });

    res.status(201).json({
      success: true,
      data: {
        devices,
        imported: devices.length,
      },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to import devices",
    });
  }
};

export const getAvailableDevices = async (req, res) => {
  try {
    const filter = {
      inventoryState: "IN_STOCK",
    };

    if (req.query.variantSku) filter.variantSku = String(req.query.variantSku).trim();
    if (req.query.storeId) filter.storeId = req.query.storeId;
    if (req.query.locationId) filter.warehouseLocationId = req.query.locationId;

    const devices = await Device.find(filter)
      .sort({ receivedAt: 1, createdAt: 1 })
      .limit(Math.min(100, Math.max(1, Number(req.query.limit) || 50)))
      .lean();

    res.json({
      success: true,
      data: { devices },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to load available devices",
    });
  }
};

export const updateDeviceServiceState = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) {
      throw buildError("Device not found", 404, "DEVICE_NOT_FOUND");
    }

    const nextServiceState = String(req.body.serviceState || "").trim().toUpperCase();
    if (!Object.values(SERVICE_STATES).includes(nextServiceState)) {
      throw buildError("Invalid service state", 400, "DEVICE_SERVICE_STATE_INVALID");
    }

    const previousServiceState = device.serviceState;
    device.serviceState = nextServiceState;
    if (req.body.notes !== undefined) {
      device.notes = String(req.body.notes || "").trim();
    }
    await device.save();

    await createLifecycleEvent({
      deviceId: device._id,
      storeId: device.storeId,
      eventType: "SERVICE_STATE_UPDATED",
      fromInventoryState: device.inventoryState,
      toInventoryState: device.inventoryState,
      fromServiceState: previousServiceState,
      toServiceState: nextServiceState,
      actorId: req.user?._id || null,
      actorName: getActorName(req.user),
      note: String(req.body.notes || "").trim(),
      referenceType: "DEVICE",
      referenceId: String(device._id),
    });

    res.json({
      success: true,
      data: { device },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to update device service state",
    });
  }
};

export const listEligibleOrdersForImeiAssignment = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const activeStoreId = req.authz?.activeBranchId;

    const phone = normalizePhone(req.query.phone || req.query.q || "");
    const orderIdOrNumber = String(req.query.orderId || req.query.orderNumber || req.query.q || "").trim();

    const query = {};

    // Only apply branch filter if it's a general list (no search query)
    const hasSearch = phone || orderIdOrNumber;
    if (activeStoreId && !hasSearch) {
      query["assignedStore.storeId"] = activeStoreId;
    }

    if (phone || orderIdOrNumber) {
      const searchOr = [];
      
      // Phone search (only if it looks like a possible phone number)
      if (phone && phone.length >= 8 && phone.length <= 15) {
        searchOr.push({ "shippingAddress.phoneNumber": { $regex: phone } });
        searchOr.push({ customerPhone: { $regex: phone } });
      }

      // Order ID or Number search
      if (orderIdOrNumber) {
        if (mongoose.isValidObjectId(orderIdOrNumber)) {
          searchOr.push({ _id: orderIdOrNumber });
        }
        searchOr.push({ orderNumber: { $regex: orderIdOrNumber, $options: "i" } });
      }

      if (searchOr.length > 0) {
        query.$or = searchOr;
      }
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        orders: orders.map(buildOrderListItem),
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
        },
      },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to load eligible orders",
    });
  }
};

export const getEligibleOrderForImeiAssignment = async (req, res) => {
  try {
    const activeStoreId = req.authz?.activeBranchId;
    const order = await Order.findOne({
      _id: req.params.id,
      "assignedStore.storeId": activeStoreId,
    }).lean();

    if (!order) {
      throw buildError("Order not found", 404, "ORDER_NOT_FOUND");
    }
    if (!isEligibleOrderForAssignment(order)) {
      throw buildError("Order is not eligible for IMEI assignment", 400, "ORDER_NOT_ELIGIBLE");
    }

    const serializedFlags = await resolveSerializedItemFlags({ items: order.items, session: null });
    const customer = getCustomerSnapshotFromOrder(order);

    const items = (Array.isArray(order.items) ? order.items : []).map((item) => {
      const resolved = serializedFlags.get(String(item.productId || "")) || {};
      return {
        id: String(item._id),
        orderItemId: String(item._id),
        productId: String(item.productId || ""),
        variantId: String(item.variantId || ""),
        variantSku: String(item.variantSku || ""),
        productName: String(item.productName || item.name || ""),
        variantName: String(item.variantName || ""),
        quantity: Number(item.quantity) || 0,
        isSerialized: Boolean(resolved.isSerialized),
        identifierPolicy: resolved?.config?.identifierPolicy || null,
        existingAssignments: Array.isArray(item.deviceAssignments) ? item.deviceAssignments.length : 0,
      };
    });

    res.json({
      success: true,
      data: {
        order: {
          id: String(order._id),
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          orderSource: order.orderSource,
          fulfillmentType: order.fulfillmentType,
          status: order.status,
          paymentStatus: order.paymentStatus,
          createdAt: order.createdAt,
          customerName: customer.name,
          customerPhone: customer.phone,
          items,
        },
      },
    });
  } catch (error) {
    res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to load order detail",
    });
  }
};

export const assignImeiToOrder = async (req, res) => {
  const session = await mongoose.startSession();
  const now = new Date();

  const run = async (useTransaction) => {
    if (useTransaction) {
      session.startTransaction();
    }

    try {
      const activeStoreId = req.authz?.activeBranchId;
      const orderId = String(req.body?.orderId || "").trim();
      const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];

      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        throw buildError("orderId is required", 400, "ORDER_ID_REQUIRED");
      }
      if (!assignments.length) {
        throw buildError("assignments is required", 400, "ASSIGNMENTS_REQUIRED");
      }

      const order = await Order.findOne({
        _id: orderId,
        "assignedStore.storeId": activeStoreId,
      }).session(session);

      if (!order) {
        throw buildError("Order not found", 404, "ORDER_NOT_FOUND");
      }
      if (!isEligibleOrderForAssignment(order)) {
        throw buildError("Order is not eligible for IMEI assignment", 400, "ORDER_NOT_ELIGIBLE");
      }

      const orderItems = Array.isArray(order.items) ? order.items : [];
      const byItemId = new Map(orderItems.map((item) => [String(item._id), item]));

      const serializedFlags = await resolveSerializedItemFlags({
        items: orderItems,
        session,
      });

      const requestItemIds = new Set();
      const requestLookupKeys = new Set();

      for (const itemAssignment of assignments) {
        const orderItemId = String(itemAssignment?.orderItemId || "").trim();
        if (!orderItemId) {
          throw buildError("orderItemId is required", 400, "ORDER_ITEM_ID_REQUIRED");
        }
        if (requestItemIds.has(orderItemId)) {
          throw buildError("Duplicate orderItemId in request", 400, "DUPLICATE_ORDER_ITEM");
        }
        requestItemIds.add(orderItemId);

        const orderItem = byItemId.get(orderItemId);
        if (!orderItem) {
          throw buildError(`Order item not found: ${orderItemId}`, 404, "ORDER_ITEM_NOT_FOUND");
        }

        const resolved = serializedFlags.get(String(orderItem.productId || "")) || {};
        if (!resolved.isSerialized || !isSerializedConfig(resolved.config)) {
          throw buildError(
            `Order item does not require serialized assignment: ${orderItem.productName || orderItem.variantSku}`,
            400,
            "ORDER_ITEM_NOT_SERIALIZED"
          );
        }

        const existingAssignments = Array.isArray(orderItem.deviceAssignments)
          ? orderItem.deviceAssignments.length
          : 0;
        if (existingAssignments > 0) {
          throw buildError(
            `Order item already has assigned identifiers: ${orderItem.productName || orderItem.variantSku}`,
            409,
            "ORDER_ITEM_ALREADY_ASSIGNED"
          );
        }

        const units = Array.isArray(itemAssignment?.units) ? itemAssignment.units : [];
        const expectedQty = Number(orderItem.quantity) || 0;
        if (units.length !== expectedQty) {
          throw buildError(
            `Expected ${expectedQty} IMEI/Serial for ${orderItem.productName || orderItem.variantSku}`,
            400,
            "IMEI_COUNT_MISMATCH"
          );
        }

        const createdAssignments = [];
        for (const unitRaw of units) {
          const normalizedUnit = normalizeSerializedUnitForPersistence(unitRaw);
          const policyError = ensureIdentifierPolicySatisfied(resolved.config || {}, normalizedUnit);
          if (policyError) {
            throw buildError(policyError, 400, "DEVICE_IDENTIFIER_POLICY");
          }
          const formatError = validateIdentifierFormat(normalizedUnit);
          if (formatError) {
            throw buildError(formatError, 400, "DEVICE_IDENTIFIER_INVALID");
          }

          for (const key of normalizedUnit.lookupKeys || []) {
            if (requestLookupKeys.has(key)) {
              throw buildError(
                `Duplicate identifier ${key} in request`,
                400,
                "DEVICE_IDENTIFIER_DUPLICATE_REQUEST"
              );
            }
            requestLookupKeys.add(key);
          }

          await ensureSparseUniqueness({
            imeiNormalized: normalizedUnit.imeiNormalized,
            serialNumberNormalized: normalizedUnit.serialNumberNormalized,
            session,
          });

          const [device] = await Device.create(
            [
              {
                storeId: order.assignedStore.storeId,
                warehouseLocationId: null,
                warehouseLocationCode: "",
                productId: orderItem.productId,
                variantId: orderItem.variantId,
                variantSku: orderItem.variantSku,
                productName: orderItem.productName || orderItem.name || "",
                variantName: orderItem.variantName || "",
                basePrice: Number(orderItem.basePrice) || 0,
                originalPrice: Number(orderItem.originalPrice) || Number(orderItem.basePrice) || 0,
                sellingPrice: Number(orderItem.price) || 0,
                costPrice: Number(orderItem.costPrice) || 0,
                priceUpdatedAt: now,
                imei: normalizedUnit.imei,
                imeiNormalized: normalizedUnit.imeiNormalized || undefined,
                serialNumber: normalizedUnit.serialNumber,
                serialNumberNormalized: normalizedUnit.serialNumberNormalized || undefined,
                lookupKeys: normalizedUnit.lookupKeys,
                orderId: order._id,
                orderItemId: orderItem._id,
                assignedAt: now,
                inventoryState: INVENTORY_STATES.SOLD,
                serviceState: SERVICE_STATES.NONE,
                notes: String(req.body?.notes || "").trim(),
                receivedAt: now,
                saleSnapshot: {
                  orderId: order._id,
                  orderNumber: order.orderNumber,
                  orderItemId: orderItem._id,
                  customerId: order.customerId || order.userId || null,
                  customerName: getCustomerSnapshotFromOrder(order).name,
                  customerPhone: getCustomerSnapshotFromOrder(order).phone,
                  soldAt: now,
                },
              },
            ],
            { session }
          );

          await createLifecycleEvent({
            deviceId: device._id,
            storeId: device.storeId,
            orderId: order._id,
            orderItemId: orderItem._id,
            eventType: "ASSIGNED_TO_ORDER_POST_PAYMENT",
            fromInventoryState: null,
            toInventoryState: INVENTORY_STATES.SOLD,
            fromServiceState: null,
            toServiceState: SERVICE_STATES.NONE,
            actorId: req.user?._id || null,
            actorName: getActorName(req.user),
            note: `Assigned to order ${order.orderNumber || order._id}`,
            referenceType: "ORDER",
            referenceId: String(order._id),
            metadata: { variantSku: orderItem.variantSku },
            session,
          });

          createdAssignments.push({
            deviceId: device._id,
            imei: device.imei || "",
            serialNumber: device.serialNumber || "",
            assignedAt: now,
            assignedBy: req.user?._id || null,
            mode: "MANUAL",
          });
        }

        orderItem.deviceAssignments = createdAssignments;
        orderItem.imei = createdAssignments[0]?.imei || "";
        orderItem.serialNumber = createdAssignments[0]?.serialNumber || "";
      }

      await activateWarrantyForOrder({
        order,
        soldAt: now,
        actor: req.user,
        session,
      });

      await order.save({ session });

      if (useTransaction) {
        await session.commitTransaction();
      }

      return {
        order,
        assignedAt: now,
      };
    } catch (error) {
      if (useTransaction) {
        await session.abortTransaction();
      }
      throw error;
    }
  };

  try {
    const result = await run(true);
    return res.status(201).json({
      success: true,
      data: {
        orderId: String(result.order._id),
        assignedAt: result.assignedAt,
      },
    });
  } catch (error) {
    // Fallback for environments without transactions
    try {
      if (String(error?.message || "").includes("Transaction") || error?.code === 251) {
        const result = await run(false);
        return res.status(201).json({
          success: true,
          data: {
            orderId: String(result.order._id),
            assignedAt: result.assignedAt,
          },
        });
      }
    } catch (fallbackError) {
      error = fallbackError;
    }

    return res.status(error.httpStatus || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to assign IMEI to order",
    });
  } finally {
    session.endSession();
  }
};

export default {
  getAvailableDevices,
  getDeviceById,
  getDeviceHistory,
  importDevices,
  listDevices,
  assignImeiToOrder,
  getEligibleOrderForImeiAssignment,
  listEligibleOrdersForImeiAssignment,
  registerDevice,
  updateDeviceServiceState,
};
