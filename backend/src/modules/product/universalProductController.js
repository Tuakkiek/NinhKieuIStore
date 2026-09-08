import mongoose from "mongoose";
import UniversalProduct, { UniversalVariant } from "./UniversalProduct.js";
import { getNextSku } from "../../lib/generateSKU.js";
import { normalizeAfterSalesInput } from "../device/afterSalesConfig.js";
import {
  PRODUCT_STATUSES,
  normalizeProductStatus,
} from "./productPricingConfig.js";
import {
  decorateProductForCommerce,
  PUBLIC_PRODUCT_STATUSES,
  recalculateProductAvailability,
  resolveVariantPricingSnapshot,
} from "./productPricingService.js";

const STOCK_CONTROL_OWNER_ROLE = "WAREHOUSE_MANAGER";

const createSlug = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

const createVariantSlug = (baseSlug, color, variantName) => {
  const colorSlug = createSlug(color);
  const nameSlug = createSlug(variantName);
  return [baseSlug, colorSlug, nameSlug].filter(Boolean).join("-");
};

const normalizeStockValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const hasVariantStockInput = (variantGroups = []) => {
  if (!Array.isArray(variantGroups) || variantGroups.length === 0) return false;

  for (const group of variantGroups) {
    const options = Array.isArray(group?.options) ? group.options : [];
    for (const opt of options) {
      if (!Object.prototype.hasOwnProperty.call(opt || {}, "stock")) continue;
      if (opt.stock === "" || opt.stock === null || opt.stock === undefined) continue;
      const parsed = Number(opt.stock);
      if (!Number.isFinite(parsed) || parsed !== 0) {
        return true;
      }
    }
  }

  return false;
};

const buildVariantKey = (color, variantName) =>
  `${String(color || "").trim().toLowerCase()}::${String(variantName || "")
    .trim()
    .toLowerCase()}`;

const RESERVED_VARIANT_FIELDS = new Set([
  "variantName",
  "basePrice",
  "originalPrice",
  "price",
  "sellingPrice",
  "costPrice",
  "stock",
  "sku",
  "slug",
]);

const extractVariantAttributes = (option = {}) => {
  if (!option || typeof option !== "object") return {};

  const attrs = {};
  for (const [key, value] of Object.entries(option)) {
    if (RESERVED_VARIANT_FIELDS.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    attrs[key] = value;
  }
  return attrs;
};

const deriveVariantName = (option = {}) => {
  const explicitName = String(option?.variantName || "").trim();
  if (explicitName) {
    // Clean up variant name - remove price if accidentally included
    // Common patterns: "256GB 22.990.000đ", "128GB - 15.000.000đ", etc.
    const cleanedName = explicitName
      .replace(/\d{1,3}(\.\d{3})*đ?\s*$/, "") // Remove trailing price like "22.990.000đ"
      .replace(/\s*[-–]\s*\d+(\.\d+)*\s*$/, "") // Remove trailing "- 15000000"
      .replace(/^\d+\s*(GB|TB)\s*/i, "$1") // Clean "256GB" if that's all there is
      .trim();
    return cleanedName || explicitName; // Fallback to original if cleanup resulted in empty
  }

  const fallbackParts = [
    option?.storage,
    option?.connectivity,
    option?.cpuGpu,
    option?.ram,
    option?.bandSize,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return fallbackParts.join(" - ");
};

const normalizeBasePrice = (option = {}) => {
  const candidates = [option.basePrice, option.originalPrice, option.price];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
};

const buildSortQuery = (sortBy = "") => {
  switch (String(sortBy || "").trim()) {
    case "oldest":
      return { createdAt: 1 };
    case "name-asc":
      return { name: 1, createdAt: -1 };
    case "name-desc":
      return { name: -1, createdAt: -1 };
    default:
      return { createdAt: -1 };
  }
};

const buildResponseProduct = (product) => {
  const decorated = decorateProductForCommerce(product);
  return {
    ...decorated,
    isUniversal: true,
    featuredImages: decorated.featuredImages?.length
      ? decorated.featuredImages
      : decorated.variants?.[0]?.images || [],
  };
};

const loadPopulatedProduct = (id) =>
  UniversalProduct.findById(id)
    .populate("variants")
    .populate("brand", "name logo website")
    .populate("productType", "name slug specFields afterSalesDefaults")
    .populate("createdBy", "fullName email");

export const create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { createVariants, variants, slug: frontendSlug, ...productData } = req.body;
    const variantGroups = createVariants || variants || [];
    const stockInputIgnored = hasVariantStockInput(variantGroups);

    if (!productData.name?.trim()) {
      throw new Error("Product name is required");
    }
    if (!productData.model?.trim()) {
      throw new Error("Model is required");
    }
    if (!productData.brand) {
      throw new Error("Brand is required");
    }
    if (!productData.productType) {
      throw new Error("Product type is required");
    }
    if (!productData.createdBy) {
      throw new Error("createdBy is required");
    }
    if (!Array.isArray(variantGroups) || variantGroups.length === 0) {
      throw new Error("At least one variant group is required");
    }

    const finalSlug = frontendSlug?.trim() || createSlug(productData.model.trim());
    if (!finalSlug) {
      throw new Error("Could not generate slug from model");
    }

    const existingBySlug = await UniversalProduct.findOne({
      $or: [{ slug: finalSlug }, { baseSlug: finalSlug }],
    }).session(session);
    if (existingBySlug) {
      throw new Error(`Slug already exists: ${finalSlug}`);
    }

    const product = new UniversalProduct({
      name: productData.name.trim(),
      model: productData.model.trim(),
      slug: finalSlug,
      baseSlug: finalSlug,
      description: productData.description?.trim() || "",
      brand: productData.brand,
      productType: productData.productType,
      specifications: productData.specifications || {},
      afterSalesConfig: normalizeAfterSalesInput(productData.afterSalesConfig || {}),
      condition: productData.condition || "NEW",
      lifecycleStage: "ACTIVE",
      status: PRODUCT_STATUSES.COMING_SOON,
      installmentBadge: productData.installmentBadge || "NONE",
      createdBy: productData.createdBy,
      featuredImages: productData.featuredImages || [],
      videoUrl: productData.videoUrl?.trim() || "",
      averageRating: 0,
      totalReviews: 0,
      salesCount: 0,
      variants: [],
    });

    await product.save({ session });

    const createdVariantIds = [];
    const seenVariantKeys = new Set();

    for (const group of variantGroups) {
      const { color, images = [], options = [] } = group || {};
      if (!color?.trim() || !Array.isArray(options) || options.length === 0) {
        continue;
      }

      for (const option of options) {
        const derivedVariantName = deriveVariantName(option);
        if (!derivedVariantName) continue;

        const variantKey = buildVariantKey(color, derivedVariantName);
        if (seenVariantKeys.has(variantKey)) {
          throw new Error(`Duplicate variant: ${color} / ${derivedVariantName}`);
        }
        seenVariantKeys.add(variantKey);

        const basePrice = normalizeBasePrice(option);
        const sku = await getNextSku();
        const variantSlug = createVariantSlug(finalSlug, color, derivedVariantName);

        const variantDoc = new UniversalVariant({
          productId: product._id,
          color: color.trim(),
          variantName: derivedVariantName,
          basePrice,
          originalPrice: basePrice,
          price: basePrice,
          stock: 0,
          images: images.filter((img) => img?.trim()),
          sku,
          slug: variantSlug,
          attributes: extractVariantAttributes(option),
        });

        await variantDoc.save({ session });
        createdVariantIds.push(variantDoc._id);
      }
    }

    if (createdVariantIds.length === 0) {
      throw new Error("No valid variants were created");
    }

    product.variants = createdVariantIds;
    await product.save({ session });

    await recalculateProductAvailability({
      productId: product._id,
      session,
    });

    await session.commitTransaction();

    const populated = await loadPopulatedProduct(product._id);
    const responsePayload = {
      success: true,
      message: "Product created successfully",
      data: { product: buildResponseProduct(populated) },
    };

    if (stockInputIgnored) {
      responsePayload.warning = `Stock input ignored. Inventory quantity is controlled by ${STOCK_CONTROL_OWNER_ROLE}.`;
    }

    res.status(201).json(responsePayload);
  } catch (error) {
    await session.abortTransaction();

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const value = error.keyValue[field];
      return res.status(400).json({
        success: false,
        message: `Duplicate ${field}: ${value}`,
      });
    }

    res.status(400).json({
      success: false,
      message: error.message || "Failed to create product",
    });
  } finally {
    session.endSession();
  }
};

export const update = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { createVariants, variants, slug: frontendSlug, ...data } = req.body;
    const variantGroups = createVariants || variants || [];
    const stockInputIgnored = hasVariantStockInput(variantGroups);

    const product = await UniversalProduct.findById(id).session(session);
    if (!product) throw new Error("Product not found");

    const existingVariants = await UniversalVariant.find({ productId: id }).session(session);
    const variantStateByKey = new Map();
    for (const item of existingVariants) {
      const snapshot = resolveVariantPricingSnapshot(item);
      variantStateByKey.set(buildVariantKey(item.color, item.variantName), {
        stock: normalizeStockValue(item.stock),
        sku: String(item.sku || ""),
        sellingPrice: snapshot.sellingPrice,
        costPrice: snapshot.costPrice,
      });
    }

    if (data.name) product.name = data.name.trim();
    if (data.model) product.model = data.model.trim();
    if (data.description !== undefined) {
      product.description = data.description?.trim() || "";
    }
    if (data.brand) product.brand = data.brand;
    if (data.productType) product.productType = data.productType;
    if (data.condition) product.condition = data.condition;
    if (data.status) {
      product.status = normalizeProductStatus(
        data.status,
        product.status || PRODUCT_STATUSES.COMING_SOON
      );
    }
    if (data.installmentBadge) product.installmentBadge = data.installmentBadge;
    if (data.featuredImages !== undefined) product.featuredImages = data.featuredImages;
    if (data.videoUrl !== undefined) product.videoUrl = data.videoUrl?.trim() || "";
    if (data.specifications !== undefined) product.specifications = data.specifications;
    if (data.afterSalesConfig !== undefined) {
      product.afterSalesConfig = normalizeAfterSalesInput(data.afterSalesConfig || {});
    }
    product.lifecycleStage = "ACTIVE";

    let newSlug = product.slug || product.baseSlug;
    if (data.model && data.model.trim() !== product.model) {
      newSlug = createSlug(data.model.trim());
    } else if (frontendSlug?.trim()) {
      newSlug = frontendSlug.trim();
    }

    if (newSlug !== (product.slug || product.baseSlug)) {
      const slugExists = await UniversalProduct.findOne({
        $or: [{ slug: newSlug }, { baseSlug: newSlug }],
        _id: { $ne: id },
      }).session(session);
      if (slugExists) {
        throw new Error(`Slug already exists: ${newSlug}`);
      }
      product.slug = newSlug;
      product.baseSlug = newSlug;
    }

    await product.save({ session });

    if (variantGroups.length > 0) {
      await UniversalVariant.deleteMany({ productId: id }, { session });

      const newIds = [];
      const seenVariantKeys = new Set();

      for (const group of variantGroups) {
        const { color, images = [], options = [] } = group || {};
        if (!color?.trim() || !options.length) continue;

        for (const option of options) {
          const derivedVariantName = deriveVariantName(option);
          if (!derivedVariantName) continue;

          const variantKey = buildVariantKey(color, derivedVariantName);
          if (seenVariantKeys.has(variantKey)) {
            throw new Error(`Duplicate variant: ${color} / ${derivedVariantName}`);
          }
          seenVariantKeys.add(variantKey);

          const previousVariantState = variantStateByKey.get(variantKey);
          const basePrice = normalizeBasePrice(option);
          const sku = previousVariantState?.sku || (await getNextSku());
          const variantSlug = createVariantSlug(
            product.baseSlug || product.slug,
            color,
            derivedVariantName
          );

          const variantDoc = new UniversalVariant({
            productId: id,
            color: color.trim(),
            variantName: derivedVariantName,
            basePrice,
            originalPrice: basePrice,
            price: previousVariantState?.sellingPrice || basePrice,
            sellingPrice: previousVariantState?.sellingPrice || basePrice,
            costPrice: previousVariantState?.costPrice || 0,
            stock: previousVariantState?.stock || 0,
            images: images.filter((img) => img?.trim()),
            sku,
            slug: variantSlug,
            attributes: extractVariantAttributes(option),
          });

          await variantDoc.save({ session });
          newIds.push(variantDoc._id);
        }
      }

      if (newIds.length === 0) {
        throw new Error("No valid variants were created");
      }

      product.variants = newIds;
      await product.save({ session });
    }

    await recalculateProductAvailability({
      productId: product._id,
      session,
    });

    await session.commitTransaction();

    const populated = await loadPopulatedProduct(id);
    const responsePayload = {
      success: true,
      message: "Product updated successfully",
      data: { product: buildResponseProduct(populated) },
    };

    if (stockInputIgnored) {
      responsePayload.warning = `Stock input ignored. Inventory quantity is controlled by ${STOCK_CONTROL_OWNER_ROLE}.`;
    }

    res.json(responsePayload);
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update product",
    });
  } finally {
    session.endSession();
  }
};

export const findAll = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, brand, productType, sortBy } =
      req.query;
    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.max(Number(limit) || 10, 1);
    const skipNum = (pageNum - 1) * limitNum;
    const sortQuery = buildSortQuery(sortBy);
    const isPublicRequest = !req.user;
    const isDev = process.env.NODE_ENV !== "production";

    const query = {};
    const publicStatuses = PUBLIC_PRODUCT_STATUSES;

    if (search) {
      const skuMatchedVariants = await UniversalVariant.find({
        sku: { $regex: search, $options: "i" },
      })
        .select("productId")
        .limit(200)
        .lean();
      const skuMatchedProductIds = [
        ...new Set(
          skuMatchedVariants
            .map((variant) => String(variant?.productId || ""))
            .filter(Boolean)
        ),
      ];

      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { model: { $regex: search, $options: "i" } },
        ...(skuMatchedProductIds.length > 0
          ? [{ _id: { $in: skuMatchedProductIds } }]
          : []),
      ];
    }

    if (status) {
      query.status = normalizeProductStatus(
        status,
        PRODUCT_STATUSES.OUT_OF_STOCK
      );
    } else if (isPublicRequest) {
      query.status = { $in: publicStatuses };
    }

    if (brand) query.brand = brand;
    if (productType) query.productType = productType;

    if (isDev) {
      console.log("[API][universal-products] findAll", {
        isPublicRequest,
        rawQuery: req.query,
        resolvedQuery: query,
        publicStatuses: isPublicRequest && !status ? publicStatuses : undefined,
      });
    }

    const [products, totalCount] = await Promise.all([
      UniversalProduct.find(query)
        .populate("variants")
        .populate("brand", "name logo")
        .populate("productType", "name slug afterSalesDefaults")
        .populate("createdBy", "fullName")
        .sort(sortQuery)
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      UniversalProduct.countDocuments(query),
    ]);

    if (isDev) {
      console.log("[API][universal-products] findAll result", {
        totalCount,
        returned: products.length,
      });
    }

    if (isDev && isPublicRequest && totalCount === 0) {
      const [
        allCount,
        statusSummary,
        statusSamples,
        countIn,
        countRegexExact,
        countRegexPrefix,
        statusLens,
      ] = await Promise.all([
        UniversalProduct.countDocuments({}),
        UniversalProduct.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        UniversalProduct.find({})
          .select("status")
          .limit(5)
          .lean(),
        UniversalProduct.countDocuments({ status: { $in: publicStatuses } }),
        UniversalProduct.countDocuments({ status: { $regex: /^available$/i } }),
        UniversalProduct.countDocuments({ status: { $regex: /^available/i } }),
        UniversalProduct.aggregate([
          {
            $project: {
              statusStr: { $toString: "$status" },
            },
          },
          {
            $group: {
              _id: "$statusStr",
              count: { $sum: 1 },
              len: { $first: { $strLenCP: "$statusStr" } },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
      ]);
      console.warn("[API][universal-products] public query returned 0", {
        allCount,
        statusSummary,
        publicStatuses,
        countIn,
        countRegexExact,
        countRegexPrefix,
        statusSamples,
        statusLens,
      });
    }

    return res.json({
      success: true,
      data: {
        products: products.map(buildResponseProduct),
        totalPages: Math.ceil(totalCount / limitNum),
        currentPage: pageNum,
        total: totalCount,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const findOne = async (req, res) => {
  try {
    const product = await loadPopulatedProduct(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({ success: true, data: { product: buildResponseProduct(product) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getProductDetail = async (req, res) => {
  try {
    const slug = req.params.id;
    const skuQuery = req.query.sku?.trim();

    let variant = await UniversalVariant.findOne({ slug });
    let product = null;

    if (variant) {
      product = await loadPopulatedProduct(variant.productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (skuQuery) {
        const variantBySku = product.variants.find((item) => item.sku === skuQuery);
        if (variantBySku) variant = variantBySku;
      }
    } else {
      product = await UniversalProduct.findOne({
        $or: [{ baseSlug: slug }, { slug }],
      })
        .populate("variants")
        .populate("brand", "name logo website")
        .populate("productType", "name slug specFields afterSalesDefaults")
        .populate("createdBy", "fullName email");

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      const variants = product.variants || [];
      variant = variants.find((item) => item.stock > 0) || variants[0];

      if (!variant) {
        return res.json({
          success: true,
          data: {
            product: buildResponseProduct(product),
            selectedVariantSku: null,
          },
        });
      }

      return res.json({
        success: true,
        redirect: true,
        redirectSlug: variant.slug,
        redirectSku: variant.sku,
        data: {
          product: buildResponseProduct(product),
          selectedVariantSku: variant.sku,
        },
      });
    }

    res.json({
      success: true,
      data: {
        product: buildResponseProduct(product),
        selectedVariantSku: variant?.sku || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

export const deleteProduct = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const product = await UniversalProduct.findById(req.params.id).session(session);
    if (!product) throw new Error("Product not found");

    await UniversalVariant.deleteMany({ productId: product._id }, { session });
    await product.deleteOne({ session });

    await session.commitTransaction();
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const getVariants = async (req, res) => {
  try {
    const variants = await UniversalVariant.find({
      productId: req.params.id,
    }).sort({ color: 1, variantName: 1 });

    res.json({
      success: true,
      data: {
        variants: variants.map((variant) => ({
          ...variant.toObject(),
          ...resolveVariantPricingSnapshot(variant),
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export default {
  create,
  update,
  findAll,
  findOne,
  getProductDetail,
  deleteProduct,
  getVariants,
};
