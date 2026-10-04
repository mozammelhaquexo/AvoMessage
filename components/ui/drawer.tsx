"use client";

/**
 * Drawer — accessible slide-over panel.
 * Mobile: bottom sheet by default. Desktop: side panel.
 * Same a11y contract as Dialog (focus trap, Escape, scroll lock).
 */

import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "./utils";
import { Icon } from "./icons";
import { fade, slideInRight, slideUpSheet } from "@/lib/motion";
import { useEscapeKey, useFocusTrap, useMounted, useScrollLock } from "./use-overlay";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name — required. */
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: "left" | "right" | "bottom";
  dismissable?: boolean;
  className?: string;
}

const sideStyles = {
  left: "left-0 top-0 h-full w-full max-w-md rounded-r-xl",
  right: "right-0 top-0 h-full w-full max-w-md rounded-l-xl",
  bottom: "bottom-0 left-0 right-0 max-h-[90dvh] rounded-t-xl",
} as const;

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = "right",
  dismissable = true,
  className,
}: DrawerProps) {
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

  const variants = side === "bottom" ? slideUpSheet : slideInRight;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-drawer"
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
            variants={variants}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              "absolute flex flex-col border border-line bg-surface shadow-lg",
              sideStyles[side],
              className,
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
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
              <button
                type="button"
                onClick={close}
                aria-label="Close panel"
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                  "text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink",
                  "focus-visible:outline-2 focus-visible:outline-brand",
                )}
              >
                <Icon name="x" size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
