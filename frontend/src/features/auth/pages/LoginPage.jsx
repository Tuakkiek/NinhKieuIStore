import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/shared/ui/button";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";
import { useAuthStore } from "../state/auth.store";
import { resolveHomeRoute } from "../lib/authorization";

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuthStore();

  const [formData, setFormData] = useState({
    phoneNumber: "",
    password: "",
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === "phoneNumber" && !/^\d*$/.test(value)) {
      return;
    }

    clearError();
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const result = await login({
      phoneNumber: formData.phoneNumber.trim(),
      password: formData.password,
    });

    if (!result.success) return;

    const { user, authz, authorization } = useAuthStore.getState();
    navigate(resolveHomeRoute({ user, authz, authorization }) || "/");
  };

  return (
    <AuthLayout
      title="Đăng nhập"
      description="Dùng số điện thoại và mật khẩu để truy cập tài khoản của bạn."
      footer={
        <p className="text-center text-sm text-slate-600">
          Chưa có tài khoản?{" "}
          <Link to="/register" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            Đăng ký
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error ? <ErrorMessage message={error} /> : null}

        <FormInput
          label="Số điện thoại"
          name="phoneNumber"
          type="tel"
          value={formData.phoneNumber}
          onChange={handleChange}
          placeholder="Nhập số điện thoại"
          inputMode="numeric"
          autoComplete="tel"
          required
        />

        <FormInput
          label="Mật khẩu"
          name="password"
          type="password"
          value={formData.password}
          onChange={handleChange}
          placeholder="Nhập mật khẩu"
          autoComplete="current-password"
          required
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-slate-700 underline-offset-4 hover:text-slate-900 hover:underline"
          >
            Quên mật khẩu?
          </Link>
        </div>

        <Button type="submit" disabled={isLoading} className="h-11 w-full">
          {isLoading ? "Đang đăng nhập..." : "Đăng nhập"}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;

