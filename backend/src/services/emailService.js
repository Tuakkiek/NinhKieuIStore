/**
 * emailService.js
 * ───────────────────────────────────────────────────────────────────
 * Centralized email delivery service.
 * - Validates SMTP config at startup (throws clearly if misconfigured)
 * - No silent console-only fallback in production
 * - Provides typed helpers: sendOTPEmail, sendWelcomeEmail, sendGenericEmail
 * ───────────────────────────────────────────────────────────────────
 */
import nodemailer from "nodemailer";
import dns from "dns";

// Sửa lỗi ENETUNREACH khi nền tảng deploy ưu tiên IPv6 nhưng mạng IPv6 chưa được cấu hình
dns.setDefaultResultOrder("ipv4first");

// ────────────────────────────────────────────────────────────────
//  Brand constants
// ────────────────────────────────────────────────────────────────
const BRAND_NAME = "Ninh Kiểu iStore";
const BRAND_COLOR = "#1a1a2e";
const BRAND_ACCENT = "#e94560";
const SUPPORT_EMAIL = "[EMAIL_ADDRESS]";

// ────────────────────────────────────────────────────────────────
//  SMTP config validation
// ────────────────────────────────────────────────────────────────
/**
 * Validates that all required SMTP env vars are present and not placeholder values.
 * Returns { valid: boolean, missing: string[] }
 */
export const validateSMTPConfig = () => {
  const required = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  };

  const placeholders = ["your@email.com", "your-app-password", "YOUR_EMAIL", "YOUR_PASSWORD"];
  const missing = [];

  for (const [key, value] of Object.entries(required)) {
    if (!value || value.trim() === "" || placeholders.some((p) => value.includes(p))) {
      missing.push(key);
    }
  }

  return { valid: missing.length === 0, missing };
};

/**
 * Checks once at module load whether SMTP is configured.
 * Logs a clear warning — but does NOT crash the server.
 * Actual email calls will throw if config is bad.
 */
const smtpCheck = validateSMTPConfig();
if (!smtpCheck.valid) {
  console.warn(
    `⚠️  [EmailService] SMTP config incomplete. Missing/placeholder: ${smtpCheck.missing.join(", ")}\n` +
    `   Email delivery will THROW errors until these are set in .env.\n` +
    `   Required: SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT (optional, default 587)`
  );
} else {
  console.log(
    `✅ [EmailService] SMTP configured → ${process.env.SMTP_USER} via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`
  );
}

// ────────────────────────────────────────────────────────────────
//  Transporter factory — created per-call so env changes propagate
// ────────────────────────────────────────────────────────────────
const createTransporter = () => {
  const { valid, missing } = validateSMTPConfig();
  if (!valid) {
    throw Object.assign(
      new Error(
        `[EmailService] SMTP not configured. Missing or placeholder values for: ${missing.join(", ")}. ` +
        `Set real credentials in backend/.env (SMTP_HOST, SMTP_USER, SMTP_PASS).`
      ),
      { code: "SMTP_CONFIG_MISSING" }
    );
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true", // true → port 465, false → STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Timeout settings to prevent hanging
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
};

// ────────────────────────────────────────────────────────────────
//  Base HTML email layout
// ────────────────────────────────────────────────────────────────
const emailLayout = ({ title, preheader = "", body }) => `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <!--[if mso]><style>table {border-collapse: collapse;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="display:none;font-size:1px;color:#fefefe;overflow:hidden;max-height:0;">${preheader}</div>
  <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f4f4f8">
    <tr>
      <td align="center" style="padding:40px 0;">
        <table width="560" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:${BRAND_COLOR};padding:28px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:0.5px;">
                 ${BRAND_NAME}
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f9fb;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
              <p style="color:#aaa;font-size:12px;margin:0;">
                © ${new Date().getFullYear()} ${BRAND_NAME}. Mọi email từ chúng tôi đều có thể bỏ qua nếu bạn không yêu cầu.
              </p>
              <p style="color:#aaa;font-size:12px;margin:6px 0 0;">
                Liên hệ hỗ trợ: <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_ACCENT};">${SUPPORT_EMAIL}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ────────────────────────────────────────────────────────────────
//  sendOTPEmail — step-up / verification OTP
// ────────────────────────────────────────────────────────────────
/**
 * Gửi email chứa mã OTP 6 chữ số.
 *
 * @param {object} opts
 * @param {string} opts.to           - Địa chỉ email nhận
 * @param {string} opts.otp          - Mã OTP (plain text, 6 số)
 * @param {number} [opts.ttlMinutes] - TTL tính bằng phút (để hiển thị trong email)
 * @param {"step_up"|"email_verification"|"forgot_password"} [opts.type] - Loại OTP
 * @param {string} [opts.action]     - Action mô tả (vd: "product.delete")
 * @returns {Promise<void>}
 * @throws {Error} nếu SMTP không được cấu hình hoặc gửi thất bại
 */
export const sendOTPEmail = async ({ to, otp, ttlMinutes = 10, type = "step_up", action = "" }) => {
  if (!to) throw new Error("[EmailService] sendOTPEmail: recipient email (to) is required");
  if (!otp) throw new Error("[EmailService] sendOTPEmail: otp is required");

  const isVerification = type === "email_verification";
  const isForgotPassword = type === "forgot_password";

  const subjectMap = {
    step_up: `[${BRAND_NAME}] Mã OTP xác nhận thao tác bảo mật`,
    email_verification: `[${BRAND_NAME}] Xác thực địa chỉ email của bạn`,
    forgot_password: `[${BRAND_NAME}] Mã OTP đặt lại mật khẩu`,
  };

  const subject = subjectMap[type] || subjectMap["step_up"];
  const heading = isVerification
    ? "Xác thực email"
    : isForgotPassword
      ? "Đặt lại mật khẩu"
      : "Xác nhận thao tác bảo mật";
  const description = isVerification
    ? "Bạn vừa đăng ký tài khoản tại <strong>SmartMobile Store</strong>. Vui lòng nhập mã OTP bên dưới để xác thực địa chỉ email của bạn."
    : isForgotPassword
      ? "Bạn vừa yêu cầu đặt lại mật khẩu. Vui lòng nhập mã OTP bên dưới để tiếp tục đổi mật khẩu."
      : `Bạn vừa yêu cầu thực hiện một thao tác cần xác minh danh tính bổ sung${action ? ` (<code>${action}</code>)` : ""}.`;

  const html = emailLayout({
    title: subject,
    preheader: `Mã OTP của bạn: ${otp} — có hiệu lực trong ${ttlMinutes} phút`,
    body: `
      <h2 style="color:${BRAND_COLOR};margin:0 0 12px;font-size:20px;">${heading}</h2>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 28px;">${description}</p>

      <div style="background:#f5f5f8;border-radius:10px;padding:28px;text-align:center;margin-bottom:28px;border:1px solid #e8e8ef;">
        <p style="font-size:13px;color:#888;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">Mã OTP của bạn</p>
        <p style="font-size:42px;font-weight:800;letter-spacing:12px;color:${BRAND_COLOR};margin:0;font-family:'Courier New',monospace;">${otp}</p>
      </div>

      <div style="background:#fff8e1;border-left:4px solid #ffc107;border-radius:4px;padding:14px 18px;margin-bottom:20px;">
        <p style="color:#856404;font-size:14px;margin:0;">
          ⏱️ Mã có hiệu lực trong <strong>${ttlMinutes} phút</strong>. Không chia sẻ mã này với bất kỳ ai.
        </p>
      </div>

      <p style="color:#bbb;font-size:12px;margin:0;">
        Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email này hoặc liên hệ ngay bộ phận hỗ trợ.
      </p>
    `,
  });

  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: `"${BRAND_NAME}" <${SUPPORT_EMAIL}>`,
    to,
    subject,
    html,
  });

  console.log(`✅ [EmailService] OTP email sent → ${to} | messageId: ${info.messageId}`);
};

// ────────────────────────────────────────────────────────────────
//  sendWelcomeEmail — sau khi verify email thành công
// ────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.fullName
 */
export const sendWelcomeEmail = async ({ to, fullName }) => {
  if (!to) throw new Error("[EmailService] sendWelcomeEmail: recipient email required");

  const subject = `Chào mừng bạn đến với ${BRAND_NAME}!`;
  const firstName = fullName ? fullName.split(" ").pop() : "bạn";

  const html = emailLayout({
    title: subject,
    preheader: `Tài khoản của bạn đã được xác thực thành công`,
    body: `
      <h2 style="color:${BRAND_COLOR};margin:0 0 12px;font-size:22px;">🎉 Chào mừng ${firstName}!</h2>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Tài khoản của bạn tại <strong>${BRAND_NAME}</strong> đã được xác thực thành công.
        Bạn có thể bắt đầu mua sắm ngay bây giờ!
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${process.env.CLIENT_URL || "https://www.canthoistore.io.vn"}"
           style="background:${BRAND_ACCENT};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block;">
          Khám phá sản phẩm →
        </a>
      </div>
      <p style="color:#aaa;font-size:13px;">
        Cảm ơn bạn đã tin tưởng và chọn ${BRAND_NAME}. Chúng tôi luôn nỗ lực mang đến trải nghiệm mua sắm tốt nhất.
      </p>
    `,
  });

  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: `"${BRAND_NAME}" <${SUPPORT_EMAIL}>`,
    to,
    subject,
    html,
  });

  console.log(`✅ [EmailService] Welcome email sent → ${to} | messageId: ${info.messageId}`);
};

// ────────────────────────────────────────────────────────────────
//  sendGenericEmail — generic helper
// ────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html      - Full HTML (will be wrapped in layout)
 * @param {string} [opts.preheader]
 */
export const sendGenericEmail = async ({ to, subject, htmlBody, preheader = "" }) => {
  if (!to || !subject || !htmlBody) {
    throw new Error("[EmailService] sendGenericEmail: to, subject, htmlBody are required");
  }
  const html = emailLayout({ title: subject, preheader, body: htmlBody });
  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: `"${BRAND_NAME}" <${SUPPORT_EMAIL}>`,
    to,
    subject,
    html,
  });
  console.log(`✅ [EmailService] Generic email sent → ${to} | messageId: ${info.messageId}`);
};

/**
 * testSMTPConnection — kiểm tra kết nối SMTP (dùng trong script test)
 */
export const testSMTPConnection = async () => {
  const transporter = createTransporter(); // throws if misconfigured
  await transporter.verify();
  console.log("✅ [EmailService] SMTP connection verified successfully");
  return true;
};

export default {
  validateSMTPConfig,
  sendOTPEmail,
  sendWelcomeEmail,
  sendGenericEmail,
  testSMTPConnection,
};
