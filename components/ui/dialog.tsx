"use client";

/**
 * Dialog — accessible modal.
 * Focus trap + Escape + backdrop dismiss + scroll lock + focus restoration.
 * Enter/exit animation via framer-motion (respects reduced motion via
 * MotionConfig `reducedMotion="user"` at the app root).
 */

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "./utils";
import { Icon } from "./icons";
import { fade, scaleIn } from "@/lib/motion";
import { useEscapeKey, useFocusTrap, useMounted, useScrollLock } from "./use-overlay";

const sizeStyles = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[calc(100vw-2rem)]",
} as const;

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name — required. Rendered as the dialog heading. */
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: keyof typeof sizeStyles;
  /** Show the × close button (default true). */
  showClose?: boolean;
  /** Allow dismiss via backdrop click / Escape (default true). */
  dismissable?: boolean;
  className?: string;
  contentClassName?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "md",
  showClose = true,
  dismissable = true,
  className,
  contentClassName,
}: DialogProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = () => onOpenChange(false);

  useScrollLock(open);
  useFocusTrap(panelRef, open);
  useEscapeKey(open, () => {
    if (dismissable) close();
  });

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn("fixed inset-0 z-modal flex items-center justify-center p-4", className)}
          // Backdrop clicks dismiss; panel stops propagation via its own handler.
          onMouseDown={(e) => {
            if (dismissable && e.target === e.currentTarget) close();
          }}
        >
          <motion.div
            variants={fade}
            initial="hidden"
            animate="show"
            exit="exit"
            aria-hidden
            className="absolute inset-0 bg-overlay"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              "relative flex max-h-[calc(100dvh-2rem)] w-full flex-col",
              "rounded-xl border border-line bg-surface shadow-lg",
              sizeStyles[size],
              contentClassName,
            )}
          >
            <div className="flex items-start justify-between gap-4 p-5 pb-0">
              <div className="min-w-0">
                <h2 id={titleId} className="text-h3 font-semibold text-ink">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="mt-1 text-body-sm text-ink-2">
                    {description}
                  </p>
                )}
              </div>
              {showClose && (
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close dialog"
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                    "text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink",
                    "focus-visible:outline-2 focus-visible:outline-brand",
                  )}
                >
                  <Icon name="x" size={20} />
                </button>
              )}
            </div>
            <div className="overflow-y-auto p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Convenience footer row for dialog actions. */
export function DialogFooter({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 pt-5 sm:flex-row sm:justify-end", className)}
      {...rest}
    />
  );
}
