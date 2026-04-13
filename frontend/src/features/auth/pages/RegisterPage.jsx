import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";
import { authAPI } from "../api/auth.api";
import { useAuthStore } from "../state/auth.store";
import { useAuthFlow } from "../context/AuthFlowContext";

const phoneRegex = /^0\d{9}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RegisterPage = () => {
  const navigate = useNavigate();
  const { register, login, isLoading, error, clearError } = useAuthStore();
  const { setLoading, setError, startOTPSession, clearOTPSession } = useAuthFlow();

  const [formData, setFormData] = useState({
    fullName: "",
    phoneNumber: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [localLoading, setLocalLoading] = useState(false);

  const passwordRules = useMemo(
    () => ({
      length: formData.password.length >= 8,
      lower: /[a-z]/.test(formData.password),
      upper: /[A-Z]/.test(formData.password),
      number: /[0-9]/.test(formData.password),
      special: /[^A-Za-z0-9]/.test(formData.password),
    }),
    [formData.password],
  );

  const validate = () => {
    const nextErrors = {};
    const normalizedFullName = formData.fullName.trim();
    const normalizedPhone = formData.phoneNumber.trim();
    const normalizedEmail = formData.email.trim().toLowerCase();

    if (!normalizedFullName) {
      nextErrors.fullName = "Vui lòng nhập họ và tên";
    } else if (normalizedFullName.length < 2) {
      nextErrors.fullName = "Họ và tên phải có ít nhất 2 ký tự";
    }

    if (!normalizedPhone) {
      nextErrors.phoneNumber = "Vui lòng nhập số điện thoại";
    } else if (!phoneRegex.test(normalizedPhone)) {
      nextErrors.phoneNumber = "Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0";
    }

    if (normalizedEmail && !emailRegex.test(normalizedEmail)) {
      nextErrors.email = "Email không hợp lệ";
    }

    if (!passwordRules.length || !passwordRules.lower || !passwordRules.upper || !passwordRules.number || !passwordRules.special) {
      nextErrors.password = "Mật khẩu chưa đủ điều kiện bảo mật";
    }

    if (!formData.confirmPassword) {
      nextErrors.confirmPassword = "Vui lòng nhập lại mật khẩu";
    } else if (formData.confirmPassword !== formData.password) {
      nextErrors.confirmPassword = "Mật khẩu nhập lại không khớp";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === "phoneNumber" && !/^\d*$/.test(value)) {
      return;
    }

    clearError();
    setError("");
    setFieldErrors((prev) => ({ ...prev, [name]: "" }));
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    const normalizedFullName = formData.fullName.trim();
    const normalizedPhone = formData.phoneNumber.trim();
    const normalizedEmail = formData.email.trim().toLowerCase();

    setLocalLoading(true);
    setLoading(true);
    setError("");

    const registerResult = await register({
      fullName: normalizedFullName,
      phone: normalizedPhone,
      email: normalizedEmail || undefined,
      password: formData.password,
    });

    if (!registerResult.success) {
      setLoading(false);
      setLocalLoading(false);
      return;
    }

    if (!normalizedEmail) {
      clearOTPSession();
      setLoading(false);
      setLocalLoading(false);
      toast.success("Đăng ký thành công. Bạn có thể đăng nhập ngay.");
      navigate("/login");
      return;
    }

    const loginResult = await login({
      phoneNumber: normalizedPhone,
      password: formData.password,
    });

    if (!loginResult.success) {
      setLoading(false);
      setLocalLoading(false);
      toast.message("Đăng ký thành công", {
        description: "Vui lòng đăng nhập để tiếp tục xác thực email.",
      });
      navigate("/login");
      return;
    }

    try {
      const response = await authAPI.sendEmailOTP({ email: normalizedEmail });
      const payload = response?.data?.data || {};

      startOTPSession({
        sessionId: payload.sessionId,
        purpose: "EMAIL_VERIFICATION",
        channel: "EMAIL",
        target: normalizedEmail,
        maskedTarget: payload.maskedEmail,
        expiresAt: payload.expiresAt,
      });

      setLoading(false);
      setLocalLoading(false);
      toast.success("Đăng ký thành công. Vui lòng nhập OTP để xác thực email.");
      navigate("/verify-email");
    } catch (otpError) {
      const message = otpError.response?.data?.message || "Không thể gửi OTP xác thực email";
      setError(message);
      setLoading(false);
      setLocalLoading(false);
      toast.error(message);
      navigate("/profile");
    }
  };

  const isBusy = isLoading || localLoading;

  return (
    <AuthLayout
      title="Đăng ký tài khoản"
      description="Đăng ký tài khoản bằng họ và tên, số điện thoại và mật khẩu. Email là tùy chọn."
      footer={
        <p className="text-center text-sm text-slate-600">
          Đã có tài khoản?{" "}
          <Link to="/login" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            Đăng nhập
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error ? <ErrorMessage message={error} /> : null}

        <FormInput
          label="Họ và tên"
          name="fullName"
          type="text"
          autoComplete="name"
          value={formData.fullName}
          onChange={handleChange}
          placeholder="Nhập họ và tên"
          error={fieldErrors.fullName}
          required
        />

        <FormInput
          label="Số điện thoại"
          name="phoneNumber"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          autoComplete="tel"
          value={formData.phoneNumber}
          onChange={handleChange}
          placeholder="Ví dụ: 0901234567"
          error={fieldErrors.phoneNumber}
          required
        />

        <FormInput
          label="Email (tùy chọn)"
          name="email"
          type="email"
          autoComplete="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="Nhập email (không bắt buộc)"
          error={fieldErrors.email}
          helperText={
            formData.email.trim()
              ? "Chúng tôi sẽ gửi mã xác thực email sau khi đăng ký"
              : "Bạn có thể thêm email sau trong trang hồ sơ"
          }
        />

        <FormInput
          label="Mật khẩu"
          name="password"
          type="password"
          autoComplete="new-password"
          value={formData.password}
          onChange={handleChange}
          placeholder="Nhập mật khẩu"
          error={fieldErrors.password}
          required
        />

        <FormInput
          label="Nhập lại mật khẩu"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={formData.confirmPassword}
          onChange={handleChange}
          placeholder="Nhập lại mật khẩu"
          error={fieldErrors.confirmPassword}
          required
        />

        <div className="grid grid-cols-1 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
          <p className={passwordRules.length ? "text-emerald-700" : ""}>• Ít nhất 8 ký tự</p>
          <p className={passwordRules.lower ? "text-emerald-700" : ""}>• Có chữ thường</p>
          <p className={passwordRules.upper ? "text-emerald-700" : ""}>• Có chữ hoa</p>
          <p className={passwordRules.number ? "text-emerald-700" : ""}>• Có chữ số</p>
          <p className={passwordRules.special ? "text-emerald-700 sm:col-span-2" : "sm:col-span-2"}>
            • Có ký tự đặc biệt
          </p>
        </div>

        <Button type="submit" disabled={isBusy} className="h-11 w-full">
          {isBusy ? "Đang xử lý..." : "Đăng ký"}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default RegisterPage;

