import mongoose from "mongoose";
import UniversalProduct from "../product/UniversalProduct.js";
import {
  decorateProductForCommerce,
  PUBLIC_PRODUCT_STATUSES,
} from "../product/productPricingService.js";

const CATEGORY_ROUTE_MAP = {
  smartphone: "dien-thoai",
  tablet: "may-tinh-bang",
  laptop: "macbook",
  headphone: "tai-nghe",
  smartwatch: "apple-watch",
  accessories: "phu-kien",
};

const normalizeVietnamese = (text) => {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

const getCategoryRoute = (productType) => {
  const slug = normalizeVietnamese(productType?.slug || "").replace(
    /\s+/g,
    "-"
  );
  const nameSlug = normalizeVietnamese(productType?.name || "").replace(
    /\s+/g,
    "-"
  );
  return CATEGORY_ROUTE_MAP[slug] || CATEGORY_ROUTE_MAP[nameSlug] || "san-pham";
};

const findProductById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return UniversalProduct.findById(id)
    .populate("productType", "name slug")
    .lean();
};

export const getRelatedProducts = async (req, res) => {
  try {
    const product = await findProductById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm",
      });
    }

    const query = {
      _id: { $ne: product._id },
      status: { $in: PUBLIC_PRODUCT_STATUSES },
    };

    if (product.productType?._id) {
      query.productType = product.productType._id;
    }

    if (product.condition) {
      query.condition = product.condition;
    }

    const products = await UniversalProduct.find(query)
      .populate("variants")
      .populate("productType", "name slug")
      .sort({ averageRating: -1, salesCount: -1, createdAt: -1 })
      .limit(4)
      .lean();

    const normalized = products.map((item) => {
      const commerceProduct = decorateProductForCommerce(item);
      const variants = Array.isArray(commerceProduct.variants)
        ? commerceProduct.variants
        : [];
      const prices = variants
        .map((variant) => Number(variant.sellingPrice ?? variant.price))
        .filter((price) => Number.isFinite(price));
      const originalPrices = variants
        .map((variant) => Number(variant.basePrice ?? variant.originalPrice))
        .filter((price) => Number.isFinite(price));
      const costPrices = variants
        .map((variant) => Number(variant.costPrice))
        .filter((price) => Number.isFinite(price));

      const minPrice = prices.length ? Math.min(...prices) : 0;
      const minOriginalPrice = originalPrices.length
        ? Math.min(...originalPrices)
        : minPrice;
      const minCostPrice = costPrices.length ? Math.min(...costPrices) : 0;
      const images =
        commerceProduct.featuredImages?.length > 0
          ? commerceProduct.featuredImages
          : variants[0]?.images || [];

      return {
        _id: commerceProduct._id,
        name: commerceProduct.name,
        model: commerceProduct.model,
        category: commerceProduct.productType?.name || "",
        categoryRoute: getCategoryRoute(commerceProduct.productType),
        images,
        price: minPrice,
        originalPrice: minOriginalPrice,
        sellingPrice: minPrice,
        basePrice: minOriginalPrice,
        costPrice: minCostPrice,
        averageRating: commerceProduct.averageRating || 0,
        totalReviews: commerceProduct.totalReviews || 0,
        variants,
        baseSlug: commerceProduct.baseSlug || commerceProduct.slug,
        installmentBadge: commerceProduct.installmentBadge || "NONE",
        canPurchase: commerceProduct.canPurchase,
        availabilityState: commerceProduct.availabilityState,
      };
    });

    res.json({
      success: true,
      data: { products: normalized },
    });
  } catch (error) {
    console.error("Error getting related products:", error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export default {
  getRelatedProducts,
};
