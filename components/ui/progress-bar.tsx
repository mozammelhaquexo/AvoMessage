"use client";

/**
 * ProgressBar — determinate (or indeterminate) progress.
 * `role="progressbar"` with aria-valuenow/min/max/text.
 */

import { motion } from "framer-motion";
import { cn } from "./utils";
import { tweenSlow } from "@/lib/motion";

export interface ProgressBarProps {
  /** 0–100. Omit for indeterminate. */
  value?: number;
  label: string;
  size?: "sm" | "md";
  variant?: "brand" | "success" | "info";
  className?: string;
  showValue?: boolean;
}

const variantStyles = {
  brand: "bg-brand-gradient",
  success: "bg-success",
  info: "bg-info",
} as const;

export function ProgressBar({
  value,
  label,
  size = "md",
  variant = "brand",
  className,
  showValue = false,
}: ProgressBarProps) {
  const clamped = value === undefined ? undefined : Math.max(0, Math.min(100, value));
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span id={`${label}-label`} className="text-caption font-medium text-ink-2">
          {label}
        </span>
        {showValue && clamped !== undefined && (
          <span className="text-caption font-semibold text-ink tabular-nums">
            {Math.round(clamped)}%
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped === undefined ? undefined : Math.round(clamped)}
        aria-valuetext={clamped === undefined ? "Loading" : `${Math.round(clamped)} percent`}
        className={cn(
          "w-full overflow-hidden rounded-full bg-surface-2",
          size === "md" ? "h-2.5" : "h-1.5",
        )}
      >
        {clamped === undefined ? (
          <motion.div
            aria-hidden
            className={cn("h-full w-1/3 rounded-full", variantStyles[variant])}
            animate={{ x: ["-100%", "300%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <motion.div
            aria-hidden
            className={cn("h-full rounded-full", variantStyles[variant])}
            initial={false}
            animate={{ width: `${clamped}%` }}
            transition={tweenSlow}
          />
        )}
      </div>
    </div>
  );
}
