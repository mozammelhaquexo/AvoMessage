"use client";

/**
 * Checkbox — accessible checkbox built on a native <input type="checkbox">.
 *
 * Native rather than a styled div because this one gates a form submit (the
 * "I agree" box on sign-up): the browser's own required/validation, focus
 * order and screen-reader announcement are all correct for free, and
 * `indeterminate` is available for future bulk-select use.
 *
 * The visual box is drawn with `peer` styles driven off the real input, so the
 * input stays the single source of truth for state.
 */

import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from "react";
import { Icon } from "./icons";
import { cn } from "./utils";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label text. Required unless `aria-label` is supplied. */
  label?: React.ReactNode;
  /** Renders the box in the error style (e.g. after a failed submit). */
  invalid?: boolean;
  /** Indeterminate state — e.g. a "select all" that is partially applied. */
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, invalid, indeterminate, className, id, disabled, ...rest }, ref) => {
    const innerRef = useRef<HTMLInputElement | null>(null);

    // `indeterminate` is a DOM property with no HTML attribute, so it must be
    // assigned imperatively — React cannot set it from JSX.
    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);

    return (
      <label
        className={cn(
          "group flex min-h-11 cursor-pointer items-center gap-2.5 text-body-sm text-ink",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <input
            ref={(node) => {
              innerRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) ref.current = node;
            }}
            id={id}
            type="checkbox"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              "peer h-5 w-5 cursor-pointer appearance-none rounded-[6px] border transition-all duration-fast ease-out",
              "checked:border-brand-cta checked:bg-brand-cta",
              invalid ? "border-danger" : "border-line-strong bg-surface",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              "disabled:cursor-not-allowed",
            )}
            {...rest}
          />
          <Icon
            name="check"
            size={13}
            aria-hidden
            className="pointer-events-none absolute text-on-brand opacity-0 transition-opacity duration-fast peer-checked:opacity-100"
          />
        </span>
        {label && <span className="min-w-0">{label}</span>}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
