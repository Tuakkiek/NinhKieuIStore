import mongoose from "mongoose";
import StockTransfer from "./StockTransfer.js";
import Store from "../store/Store.js";
import StoreInventory from "./StoreInventory.js";
import StockMovement from "../warehouse/StockMovement.js";
import Inventory from "../warehouse/Inventory.js";
import WarehouseLocation from "../warehouse/WarehouseLocation.js";

const TRANSFER_EDITABLE_STATUSES = new Set(["CREATED"]);
const PHYSICAL_WAREHOUSE_STORE_ID = "67ab23743c72b2ff5432c256";

const getActorName = (user) =>
  user?.fullName?.trim() || user?.name?.trim() || user?.email?.trim() || "Unknown";

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeSku = (value) => String(value || "").trim();

const getAllowedBranchIds = (req) =>
  Array.isArray(req?.authz?.allowedBranchIds)
    ? req.authz.allowedBranchIds.map((branchId) => String(branchId)).filter(Boolean)
    : [];

const isGlobalAdminRequest = (req) => Boolean(req?.authz?.isGlobalAdmin);

const hasTransferAccess = (req, transfer) => {
  if (isGlobalAdminRequest(req)) return true;

  const allowedBranches = getAllowedBranchIds(req);
  const fromStoreId = String(transfer?.fromStore?.storeId || "");
  const toStoreId = String(transfer?.toStore?.storeId || "");

  return allowedBranches.includes(fromStoreId) || allowedBranches.includes(toStoreId);
};

const ensureTransferAccess = (req, transfer) => {
  if (!hasTransferAccess(req, transfer)) {
    throw new Error("AUTHZ_BRANCH_FORBIDDEN: Ban khong duoc xem transfer nay");
  }
};

const buildTransferAccessFilter = (req) => {
  if (isGlobalAdminRequest(req)) return {};

  const allowedBranches = getAllowedBranchIds(req);
  if (allowedBranches.length === 0) {
    return { _id: { $exists: false } };
  }

  return {
    $or: [
      { "fromStore.storeId": { $in: allowedBranches } },
      { "toStore.storeId": { $in: allowedBranches } },
    ],
  };
};

const ensureStore = async (storeId, session) => {
  const store = await Store.findById(storeId)
    .select("_id code name status type")
    .session(session);

  if (!store) {
    throw new Error(`Khong tim thay cua hang: ${storeId}`);
  }
  if (store.status !== "ACTIVE") {
    throw new Error(`Cua hang ${store.code} khong o trang thai ACTIVE`);
  }

  return store;
};

const getTransferForRead = async (transferId) =>
  StockTransfer.findById(transferId)
    .populate("requestedBy", "fullName email role")
    .populate("approvedBy", "fullName email role")
    .populate("rejectedBy", "fullName email role")
    .populate("shippedBy", "fullName email role")
    .populate("receivedBy", "fullName email role");

const buildInventoryFilter = ({ storeId, item }) => {
  const filter = {
    storeId,
    variantSku: item.variantSku,
  };

  if (item.productId) {
    filter.productId = item.productId;
  }

  return filter;
};

const isWarehouseStore = (store = {}) => {
  const storeCode = String(store?.storeCode || "");
  const storeId = String(store?.storeId || "");
  return storeCode.startsWith("WH") || storeId === PHYSICAL_WAREHOUSE_STORE_ID;
};

const syncPhysicalSourceInventoryOnReceipt = async ({
  transfer,
  item,
  quantity,
  session,
}) => {
  if (!isWarehouseStore(transfer.fromStore) || quantity <= 0) return;

  let remainingQtyToPick = quantity;
  const query = {
    storeId: transfer.fromStore.storeId,
    sku: item.variantSku,
    locationCode: { $regex: new RegExp(`^${transfer.fromStore.storeCode}-`) },
    quantity: { $gt: 0 },
  };

  const physicalInventories = await Inventory.find(query)
    .sort({ quantity: -1 })
    .session(session);

  for (const inventory of physicalInventories) {
    if (remainingQtyToPick <= 0) break;

    const pickQty = Math.min(Number(inventory.quantity) || 0, remainingQtyToPick);
    inventory.quantity -= pickQty;
    remainingQtyToPick -= pickQty;

    if (inventory.quantity === 0) {
      await Inventory.deleteOne({ _id: inventory._id }).session(session);
    } else {
      await inventory.save({ session });
    }

    const location = await WarehouseLocation.findById(inventory.locationId).session(session);
    if (location) {
      location.currentLoad = Math.max(0, (location.currentLoad || 0) - pickQty);
      await location.save({ session });
    }
  }

  if (remainingQtyToPick > 0) {
    console.warn( // eslint-disable-line no-console
      `[StockTransfer] Metadata mismatch for ${transfer.transferNumber} ${item.variantSku}: missing ${remainingQtyToPick} units in physical source inventory.`
    );
  }
};

const syncPhysicalDestinationInventoryOnReceipt = async ({
  transfer,
  item,
  quantity,
  session,
}) => {
  if (!isWarehouseStore(transfer.toStore) || quantity <= 0) return;

  const targetLocation = await WarehouseLocation.findOne({
    storeId: transfer.toStore.storeId,
    locationCode: { $regex: `^${transfer.toStore.storeCode}-` },
    status: "ACTIVE",
  }).session(session);

  if (!targetLocation) {
    const warnMsg = `[CANH BAO] Khong tim thay vi tri kho vat ly cho SKU ${item.variantSku} tai ${transfer.toStore.storeCode}.`;
    console.warn(`[StockTransfer] ${warnMsg}`); // eslint-disable-line no-console
    transfer.receivingNotes = [transfer.receivingNotes, warnMsg].filter(Boolean).join(" | ");
    return;
  }

  let physicalInventory = await Inventory.findOne({
    storeId: transfer.toStore.storeId,
    sku: item.variantSku,
    locationId: targetLocation._id,
  }).session(session);

  if (physicalInventory) {
    physicalInventory.quantity += quantity;
    physicalInventory.lastReceived = new Date();
    await physicalInventory.save({ session });
  } else {
    physicalInventory = new Inventory({
      storeId: transfer.toStore.storeId,
      sku: item.variantSku,
      productId: item.productId,
      productName: item.name || item.variantSku,
      locationId: targetLocation._id,
      locationCode: targetLocation.locationCode,
      quantity,
      status: "GOOD",
      lastReceived: new Date(),
    });
    await physicalInventory.save({ session });
  }

  targetLocation.currentLoad = (targetLocation.currentLoad || 0) + quantity;
  await targetLocation.save({ session });
};

const validateTransferItemsForRequest = async ({
  fromStoreId,
  rawItems,
  session,
}) => {
  const normalizedItems = [];
  const skuSet = new Set();

  for (const rawItem of rawItems) {
    const sku = normalizeSku(rawItem.variantSku || rawItem.sku);
    if (sku && skuSet.has(sku)) {
      throw new Error(`SKU trung lap trong danh sach yeu cau: ${sku}`);
    }
    if (sku) skuSet.add(sku);
  }

  for (const rawItem of rawItems) {
    const variantSku = normalizeSku(rawItem.variantSku || rawItem.sku);
    const requestedQuantity = toPositiveInteger(
      rawItem.requestedQuantity || rawItem.quantity
    );

    if (!variantSku || !requestedQuantity) {
      throw new Error("Thong tin item transfer khong hop le");
    }

    const inventoryFilter = {
      storeId: fromStoreId,
      variantSku,
    };

    if (rawItem.productId) {
      inventoryFilter.productId = rawItem.productId;
    }

    const sourceInventory = await StoreInventory.findOne(inventoryFilter)
      .populate("productId", "name")
      .session(session)
      .setOptions({ skipBranchIsolation: true });

    if (!sourceInventory) {
      throw new Error(`Khong tim thay ton kho nguon cho SKU ${variantSku}`);
    }

    const available = Number(sourceInventory.available) || 0;
    if (available < requestedQuantity) {
      throw new Error(
        `Khong du ton kha dung cho SKU ${variantSku}. Available: ${available}`
      );
    }

    normalizedItems.push({
      productId: sourceInventory.productId?._id || sourceInventory.productId,
      variantSku,
      name:
        rawItem.name ||
        rawItem.productName ||
        sourceInventory.productId?.name ||
        variantSku,
      image: rawItem.image || "",
      requestedQuantity,
      approvedQuantity: 0,
      receivedQuantity: 0,
      confirmedQuantity: 0,
      condition: rawItem.condition || "NEW",
    });
  }

  if (normalizedItems.length === 0) {
    throw new Error("Danh sach item transfer trong");
  }

  return normalizedItems;
};

export const requestTransfer = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!isGlobalAdminRequest(req)) {
      throw new Error("AUTHZ_FORBIDDEN: Only Global Admin can create transfer requests");
    }

    const { fromStoreId, toStoreId, items, reason, notes } = req.body;

    if (!fromStoreId || !toStoreId) {
      throw new Error("Thieu thong tin cua hang nguon/dich");
    }
    if (String(fromStoreId) === String(toStoreId)) {
      throw new Error("Cua hang nguon va dich khong duoc trung nhau");
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Danh sach item transfer khong hop le");
    }
    if (!reason) {
      throw new Error("Ly do transfer la bat buoc");
    }

    const fromStore = await ensureStore(fromStoreId, session);
    const toStore = await ensureStore(toStoreId, session);

    const normalizedItems = await validateTransferItemsForRequest({
      fromStoreId,
      rawItems: items,
      session,
    });

    const transfer = await StockTransfer.create(
      [
        {
          fromStore: {
            storeId: fromStore._id,
            storeName: fromStore.name,
            storeCode: fromStore.code,
          },
          toStore: {
            storeId: toStore._id,
            storeName: toStore.name,
            storeCode: toStore.code,
          },
          items: normalizedItems,
          reason,
          notes: String(notes || "").trim(),
          status: "CREATED",
          requestedBy: req.user._id,
          requestedAt: new Date(),
        },
      ],
      { session }
    );

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      transfer: transfer[0],
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({
      success: false,
      message: error.message || "Khong the tao yeu cau transfer",
    });
  } finally {
    session.endSession();
  }
};

export const getTransfers = async (req, res) => {
  try {
    const {
      status,
      fromStoreId,
      toStoreId,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {
      ...buildTransferAccessFilter(req),
    };

    if (status) filter.status = String(status).trim().toUpperCase();
    if (fromStoreId) filter["fromStore.storeId"] = fromStoreId;
    if (toStoreId) filter["toStore.storeId"] = toStoreId;
    if (search) {
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { transferNumber: { $regex: search, $options: "i" } },
            { "items.variantSku": { $regex: search, $options: "i" } },
          ],
        },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [transfers, total] = await Promise.all([
      StockTransfer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("requestedBy", "fullName role")
        .populate("approvedBy", "fullName role")
        .populate("receivedBy", "fullName role")
        .lean(),
      StockTransfer.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      transfers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Khong the lay danh sach transfer",
    });
  }
};

export const getTransferById = async (req, res) => {
  try {
    const transfer = await getTransferForRead(req.params.id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Khong tim thay transfer",
      });
    }

    ensureTransferAccess(req, transfer);

    return res.json({
      success: true,
      transfer,
    });
  } catch (error) {
    const isForbidden = String(error.message || "").startsWith("AUTHZ_BRANCH_FORBIDDEN");
    return res.status(isForbidden ? 403 : 500).json({
      success: false,
      message: error.message || "Khong the lay chi tiet transfer",
    });
  }
};

export const approveTransfer = async (req, res) =>
  res.status(410).json({
    success: false,
    code: "ENDPOINT_DEPRECATED",
    message:
      "approveTransfer is no longer used. Global Admin creates transfers with auto-validation. Source branch uses confirmShipment.",
  });

export const rejectTransfer = async (req, res) =>
  res.status(410).json({
    success: false,
    code: "ENDPOINT_DEPRECATED",
    message: "rejectTransfer is no longer used.",
  });

export const confirmShipment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const transfer = await StockTransfer.findById(req.params.id).session(session);
    if (!transfer) {
      throw new Error("Khong tim thay transfer");
    }
    if (transfer.status !== "CREATED") {
      throw new Error(
        `Chi transfer CREATED moi co the xac nhan gui hang. Hien tai: ${transfer.status}`
      );
    }

    const allowedBranches = getAllowedBranchIds(req);
    if (
      !isGlobalAdminRequest(req) &&
      !allowedBranches.includes(String(transfer.fromStore.storeId))
    ) {
      throw new Error("AUTHZ_BRANCH_FORBIDDEN: Ban khong quan ly kho nguon");
    }

    transfer.status = "IN_TRANSIT";
    transfer.shippedBy = req.user._id;
    transfer.shippedAt = new Date();
    transfer.trackingNumber = String(req.body.trackingNumber || "").trim();
    transfer.carrier = String(req.body.carrier || "").trim();
    transfer.estimatedDelivery = req.body.estimatedDelivery || transfer.estimatedDelivery;
    await transfer.save({ session });

    await session.commitTransaction();

    const refreshed = await getTransferForRead(transfer._id);
    return res.json({
      success: true,
      transfer: refreshed,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({
      success: false,
      message: error.message || "Khong the xac nhan gui hang",
    });
  } finally {
    session.endSession();
  }
};

export const confirmReceived = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const transfer = await StockTransfer.findById(req.params.id).session(session);
    if (!transfer) {
      throw new Error("Khong tim thay transfer");
    }
    if (transfer.status !== "IN_TRANSIT") {
      throw new Error(
        `Chi transfer IN_TRANSIT moi co the xac nhan nhan. Hien tai: ${transfer.status}`
      );
    }

    const allowedBranches = getAllowedBranchIds(req);
    if (
      !isGlobalAdminRequest(req) &&
      !allowedBranches.includes(String(transfer.toStore.storeId))
    ) {
      throw new Error("AUTHZ_BRANCH_FORBIDDEN: Ban khong quan ly kho dich");
    }

    const actorName = getActorName(req.user);
    let totalMoved = 0;

    for (const item of transfer.items) {
      const requestedQty = Number(item.requestedQuantity) || 0;
      if (requestedQty <= 0) continue;

      const sourceInventory = await StoreInventory.findOne(
        buildInventoryFilter({ storeId: transfer.fromStore.storeId, item })
      )
        .session(session)
        .setOptions({ skipBranchIsolation: true });

      if (!sourceInventory) {
        throw new Error(`Khong tim thay ton kho nguon cho SKU ${item.variantSku}`);
      }

      const sourceQty = Number(sourceInventory.quantity) || 0;
      if (sourceQty < requestedQty) {
        throw new Error(
          `Khong du ton kho nguon cho SKU ${item.variantSku}. Hien co: ${sourceQty}, Can: ${requestedQty}`
        );
      }

      sourceInventory.quantity = sourceQty - requestedQty;
      await sourceInventory.save({ session });

      await syncPhysicalSourceInventoryOnReceipt({
        transfer,
        item,
        quantity: requestedQty,
        session,
      });

      let destinationInventory = await StoreInventory.findOne(
        buildInventoryFilter({ storeId: transfer.toStore.storeId, item })
      )
        .session(session)
        .setOptions({ skipBranchIsolation: true });

      if (!destinationInventory) {
        destinationInventory = new StoreInventory({
          storeId: transfer.toStore.storeId,
          productId: item.productId || sourceInventory.productId,
          variantSku: item.variantSku,
          quantity: 0,
          reserved: 0,
        });
      }

      destinationInventory.quantity =
        (Number(destinationInventory.quantity) || 0) + requestedQty;
      destinationInventory.lastRestockDate = new Date();
      destinationInventory.lastRestockQuantity = requestedQty;
      await destinationInventory.save({ session });

      await syncPhysicalDestinationInventoryOnReceipt({
        transfer,
        item: {
          ...item.toObject(),
          productId: item.productId || sourceInventory.productId,
        },
        quantity: requestedQty,
        session,
      });

      await StockMovement.create(
        [
          {
            storeId: transfer.toStore.storeId,
            type: "TRANSFER",
            sku: item.variantSku,
            productId: item.productId || sourceInventory.productId,
            productName: item.name || item.variantSku,
            fromLocationCode: transfer.fromStore.storeCode,
            toLocationCode: transfer.toStore.storeCode,
            quantity: requestedQty,
            referenceType: "TRANSFER",
            referenceId: transfer.transferNumber,
            performedBy: req.user._id,
            performedByName: actorName,
            notes: `Transfer confirmed received: ${transfer.transferNumber}`,
          },
        ],
        { session }
      );

      item.receivedQuantity = requestedQty;
      item.confirmedQuantity = requestedQty;
      totalMoved += requestedQty;
    }

    if (totalMoved <= 0) {
      throw new Error("Khong co san pham nao duoc xac nhan");
    }

    transfer.status = "COMPLETED";
    transfer.receivedBy = req.user._id;
    transfer.receivedAt = new Date();
    transfer.receivingNotes = [
      String(req.body.notes || "").trim(),
      transfer.receivingNotes,
    ]
      .filter(Boolean)
      .join(" | ");
    transfer.discrepancies = [];
    await transfer.save({ session });

    await session.commitTransaction();

    const refreshed = await getTransferForRead(transfer._id);
    return res.json({
      success: true,
      transfer: refreshed,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({
      success: false,
      message: error.message || "Khong the xac nhan nhan transfer",
    });
  } finally {
    session.endSession();
  }
};

export const cancelTransfer = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!isGlobalAdminRequest(req)) {
      throw new Error("AUTHZ_FORBIDDEN: Only Global Admin can cancel transfers");
    }

    const transfer = await StockTransfer.findById(req.params.id).session(session);
    if (!transfer) {
      throw new Error("Khong tim thay transfer");
    }
    if (!TRANSFER_EDITABLE_STATUSES.has(transfer.status)) {
      throw new Error("Chi transfer CREATED moi duoc huy");
    }

    transfer.status = "CANCELLED";
    transfer.notes = [transfer.notes, String(req.body.reason || "").trim()]
      .filter(Boolean)
      .join(" | ");
    await transfer.save({ session });

    await session.commitTransaction();

    const refreshed = await getTransferForRead(transfer._id);
    return res.json({
      success: true,
      transfer: refreshed,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({
      success: false,
      message: error.message || "Khong the huy transfer",
    });
  } finally {
    session.endSession();
  }
};

export default {
  requestTransfer,
  getTransfers,
  getTransferById,
  approveTransfer,
  rejectTransfer,
  confirmShipment,
  confirmReceived,
  cancelTransfer,
};
