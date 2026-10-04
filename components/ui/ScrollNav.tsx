"use client";

/**
 * ScrollNav — horizontally-scrollable nav rail with overflow affordances.
 *
 * - Touch/wheel scroll works natively (`overflow-x-auto`).
 * - Edge fade gradients (left/right) fade in when there's hidden content on
 *   that side, hinting at scrollability.
 * - Optional chevron buttons (◀ ▶) appear on the corresponding edge when
 *   scrollable, smooth-scroll by `scrollAmount` px on click.
 * - All affordances reactively reflect scroll position, resize, and font load.
 *
 * Used by /admin (admin console) and /manage/[slug] (company console).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui";
import { cn } from "@/components/ui/utils";

export interface ScrollNavItem {
  id: string;
  label: string;
  icon: import("@/components/ui").IconName;
  href: string;
}

interface ScrollNavProps {
  items: ScrollNavItem[];
  activeId: string;
  /** A11y label for the nav element (e.g. "Admin sections"). */
  ariaLabel: string;
  /** Render fn for each item — receives the item + active flag. */
  renderItem: (item: ScrollNavItem, active: boolean) => ReactNode;
  /** Pixels to scroll per chevron click. Defaults to 220. */
  scrollAmount?: number;
}

type ScrollEdge = "start" | "middle" | "end";

export function ScrollNav({
  items,
  activeId,
  ariaLabel,
  renderItem,
  scrollAmount = 220,
}: ScrollNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState<ScrollEdge>("start");

  const measure = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      setEdge("start");
      return;
    }
    const left = el.scrollLeft;
    if (left <= 1) setEdge("start");
    else if (left >= max - 1) setEdge("end");
    else setEdge("middle");
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [measure]);

  const scrollBy = (delta: number) => {
    navRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  const showLeftEdge = edge !== "start";
  const showRightEdge = edge !== "end";

  return (
    <div className="relative mt-5">
      {/* Left edge fade */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-canvas to-transparent transition-opacity duration-base ease-out",
          showLeftEdge ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Right edge fade */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-canvas to-transparent transition-opacity duration-base ease-out",
          showRightEdge ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Left scroll button */}
      <button
        type="button"
        aria-label="Scroll tabs left"
        onClick={() => scrollBy(-scrollAmount)}
        className={cn(
          "absolute left-0 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 shadow-md transition-all duration-fast ease-out hover:bg-surface-2 hover:text-ink",
          showLeftEdge ? "pointer-events-auto opacity-90" : "pointer-events-none opacity-0",
        )}
        tabIndex={showLeftEdge ? 0 : -1}
      >
        <Icon name="chevronLeft" size={16} aria-hidden />
      </button>

      {/* Right scroll button */}
      <button
        type="button"
        aria-label="Scroll tabs right"
        onClick={() => scrollBy(scrollAmount)}
        className={cn(
          "absolute right-0 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 shadow-md transition-all duration-fast ease-out hover:bg-surface-2 hover:text-ink",
          showRightEdge ? "pointer-events-auto opacity-90" : "pointer-events-none opacity-0",
        )}
        tabIndex={showRightEdge ? 0 : -1}
      >
        <Icon name="chevronRight" size={16} aria-hidden />
      </button>

      <nav
        ref={navRef}
        aria-label={ariaLabel}
        className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line scroll-smooth"
      >
        {items.map((s) => renderItem(s, s.id === activeId))}
      </nav>
    </div>
  );
}