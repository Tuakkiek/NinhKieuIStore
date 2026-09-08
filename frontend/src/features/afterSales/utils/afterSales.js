const TRACKING_MODES = Object.freeze({
  NONE: "NONE",
  SERIALIZED: "SERIALIZED",
});

const WARRANTY_PROVIDERS = Object.freeze({
  BRAND: "BRAND",
  STORE: "STORE",
});

const IDENTIFIER_POLICIES = Object.freeze({
  NONE: "NONE",
  IMEI: "IMEI",
  SERIAL: "SERIAL",
  IMEI_OR_SERIAL: "IMEI_OR_SERIAL",
  IMEI_AND_SERIAL: "IMEI_AND_SERIAL",
});

const DEFAULT_AFTER_SALES_BY_PRODUCT_TYPE = Object.freeze({
  SMARTPHONE: {
    trackingMode: TRACKING_MODES.SERIALIZED,
    identifierPolicy: IDENTIFIER_POLICIES.IMEI,
    warrantyMonths: 12,
  },
  TABLET: {
    trackingMode: TRACKING_MODES.SERIALIZED,
    identifierPolicy: IDENTIFIER_POLICIES.SERIAL,
    warrantyMonths: 12,
  },
  LAPTOP: {
    trackingMode: TRACKING_MODES.SERIALIZED,
    identifierPolicy: IDENTIFIER_POLICIES.SERIAL,
    warrantyMonths: 12,
  },
  SMARTWATCH: {
    trackingMode: TRACKING_MODES.SERIALIZED,
    identifierPolicy: IDENTIFIER_POLICIES.SERIAL,
    warrantyMonths: 12,
  },
  HEADPHONE: {
    trackingMode: TRACKING_MODES.NONE,
    identifierPolicy: IDENTIFIER_POLICIES.NONE,
    warrantyMonths: 12,
  },
  ACCESSORIES: {
    trackingMode: TRACKING_MODES.NONE,
    identifierPolicy: IDENTIFIER_POLICIES.NONE,
    warrantyMonths: 0,
  },
});

const normalizeKey = (value) => String(value || "").trim().toUpperCase();

const pickValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
};

const getDefaultWarrantyProvider = (condition = "") =>
  normalizeKey(condition) === "NEW"
    ? WARRANTY_PROVIDERS.BRAND
    : WARRANTY_PROVIDERS.STORE;

export const resolveAfterSalesConfig = (product = {}) => {
  const productConfig = product?.afterSalesConfig || {};
  const productTypeDefaults = product?.productType?.afterSalesDefaults || {};
  const namedDefaults =
    DEFAULT_AFTER_SALES_BY_PRODUCT_TYPE[normalizeKey(product?.productType?.name)] || {};

  const warrantyProvider = pickValue(
    productConfig.warrantyProvider,
    productTypeDefaults.warrantyProvider,
    getDefaultWarrantyProvider(product?.condition)
  );

  const trackingMode =
    warrantyProvider === WARRANTY_PROVIDERS.STORE
      ? pickValue(
          productConfig.trackingMode,
          productTypeDefaults.trackingMode,
          namedDefaults.trackingMode,
          TRACKING_MODES.NONE
        )
      : TRACKING_MODES.NONE;

  const identifierPolicy =
    warrantyProvider === WARRANTY_PROVIDERS.STORE
      ? pickValue(
          productConfig.identifierPolicy,
          productTypeDefaults.identifierPolicy,
          namedDefaults.identifierPolicy,
          IDENTIFIER_POLICIES.NONE
        )
      : IDENTIFIER_POLICIES.NONE;

  return {
    warrantyProvider,
    trackingMode,
    identifierPolicy,
    warrantyMonths:
      Number(
        pickValue(
          productConfig.warrantyMonths,
          productTypeDefaults.warrantyMonths,
          namedDefaults.warrantyMonths,
          0
        )
      ) || 0,
    warrantyTerms: pickValue(
      productConfig.warrantyTerms,
      productTypeDefaults.warrantyTerms,
      namedDefaults.warrantyTerms,
      ""
    ),
  };
};

export const isSerializedProduct = (product = {}) => {
  const config = resolveAfterSalesConfig(product);
  return (
    config.warrantyProvider === WARRANTY_PROVIDERS.STORE &&
    config.trackingMode === TRACKING_MODES.SERIALIZED
  );
};

export const formatWarrantyDuration = (months = 0) => {
  const normalizedMonths = Number(months) || 0;
  if (normalizedMonths <= 0) return "Theo chính sách của cửa hàng";
  if (normalizedMonths < 12) return `${normalizedMonths} thang`;
  const years = Math.floor(normalizedMonths / 12);
  const remainingMonths = normalizedMonths % 12;
  if (!remainingMonths) return `${years} nam`;
  return `${years} nam ${remainingMonths} thang`;
};

export const formatIdentifierPolicy = (policy = "IMEI_OR_SERIAL") => {
  switch (policy) {
    case IDENTIFIER_POLICIES.NONE:
      return "Không yêu cầu mã định danh";
    case IDENTIFIER_POLICIES.IMEI:
      return "IMEI";
    case IDENTIFIER_POLICIES.SERIAL:
      return "Serial Number";
    case IDENTIFIER_POLICIES.IMEI_AND_SERIAL:
      return "IMEI va Serial Number";
    default:
      return "IMEI hoac Serial Number";
  }
};

export const formatWarrantyProvider = (provider = WARRANTY_PROVIDERS.BRAND) =>
  normalizeKey(provider) === WARRANTY_PROVIDERS.STORE
    ? "Bảo hành cửa hàng"
    : "Bảo hành hãng";

export { IDENTIFIER_POLICIES, TRACKING_MODES, WARRANTY_PROVIDERS };
