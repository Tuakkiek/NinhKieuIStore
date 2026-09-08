// ============================================
// FILE: backend/src/controllers/vnpayController.js
// ✅ FIXED: IPN now updates status correctly
// ✅ ADDED: Auto-generate invoice for online orders
// ============================================

import crypto from "crypto";
import qs from "qs";
import moment from "moment";
import Order from "../order/Order.js";

function sortObject(obj) {
  let sorted = {};
  let str = [];
  let key;
  for (key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      str.push(encodeURIComponent(key));
    }
  }
  str.sort();
  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(
      obj[decodeURIComponent(str[key])]
    ).replace(/%20/g, "+");
  }
  return sorted;
}

const appendStatusHistoryIfChanged = (order, status, updatedBy, note) => {
  if (!Array.isArray(order.statusHistory)) {
    order.statusHistory = [];
  }

  const latest = order.statusHistory[order.statusHistory.length - 1];
  const latestStatus = latest?.status;
  const latestNote = latest?.note;

  if (latestStatus === status && latestNote === note) {
    return;
  }

  order.statusHistory.push({
    status,
    updatedBy,
    updatedAt: new Date(),
    note,
  });
};

// ============================================
// CREATE PAYMENT URL
// ============================================
export const createPaymentUrl = async (req, res) => {
  console.log("\n=== CREATE VNPAY PAYMENT URL ===");
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  try {
    const { orderId, amount, orderDescription, bankCode, language } = req.body;

    if (!orderId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin đơn hàng hoặc số tiền không hợp lệ",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Đơn hàng không tồn tại",
      });
    }

    const orderOwnerId = order.customerId || order.userId;

    if (!orderOwnerId || orderOwnerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Không có quyền truy cập đơn hàng này",
      });
    }

    let ipAddr =
      req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "127.0.0.1";

    if (ipAddr.includes(",")) {
      ipAddr = ipAddr.split(",")[0].trim();
    }
    ipAddr = ipAddr.replace("::ffff:", "");

    const createDate = moment().format("YYYYMMDDHHmmss");
    const orderId_vnp = `${order._id}${moment().format("YYYYMMDDHHmmss")}`;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expireDate = moment(tomorrow).format("YYYYMMDDHHmmss");

    const returnUrl =
      process.env.VNP_RETURN_URL ||
      "http://localhost:5173/payment/vnpay/return";

    let vnp_Params = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: process.env.VNP_TMN_CODE,
      vnp_Locale: language || "vn",
      vnp_CurrCode: "VND",
      vnp_TxnRef: orderId_vnp,
      vnp_OrderInfo:
        orderDescription || `Thanh toán đơn hàng ${order.orderNumber}`,
      vnp_OrderType: "other",
      vnp_Amount: amount * 100,
      vnp_ReturnUrl: returnUrl,
      vnp_IpAddr: ipAddr,
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
    };

    if (bankCode && bankCode !== "") {
      vnp_Params["vnp_BankCode"] = bankCode;
    }

    vnp_Params = sortObject(vnp_Params);

    const signData = qs.stringify(vnp_Params, { encode: false });
    const hmac = crypto.createHmac("sha512", process.env.VNP_HASH_SECRET);
    const signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

    vnp_Params["vnp_SecureHash"] = signed;

    const vnpUrl =
      process.env.VNP_URL ||
      "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
    const paymentUrl =
      vnpUrl + "?" + qs.stringify(vnp_Params, { encode: false });

    order.paymentInfo = {
      ...order.paymentInfo,
      vnpayTxnRef: orderId_vnp,
      vnpayCreatedAt: new Date(),
    };
    await order.save();

    console.log("✅ Payment URL created successfully");

    res.json({
      success: true,
      data: { paymentUrl },
    });
  } catch (error) {
    console.error("❌ CREATE PAYMENT URL ERROR:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Lỗi khi tạo link thanh toán",
    });
  }
};

// ============================================
// IPN HANDLER - ✅ FIXED
// ============================================
export const vnpayIPN = async (req, res) => {
  console.log("\n=== VNPAY IPN RECEIVED ===");
  console.log("Query params:", JSON.stringify(req.query, null, 2));

  let vnp_Params = req.query;
  const secureHash = vnp_Params["vnp_SecureHash"];

  delete vnp_Params["vnp_SecureHash"];
  delete vnp_Params["vnp_SecureHashType"];

  vnp_Params = sortObject(vnp_Params);

  const signData = qs.stringify(vnp_Params, { encode: false });
  const hmac = crypto.createHmac("sha512", process.env.VNP_HASH_SECRET);
  const signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

  console.log("\n--- Hash Verification ---");
  console.log("Expected:", signed);
  console.log("Received:", secureHash);
  console.log("Match:", secureHash === signed ? "✅ YES" : "❌ NO");

  if (secureHash === signed) {
    const vnpTxnRef = vnp_Params["vnp_TxnRef"];
    const rspCode = vnp_Params["vnp_ResponseCode"];
    const amount = parseInt(vnp_Params["vnp_Amount"]) / 100;
    const transactionNo = vnp_Params["vnp_TransactionNo"];
    const bankCode = vnp_Params["vnp_BankCode"];
    const cardType = vnp_Params["vnp_CardType"];

    console.log("\n=== FINDING ORDER ===");
    console.log("vnp_TxnRef:", vnpTxnRef);

    const orderId = vnpTxnRef.substring(0, 24);
    const order = await Order.findOne({
      $or: [{ "paymentInfo.vnpayTxnRef": vnpTxnRef }, { _id: orderId }],
    });

    console.log("Found order:", order?._id);

    if (!order) {
      console.error("❌ Order not found");
      return res
        .status(200)
        .json({ RspCode: "01", Message: "Order not found" });
    }

    if (amount !== order.totalAmount) {
      console.error("❌ Amount mismatch");
      return res.status(200).json({ RspCode: "04", Message: "Invalid amount" });
    }

    // ✅ Payment success: mark paid and return order to waiting-for-processing queue
    if (rspCode === "00") {
      const alreadyProcessedSuccess =
        order.paymentStatus === "PAID" &&
        order.status === "PENDING" &&
        Boolean(order?.paymentInfo?.vnpayVerified);

      if (alreadyProcessedSuccess) {
        return res
          .status(200)
          .json({ RspCode: "00", Message: "Confirm Success" });
      }

      order.paymentStatus = "PAID";
      order.status = "PENDING";

      order.paymentInfo = {
        ...order.paymentInfo,
        vnpayTransactionNo: transactionNo,
        vnpayBankCode: bankCode,
        vnpayCardType: cardType,
        vnpayPaidAt: new Date(),
        vnpayVerified: true,
        vnpayVerifiedAt: new Date(),
        vnpayAmount: amount,
        vnpayResponseCode: rspCode,
      };

      appendStatusHistoryIfChanged(
        order,
        "PENDING",
        order.customerId || order.userId,
        `Thanh toán VNPay thành công - Mã giao dịch: ${transactionNo}. Đơn chờ xử lý.`
      );

      await order.save();

      // ✅ AUTO-GENERATE INVOICE
      try {
        await order.issueOnlineInvoice();
        console.log(
          "✅ Invoice auto-generated:",
          order.onlineInvoice?.invoiceNumber
        );
      } catch (invoiceError) {
        console.error("⚠️ Invoice generation failed:", invoiceError.message);
      }

      // ✅ XÓA GIỎ HÀNG SAU KHI THANH TOÁN THÀNH CÔNG
      try {
        const Cart = (await import("../cart/Cart.js")).default;
        const cart = await Cart.findOne({ customerId: order.customerId || order.userId });

        if (cart && cart.items.length > 0) {
          const selectedVariantIds = order.items.map((item) =>
            item.variantId.toString()
          );
          const beforeCount = cart.items.length;

          cart.items = cart.items.filter(
            (item) => !selectedVariantIds.includes(item.variantId.toString())
          );

          await cart.save();
          const removedCount = beforeCount - cart.items.length;
          console.log(
            `✅ Removed ${removedCount} items from cart after VNPay payment (${cart.items.length} remaining)`
          );
        } else {
          console.log("ℹ️ Cart is empty or not found");
        }
      } catch (cartErr) {
        console.error("⚠️ Failed to clean cart:", cartErr.message);
      }

      console.log("✅ Order updated successfully");
      return res
        .status(200)
        .json({ RspCode: "00", Message: "Confirm Success" });
    } else {
      // ❌ PAYMENT FAILED
      const alreadyProcessedFailure =
        order.paymentStatus === "FAILED" &&
        order.status === "PAYMENT_FAILED" &&
        String(order?.paymentInfo?.vnpayResponseCode || "") === String(rspCode);

      if (alreadyProcessedFailure) {
        return res
          .status(200)
          .json({ RspCode: "00", Message: "Confirm Success" });
      }

      order.paymentStatus = "FAILED";
      order.status = "PAYMENT_FAILED";
      order.paymentFailureAt = new Date();
      order.paymentFailureReason = `VNPAY_${rspCode}`;
      order.paymentInfo = {
        ...order.paymentInfo,
        vnpayFailed: true,
        vnpayFailReason: rspCode,
        vnpayResponseCode: rspCode,
      };

      appendStatusHistoryIfChanged(
        order,
        "PAYMENT_FAILED",
        order.customerId || order.userId,
        `Thanh toán VNPay thất bại - Mã lỗi: ${rspCode}.`
      );

      await order.save();

      // ✅ THÊM: XÓA GIỎ HÀNG SAU KHI THANH TOÁN THÀNH CÔNG
      try {
        const Cart = (await import("../cart/Cart.js")).default;
        const cart = await Cart.findOne({ customerId: order.customerId || order.userId });

        if (cart) {
          const selectedVariantIds = order.items.map((item) =>
            item.variantId.toString()
          );
          cart.items = cart.items.filter(
            (item) => !selectedVariantIds.includes(item.variantId.toString())
          );
          await cart.save();
          console.log(
            `✅ Removed ${order.items.length} items from cart after VNPay payment`
          );
        }
      } catch (cartErr) {
        console.error("⚠️ Failed to clean cart:", cartErr);
      }

      console.log("✅ Order updated successfully");

      console.log("❌ Payment failed with code:", rspCode);
      return res
        .status(200)
        .json({ RspCode: "00", Message: "Confirm Success" });
    }
  } else {
    console.error("❌ Invalid signature");
    return res
      .status(200)
      .json({ RspCode: "97", Message: "Invalid signature" });
  }
};

// RETURN URL
// ============================================
export const vnpayReturn = async (req, res) => {
  console.log("\n=== VNPAY RETURN URL ===");
  console.log("Query params:", JSON.stringify(req.query, null, 2));

  let vnp_Params = req.query;
  const secureHash = vnp_Params["vnp_SecureHash"];

  delete vnp_Params["vnp_SecureHash"];
  delete vnp_Params["vnp_SecureHashType"];

  vnp_Params = sortObject(vnp_Params);

  const signData = qs.stringify(vnp_Params, { encode: false });
  const hmac = crypto.createHmac("sha512", process.env.VNP_HASH_SECRET);
  const signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

  console.log("\n--- Return Hash Verification ---");
  console.log("Expected:", signed);
  console.log("Received:", secureHash);

  if (secureHash === signed) {
    const vnpTxnRef = vnp_Params["vnp_TxnRef"];
    const rspCode = vnp_Params["vnp_ResponseCode"];

    const orderId = vnpTxnRef.substring(0, 24);
    const order = await Order.findOne({
      $or: [{ "paymentInfo.vnpayTxnRef": vnpTxnRef }, { _id: orderId }],
    });

    const paymentVerified =
      order?.paymentInfo?.vnpayVerified || order?.paymentStatus === "PAID";

    res.json({
      success: rspCode === "00",
      code: rspCode,
      message:
        rspCode === "00"
          ? "Thanh toán thành công"
          : `Thanh toán thất bại - Mã lỗi: ${rspCode}`,
      orderId: order?._id,
      orderNumber: order?.orderNumber,
      orderStatus: order?.status,
      paymentStatus: order?.paymentStatus,
      paymentVerified: paymentVerified,
      totalAmount: order?.totalAmount,
      transactionNo: order?.paymentInfo?.vnpayTransactionNo,
      invoiceNumber: order?.onlineInvoice?.invoiceNumber, // ✅ NEW
    });
  } else {
    res.json({
      success: false,
      message: "Chữ ký không hợp lệ",
    });
  }
};


