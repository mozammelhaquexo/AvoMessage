import { forwardRef, type LabelHTMLAttributes, type ReactNode, useId } from "react";
import { cn } from "./utils";

/**
 * Label — always associate with a control via `htmlFor`.
 */

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ required, className, children, ...rest }, ref) => (
    <label
      ref={ref}
      className={cn("text-body-sm font-medium text-ink", className)}
      {...rest}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ml-1 text-danger">
          *
        </span>
      )}
    </label>
  ),
);
Label.displayName = "Label";

/**
 * FormField — label + control + hint/error wiring.
 * The child control receives `id`, `aria-invalid` and `aria-describedby`;
 * the error message is announced via `role="alert"`.
 */

export interface FormFieldProps {
  label: ReactNode;
  error?: string;
  /** Hint text or rich content (e.g. a "Forgot password?" link). */
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (fieldProps: {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}

export function FormField({ label, error, hint, required, className, children }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
