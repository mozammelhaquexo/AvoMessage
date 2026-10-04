"use client";

/**
 * Switch — premium accessible toggle. `role="switch"` with keyboard support
 * (Space/Enter via native button behavior). 44px hit target via padding.
 * Springy thumb, glowing on-track, refined inset off-track.
 */

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible label — required (visible or via aria-label). */
  label: string;
  size?: "sm" | "md";
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, label, size = "md", disabled, className, ...rest }, ref) => {
    const track = size === "md" ? "h-8 w-[52px]" : "h-7 w-[46px]";
    const thumb = size === "md" ? "h-6 w-6" : "h-5 w-5";

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "flex min-h-11 min-w-11 items-center justify-center rounded-full",
          "transition-transform duration-150 ease-out active:scale-90",
          "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...rest}
      >
        <span
          aria-hidden
          className={cn(
            "flex items-center rounded-full p-1 transition-all duration-300 ease-out",
            track,
            checked
              ? "glow-brand justify-end bg-brand-cta"
              : "justify-start border border-line-strong bg-surface-2 shadow-[inset_0_2px_4px_rgba(0,0,0,0.10)] dark:shadow-[inset_0_2px_4px_rgba(0,0,0,0.45)]",
          )}
        >
          <span
            className={cn(
              "block rounded-full bg-white transition-transform duration-300 ease-[cubic-bezier(0.34,1.45,0.64,1)]",
              "shadow-[0_2px_6px_rgba(0,0,0,0.30),0_0_1px_rgba(0,0,0,0.25)]",
              thumb,
            )}
          />
        </span>
      </button>
    );
  },
);
Switch.displayName = "Switch";
