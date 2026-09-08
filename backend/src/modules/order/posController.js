import mongoose from "mongoose";
import Order, { mapStatusToStage } from "./Order.js";
import User from "../auth/User.js";
import Store from "../store/Store.js";
import UniversalProduct, { UniversalVariant } from "../product/UniversalProduct.js";
import Inventory from "../warehouse/Inventory.js";
import WarehouseLocation from "../warehouse/WarehouseLocation.js";
import StockMovement from "../warehouse/StockMovement.js";
import Device from "../device/Device.js";
import {
  assignDevicesToOrderItem,
  buildError,
  resolveSerializedItemFlags,
} from "../device/deviceService.js";
import {
  ensureIdentifierPolicySatisfied,
  normalizeImei,
  normalizeSerialNumber,
  validateIdentifierFormat,
} from "../device/afterSalesConfig.js";
import { activateWarrantyForOrder } from "../warranty/warrantyService.js";
import {
  notifyOrderManagerPendingInStoreOrder,
  sendOrderStageNotifications,
} from "../notification/notificationService.js";
import {
  recalculateProductAvailability,
  resolveVariantPricingSnapshot,
} from "../product/productPricingService.js";
import {
  canPurchaseForProductStatus,
  normalizeProductStatus,
} from "../product/productPricingConfig.js";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";
import { hasPermission } from "../../authz/policyEngine.js";

const getModelsByType = () => ({ Product: UniversalProduct, Variant: UniversalVariant });

const resolveOrderStage = (order) => order?.statusStage || mapStatusToStage(order?.status);

const buildHttpError = (httpStatus, code, message) => {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.code = code;
  return error;
};

const getActiveBranchIdFromReq = (req) => String(req?.authz?.activeBranchId || "").trim();

const isGlobalAdminRequest = (req) =>
  Boolean(req?.authz?.isGlobalAdmin);

const requestHasPermission = (req, permission, mode = "branch") =>
  hasPermission(req?.authz, permission, { mode });

const hasBroadPosAccess = (req) =>
  Boolean(req?.authz?.isGlobalAdmin) ||
  requestHasPermission(req, AUTHZ_ACTIONS.POS_ORDER_READ_BRANCH, "branch") ||
  requestHasPermission(req, AUTHZ_ACTIONS.POS_ORDER_READ_BRANCH, "global");

const canReadOwnPosOrders = (req) =>
  !hasBroadPosAccess(req) &&
  requestHasPermission(req, AUTHZ_ACTIONS.POS_ORDER_READ_SELF, "self");

const canReadBranchPosOrders = (req) =>
  requestHasPermission(
    req,
    AUTHZ_ACTIONS.POS_ORDER_READ_BRANCH,
    req?.authz?.isGlobalAdmin ? "global" : "branch",
  );

const canProcessCashierPayments = (req) =>
  !req?.authz?.isGlobalAdmin &&
  requestHasPermission(
    req,
    AUTHZ_ACTIONS.POS_PAYMENT_PROCESS,
    req?.authz?.isGlobalAdmin ? "global" : "branch",
  );

const ensureActiveBranchContext = (req, { allowGlobalWithoutBranch = false, fallbackBranchId = "" } = {}) => {
  const activeBranchId = getActiveBranchIdFromReq(req);
  if (activeBranchId) {
    return activeBranchId;
  }

  if (isGlobalAdminRequest(req)) {
    const normalizedFallbackBranchId = String(fallbackBranchId || "").trim();
    if (normalizedFallbackBranchId) {
      return normalizedFallbackBranchId;
    }

    if (allowGlobalWithoutBranch) {
      return "";
    }
  }

  throw buildHttpError(
    403,
    "AUTHZ_ACTIVE_BRANCH_REQUIRED",
    "Active branch context is required for POS operations",
  );
};

const extractRequestedBranchId = (body = {}) => {
  const raw =
    body?.branchId ||
    body?.storeId ||
    body?.assignedStore?.storeId ||
    body?.assignedStoreId ||
    "";
  return String(raw || "").trim();
};

const formatStoreAddress = (store) => {
  const address = store?.address || {};
  return [address.street, address.ward, address.district, address.province]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
};

const buildAssignedStoreSnapshot = (store, assignedBy) => ({
  storeId: store._id,
  storeName: store.name,
  storeCode: store.code,
  storeAddress: formatStoreAddress(store),
  storePhone: store.phone || "",
  assignedAt: new Date(),
  assignedBy,
});

const resolveActiveStore = async (req, session = null, { requestedBranchId = "" } = {}) => {
  const activeBranchId = ensureActiveBranchContext(req, { fallbackBranchId: requestedBranchId });
  const query = Store.findById(activeBranchId);
  if (session) {
    query.session(session);
  }
  const store = await query;

  if (!store || store.status !== "ACTIVE") {
    throw buildHttpError(403, "ORDER_BRANCH_FORBIDDEN", "Assigned branch is not available for POS operations");
  }

  return { activeBranchId, store };
};

const assertOrderInActiveBranch = (req, order) => {
  const orderBranchId = String(order?.assignedStore?.storeId || "").trim();

  if (!orderBranchId) {
    throw buildHttpError(
      403,
      "ORDER_BRANCH_MISSING",
      "In-store order is missing branch assignment and cannot be processed",
    );
  }

  if (isGlobalAdminRequest(req)) {
    return getActiveBranchIdFromReq(req) || orderBranchId;
  }

  const activeBranchId = ensureActiveBranchContext(req);

  if (orderBranchId !== activeBranchId) {
    throw buildHttpError(403, "ORDER_BRANCH_FORBIDDEN", "Order does not belong to your assigned branch");
  }

  return activeBranchId;
};

const handleError = (res, error, fallbackMessage) => {
  const status = error?.httpStatus || 500;
  const payload = {
    success: false,
    message: error?.message || fallbackMessage,
  };

  if (error?.code) {
    payload.code = error.code;
  }

  return res.status(status).json(payload);
};

const recalculateAvailabilityForItems = async (orderItems = [], session) => {
  const productIds = [
    ...new Set(
      (Array.isArray(orderItems) ? orderItems : [])
        .map((item) => String(item?.productId || "").trim())
        .filter(Boolean),
    ),
  ];

  for (const productId of productIds) {
    await recalculateProductAvailability({ productId, session });
  }
};

export const createPOSOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items, customerInfo, totalAmount, promotionCode } = req.body;
    const requestedBranchId = extractRequestedBranchId(req.body);
    const { activeBranchId, store } = await resolveActiveStore(req, session, { requestedBranchId });

    if (requestedBranchId && requestedBranchId !== activeBranchId && !isGlobalAdminRequest(req)) {
      throw buildHttpError(
        403,
        "ORDER_BRANCH_FORBIDDEN",
        "Request branch does not match authenticated staff branch",
      );
    }

    const customerPhone = String(customerInfo?.phoneNumber || "").trim();
    const customerName = String(customerInfo?.fullName || "").trim();

    if (!items?.length) {
      throw buildHttpError(400, "ORDER_ITEMS_REQUIRED", "Cart is empty");
    }

    if (!customerName || !customerPhone) {
      throw buildHttpError(400, "ORDER_CUSTOMER_REQUIRED", "Customer information is required");
    }

    const customer = await User.findOne({
      phoneNumber: customerPhone,
      role: "CUSTOMER",
    }).session(session);

    if (!customer) {
      throw buildHttpError(
        400,
        "ORDER_CUSTOMER_NOT_FOUND",
        "Customer account is required before creating an in-store order",
      );
    }

    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const { variantId, productType, quantity } = item;
      const models = getModelsByType(productType);

      const variant = await models.Variant.findById(variantId).session(session);
      if (!variant) {
        throw buildHttpError(404, "ORDER_VARIANT_NOT_FOUND", `Variant not found: ${variantId}`);
      }

      const product = await models.Product.findById(variant.productId).session(session);
      if (!product) {
        throw buildHttpError(404, "ORDER_PRODUCT_NOT_FOUND", "Product not found");
      }

      const productStatus = normalizeProductStatus(product.status);
      if (!canPurchaseForProductStatus(productStatus)) {
        throw buildHttpError(
          400,
          "ORDER_PRODUCT_UNAVAILABLE",
          `${product.name} is not available for purchase`,
        );
      }

      if (variant.stock < quantity) {
        throw buildHttpError(
          400,
          "ORDER_OUT_OF_STOCK",
          `${product.name} (${variant.color || ""}) only has ${variant.stock} item(s) left`,
        );
      }

      variant.stock -= quantity;
      variant.salesCount = (variant.salesCount || 0) + quantity;
      await variant.save({ session });

      product.salesCount = (product.salesCount || 0) + quantity;
      await product.save({ session });

      const pricingSnapshot = resolveVariantPricingSnapshot(variant);
      const price = Number(pricingSnapshot.price) || 0;
      const originalPrice = Number(pricingSnapshot.originalPrice) || price;
      const basePrice = Number(pricingSnapshot.basePrice) || originalPrice;
      const costPrice = Number(pricingSnapshot.costPrice) || 0;
      if (price <= 0) {
        throw buildHttpError(400, "ORDER_PRICE_INVALID", `${product.name} is missing a live selling price`);
      }
      const itemTotal = price * quantity;
      subtotal += itemTotal;

      const images = variant.images || product.featuredImages || [];
      const image = images.length > 0 ? images[0] : "";

      orderItems.push({
        productId: product._id,
        variantId: variant._id,
        productType,
        productName: product.name,
        name: product.name,
        variantSku: variant.sku,
        variantColor: variant.color || "",
        variantStorage: variant.storage || "",
        variantConnectivity: variant.connectivity || "",
        variantName: variant.variantName || "",
        variantCpuGpu: variant.cpuGpu || "",
        variantRam: variant.ram || "",
        quantity,
        price,
        originalPrice,
        basePrice,
        costPrice,
        total: itemTotal,
        subtotal: itemTotal,
        images,
        image,
      });
    }

    const receiptNumber = `TMP${Date.now().toString().slice(-8)}`;
    const finalTotal = totalAmount ?? subtotal;

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    const orderNumber = `POS-${datePart}-${Date.now().toString().slice(-6)}${randomPart}`;

    const [order] = await Order.create(
      [
        {
          orderNumber,
          orderSource: "IN_STORE",
          fulfillmentType: "IN_STORE",
          customerId: customer._id,
          items: orderItems,
          shippingAddress: {
            fullName: customerName,
            phoneNumber: customerPhone,
            province: store?.address?.province || "",
            district: store?.address?.district || "",
            ward: store?.address?.ward || "",
            detailAddress: "Mua tại cửa hàng",
          },
          paymentMethod: "CASH",
          paymentStatus: "UNPAID",
          paidAt: null,
          status: "PENDING_ORDER_MANAGEMENT",
          deliveredAt: null,
          subtotal,
          shippingFee: 0,
          promotionDiscount: 0,
          appliedPromotion: promotionCode ? { code: promotionCode, discountAmount: 0 } : null,
          totalAmount: finalTotal,
          assignedStore: buildAssignedStoreSnapshot(store, req.user._id),
          posInfo: {
            staffId: req.user._id,
            staffName: req.user.fullName,
            storeLocation: store.name,
            receiptNumber,
            paymentReceived: 0,
            changeGiven: 0,
          },
          createdByInfo: {
            userId: req.user._id,
            userName: req.user.fullName || req.user.name,
          },
        },
      ],
      { session },
    );

    await order.save({ session });
    await recalculateAvailabilityForItems(orderItems, session);
    await session.commitTransaction();

    await sendOrderStageNotifications({
      order,
      previousStage: "PENDING",
      triggeredBy: req.user?._id,
      source: "create_pos_order",
    });
    await notifyOrderManagerPendingInStoreOrder({ order });

    return res.status(201).json({
      success: true,
      message: "Đã tạo đơn chuyển kho thành công. Đơn đang chờ Order Manager xử lý.",
      data: { order },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("CREATE POS ORDER ERROR:", error);
    return handleError(res, error, "Lỗi tạo đơn hàng");
  } finally {
    session.endSession();
  }
};

export const getPendingOrders = async (req, res) => {
  try {
    const activeBranchId = ensureActiveBranchContext(req, { allowGlobalWithoutBranch: true });
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    const query = {
      orderSource: "IN_STORE",
      $or: [
        { statusStage: "PENDING_PAYMENT" },
        { status: "PENDING_PAYMENT" },
        { status: "PROCESSING" },
        { status: "PENDING_ORDER_MANAGEMENT" },
        { statusStage: "PENDING_ORDER_MANAGEMENT" },
      ],
    };
    if (activeBranchId) {
      query["assignedStore.storeId"] = activeBranchId;
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("posInfo.staffId", "fullName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        orders,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
        },
      },
    });
  } catch (error) {
    console.error("GET PENDING ORDERS ERROR:", error);
    return handleError(res, error, "Loi server");
  }
};

export const getPOSOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      orderSource: "IN_STORE",
    })
      .populate("customerId", "fullName email phoneNumber")
      .populate("userId", "fullName email phoneNumber")
      .populate("posInfo.staffId", "fullName")
      .populate("posInfo.cashierId", "fullName");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    assertOrderInActiveBranch(req, order);

    if (canReadOwnPosOrders(req) && !canReadBranchPosOrders(req)) {
      const staffId = String(order?.posInfo?.staffId?._id || order?.posInfo?.staffId || "");
      if (!staffId || staffId !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          code: "ORDER_BRANCH_FORBIDDEN",
          message: "Nhân viên POS chỉ được xem đơn do chính mình tạo trong chi nhánh của mình",
        });
      }
    }

    return res.json({
      success: true,
      data: { order },
    });
  } catch (error) {
    console.error("GET POS ORDER BY ID ERROR:", error);
    return handleError(res, error, "Lỗi lấy chi tiết đơn hàng POS");
  }
};

export const processPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentReceived } = req.body;

    if (!paymentReceived || paymentReceived < 0) {
      return res.status(400).json({
        success: false,
        message: "Số tiền thanh toán không hợp lệ",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    if (order.orderSource !== "IN_STORE") {
      return res.status(400).json({
        success: false,
        message: "Only in-store POS orders can be paid at cashier",
      });
    }

    assertOrderInActiveBranch(req, order);

    const currentStage = resolveOrderStage(order);
    if (
      currentStage !== "PENDING_PAYMENT" &&
      currentStage !== "PENDING_ORDER_MANAGEMENT" &&
      order.paymentStatus !== "PENDING" &&
      order.paymentStatus !== "UNPAID"
    ) {
      return res.status(400).json({
        success: false,
        message: "Đơn hàng không ở trạng thái chờ thanh toán",
      });
    }

    if (paymentReceived < order.totalAmount) {
      return res.status(400).json({
        success: false,
        message: "Số tiền thanh toán không đủ",
      });
    }

    const changeGiven = paymentReceived - order.totalAmount;

    order.paymentStatus = "PAID";
    order.status = "PROCESSING";

    if (!order.posInfo) {
      order.posInfo = {};
    }

    order.posInfo.cashierId = req.user._id;
    order.posInfo.cashierName = req.user.fullName;
    order.posInfo.paymentReceived = paymentReceived;
    order.posInfo.changeGiven = changeGiven;

    order.paymentInfo = {
      processedBy: req.user._id,
      processedAt: new Date(),
      paymentReceived,
      changeGiven,
    };

    if (!Array.isArray(order.statusHistory)) {
      order.statusHistory = [];
    }

    order.statusHistory.push({
      status: "PROCESSING",
      updatedBy: req.user._id,
      updatedAt: new Date(),
      note: `Đã thanh toán - Thu ngân: ${req.user.fullName} - Chờ nhập IMEI`,
    });

    await order.save();

    await sendOrderStageNotifications({
      order,
      previousStage: currentStage,
      triggeredBy: req.user?._id,
      source: "pos_process_payment",
    });

    return res.json({
      success: true,
      message: "Thanh toán thành công! Vui lòng nhập IMEI để hoàn tất.",
      data: { order },
    });
  } catch (error) {
    console.error("PROCESS PAYMENT ERROR:", error);
    return handleError(res, error, "Lỗi xử lý thanh toán");
  }
};

export const finalizePOSOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const { items, customerInfo } = req.body;

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      throw buildHttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng");
    }

    if (order.orderSource !== "IN_STORE") {
      throw buildHttpError(400, "ORDER_SOURCE_INVALID", "Only in-store POS orders can be finalized");
    }

    assertOrderInActiveBranch(req, order);

    if (order.status !== "PROCESSING" && order.status !== "PENDING_PAYMENT") {
      if (order.paymentStatus !== "PAID") {
        throw buildHttpError(400, "ORDER_NOT_PAID", "Đơn hàng chưa được thanh toán");
      }
    }

    const serializedFlags = await resolveSerializedItemFlags({
      items: order.items,
      session,
    });

    if (items && items.length > 0) {
      const itemMap = new Map(items.map((item) => [String(item._id || item.variantId), item]));

      for (const orderItem of order.items) {
        const updateItem =
          itemMap.get(String(orderItem._id)) || itemMap.get(String(orderItem.variantId));
        const serializedTrackingEnabled =
          serializedFlags.get(String(orderItem.productId || ""))?.isSerialized || false;
        const serializedConfig =
          serializedFlags.get(String(orderItem.productId || ""))?.config || null;

        if (serializedTrackingEnabled) {
          const requestedAssignments = Array.isArray(updateItem?.deviceAssignments)
            ? updateItem.deviceAssignments
            : [];
          const requestedDeviceIds = requestedAssignments
            .map((assignment) => assignment?.deviceId || assignment?._id || assignment)
            .filter(Boolean);

          if (!requestedDeviceIds.length && updateItem?.imei && Number(orderItem.quantity) === 1) {
            const normalizedLegacyImei = normalizeImei(updateItem.imei);
            const normalizedLegacySerial = normalizeSerialNumber(updateItem.serialNumber);
            const legacyDevice = await Device.findOne({
              storeId: order.assignedStore.storeId,
              variantSku: orderItem.variantSku,
              inventoryState: "IN_STOCK",
              $or: [
                ...(normalizedLegacyImei ? [{ imeiNormalized: normalizedLegacyImei }] : []),
                ...(normalizedLegacySerial
                  ? [{ serialNumberNormalized: normalizedLegacySerial }]
                  : []),
              ],
            }).session(session);

            if (legacyDevice) {
              requestedDeviceIds.push(legacyDevice._id);
            }
          }

          if (requestedDeviceIds.length) {
            if (requestedDeviceIds.length !== Number(orderItem.quantity || 0)) {
              throw buildError(
                `Please select ${orderItem.quantity} device(s) for ${orderItem.productName || orderItem.variantSku}`,
                400,
                "DEVICE_ASSIGNMENT_REQUIRED"
              );
            }

            await assignDevicesToOrderItem({
              storeId: order.assignedStore.storeId,
              order,
              orderItem,
              requestedDeviceIds,
              requestedQuantity: Number(orderItem.quantity) || 0,
              actor: req.user,
              session,
              mode: "MANUAL",
            });
          } else {
            const manualIdentifiers = {
              imei: String(updateItem?.imei || "").trim(),
              serialNumber: String(updateItem?.serialNumber || "").trim(),
            };
            const identifierPolicyError = ensureIdentifierPolicySatisfied(
              serializedConfig || {},
              manualIdentifiers
            );
            if (identifierPolicyError) {
              throw buildError(
                identifierPolicyError,
                400,
                "WARRANTY_IDENTIFIER_REQUIRED"
              );
            }

            const identifierFormatError = validateIdentifierFormat(manualIdentifiers);
            if (identifierFormatError) {
              throw buildError(
                identifierFormatError,
                400,
                "WARRANTY_IDENTIFIER_INVALID"
              );
            }

            if (Number(orderItem.quantity || 0) !== 1) {
              throw buildError(
                `Please select registered devices for quantity ${orderItem.quantity} of ${orderItem.productName || orderItem.variantSku}`,
                400,
                "DEVICE_ASSIGNMENT_REQUIRED"
              );
            }

            orderItem.imei = manualIdentifiers.imei;
            orderItem.serialNumber = manualIdentifiers.serialNumber;
            orderItem.deviceAssignments = [];
          }
        } else if (updateItem?.imei) {
          orderItem.imei = String(updateItem.imei).trim();
          if (updateItem?.serialNumber) {
            orderItem.serialNumber = String(updateItem.serialNumber).trim();
          }
        }
      }
    }

    if (!order.paymentInfo || !order.paymentInfo.invoiceNumber) {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const lastInvoice = await Order.findOne({
        "paymentInfo.invoiceNumber": new RegExp(`^INV${year}${month}`),
      })
        .sort({ "paymentInfo.invoiceNumber": -1 })
        .session(session);

      let seq = 1;
      if (lastInvoice?.paymentInfo?.invoiceNumber) {
        const lastSeq = parseInt(lastInvoice.paymentInfo.invoiceNumber.slice(-6), 10);
        if (!Number.isNaN(lastSeq)) {
          seq = lastSeq + 1;
        }
      }

      const invoiceNumber = `INV${year}${month}${seq.toString().padStart(6, "0")}`;
      if (!order.paymentInfo) {
        order.paymentInfo = {};
      }
      order.paymentInfo.invoiceNumber = invoiceNumber;
    }

    order.status = "DELIVERED";
    order.deliveredAt = new Date();

    if (customerInfo) {
      if (customerInfo.name) {
        order.shippingAddress.fullName = customerInfo.name;
      }
      if (customerInfo.phone) {
        order.shippingAddress.phoneNumber = customerInfo.phone;
      }
    }

    if (!Array.isArray(order.statusHistory)) {
      order.statusHistory = [];
    }

    order.statusHistory.push({
      status: "DELIVERED",
      updatedBy: req.user._id,
      updatedAt: new Date(),
      note: `Hoàn tất đơn hàng - Hóa đơn ${order.paymentInfo.invoiceNumber}`,
    });

    await activateWarrantyForOrder({
      order,
      soldAt: order.deliveredAt,
      actor: req.user,
      session,
    });

    await order.save({ session });
    await session.commitTransaction();

    return res.json({
      success: true,
      message: "Đơn hàng đã hoàn tất!",
      data: { order },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("FINALIZE ORDER ERROR:", error);
    return handleError(res, error, "Lỗi hoàn tất đơn hàng");
  } finally {
    session.endSession();
  }
};

export const cancelPendingOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      throw buildHttpError(404, "ORDER_NOT_FOUND", "Không tìm thấy đơn hàng");
    }

    if (order.orderSource !== "IN_STORE") {
      throw buildHttpError(400, "ORDER_SOURCE_INVALID", "Only in-store POS orders can be canceled at cashier");
    }

    assertOrderInActiveBranch(req, order);
    const orderBranchId = String(order?.assignedStore?.storeId || "").trim();

    const currentStage = resolveOrderStage(order);
    if (currentStage !== "PENDING_PAYMENT") {
      throw buildHttpError(400, "ORDER_STATUS_INVALID", "Chỉ hủy được đơn đang chờ thanh toán");
    }

    const pickMovements = await StockMovement.find({
      type: "OUTBOUND",
      referenceType: "ORDER",
      referenceId: String(order._id),
    }).session(session);
    const orderItemBySku = new Map(
      (Array.isArray(order.items) ? order.items : [])
        .map((item) => [String(item?.variantSku || "").trim(), item])
        .filter(([sku]) => sku),
    );

    const restoreBatches = new Map();
    for (const movement of pickMovements) {
      const locationId = movement.fromLocationId?.toString();
      if (!locationId) {
        continue;
      }

      const key = `${movement.sku}::${locationId}`;
      const previous = restoreBatches.get(key);
      if (previous) {
        previous.quantity += Number(movement.quantity) || 0;
        continue;
      }

      restoreBatches.set(key, {
        storeId: movement.storeId || orderBranchId || null,
        sku: movement.sku,
        locationId: movement.fromLocationId,
        locationCode: movement.fromLocationCode,
        productId: movement.productId,
        productName: movement.productName,
        quantity: Number(movement.quantity) || 0,
      });
    }

    for (const batch of restoreBatches.values()) {
      if (!batch.quantity) {
        continue;
      }

      const location = await WarehouseLocation.findById(batch.locationId).session(session);
      const batchStoreId = String(batch.storeId || location?.storeId || orderBranchId || "").trim();
      if (!batchStoreId) {
        continue;
      }

      const inventory = await Inventory.findOne({
        storeId: batchStoreId,
        sku: batch.sku,
        locationId: batch.locationId,
      }).session(session);
      const orderItem = orderItemBySku.get(String(batch.sku || "").trim());

      if (inventory) {
        inventory.quantity += batch.quantity;
        inventory.basePrice = Number(orderItem?.basePrice) || Number(orderItem?.originalPrice) || 0;
        inventory.originalPrice = Number(orderItem?.originalPrice) || Number(orderItem?.basePrice) || 0;
        inventory.sellingPrice = Number(orderItem?.price) || 0;
        inventory.costPrice = Number(orderItem?.costPrice) || 0;
        inventory.price = Number(orderItem?.price) || 0;
        await inventory.save({ session });
      } else {
        await Inventory.create(
          [
            {
              storeId: batchStoreId,
              sku: batch.sku,
              productId: batch.productId,
              productName: batch.productName,
              locationId: batch.locationId,
              locationCode: batch.locationCode,
              quantity: batch.quantity,
              basePrice: Number(orderItem?.basePrice) || Number(orderItem?.originalPrice) || 0,
              originalPrice: Number(orderItem?.originalPrice) || Number(orderItem?.basePrice) || 0,
              sellingPrice: Number(orderItem?.price) || 0,
              costPrice: Number(orderItem?.costPrice) || 0,
              price: Number(orderItem?.price) || 0,
              status: "GOOD",
            },
          ],
          { session },
        );
      }

      if (location) {
        location.currentLoad += batch.quantity;
        await location.save({ session });
      }

      await StockMovement.create(
        [
          {
            storeId: batchStoreId,
            type: "INBOUND",
            sku: batch.sku,
            productId: batch.productId,
            productName: batch.productName,
            toLocationId: batch.locationId,
            toLocationCode: batch.locationCode,
            quantity: batch.quantity,
            basePrice: Number(orderItem?.basePrice) || Number(orderItem?.originalPrice) || 0,
            originalPrice: Number(orderItem?.originalPrice) || Number(orderItem?.basePrice) || 0,
            sellingPrice: Number(orderItem?.price) || 0,
            costPrice: Number(orderItem?.costPrice) || 0,
            price: Number(orderItem?.price) || 0,
            referenceType: "ORDER",
            referenceId: String(order._id),
            performedBy: req.user._id,
            performedByName: req.user.fullName || req.user.name || "Cashier",
            notes: "Inventory restored from cashier cancellation",
          },
        ],
        { session },
      );
    }

    for (const item of order.items) {
      const models = getModelsByType(item.productType);
      const variant = await models.Variant.findById(item.variantId).session(session);
      if (variant) {
        variant.stock += item.quantity;
        variant.salesCount = Math.max(0, (variant.salesCount || 0) - item.quantity);
        await variant.save({ session });
      }

      const product = await models.Product.findById(item.productId).session(session);
      if (product) {
        product.salesCount = Math.max(0, (product.salesCount || 0) - item.quantity);
        await product.save({ session });
      }
    }

    await recalculateAvailabilityForItems(order.items, session);

    order.status = "CANCELLED";
    order.cancelledAt = new Date();
    order.cancelReason = reason || "Huy boi thu ngan";

    if (!Array.isArray(order.statusHistory)) {
      order.statusHistory = [];
    }

    order.statusHistory.push({
      status: "CANCELLED",
      updatedBy: req.user._id,
      updatedAt: new Date(),
      note: order.cancelReason,
    });

    await order.save({ session });
    await session.commitTransaction();

    return res.json({
      success: true,
      message: "Đã hủy đơn hàng và hoàn kho thành công",
      data: { order },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("CANCEL ORDER ERROR:", error);
    return handleError(res, error, "Lỗi hủy đơn hàng");
  } finally {
    session.endSession();
  }
};

export const issueVATInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { companyName, taxCode, companyAddress } = req.body;

    if (!companyName || !taxCode) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin công ty hoặc mã số thuế",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng",
      });
    }

    if (order.orderSource !== "IN_STORE") {
      return res.status(400).json({
        success: false,
        message: "Only in-store POS orders support VAT invoice issuance in this flow",
      });
    }

    assertOrderInActiveBranch(req, order);

    if (order.paymentStatus !== "PAID") {
      return res.status(400).json({
        success: false,
        message: "Chỉ xuất hóa đơn cho đơn đã thanh toán",
      });
    }

    if (order.vatInvoice?.invoiceNumber) {
      return res.status(400).json({
        success: false,
        message: "Đơn hàng đã có hóa đơn VAT",
      });
    }

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    const lastVAT = await Order.findOne({
      "vatInvoice.invoiceNumber": new RegExp(`^VAT${year}${month}`),
      "assignedStore.storeId": order.assignedStore.storeId,
    }).sort({ "vatInvoice.invoiceNumber": -1 });

    let seq = 1;
    if (lastVAT?.vatInvoice?.invoiceNumber) {
      const lastSeq = parseInt(lastVAT.vatInvoice.invoiceNumber.slice(-6), 10);
      if (!Number.isNaN(lastSeq)) {
        seq = lastSeq + 1;
      }
    }

    const invoiceNumber = `VAT${year}${month}${seq.toString().padStart(6, "0")}`;

    order.vatInvoice = {
      invoiceNumber,
      companyName,
      taxCode,
      companyAddress,
      issuedBy: req.user._id,
      issuedAt: new Date(),
    };

    await order.save();

    return res.json({
      success: true,
      message: "Xuat hoa don VAT thanh cong",
      data: { order },
    });
  } catch (error) {
    console.error("ISSUE VAT INVOICE ERROR:", error);
    return handleError(res, error, "Loi xuat hoa don");
  }
};

export const getPOSOrderHistory = async (req, res) => {
  try {
    const activeBranchId = ensureActiveBranchContext(req, { allowGlobalWithoutBranch: true });
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const { startDate, endDate, search } = req.query;

    const query = {
      orderSource: "IN_STORE",
    };
    if (activeBranchId) {
      query["assignedStore.storeId"] = activeBranchId;
    }

    if (canReadOwnPosOrders(req) && !canReadBranchPosOrders(req)) {
      query["posInfo.staffId"] = req.user._id;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: "i" } },
        { "posInfo.receiptNumber": { $regex: search, $options: "i" } },
        { "shippingAddress.fullName": { $regex: search, $options: "i" } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("posInfo.staffId", "fullName")
        .populate("items.variantId", "color storage sku images")
        .populate("items.productId", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        orders,
        pagination: {
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
        },
      },
    });
  } catch (error) {
    console.error("GET POS HISTORY ERROR:", error);
    return handleError(res, error, "Lỗi lấy lịch sử đơn hàng");
  }
};

export const getPOSStats = async (req, res) => {
  try {
    const activeBranchId = ensureActiveBranchContext(req, { allowGlobalWithoutBranch: true });
    const { startDate, endDate } = req.query;
    const userId = req.user._id;
    const query = {
      orderSource: "IN_STORE",
    };
    if (activeBranchId) {
      query["assignedStore.storeId"] = activeBranchId;
    }

    if (canProcessCashierPayments(req)) {
      query["posInfo.cashierId"] = userId;
    }

    if (canReadOwnPosOrders(req) && !canReadBranchPosOrders(req)) {
      query["posInfo.staffId"] = userId;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const allOrders = await Order.find(query).lean();

    const stats = {
      totalOrders: allOrders.length,
      totalRevenue: allOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0),
      totalVATInvoices: allOrders.filter((order) => order.vatInvoice?.invoiceNumber).length,
      paidOrders: allOrders.filter((order) => order.paymentStatus === "PAID").length,
      unpaidOrders: allOrders.filter((order) => order.paymentStatus === "UNPAID").length,
      pendingPayment: allOrders.filter((order) => order.status === "PENDING_PAYMENT").length,
      delivered: allOrders.filter((order) => order.status === "DELIVERED").length,
      cancelled: allOrders.filter((order) => order.status === "CANCELLED").length,
      avgOrderValue:
        allOrders.length > 0
          ? allOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0) / allOrders.length
          : 0,
      todayOrders: allOrders.filter((order) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const orderDate = new Date(order.createdAt);
        orderDate.setHours(0, 0, 0, 0);
        return orderDate.getTime() === today.getTime();
      }).length,
      todayRevenue: allOrders
        .filter((order) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const orderDate = new Date(order.createdAt);
          orderDate.setHours(0, 0, 0, 0);
          return orderDate.getTime() === today.getTime();
        })
        .reduce((sum, order) => sum + (order.totalAmount || 0), 0),
    };

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("GET POS STATS ERROR:", error);
    return handleError(res, error, "Loi lay thong ke");
  }
};

export default {
  createPOSOrder,
  getPendingOrders,
  getPOSOrderById,
  processPayment,
  cancelPendingOrder,
  issueVATInvoice,
  getPOSOrderHistory,
  getPOSStats,
  finalizePOSOrder,
};
