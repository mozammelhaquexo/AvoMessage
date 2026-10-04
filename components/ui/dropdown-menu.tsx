"use client";

/**
 * DropdownMenu — accessible menu with full keyboard support.
 * Renders in a portal, positioned against the trigger.
 *
 * Keyboard: Enter/Space/ArrowDown opens · ArrowUp/Down/Home/End navigate ·
 * Enter/Space selects · Escape closes (refocus trigger) · Tab closes.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
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
import { Icon, type IconName } from "./icons";
import { scaleIn } from "@/lib/motion";
import { useMounted } from "./use-overlay";

export interface DropdownMenuItem {
  id: string;
  label: ReactNode;
  icon?: IconName;
  /** Right-aligned hint, e.g. keyboard shortcut. */
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface DropdownMenuSection {
  id: string;
  label?: ReactNode;
  items: DropdownMenuItem[];
}

export interface DropdownMenuProps {
  /** The trigger element (button, icon button, …). Gets aria props + ref. */
  trigger: ReactElement;
  sections: DropdownMenuSection[];
  /** Accessible label for the menu. */
  label: string;
  align?: "start" | "end";
  className?: string;
}

type FlatItem =
  | { kind: "header"; key: string; label: ReactNode }
  | { kind: "item"; key: string; item: DropdownMenuItem; sectionIndex: number; itemIndex: number };

export function DropdownMenu({
  trigger,
  sections,
  label,
  align = "end",
  className,
}: DropdownMenuProps) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 320 });

  const flat: FlatItem[] = [];
  sections.forEach((section, si) => {
    if (section.label) flat.push({ kind: "header", key: `h-${section.id}`, label: section.label });
    section.items.forEach((item, ii) =>
      flat.push({ kind: "item", key: item.id, item, sectionIndex: si, itemIndex: ii }),
    );
  });
  const selectable = flat.filter((f) => f.kind === "item" && !f.item.disabled);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const select = useCallback(
    (item: DropdownMenuItem) => {
      if (item.disabled) return;
      close();
      item.onSelect?.();
    },
    [close],
  );

  // Position the menu against the trigger.
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 240;
    const menuHeight = Math.min(360, flat.length * 44 + 16);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUp = spaceBelow < menuHeight && rect.top > menuHeight;
    const left =
      align === "end"
        ? Math.max(8, rect.right - menuWidth)
        : Math.min(rect.left, window.innerWidth - menuWidth - 8);
    setPosition({
      top: openUp ? Math.max(8, rect.top - menuHeight - 8) : rect.bottom + 8,
      left,
      maxHeight: openUp ? rect.top - 16 : spaceBelow,
    });
  }, [align, flat.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        menuRef.current?.contains(t) ||
        (triggerRef.current && triggerRef.current.contains(t as Node))
      ) {
        return;
      }
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
      if (e.key === "Tab") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close, updatePosition]);

  // Focus the active item as keyboard nav moves.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const entry = selectable[activeIndex];
    if (!entry || entry.kind !== "item") return;
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-item-id="${entry.item.id}"]`)
      ?.focus();
  }, [activeIndex, open, selectable]);

  const openMenu = (focusFirst: boolean) => {
    setOpen(true);
    setActiveIndex(focusFirst && selectable.length > 0 ? 0 : -1);
  };

  const moveActive = (delta: 1 | -1) => {
    if (selectable.length === 0) return;
    setActiveIndex((prev) => {
      const next = prev < 0 ? (delta === 1 ? 0 : selectable.length - 1) : prev + delta;
      return (next + selectable.length) % selectable.length;
    });
  };

  const triggerWithProps = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": menuId,
      })
    : trigger;

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if (open) close();
        else openMenu(true);
      }}
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!open) openMenu(true);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            setActiveIndex(selectable.length - 1);
          }
        }
      }}
    >
      {triggerWithProps}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={label}
                aria-orientation="vertical"
                variants={scaleIn}
                initial="hidden"
                animate="show"
                exit="exit"
                style={{
                  top: position.top,
                  left: position.left,
                  maxHeight: Math.max(120, position.maxHeight),
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    moveActive(1);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    moveActive(-1);
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setActiveIndex(0);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    setActiveIndex(selectable.length - 1);
                  }
                }}
                className={cn(
                  "fixed z-dropdown w-60 overflow-y-auto rounded-lg border border-line",
                  "bg-surface p-1.5 shadow-lg",
                  className,
                )}
              >
                {flat.map((entry) =>
                  entry.kind === "header" ? (
                    <div
                      key={entry.key}
                      className="px-3 pt-2 pb-1 text-tiny font-semibold tracking-wide text-ink-3 uppercase"
                    >
                      {entry.label}
                    </div>
                  ) : (
                    <button
                      key={entry.key}
                      data-item-id={entry.item.id}
                      role="menuitem"
                      type="button"
                      disabled={entry.item.disabled}
                      onClick={() => select(entry.item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(entry.item);
                        }
                      }}
                      onMouseEnter={() =>
                        !entry.item.disabled &&
                        setActiveIndex(selectable.findIndex((s) => s.kind === "item" && s.item.id === entry.item.id))
                      }
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-body-sm",
                        "text-ink transition-colors duration-fast",
                        "hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        entry.item.destructive && "text-danger hover:bg-danger/10 focus-visible:bg-danger/10",
                      )}
                    >
                      {entry.item.icon && <Icon name={entry.item.icon} size={18} aria-hidden />}
                      <span className="flex-1 truncate">{entry.item.label}</span>
                      {entry.item.shortcut && (
                        <kbd className="text-caption text-ink-3">{entry.item.shortcut}</kbd>
                      )}
                    </button>
                  ),
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
