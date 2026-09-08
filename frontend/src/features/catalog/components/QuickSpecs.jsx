import React from "react";
import { Cpu, Monitor, Camera, Battery, HardDrive, Package } from "lucide-react";

const QuickSpecs = ({ specifications }) => {
  const highlightSpecs = [
    { key: "screenSize", icon: Monitor, label: "Màn hình" },
    { key: "chip", icon: Cpu, label: "Chip" },
    { key: "rearCamera", icon: Camera, label: "Camera" },
    { key: "battery", icon: Battery, label: "Pin" },
    { key: "ram", icon: HardDrive, label: "RAM" },
    { key: "storage", icon: Package, label: "Bộ nhớ" },
  ].filter((spec) => specifications?.[spec.key]);

  if (highlightSpecs.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
      {highlightSpecs.map((spec) => (
        <div
          key={spec.key}
          className="min-w-0 min-h-[142px] overflow-hidden bg-white border-2 border-gray-200 rounded-lg p-2 sm:p-3 hover:border-red-400 hover:shadow-md transition-all"
        >
          <div className="flex h-full min-w-0 flex-col items-center text-center gap-1 sm:gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-50 rounded-lg flex items-center justify-center">
              <spec.icon className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" />
            </div>
            <div className="w-full min-w-0 overflow-hidden">
              <p className="text-[10px] sm:text-xs text-gray-600 mb-0.5 sm:mb-1">{spec.label}</p>
              <p className="w-full max-h-10 overflow-hidden text-xs sm:text-sm font-bold leading-5 text-gray-900 break-words text-center">
                {specifications[spec.key]}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default QuickSpecs;