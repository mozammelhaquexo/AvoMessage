"use client";

/**
 * Select — custom listbox (button + popup).
 * Keyboard: Enter/Space/ArrowDown opens · ArrowUp/Down navigate ·
 * Enter selects · Escape closes · type-ahead jumps to matches.
 */

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "./utils";
import { Icon } from "./icons";
import { scaleIn } from "@/lib/motion";
import { useMounted } from "./use-overlay";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  label,
  disabled,
  invalid,
  className,
  id: idProp,
}: SelectProps) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [typeahead, setTypeahead] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonId = useId();
  const listId = useId();
  const id = idProp ?? buttonId;
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const close = (refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    setTypeahead("");
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onValueChange?.(option.value);
    close();
  };

  // Close on outside pointer + scroll/resize.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        !buttonRef.current?.contains(e.target as Node) &&
        !listRef.current?.contains(e.target as Node)
      ) {
        close(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openWithActive = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  const move = (delta: 1 | -1) => {
    setActiveIndex((prev) => {
      let next = prev + delta;
      // Skip disabled options.
      let guard = 0;
      while (guard++ < options.length && options[next]?.disabled) next += delta;
      return Math.max(0, Math.min(options.length - 1, next));
    });
  };

  const onTypeahead = (char: string) => {
    const next = typeahead + char.toLowerCase();
    setTypeahead(next);
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = setTimeout(() => setTypeahead(""), 600);
    const match = options.findIndex(
      (o) => !o.disabled && o.label.toLowerCase().startsWith(next),
    );
    if (match >= 0) setActiveIndex(match);
  };

  // Keep the active option visible.
  useEffect(() => {
    if (open && activeIndex >= 0) {
      listRef.current
        ?.querySelector(`[data-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openWithActive(Math.max(0, selectedIndex)))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openWithActive(Math.max(0, selectedIndex));
            else move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) openWithActive(Math.max(0, selectedIndex));
            else move(-1);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!open) {
              openWithActive(Math.max(0, selectedIndex));
            } else {
              const opt = options[activeIndex];
              if (opt) choose(opt);
            }
          } else if (e.key === "Home" && open) {
            e.preventDefault();
            setActiveIndex(0);
          } else if (e.key === "End" && open) {
            e.preventDefault();
            setActiveIndex(options.length - 1);
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (!open) openWithActive(Math.max(0, selectedIndex));
            onTypeahead(e.key);
          }
        }}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-surface-2 px-4",
          "text-left text-body-sm text-ink transition-colors duration-fast",
          "border-line hover:border-line-strong",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30",
          "disabled:cursor-not-allowed disabled:opacity-60",
          invalid && "border-danger focus:ring-danger/25",
          !selected && "text-ink-3",
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <Icon
          name="chevronDown"
          size={18}
          className={cn("text-ink-3 transition-transform duration-fast", open && "rotate-180")}
        />
      </button>

      {mounted && (
        <AnimatePresence>
          {open && (
            <motion.ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={label}
              variants={scaleIn}
              initial="hidden"
              animate="show"
              exit="exit"
              style={{ transformOrigin: "top center" }}
              className={cn(
                "absolute z-dropdown mt-2 max-h-64 w-full overflow-y-auto rounded-lg border border-line",
                "bg-surface p-1.5 shadow-lg",
              )}
            >
              {options.map((option, i) => (
                <li
                  key={option.value}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  tabIndex={-1}
                  onClick={() => choose(option)}
                  onMouseEnter={() => !option.disabled && setActiveIndex(i)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-md px-3",
                    "text-body-sm text-ink transition-colors duration-fast",
                    i === activeIndex && "bg-surface-2",
                    option.value === value && "font-semibold",
                    option.disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value && (
                    <Icon name="check" size={16} className="text-brand-strong" />
                  )}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
