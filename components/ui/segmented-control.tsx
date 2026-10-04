"use client";

/**
 * SegmentedControl — iOS-style segmented picker (radiogroup).
 * Roving tabindex + arrow-key navigation.
 */

import { useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "./utils";
import { Icon, type IconName } from "./icons";

export interface SegmentOption {
  value: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  size = "md",
  className,
}: SegmentedControlProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? options[0]?.value ?? "");
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = value ?? internal;
  const setSelected = (v: string) => {
    if (value === undefined) setInternal(v);
    onValueChange?.(v);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled);
    const pos = enabled.findIndex(({ o }) => o.value === selected);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (pos + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (pos - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next !== null && enabled[next]) {
      e.preventDefault();
      const target = enabled[next];
      setSelected(target.o.value);
      btnRefs.current[target.i]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "no-scrollbar inline-flex max-w-full overflow-x-auto rounded-full border border-line bg-surface-2 p-1",
        className,
      )}
    >
      {options.map((option, i) => {
        const checked = option.value === selected;
        return (
          <button
            key={option.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => setSelected(option.value)}
            className={cn(
              "relative flex items-center justify-center gap-1.5 rounded-full font-medium",
              "transition-colors duration-fast",
              size === "md" ? "min-h-11 px-5 text-body-sm" : "min-h-9 px-4 text-caption",
              checked ? "text-ink" : "text-ink-2 hover:text-ink",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "focus-visible:outline-2 focus-visible:outline-brand",
            )}
          >
            {checked && (
              <motion.span
                layoutId={`${baseId}-thumb`}
                aria-hidden
                className="absolute inset-0 rounded-full bg-surface shadow-sm border border-line"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.icon && <Icon name={option.icon} size={16} />}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
