import type { HTMLAttributes } from "react";
import { cn } from "./utils";

/**
 * Spinner — indeterminate loading indicator.
 * Exposes `role="status"` with a screen-reader label by default.
 */

const sizes = {
  xs: "h-3.5 w-3.5 border-2",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-[3px]",
  lg: "h-10 w-10 border-4",
} as const;

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof sizes;
  label?: string;
}

export function Spinner({ size = "md", label = "Loading…", className, ...rest }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex", className)} {...rest}>
      <span
        aria-hidden
        className={cn(
          "animate-spin rounded-full border-current border-t-transparent opacity-70",
          sizes[size],
        )}
      />
    </span>
  );
}
