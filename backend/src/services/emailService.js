import nodemailer from "nodemailer";
import dns from "dns";

if (typeof dns.setDefaultResultOrder === "function") {
  // Prefer IPv4 in some hosted environments where IPv6 routing is unstable.
  dns.setDefaultResultOrder("ipv4first");
}

const BRAND_NAME = "Ninh Kieu iStore";
const BRAND_COLOR = "#1a1a2e";
const BRAND_ACCENT = "#e94560";

const readEnv = (key, fallback = "") => {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return fallback;
  return String(raw).trim();
};

const parseEmailFromAddress = (value = "") => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const bracketMatch = trimmed.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  if (trimmed.includes("@")) return trimmed;
  return "";
};

const SMTP_FROM = readEnv("SMTP_FROM");
const SUPPORT_EMAIL =
  readEnv("SUPPORT_EMAIL") ||
  parseEmailFromAddress(SMTP_FROM) ||
  readEnv("SMTP_USER") ||
  "support@smartmobilestore.local";
const MAIL_FROM = SMTP_FROM || `"${BRAND_NAME}" <${SUPPORT_EMAIL}>`;

/**
 * Validates that required SMTP variables are present and not placeholders.
 */
export const validateSMTPConfig = () => {
  const required = {
    SMTP_HOST: readEnv("SMTP_HOST"),
    SMTP_USER: readEnv("SMTP_USER"),
    SMTP_PASS: readEnv("SMTP_PASS"),
  };

  const placeholders = ["your@email.com", "your-app-password", "YOUR_EMAIL", "YOUR_PASSWORD"];
  const missing = [];

  for (const [key, value] of Object.entries(required)) {
    if (!value || placeholders.some((placeholder) => value.includes(placeholder))) {
      missing.push(key);
    }
  }

  return { valid: missing.length === 0, missing };
};

const smtpCheck = validateSMTPConfig();
if (!smtpCheck.valid) {
  console.warn(
    `⚠️  [EmailService] SMTP config incomplete. Missing/placeholder: ${smtpCheck.missing.join(", ")}\n` +
      "   Email delivery will throw errors until these are set.\n" +
      "   Required: SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT (optional, default 587)"
  );
} else {
  console.log(
    `✅ [EmailService] SMTP configured -> ${readEnv("SMTP_USER")} via ${readEnv("SMTP_HOST")}:${readEnv(
      "SMTP_PORT",
      "587"
    )}`
  );
}

const createTransporter = () => {
  const { valid, missing } = validateSMTPConfig();
  if (!valid) {
    throw Object.assign(
      new Error(
        `[EmailService] SMTP not configured. Missing or placeholder values for: ${missing.join(", ")}. ` +
          "Set real credentials in backend environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS)."
      ),
      { code: "SMTP_CONFIG_MISSING" }
    );
  }

  const host = readEnv("SMTP_HOST");
  const port = Number.parseInt(readEnv("SMTP_PORT"), 10) || 587;
  const secure = readEnv("SMTP_SECURE").toLowerCase() === "true";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: readEnv("SMTP_USER"),
      pass: readEnv("SMTP_PASS"),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    dnsTimeout: 10_000,
    family: 4,
  });
};

const isSMTPTimeoutError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return (
    code === "ETIMEDOUT" ||
    message.includes("connection timeout") ||
    message.includes("timed out") ||
    message.includes("greeting never received")
  );
};

const isSMTPNetworkError = (error) => {
  const code = String(error?.code || "").toUpperCase();
  return ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code);
};

const isSMTPAuthError = (error) => {
  const code = String(error?.code || "").toUpperCase();
  return code === "EAUTH" || Number(error?.responseCode) === 535;
};

export const classifySMTPError = (error) => {
  const code = String(error?.code || "").toUpperCase();

  if (code === "SMTP_CONFIG_MISSING") {
    return {
      type: "CONFIG",
      httpStatus: 503,
      appCode: "EMAIL_SERVICE_UNAVAILABLE",
      message: "Dich vu gui email chua duoc cau hinh.",
    };
  }

  if (isSMTPTimeoutError(error)) {
    return {
      type: "TIMEOUT",
      httpStatus: 504,
      appCode: "EMAIL_SERVICE_TIMEOUT",
      message: "Ket noi may chu email bi timeout. Vui long thu lai sau it phut.",
    };
  }

  if (isSMTPNetworkError(error)) {
    return {
      type: "NETWORK",
      httpStatus: 503,
      appCode: "EMAIL_SERVICE_NETWORK_ERROR",
      message: "Khong the ket noi toi may chu email o moi truong hien tai.",
    };
  }

  if (isSMTPAuthError(error)) {
    return {
      type: "AUTH",
      httpStatus: 503,
      appCode: "EMAIL_SERVICE_AUTH_FAILED",
      message: "Xac thuc SMTP that bai. Vui long kiem tra tai khoan gui email.",
    };
  }

  return {
    type: "UNKNOWN",
    httpStatus: 500,
    appCode: "EMAIL_SERVICE_SEND_FAILED",
    message: "Khong the gui email OTP. Vui long thu lai.",
  };
};

export const getSMTPDiagnostic = (error) => ({
  code: error?.code || null,
  errno: error?.errno || null,
  command: error?.command || null,
  responseCode: error?.responseCode || null,
  host: readEnv("SMTP_HOST"),
  port: Number.parseInt(readEnv("SMTP_PORT"), 10) || 587,
  secure: readEnv("SMTP_SECURE").toLowerCase() === "true",
  message: error?.message || null,
});

const emailLayout = ({ title, preheader = "", body }) => `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="display:none;font-size:1px;color:#fefefe;overflow:hidden;max-height:0;">${preheader}</div>
  <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f4f4f8">
    <tr>
      <td align="center" style="padding:40px 0;">
        <table width="560" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:${BRAND_COLOR};padding:28px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:0.5px;">${BRAND_NAME}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">${body}</td>
          </tr>
          <tr>
            <td style="background:#f9f9fb;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
              <p style="color:#aaa;font-size:12px;margin:0;">
                © ${new Date().getFullYear()} ${BRAND_NAME}. Moi email tu chung toi deu co the bo qua neu ban khong yeu cau.
              </p>
              <p style="color:#aaa;font-size:12px;margin:6px 0 0;">
                Lien he ho tro: <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_ACCENT};">${SUPPORT_EMAIL}</a>
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

const sendMail = async ({ to, subject, html }) => {
  const transporter = createTransporter();
  return transporter.sendMail({
    from: MAIL_FROM,
    to,
    subject,
    html,
  });
};

export const sendOTPEmail = async ({ to, otp, ttlMinutes = 10, type = "step_up", action = "" }) => {
  if (!to) throw new Error("[EmailService] sendOTPEmail: recipient email (to) is required");
  if (!otp) throw new Error("[EmailService] sendOTPEmail: otp is required");

  const isVerification = type === "email_verification";
  const isForgotPassword = type === "forgot_password";

  const subjectMap = {
    step_up: `[${BRAND_NAME}] Ma OTP xac nhan thao tac bao mat`,
    email_verification: `[${BRAND_NAME}] Xac thuc dia chi email cua ban`,
    forgot_password: `[${BRAND_NAME}] Ma OTP dat lai mat khau`,
  };

  const subject = subjectMap[type] || subjectMap.step_up;
  const heading = isVerification
    ? "Xac thuc email"
    : isForgotPassword
      ? "Dat lai mat khau"
      : "Xac nhan thao tac bao mat";
  const description = isVerification
    ? "Ban vua dang ky tai khoan tai <strong>SmartMobile Store</strong>. Vui long nhap ma OTP ben duoi de xac thuc dia chi email cua ban."
    : isForgotPassword
      ? "Ban vua yeu cau dat lai mat khau. Vui long nhap ma OTP ben duoi de tiep tuc doi mat khau."
      : `Ban vua yeu cau thuc hien mot thao tac can xac minh danh tinh bo sung${action ? ` (<code>${action}</code>)` : ""}.`;

  const html = emailLayout({
    title: subject,
    preheader: `Ma OTP cua ban: ${otp} - co hieu luc trong ${ttlMinutes} phut`,
    body: `
      <h2 style="color:${BRAND_COLOR};margin:0 0 12px;font-size:20px;">${heading}</h2>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 28px;">${description}</p>
      <div style="background:#f5f5f8;border-radius:10px;padding:28px;text-align:center;margin-bottom:28px;border:1px solid #e8e8ef;">
        <p style="font-size:13px;color:#888;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">Ma OTP cua ban</p>
        <p style="font-size:42px;font-weight:800;letter-spacing:12px;color:${BRAND_COLOR};margin:0;font-family:'Courier New',monospace;">${otp}</p>
      </div>
      <div style="background:#fff8e1;border-left:4px solid #ffc107;border-radius:4px;padding:14px 18px;margin-bottom:20px;">
        <p style="color:#856404;font-size:14px;margin:0;">
          Ma co hieu luc trong <strong>${ttlMinutes} phut</strong>. Khong chia se ma nay voi bat ky ai.
        </p>
      </div>
      <p style="color:#bbb;font-size:12px;margin:0;">Neu ban khong thuc hien yeu cau nay, hay bo qua email nay hoac lien he bo phan ho tro.</p>
    `,
  });

  const info = await sendMail({ to, subject, html });
  console.log(`✅ [EmailService] OTP email sent -> ${to} | messageId: ${info.messageId}`);
};

export const sendWelcomeEmail = async ({ to, fullName }) => {
  if (!to) throw new Error("[EmailService] sendWelcomeEmail: recipient email required");

  const subject = `Chao mung ban den voi ${BRAND_NAME}!`;
  const firstName = fullName ? fullName.split(" ").pop() : "ban";

  const html = emailLayout({
    title: subject,
    preheader: "Tai khoan cua ban da duoc xac thuc thanh cong",
    body: `
      <h2 style="color:${BRAND_COLOR};margin:0 0 12px;font-size:22px;">Chao mung ${firstName}!</h2>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Tai khoan cua ban tai <strong>${BRAND_NAME}</strong> da duoc xac thuc thanh cong.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${readEnv("CLIENT_URL", "https://www.canthoistore.io.vn")}" style="background:${BRAND_ACCENT};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block;">
          Kham pha san pham
        </a>
      </div>
    `,
  });

  const info = await sendMail({ to, subject, html });
  console.log(`✅ [EmailService] Welcome email sent -> ${to} | messageId: ${info.messageId}`);
};

export const sendGenericEmail = async ({ to, subject, htmlBody, preheader = "" }) => {
  if (!to || !subject || !htmlBody) {
    throw new Error("[EmailService] sendGenericEmail: to, subject, htmlBody are required");
  }

  const html = emailLayout({ title: subject, preheader, body: htmlBody });
  const info = await sendMail({ to, subject, html });
  console.log(`✅ [EmailService] Generic email sent -> ${to} | messageId: ${info.messageId}`);
};

export const testSMTPConnection = async () => {
  const transporter = createTransporter();
  await transporter.verify();
  console.log("✅ [EmailService] SMTP connection verified successfully");
  return true;
};

export default {
  validateSMTPConfig,
  classifySMTPError,
  getSMTPDiagnostic,
  sendOTPEmail,
  sendWelcomeEmail,
  sendGenericEmail,
  testSMTPConnection,
};
