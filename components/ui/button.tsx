import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "./utils";
import { Spinner } from "./spinner";

/**
 * AvoMessage Button — primary CTAs use the brand gradient + dark-mode glow.
 * All variants meet ≥44px touch targets (except `xs`/`icon-sm`, which are
 * desktop-dense; prefer `icon` on touch surfaces).
 */

type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "success"
  | "link";

type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. Also sets aria-busy. */
  loading?: boolean;
  /** Full-width block button. */
  fullWidth?: boolean;
  /**
   * Render as a link that looks like this button, instead of as a `<button>`.
   *
   * Use this rather than wrapping: `<Link><Button/></Link>` emits
   * `<a><button>`, which is invalid nesting. It looks fine with a mouse, but
   * keyboard users tab to the inner button and Enter activates the *button* —
   * which has no handler — so the link can never be followed from the keyboard.
   * Twelve CTAs in this app had that shape, including every button on the
   * public landing page.
   *
   * The rendered `<a>` is a Next `<Link>`, so it prefetches like every other
   * navigation in the app.
   */
  href?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  // AA-safe: dark on-brand text on the CTA gradient (5.4–8.4:1, both themes).
  // Never use text-white on brand fills — it fails WCAG AA (3.09:1).
  primary:
    "bg-brand-cta text-on-brand shadow-pop glow-brand hover:brightness-105 active:brightness-95 disabled:shadow-none",
  secondary:
    "bg-surface-2 text-ink hover:bg-line/60 active:bg-line border border-line",
  outline:
    "border border-line-strong bg-transparent text-ink hover:bg-surface-2 hover:border-ink-3 active:bg-line/50",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-line/50",
  danger:
    "bg-danger text-white hover:brightness-110 active:brightness-95 shadow-md",
  // AA-safe: white on #15803d (5.02:1); dark mode swaps to dark text on #4ade80.
  success:
    "bg-success-strong text-white dark:text-on-brand hover:brightness-110 active:brightness-95 shadow-md",
  link: "bg-transparent text-brand-strong underline-offset-4 hover:underline px-1 min-h-0",
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: "h-8 px-3 text-caption font-medium rounded-sm",
  sm: "h-9 px-4 text-body-sm font-medium rounded-md",
  md: "h-11 px-5 text-body-sm font-semibold rounded-md",
  lg: "h-12 px-6 text-base font-semibold rounded-lg",
  icon: "h-11 w-11 rounded-full",
  "icon-sm": "h-9 w-9 rounded-full",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled,
      className,
      children,
      type = "button",
      href,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    const classes = cn(
      "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
      "font-sans transition-all duration-fast ease-out",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "active:scale-[0.98]",
      sizeStyles[size],
      variantStyles[variant],
      fullWidth && "w-full",
      className,
    );
    const content: ReactNode = (
      <>
        {loading && <Spinner size="sm" aria-hidden />}
        {children}
      </>
    );

    if (href !== undefined) {
      /*
       * `rest` is typed for a <button>. The DOM handlers it carries (onClick,
       * onKeyDown, onFocus, …) are structurally identical on an <a>, so one
       * documented cast replaces a dozen. Button-only attributes (`name`,
       * `value`, `formAction`) would be meaningless here — a caller passing
       * `href` does not pass those, and React would flag it if one did.
       */
      const anchorProps = rest as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>;
      return (
        <Link
          // next/link forwards the ref to the <a>, so the cast is honest at
          // runtime; the public type stays HTMLButtonElement so that no existing
          // call site has to change.
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          aria-busy={loading || undefined}
          aria-disabled={isDisabled || undefined}
          tabIndex={isDisabled ? -1 : undefined}
          className={cn(classes, isDisabled && "pointer-events-none opacity-50")}
          {...anchorProps}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        className={classes}
        {...rest}
      >
        {content}
      </button>
    );
  },
);
Button.displayName = "Button";
