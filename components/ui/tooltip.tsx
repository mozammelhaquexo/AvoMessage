"use client";

/**
 * Tooltip — hover/focus hint, rendered in a portal.
 * Linked to its trigger via `aria-describedby`. Dismisses on Escape.
 */

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "./utils";
import { fade } from "@/lib/motion";
import { useMounted } from "./use-overlay";

export interface TooltipProps {
  content: ReactNode;
  /** The element the tooltip describes. Gets aria-describedby + handlers. */
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  /** Delay before showing (ms). */
  delay?: number;
  className?: string;
}

export function Tooltip({ content, children, side = "top", delay = 300, className }: TooltipProps) {
  const mounted = useMounted();
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const clearTimer = () => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  };

  const show = () => {
    clearTimer();
    showTimer.current = setTimeout(() => {
      const el = triggerRef.current;
      const tip = tooltipRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 8;
      // Measure after mount; fall back to centered estimates first.
      const w = tip?.offsetWidth ?? 0;
      const h = tip?.offsetHeight ?? 0;
      let top = 0;
      let left = 0;
      switch (side) {
        case "top":
          top = rect.top - h - gap;
          left = rect.left + rect.width / 2 - w / 2;
          break;
        case "bottom":
          top = rect.bottom + gap;
          left = rect.left + rect.width / 2 - w / 2;
          break;
        case "left":
          top = rect.top + rect.height / 2 - h / 2;
          left = rect.left - w - gap;
          break;
        case "right":
          top = rect.top + rect.height / 2 - h / 2;
          left = rect.right + gap;
          break;
      }
      setCoords({
        top: Math.max(8, Math.min(top, window.innerHeight - h - 8)),
        left: Math.max(8, Math.min(left, window.innerWidth - w - 8)),
      });
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    clearTimer();
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisible(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  useEffect(() => clearTimer, []);

  // Re-position once the tooltip has measured itself.
  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;
    const el = triggerRef.current;
    const tip = tooltipRef.current;
    const rect = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const gap = 8;
    const pos =
      side === "top"
        ? { top: rect.top - h - gap, left: rect.left + rect.width / 2 - w / 2 }
        : side === "bottom"
          ? { top: rect.bottom + gap, left: rect.left + rect.width / 2 - w / 2 }
          : side === "left"
            ? { top: rect.top + rect.height / 2 - h / 2, left: rect.left - w - gap }
            : { top: rect.top + rect.height / 2 - h / 2, left: rect.right + gap };
    setCoords({
      top: Math.max(8, Math.min(pos.top, window.innerHeight - h - 8)),
      left: Math.max(8, Math.min(pos.left, window.innerWidth - w - 8)),
    });
  }, [visible, side]);

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": tooltipId,
      })
    : children;

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {child}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {visible && (
              <motion.div
                ref={tooltipRef}
                id={tooltipId}
                role="tooltip"
                variants={fade}
                initial="hidden"
                animate="show"
                exit="exit"
                style={{ top: coords.top, left: coords.left }}
                className={cn(
                  "pointer-events-none fixed z-tooltip max-w-64 rounded-md px-2.5 py-1.5",
                  "bg-ink text-canvas text-caption font-medium shadow-md",
                  className,
                )}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
