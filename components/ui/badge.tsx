import type { HTMLAttributes } from "react";
import { cn } from "./utils";

/**
 * Badge — small status/count pill. Decorative by default; use `role="status"`
 * when the content is live (e.g. unread counts).
 */

type BadgeVariant =
  | "brand"
  | "accent"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline";

const variantStyles: Record<BadgeVariant, string> = {
  brand: "bg-brand-soft text-brand-strong",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-surface-2 text-ink-2",
  // Strong text variants: AA-safe on the tinted backgrounds in both themes.
  success: "bg-success/15 text-success-strong",
  warning: "bg-warning/15 text-warning-strong",
  danger: "bg-danger/15 text-danger-strong",
  info: "bg-info/15 text-info-strong",
  outline: "border border-line-strong text-ink-2 bg-transparent",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-full px-2",
        "text-caption font-semibold whitespace-nowrap",
        variantStyles[variant],
        className,
      )}
      {...rest}
    />
  );
}
