import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

import Order from "../modules/order/Order.js";
import { UniversalVariant } from "../modules/product/UniversalProduct.js";
import Inventory from "../modules/warehouse/Inventory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

// Bypass branch isolation plugin for one-time maintenance.
const SKIP_BRANCH_ISOLATION = { skipBranchIsolation: true };
const BATCH_SIZE = 300;

const normalizeText = (value) => String(value || "").trim();

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (value?._id) return String(value._id).trim();
  return String(value).trim();
};

const hasValue = (value) => normalizeText(value).length > 0;

const SKU_PATHS = ["variantSku", "sku", "variant.sku", "snapshot.variantSku"];
const VARIANT_ID_PATHS = ["variantId", "variant._id", "variant.id"];
const PRODUCT_ID_PATHS = ["productId", "product._id", "product.id"];

const getByPath = (obj, pathKey) => {
  if (!obj || !pathKey) return undefined;
  return pathKey.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
};

const setByPath = (obj, pathKey, value) => {
  if (!obj || !pathKey) return;
  const parts = pathKey.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
};

const detectFirstValuePath = (item, candidatePaths = []) => {
  for (const pathKey of candidatePaths) {
    if (hasValue(getByPath(item, pathKey))) return pathKey;
  }
  return "";
};

const detectExistingPath = (item, candidatePaths = []) => {
  for (const pathKey of candidatePaths) {
    if (getByPath(item, pathKey) !== undefined) return pathKey;
  }
  return "";
};

const getItemSkuValue = (item) => {
  const foundPath = detectFirstValuePath(item, SKU_PATHS);
  return { path: foundPath, value: foundPath ? normalizeText(getByPath(item, foundPath)) : "" };
};

const getItemVariantId = (item) => {
  const foundPath = detectFirstValuePath(item, VARIANT_ID_PATHS);
  return { path: foundPath, value: foundPath ? normalizeId(getByPath(item, foundPath)) : "" };
};

const getItemProductId = (item) => {
  const foundPath = detectFirstValuePath(item, PRODUCT_ID_PATHS);
  return { path: foundPath, value: foundPath ? normalizeId(getByPath(item, foundPath)) : "" };
};

const getSkuWriteTargetPath = (item) =>
  detectExistingPath(item, ["variantSku", "sku", "variant.sku", "snapshot.variantSku"]) ||
  "variantSku";

const printUsage = () => {
  console.log(`
Usage:
  node src/scripts/backfill-order-variant-sku.js [--apply] [--limit=<number>]

Options:
  --apply          Apply updates to database (default: dry-run only)
  --limit=<n>      Scan at most n orders that match filter
  --help           Show this help
`);
};

const parseLimitArg = () => {
  const raw = process.argv.find((arg) => arg.startsWith("--limit="));
  if (!raw) return 0;

  const value = Number(raw.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --limit value: ${raw}`);
  }

  return Math.floor(value);
};

const createSkuResolver = () => {
  const variantByIdCache = new Map();
  const inventoryByProductCache = new Map();

  const resolveByVariantId = async (variantId) => {
    const normalizedVariantId = normalizeId(variantId);
    if (!normalizedVariantId) {
      return { sku: "", reason: "VARIANT_ID_MISSING" };
    }

    if (variantByIdCache.has(normalizedVariantId)) {
      return variantByIdCache.get(normalizedVariantId);
    }

    const variant = await UniversalVariant.findById(normalizedVariantId)
      .select("sku")
      .lean();
    const result = hasValue(variant?.sku)
      ? { sku: normalizeText(variant.sku), reason: "" }
      : { sku: "", reason: "VARIANT_BY_ID_NOT_FOUND" };

    variantByIdCache.set(normalizedVariantId, result);
    return result;
  };

  const resolveByUniqueInventoryProduct = async (productId) => {
    const normalizedProductId = normalizeId(productId);
    if (!normalizedProductId) {
      return { sku: "", reason: "PRODUCT_ID_MISSING" };
    }

    if (inventoryByProductCache.has(normalizedProductId)) {
      return inventoryByProductCache.get(normalizedProductId);
    }

    const rows = await Inventory.find(
      { productId: normalizedProductId },
      { sku: 1 },
      SKIP_BRANCH_ISOLATION
    )
      .limit(10)
      .lean();
    const skus = Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .map((row) => normalizeText(row?.sku))
          .filter(Boolean)
      )
    );

    let result = { sku: "", reason: "INVENTORY_BY_PRODUCT_NOT_FOUND" };
    if (skus.length === 1) {
      result = { sku: skus[0], reason: "" };
    } else if (skus.length > 1) {
      result = { sku: "", reason: "INVENTORY_BY_PRODUCT_AMBIGUOUS" };
    }

    inventoryByProductCache.set(normalizedProductId, result);
    return result;
  };

  const resolveSku = async ({ item }) => {
    const reasonTrail = [];
    const variantIdRef = getItemVariantId(item);
    const productIdRef = getItemProductId(item);

    const byVariantId = await resolveByVariantId(variantIdRef.value);
    if (byVariantId.sku) {
      return { sku: byVariantId.sku, source: "VARIANT_ID", reason: "" };
    }
    if (byVariantId.reason) {
      reasonTrail.push(byVariantId.reason);
    }

    const byInventoryProduct = await resolveByUniqueInventoryProduct(productIdRef.value);
    if (byInventoryProduct.sku) {
      return { sku: byInventoryProduct.sku, source: "PRODUCT_ID_UNIQUE_INVENTORY", reason: "" };
    }
    if (byInventoryProduct.reason) {
      reasonTrail.push(byInventoryProduct.reason);
    }

    return {
      sku: "",
      source: "UNRESOLVED",
      reason: reasonTrail[reasonTrail.length - 1] || "SKU_UNRESOLVED",
      reasonTrail,
    };
  };

  return { resolveSku };
};

const run = async () => {
  if (process.argv.includes("--help")) {
    printUsage();
    return;
  }

  const apply = process.argv.includes("--apply");
  const limit = parseLimitArg();
  const dryRun = !apply;

  const mongoUri = process.env.MONGODB_CONNECTIONSTRING;
  if (!mongoUri) {
    throw new Error("Missing MONGODB_CONNECTIONSTRING");
  }

  await mongoose.connect(mongoUri);
  console.log("[backfill-order-variant-sku] MongoDB connected");

  const startedAt = Date.now();
  // Intentionally broad so we never silently miss legacy SKU path shapes.
  const filter = {
    $or: [
      { items: { $exists: true, $ne: [] } },
      { orderItems: { $exists: true, $ne: [] } },
    ],
  };

  const projection = {
    _id: 1,
    orderNumber: 1,
    assignedStore: 1,
    items: 1,
    orderItems: 1,
  };

  const resolver = createSkuResolver();
  const sourceStats = new Map();
  const reasonStats = new Map();
  const skuPathStats = new Map();
  const variantIdPathStats = new Map();
  const productIdPathStats = new Map();
  const sampleItemStructures = [];

  const stats = {
    totalOrdersInCollection: 0,
    matchedOrdersByQuery: 0,
    scannedOrders: 0,
    scannedItems: 0,
    candidateItems: 0,
    updatedOrdersPlanned: 0,
    updatedOrdersPersisted: 0,
    backfilledItems: 0,
    unresolvedItems: 0,
    skippedItems: 0,
  };

  stats.totalOrdersInCollection = await Order.countDocuments({});
  stats.matchedOrdersByQuery = await Order.countDocuments(filter);
  console.log(
    `[debug] totalOrdersInCollection=${stats.totalOrdersInCollection} matchedOrdersByQuery=${stats.matchedOrdersByQuery}`
  );

  const matchedSamples = await Order.find(
    filter,
    { _id: 1, orderNumber: 1, items: { $slice: 2 }, orderItems: { $slice: 2 } }
  )
    .sort({ _id: -1 })
    .limit(2)
    .lean();
  if (matchedSamples.length > 0) {
    console.log("[debug] sample orders in scan scope:");
    for (const sample of matchedSamples) {
      console.log(
        JSON.stringify(
          {
            _id: String(sample._id),
            orderNumber: sample.orderNumber || "",
            itemsCount: Array.isArray(sample.items) ? sample.items.length : 0,
            orderItemsCount: Array.isArray(sample.orderItems)
              ? sample.orderItems.length
              : 0,
            item0: Array.isArray(sample.items) ? sample.items[0] || null : null,
            orderItem0: Array.isArray(sample.orderItems)
              ? sample.orderItems[0] || null
              : null,
          },
          null,
          2
        )
      );
    }
  } else {
    console.log("[debug] no orders found in scan scope");
  }

  let operations = [];
  const flushOperations = async () => {
    if (operations.length === 0 || dryRun) {
      operations = [];
      return;
    }

    const result = await Order.bulkWrite(operations, { ordered: false });
    stats.updatedOrdersPersisted += result.modifiedCount || 0;
    operations = [];
  };

  let query = Order.find(filter, projection).sort({ _id: 1 }).lean();
  if (limit > 0) {
    query = query.limit(limit);
  }
  const cursor = query.cursor();

  for await (const order of cursor) {
    stats.scannedOrders += 1;
    const rawItems = Array.isArray(order?.items)
      ? order.items
      : Array.isArray(order?.orderItems)
        ? order.orderItems
        : [];
    if (rawItems.length === 0) {
      continue;
    }

    let orderChanged = false;
    const patchedItems = [];

    for (let index = 0; index < rawItems.length; index += 1) {
      const item = rawItems[index] || {};
      const nextItem = { ...item };
      const skuRef = getItemSkuValue(nextItem);
      const variantIdRef = getItemVariantId(nextItem);
      const productIdRef = getItemProductId(nextItem);
      skuPathStats.set(skuRef.path || "MISSING", (skuPathStats.get(skuRef.path || "MISSING") || 0) + 1);
      variantIdPathStats.set(
        variantIdRef.path || "MISSING",
        (variantIdPathStats.get(variantIdRef.path || "MISSING") || 0) + 1
      );
      productIdPathStats.set(
        productIdRef.path || "MISSING",
        (productIdPathStats.get(productIdRef.path || "MISSING") || 0) + 1
      );
      if (sampleItemStructures.length < 5) {
        sampleItemStructures.push({
          order: order.orderNumber || String(order._id),
          itemIndex: index,
          keys: Object.keys(nextItem),
          preview: nextItem,
        });
      }

      stats.scannedItems += 1;
      if (hasValue(skuRef.value)) {
        patchedItems.push(nextItem);
        continue;
      }

      stats.candidateItems += 1;

      const resolution = await resolver.resolveSku({
        item: nextItem,
      });

      if (resolution.sku) {
        const skuWritePath = getSkuWriteTargetPath(nextItem);
        setByPath(nextItem, skuWritePath, resolution.sku);
        if (skuWritePath !== "variantSku" && !hasValue(nextItem.variantSku)) {
          // Keep canonical field populated for downstream pick/finalize code.
          nextItem.variantSku = resolution.sku;
        }
        orderChanged = true;
        stats.backfilledItems += 1;
        sourceStats.set(resolution.source, (sourceStats.get(resolution.source) || 0) + 1);
        console.log(
          `[सफल] order=${order.orderNumber || order._id} itemIndex=${index} skuPath=${skuWritePath} variantSku=${resolution.sku} source=${resolution.source}`
        );
      } else {
        stats.unresolvedItems += 1;
        stats.skippedItems += 1;
        const reasonKey = resolution.reason || "SKU_UNRESOLVED";
        reasonStats.set(reasonKey, (reasonStats.get(reasonKey) || 0) + 1);
        console.log(
          `[skipped] order=${order.orderNumber || order._id} itemIndex=${index} reason=${reasonKey} productId=${productIdRef.value || "N/A"} variantId=${variantIdRef.value || "N/A"}`
        );
      }

      patchedItems.push(nextItem);
    }

    if (!orderChanged) {
      continue;
    }

    stats.updatedOrdersPlanned += 1;
    if (!dryRun) {
      operations.push({
        updateOne: {
          filter: { _id: order._id },
          update: {
            $set: Array.isArray(order?.items)
              ? { items: patchedItems }
              : { orderItems: patchedItems },
          },
        },
      });
    }

    if (!dryRun && operations.length >= BATCH_SIZE) {
      await flushOperations();
    }
  }

  await flushOperations();

  const durationMs = Date.now() - startedAt;
  console.log("\n==================== Summary ====================");
  console.log(`[backfill-order-variant-sku] dryRun=${dryRun} limit=${limit || "none"}`);
  console.log(`[backfill-order-variant-sku] totalOrdersInCollection=${stats.totalOrdersInCollection}`);
  console.log(`[backfill-order-variant-sku] matchedOrdersByQuery=${stats.matchedOrdersByQuery}`);
  console.log(`[backfill-order-variant-sku] totalProcessedOrders=${stats.scannedOrders}`);
  console.log(`[backfill-order-variant-sku] totalProcessedItems=${stats.scannedItems}`);
  console.log(`[backfill-order-variant-sku] missingVariantSkuItems=${stats.candidateItems}`);
  console.log(`[backfill-order-variant-sku] updatedItems=${stats.backfilledItems}`);
  console.log(`[backfill-order-variant-sku] skippedItems=${stats.skippedItems}`);
  console.log(`[backfill-order-variant-sku] updatedOrdersPlanned=${stats.updatedOrdersPlanned}`);
  console.log(
    `[backfill-order-variant-sku] updatedOrdersPersisted=${
      dryRun ? 0 : stats.updatedOrdersPersisted
    }`
  );
  console.log(`[backfill-order-variant-sku] unresolvedItems=${stats.unresolvedItems}`);
  console.log(`[backfill-order-variant-sku] durationMs=${durationMs}`);

  if (sourceStats.size > 0) {
    console.log("[backfill-order-variant-sku] source breakdown:");
    for (const [source, count] of sourceStats.entries()) {
      console.log(`  - ${source}: ${count}`);
    }
  }

  if (reasonStats.size > 0) {
    console.log("[backfill-order-variant-sku] unresolved reasons:");
    for (const [reason, count] of reasonStats.entries()) {
      console.log(`  - ${reason}: ${count}`);
    }
  }

  console.log("[debug] detected schema path counts:");
  console.log(`  sku paths: ${JSON.stringify(Object.fromEntries(skuPathStats), null, 2)}`);
  console.log(
    `  variantId paths: ${JSON.stringify(Object.fromEntries(variantIdPathStats), null, 2)}`
  );
  console.log(
    `  productId paths: ${JSON.stringify(Object.fromEntries(productIdPathStats), null, 2)}`
  );
  if (sampleItemStructures.length > 0) {
    console.log("[debug] sample item structures:");
    for (const sample of sampleItemStructures) {
      console.log(JSON.stringify(sample, null, 2));
    }
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("[backfill-order-variant-sku] Failed:", error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
