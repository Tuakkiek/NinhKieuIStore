import mongoose from "mongoose";
import UniversalProduct from "../product/UniversalProduct.js";
import ProductType from "../productType/ProductType.js";
import {
  decorateProductForCommerce,
  PUBLIC_PRODUCT_STATUSES,
} from "../product/productPricingService.js";

const SYNONYM_MAP = {
  laptop: ["macbook", "mac", "may tinh xach tay"],
  "may tinh xach tay": ["macbook", "mac", "laptop"],
  macbook: ["mac", "laptop"],
  "tai nghe": ["airpods", "tai nghe bluetooth"],
  "tai phone": ["airpods", "tai nghe"],
  "day deo": ["strap", "day watch", "day apple watch"],
  strap: ["day deo", "day watch"],
  chuot: ["mouse", "magic mouse"],
  mouse: ["chuot", "magic mouse"],
  "ban phim": ["keyboard", "magic keyboard"],
  keyboard: ["ban phim"],
  sac: ["charger", "cu sac", "adapter"],
  "cu sac": ["sac", "charger", "adapter"],
  cap: ["cable", "day cap"],
  cable: ["cap", "day"],
  "op lung": ["case", "vo may"],
  case: ["op lung", "vo"],
  "may tinh bang": ["ipad", "tablet"],
  tablet: ["ipad", "may tinh bang"],
  "dong ho": ["apple watch", "watch"],
  "dong ho thong minh": ["apple watch", "smartwatch"],
  "dien thoai": ["iphone", "phone", "smartphone"],
  "di dong": ["iphone", "dien thoai"],
  phone: ["iphone", "dien thoai"],
};

const TYPO_MAP = {
  ipone: "iphone",
  ifone: "iphone",
  aiphon: "iphone",
  iphoen: "iphone",
  ipohne: "iphone",
  iapd: "ipad",
  iapad: "ipad",
  macbok: "macbook",
  macboo: "macbook",
  makbook: "macbook",
  aripod: "airpods",
  airpod: "airpods",
  "ari pod": "airpods",
  wach: "watch",
  wacth: "watch",
  watc: "watch",
  "op lung": "op lung",
  "ban phim": "ban phim",
};

const LEGACY_CATEGORY_TO_SLUG = {
  iphone: "smartphone",
  ipad: "tablet",
  mac: "laptop",
  airpods: "headphone",
  applewatch: "smartwatch",
  accessory: "accessories",
  accessories: "accessories",
  smartphone: "smartphone",
  tablet: "tablet",
  laptop: "laptop",
  headphone: "headphone",
  smartwatch: "smartwatch",
};

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

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeCategoryKey = (text) =>
  normalizeVietnamese(text).replace(/[\s_-]+/g, "");

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

const resolveProductTypeIds = async (categoryInput) => {
  if (!categoryInput) return null;

  if (mongoose.Types.ObjectId.isValid(categoryInput)) {
    return [categoryInput];
  }

  const normalizedKey = normalizeCategoryKey(categoryInput);
  const mappedSlug =
    LEGACY_CATEGORY_TO_SLUG[normalizedKey] ||
    normalizeVietnamese(categoryInput).replace(/\s+/g, "-");

  const docs = await ProductType.find({
    $or: [
      { slug: mappedSlug },
      { slug: normalizeVietnamese(categoryInput).replace(/\s+/g, "-") },
      { name: { $regex: new RegExp(`^${escapeRegex(categoryInput)}$`, "i") } },
    ],
  })
    .select("_id")
    .lean();

  return docs.map((doc) => doc._id);
};

const correctTypos = (query) => {
  let corrected = normalizeVietnamese(query);
  if (TYPO_MAP[corrected]) return TYPO_MAP[corrected];

  for (const [typo, value] of Object.entries(TYPO_MAP)) {
    corrected = corrected.replace(new RegExp(`\\b${typo}\\b`, "gi"), value);
  }

  return corrected;
};

const expandSynonyms = (query) => {
  const normalized = normalizeVietnamese(query);
  const terms = new Set([normalized]);

  for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
    const normalizedKey = normalizeVietnamese(key);
    if (!normalized.includes(normalizedKey)) continue;
    for (const synonym of synonyms) {
      const normSynonym = normalizeVietnamese(synonym);
      if (normSynonym && normSynonym !== normalizedKey) {
        terms.add(normSynonym);
      }
    }
  }

  return Array.from(terms);
};

const extractAttributes = (query) => {
  const normalized = normalizeVietnamese(query);
  const attributes = {
    storage: null,
    color: null,
    model: null,
  };

  const storageMatch = normalized.match(/(\d+)\s*(gb|tb)/i);
  if (storageMatch) {
    attributes.storage = `${storageMatch[1]}${storageMatch[2].toUpperCase()}`;
  }

  const colors = ["den", "trang", "xanh", "do", "hong", "tim", "vang", "bac", "gold"];
  for (const color of colors) {
    if (normalized.includes(color)) {
      attributes.color = color;
      break;
    }
  }

  const modelMatch = normalized.match(
    /(iphone|ip)\s*(\d+)\s*(pro\s*max|pro|plus|mini)?/i
  );
  if (modelMatch) {
    attributes.model = modelMatch[2];
    if (modelMatch[3]) {
      attributes.model += ` ${modelMatch[3].replace(/\s+/g, " ")}`;
    }
  }

  return attributes;
};

const calculateRelevance = (product, query, attributes) => {
  let score = 0;
  const normalizedQuery = normalizeVietnamese(query);
  const normalizedName = normalizeVietnamese(product.name);
  const normalizedModel = normalizeVietnamese(product.model);

  if (normalizedName === normalizedQuery || normalizedModel === normalizedQuery) {
    score += 100;
  }

  const queryWords = normalizedQuery.split(/\s+/);
  for (const word of queryWords) {
    const boundary = new RegExp(`\\b${word}\\b`, "i");

    if (boundary.test(normalizedName)) {
      score += 30;
      if (normalizedName.startsWith(word)) score += 15;
    } else if (normalizedName.includes(word)) {
      score += 15;
    }

    if (boundary.test(normalizedModel)) {
      score += 25;
    } else if (normalizedModel.includes(word)) {
      score += 10;
    }
  }

  if (
    attributes.storage &&
    normalizeVietnamese(String(product.specifications?.storage || "")).includes(
      normalizeVietnamese(attributes.storage)
    )
  ) {
    score += 20;
  }

  if (
    attributes.model &&
    normalizedModel.includes(normalizeVietnamese(attributes.model))
  ) {
    score += 25;
  }

  if (
    product.description &&
    normalizeVietnamese(product.description).includes(normalizedQuery)
  ) {
    score += 5;
  }

  if (product.salesCount > 0) {
    score += Math.min(product.salesCount / 10, 10);
  }

  if (product.variants?.some((v) => v.stock > 0)) {
    score += 5;
  }

  const daysSinceCreation =
    (Date.now() - new Date(product.createdAt)) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation <= 30) {
    score += 10;
  }

  return Math.min(score, 100);
};

export const search = async (req, res) => {
  try {
    const { q, limit = 20, category } = req.query;
    const parsedLimit = Math.max(1, parseInt(limit, 10) || 20);

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Query phai co it nhat 2 ky tu",
      });
    }

    const correctedQuery = correctTypos(q);
    const attributes = extractAttributes(correctedQuery);
    const expandedQueries = expandSynonyms(correctedQuery);
    const searchTerms = expandedQueries.join(" ");
    const baseQuery = {
      status: { $in: PUBLIC_PRODUCT_STATUSES },
    };

    if (category) {
      const productTypeIds = await resolveProductTypeIds(category);
      if (!productTypeIds.length) {
        return res.json({
          success: true,
          data: {
            query: q,
            correctedQuery: correctedQuery !== q ? correctedQuery : null,
            extractedAttributes: attributes,
            totalResults: 0,
            results: [],
          },
        });
      }
      baseQuery.productType = { $in: productTypeIds };
    }

    let products = await UniversalProduct.find(
      { ...baseQuery, $text: { $search: searchTerms } },
      { score: { $meta: "textScore" } }
    )
      .populate("variants")
      .populate("productType", "name slug")
      .sort({ score: { $meta: "textScore" } })
      .limit(parsedLimit * 2)
      .lean();

    if (!products.length) {
      const regexQuery = new RegExp(
        correctedQuery.split(/\s+/).map(escapeRegex).join("|"),
        "i"
      );

      products = await UniversalProduct.find({
        ...baseQuery,
        $or: [
          { name: regexQuery },
          { model: regexQuery },
          { description: regexQuery },
        ],
      })
        .populate("variants")
        .populate("productType", "name slug")
        .limit(parsedLimit)
        .lean();
    }

    const ranked = products
      .map((product) => {
        const commerceProduct = decorateProductForCommerce(product);
        return {
          ...commerceProduct,
          _category: getCategoryRoute(commerceProduct.productType),
          _relevance: calculateRelevance(commerceProduct, correctedQuery, attributes),
        };
      })
      .sort((a, b) => b._relevance - a._relevance);

    return res.json({
      success: true,
      data: {
        query: q,
        correctedQuery: correctedQuery !== q ? correctedQuery : null,
        extractedAttributes: attributes,
        totalResults: ranked.length,
        results: ranked.slice(0, parsedLimit),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi khi tìm kiếm",
      error: error.message,
    });
  }
};

export const autocomplete = async (req, res) => {
  try {
    const { q, limit = 5, category } = req.query;
    const parsedLimit = Math.max(1, parseInt(limit, 10) || 5);

    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        data: { suggestions: [] },
      });
    }

    const correctedQuery = correctTypos(q);
    const normalized = normalizeVietnamese(correctedQuery);
    const baseQuery = {
      status: { $in: PUBLIC_PRODUCT_STATUSES },
    };

    if (category) {
      const productTypeIds = await resolveProductTypeIds(category);
      if (!productTypeIds.length) {
        return res.json({
          success: true,
          data: {
            query: q,
            suggestions: [],
          },
        });
      }
      baseQuery.productType = { $in: productTypeIds };
    }

    const products = await UniversalProduct.find({
      ...baseQuery,
      $or: [
        { name: new RegExp(`^${escapeRegex(normalized)}`, "i") },
        { model: new RegExp(`^${escapeRegex(normalized)}`, "i") },
      ],
    })
      .select("name model productType")
      .populate("productType", "name slug")
      .limit(parsedLimit * 3)
      .lean();

    const suggestions = [
      ...new Map(
        products.map((product) => [
          product.name,
          {
            text: product.name,
            model: product.model,
            category: getCategoryRoute(product.productType),
          },
        ])
      ).values(),
    ].slice(0, parsedLimit);

    return res.json({
      success: true,
      data: {
        query: q,
        suggestions,
      },
    });
  } catch (error) {
    console.error("Autocomplete error:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi khi lấy gợi ý",
    });
  }
};

export default { search, autocomplete };
