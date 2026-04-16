// controllers/promotionController.js
import Promotion from "./Promotion.js";
import PromotionUsage from "./PromotionUsage.js";
import mongoose from "mongoose";
import { AUTHZ_ACTIONS } from "../../authz/actions.js";


export const getAllPromotions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      search = "",
      discountType = "",
      status = "",              // ACTIVE, UPCOMING, EXPIRED
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;
    const now = new Date();

    // === XÂY DỰNG FILTER ===
    const filter = {};

    if (search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: "i" } },
        { code: { $regex: search.trim(), $options: "i" } },
      ];
    }

    if (discountType && ["PERCENTAGE", "FIXED"].includes(discountType)) {
      filter.discountType = discountType;
    }

    // === LỌC THEO TRẠNG THÁI – CHUẨN NHẤT ===
    if (status && ["ACTIVE", "UPCOMING", "EXPIRED"].includes(status)) {
      if (status === "ACTIVE") {
        filter.isActive = true;
        filter.startDate = { $lte: now };
        filter.endDate = { $gte: now };
        // usedCount < usageLimit implicitly handled if needed, but let's keep it consistent
        filter.$expr = { $lt: ["$usedCount", "$usageLimit"] };
      } else if (status === "UPCOMING") {
        filter.startDate = { $gt: now };
        filter.isActive = true; // Typically upcoming ones are active but just not started
      } else if (status === "EXPIRED") {
        filter.$or = [
          { endDate: { $lt: now } },
          { $expr: { $gte: ["$usedCount", "$usageLimit"] } },
          { isActive: false },
        ];
      }
    }

    console.log("getAllPromotions filter:", JSON.stringify(filter));

    // === QUERY ===
    const [total, promotions] = await Promise.all([
      Promotion.countDocuments(filter),
      Promotion.find(filter)
        .populate("createdBy", "fullName email")
        .select("-__v")
        .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    // === XỬ LÝ TRẠNG THÁI + DISPLAY ===
    const processedPromotions = promotions.map((p) => {
      const isUpcoming = new Date(p.startDate) > now;
      const isExpired = new Date(p.endDate) < now || p.usedCount >= p.usageLimit;
      const isActive = p.isActive && !isExpired && !isUpcoming;

      let _status = "EXPIRED";
      if (isUpcoming) _status = "UPCOMING";
      else if (isActive) _status = "ACTIVE";

      const usagePercent = p.usageLimit > 0
        ? Math.min(100, Math.round((p.usedCount / p.usageLimit) * 100))
        : 0;

      return {
        ...p,
        _status,
        usagePercent,
        displayText: p.discountType === "PERCENTAGE"
          ? `${p.discountValue}%${p.maxDiscountAmount ? ` (tối đa ${p.maxDiscountAmount.toLocaleString()}₫)` : ""}`
          : `${p.discountValue.toLocaleString()}₫`,
      };
    });

    res.json({
      success: true,
      data: {
        promotions: processedPromotions,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          total,
          limit: limitNum,
        },
      },
    });
  } catch (error) {
    console.error("getAllPromotions error:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};
/* ========================================
   2. LẤY MÃ ĐANG HOẠT ĐỘNG (PUBLIC)
   ======================================== */
export const getActivePromotions = async (req, res) => {
  try {
    const now = new Date();

    const promotions = await Promotion.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      $expr: { $lt: ["$usedCount", "$usageLimit"] },
    })
      .select(
        "name code discountType discountValue maxDiscountAmount minOrderValue usageLimit usedCount endDate"
      )
      .sort({ endDate: 1 });

    const data = promotions.map((p) => ({
      ...p.toObject(),
      displayText: p.getDisplayText(),
    }));

    res.json({ success: true, data: { promotions: data } });
  } catch (error) {
    console.error("getActivePromotions error:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống" });
  }
};

/* ========================================
   3. TẠO MÃ KHUYẾN MÃI
   ======================================== */
export const createPromotion = async (req, res) => {
  try {
    const {
      name,
      code,
      discountType,
      discountValue,
      maxDiscountAmount,
      startDate,
      endDate,
      usageLimit,
      minOrderValue = 0,
      isActive = true,
    } = req.body;

    // Validate cơ bản
    if (!code?.trim()) return res.status(400).json({ success: false, message: "Mã code là bắt buộc" });
    if (!["PERCENTAGE", "FIXED"].includes(discountType)) {
      return res.status(400).json({ success: false, message: "Loại giảm giá không hợp lệ" });
    }

    const val = Number(discountValue);
    if (!Number.isFinite(val) || val <= 0 || (discountType === "PERCENTAGE" && val > 100)) {
      return res.status(400).json({ success: false, message: "Giá trị giảm không hợp lệ" });
    }

    if (!usageLimit || usageLimit < 1) {
      return res.status(400).json({ success: false, message: "Giới hạn lượt dùng phải ≥ 1" });
    }

    // Xử lý maxDiscountAmount
    let maxVal = null;
    if (discountType === "PERCENTAGE" && maxDiscountAmount !== undefined) {
      maxVal = Number(maxDiscountAmount);
      if (!Number.isFinite(maxVal) || maxVal < 0) {
        return res.status(400).json({ success: false, message: "Số tiền giảm tối đa không hợp lệ" });
      }
    }

    const normalizedCode = code.toUpperCase().trim();
    const existing = await Promotion.findOne({ code: normalizedCode });
    if (existing) {
      return res.status(400).json({ success: false, message: "Mã code đã tồn tại" });
    }

    const promotion = await Promotion.create({
      name: name?.trim(),
      code: normalizedCode,
      discountType,
      discountValue: val,
      maxDiscountAmount: maxVal,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      usageLimit: Number(usageLimit),
      minOrderValue: Number(minOrderValue),
      isActive: Boolean(isActive),
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Tạo mã khuyến mãi thành công",
      data: { promotion },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Mã code đã tồn tại" });
    }
    console.error("createPromotion error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ========================================
   4. CẬP NHẬT MÃ
   ======================================== */
export const updatePromotion = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const promotion = await Promotion.findById(id);
    if (!promotion) {
      return res.status(404).json({ success: false, message: "Không tìm thấy mã khuyến mãi" });
    }

    // Không cho sửa code nếu đã dùng
    if (updates.code && updates.code.toUpperCase().trim() !== promotion.code) {
      const hasBeenUsed = await PromotionUsage.exists({ promotion: id });
      if (hasBeenUsed) {
        return res.status(400).json({ success: false, message: "Không thể thay đổi mã đã được sử dụng" });
      }
      updates.code = updates.code.toUpperCase().trim();
    }

    // Validate discountValue
    if (updates.discountValue !== undefined) {
      const val = Number(updates.discountValue);
      const type = updates.discountType || promotion.discountType;
      if (!Number.isFinite(val) || val <= 0 || (type === "PERCENTAGE" && val > 100)) {
        return res.status(400).json({ success: false, message: "Giá trị giảm không hợp lệ" });
      }
      updates.discountValue = val;
    }

    // Validate maxDiscountAmount
    if (updates.maxDiscountAmount !== undefined) {
      const type = updates.discountType || promotion.discountType;
      if (type === "PERCENTAGE") {
        const maxVal = Number(updates.maxDiscountAmount);
        if (!Number.isFinite(maxVal) || maxVal < 0) {
          return res.status(400).json({ success: false, message: "Số tiền giảm tối đa không hợp lệ" });
        }
        updates.maxDiscountAmount = maxVal;
      } else {
        updates.maxDiscountAmount = null;
      }
    }

    if (updates.isActive !== undefined) {
      updates.isActive = Boolean(updates.isActive);
    }

    Object.assign(promotion, updates);
    await promotion.save();

    res.json({
      success: true,
      message: "Cập nhật mã khuyến mãi thành công",
      data: { promotion },
    });
  } catch (error) {
    console.error("updatePromotion error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ========================================
   5. XÓA MÃ
   ======================================== */
export const deletePromotion = async (req, res) => {
  try {
    const { id } = req.params;
    const promotion = await Promotion.findById(id);
    if (!promotion) {
      return res.status(404).json({ success: false, message: "Không tìm thấy mã khuyến mãi" });
    }

    const hasUsage = await PromotionUsage.exists({ promotion: id });
    if (hasUsage) {
      return res.status(400).json({ success: false, message: "Không thể xóa mã đã được sử dụng" });
    }

    await Promotion.findByIdAndDelete(id);
    res.json({ success: true, message: "Xóa mã khuyến mãi thành công" });
  } catch (error) {
    console.error("deletePromotion error:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống" });
  }
};

/* ========================================
   6. ÁP DỤNG MÃ – CHỈ CUSTOMER MỚI BỊ GIỚI HẠN & LƯU LỊCH SỬ
   (Phiên bản chính thức – bắt buộc đăng nhập)
   ======================================== */
export const applyPromotion = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { code, totalAmount, orderId } = req.body;
    const userId = req.user._id;
    const isCustomerFlow = !req.authz?.permissions?.has(AUTHZ_ACTIONS.PROMOTION_MANAGE);

    // === Validate input ===
    if (!code?.trim()) {
      return res.status(400).json({ success: false, message: "Mã khuyến mãi là bắt buộc" });
      await session.abortTransaction();
      return;
    }

    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      res.status(400).json({ success: false, message: "Tổng tiền không hợp lệ" });
      await session.abortTransaction();
      return;
    }

    const normalizedCode = code.toUpperCase().trim();

    const promotion = await Promotion.findOne({ code: normalizedCode }).session(session);

    if (!promotion) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Mã khuyến mãi không tồn tại" });
    }

    // === Kiểm tra điều kiện áp dụng mã (chung cho mọi role) ===
    if (!promotion.canBeUsed(totalAmount)) {
      await session.abortTransaction();
      const reasons = [];
      if (!promotion.isActive) reasons.push("đã bị tắt");
      const now = new Date();
      if (now < promotion.startDate) reasons.push("chưa bắt đầu");
      if (now > promotion.endDate) reasons.push("đã hết hạn");
      if (promotion.usedCount >= promotion.usageLimit) reasons.push("hết lượt sử dụng");
      if (totalAmount < promotion.minOrderValue) {
        reasons.push(`đơn tối thiểu ${promotion.minOrderValue.toLocaleString()}₫`);
      }

      return res.status(400).json({
        success: false,
        message: `Mã không khả dụng: ${reasons.join(", ")}`,
      });
    }

    const isCustomer = isCustomerFlow;
 
    // === CHỈ CUSTOMER MỚI KIỂM TRA ĐÃ DÙNG CHƯA (XEM TRƯỚC) ===
    if (isCustomer) {
      // Kiểm tra đã dùng chưa
      const alreadyUsed = await PromotionUsage.findOne({
        promotion: promotion._id,
        user: userId,
      }).session(session);
 
      if (alreadyUsed) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Bạn đã sử dụng mã khuyến mãi này rồi!",
        });
      }
      // Note: We NO LONGER increment usage or create Usage record here.
      // That is now handled transactionally in createOrder.
    }
 
    // === Tính toán giảm giá (dùng cho cả customer và staff) ===
    const finalDiscountedTotal = promotion.applyDiscount(totalAmount);
    const finalDiscountAmount = totalAmount - finalDiscountedTotal;

    // Commit transaction
    await session.commitTransaction();

    // === Trả về kết quả ===
    return res.json({
      success: true,
      message: isCustomer
        ? "Áp dụng mã khuyến mãi thành công!"
        : "Áp dụng mã thành công (chế độ xem trước)",
      data: {
        discountAmount: finalDiscountAmount,
        discountedTotal: finalDiscountedTotal,
        code: promotion.code,
        name: promotion.name,
        displayText: promotion.getDisplayText(),
        isPreviewMode: !isCustomer,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("applyPromotion error:", error);
    return res.status(500).json({ success: false, message: "Lỗi hệ thống, vui lòng thử lại" });
  } finally {
    session.endSession();
  }
};

/* ========================================
   7 & 8. LỊCH SỬ SỬ DỤNG (giữ nguyên – đã ổn)
   ======================================== */
export const getPromotionUsageHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const usages = await PromotionUsage.find({ promotion: id })
      .populate("user", "fullName email phone")
      .populate("promotion", "code name")
      .populate("order", "orderNumber totalAmount status")
      .select("user promotion order orderTotal discountAmount snapshot usedAt createdAt")
      .sort({ usedAt: -1 });

    res.json({ success: true, data: { usages, total: usages.length } });
  } catch (error) {
    console.error("getPromotionUsageHistory error:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống" });
  }
};

export const getMyPromotionUsage = async (req, res) => {
  try {
    const userId = req.user._id;
    const usages = await PromotionUsage.find({ user: userId })
      .populate("promotion", "code name discountType discountValue maxDiscountAmount endDate")
      .populate("order", "orderNumber totalAmount status")
      .select("promotion order orderTotal discountAmount snapshot usedAt")
      .sort({ usedAt: -1 });

    res.json({
      success: true,
      data: {
        usages,
        total: usages.length,
        message: usages.length ? null : "Bạn chưa sử dụng mã khuyến mãi nào",
      },
    });
  } catch (error) {
    console.error("getMyPromotionUsage error:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống" });
  }
};
