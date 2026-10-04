import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

/**
 * Shared field chrome — token-driven borders, focus ring, error state.
 */

const fieldBase = cn(
  "w-full rounded-md border bg-surface-2 text-ink placeholder:text-ink-3",
  "transition-colors duration-fast ease-out",
  "border-line hover:border-line-strong",
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25",
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Renders the invalid style + `aria-invalid`. Prefer `FormField` for the message. */
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ invalid, className, type = "text", ...rest }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "h-11 px-4 text-body-sm", className)}
      {...rest}
    />
  ),
);
Input.displayName = "Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ invalid, className, rows = 4, ...rest }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "min-h-24 px-4 py-3 text-body-sm resize-y", className)}
      {...rest}
    />
  ),
);
Textarea.displayName = "Textarea";
