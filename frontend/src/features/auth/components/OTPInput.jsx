import React, { useMemo, useRef } from "react";
import { cn } from "@/shared/lib/utils";

const OTPInput = ({ value = "", onChange, length = 6, disabled = false, hasError = false }) => {
  const refs = useRef([]);
  const digits = useMemo(
    () => String(value || "").replace(/\D/g, "").slice(0, length).padEnd(length, " ").split(""),
    [value, length],
  );

  const focusIndex = (index) => {
    const input = refs.current[index];
    if (input) input.focus();
  };

  const updateAt = (index, char) => {
    const next = digits.map((digit) => (digit === " " ? "" : digit));
    next[index] = char;
    onChange?.(next.join("").replace(/\s/g, "").slice(0, length));
  };

  const handleChange = (index, event) => {
    const nextChar = event.target.value.replace(/\D/g, "").slice(-1);
    updateAt(index, nextChar);
    if (nextChar && index < length - 1) {
      focusIndex(index + 1);
    }
  };

  const handleKeyDown = (index, event) => {
    if (event.key === "Backspace") {
      if ((digits[index] || "").trim()) {
        updateAt(index, "");
      } else if (index > 0) {
        updateAt(index - 1, "");
        focusIndex(index - 1);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      focusIndex(index - 1);
      event.preventDefault();
    }

    if (event.key === "ArrowRight" && index < length - 1) {
      focusIndex(index + 1);
      event.preventDefault();
    }
  };

  const handlePaste = (event) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (pasted) {
      onChange?.(pasted);
      focusIndex(Math.min(pasted.length, length - 1));
    }
    event.preventDefault();
  };

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete="one-time-code"
          value={digit === " " ? "" : digit}
          onChange={(event) => handleChange(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          disabled={disabled}
          className={cn(
            "h-12 w-11 rounded-xl border text-center text-lg font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200",
            hasError ? "border-red-400 bg-red-50 text-red-700 focus:ring-red-100" : "border-slate-300 bg-white",
            disabled ? "cursor-not-allowed opacity-70" : "",
          )}
        />
      ))}
    </div>
  );
};

export default OTPInput;

