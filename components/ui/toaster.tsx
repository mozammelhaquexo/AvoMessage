"use client";

/**
 * Toaster — renders the toast stack. Mount once near the app root
 * (e.g. inside the root layout, within ThemeProvider).
 *
 * Position: bottom-right on desktop, bottom-center full-width-ish on mobile.
 * Each toast is `role="status"` (polite); errors use `role="alert"`.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "./utils";
import { Icon, type IconName } from "./icons";
import { toastIn } from "@/lib/motion";
import {
  dismissToast,
  subscribeToasts,
  type ToastItem,
  type ToastVariant,
} from "./toast";
import { useMounted } from "./use-overlay";

const variantIcon: Record<ToastVariant, IconName | null> = {
  default: null,
  success: "check",
  error: "alert",
  warning: "alert",
  info: "info",
};

const variantIconStyle: Record<ToastVariant, string> = {
  default: "",
  success: "bg-success/15 text-success",
  error: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
};

function ToastCard({ item }: { item: ToastItem }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => dismissToast(item.id);

  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    if (item.duration > 0) {
      timer.current = setTimeout(dismiss, item.duration);
    }
  };

  useEffect(() => {
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.duration]);

  const icon = variantIcon[item.variant];

  return (
    <motion.div
      layout
      variants={toastIn}
      initial="hidden"
      animate="show"
      exit="exit"
      role={item.variant === "error" ? "alert" : "status"}
      aria-live={item.variant === "error" ? "assertive" : "polite"}
      onMouseEnter={() => timer.current && clearTimeout(timer.current)}
      onMouseLeave={arm}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line",
        "bg-surface p-4 shadow-lg",
      )}
    >
      {icon && (
        <span
          aria-hidden
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            variantIconStyle[item.variant],
          )}
        >
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-semibold text-ink">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-body-sm text-ink-2">{item.description}</p>
        )}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              dismiss();
            }}
            className={cn(
              "mt-2 min-h-11 rounded-md px-3 text-body-sm font-semibold text-brand-strong",
              "hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand",
            )}
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className={cn(
          "flex h-11 w-11 -m-2 shrink-0 items-center justify-center rounded-full",
          "text-ink-3 transition-colors duration-fast hover:bg-surface-2 hover:text-ink",
          "focus-visible:outline-2 focus-visible:outline-brand",
        )}
      >
        <Icon name="x" size={18} />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const mounted = useMounted();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-label="Notifications"
      className={cn(
        "pointer-events-none fixed z-toast flex flex-col gap-2",
        "inset-x-4 bottom-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96",
        // Above the mobile bottom nav.
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
