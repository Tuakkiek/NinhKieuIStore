import React from "react";
import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";

const FormInput = ({
  label,
  name,
  type = "text",
  value,
  onChange,
  onBlur,
  placeholder,
  required = false,
  disabled = false,
  error = "",
  helperText = "",
  className,
  inputClassName,
  ...props
}) => (
  <div className={cn("space-y-2", className)}>
    {label ? (
      <Label htmlFor={name} className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </Label>
    ) : null}
    <Input
      id={name}
      name={name}
      type={type}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        "h-11 border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-slate-900/15",
        error ? "border-red-400 focus-visible:ring-red-200" : "",
        inputClassName,
      )}
      {...props}
    />
    {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    {!error && helperText ? <p className="text-xs text-slate-500">{helperText}</p> : null}
  </div>
);

export default FormInput;

