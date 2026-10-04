/**
 * components/layout/TopBar.tsx — slim mobile header (<lg).
 * Brand mark, theme toggle, and a search shortcut. Desktop uses the
 * sidebar + right rail instead.
 */
"use client";

import Link from "next/link";
import { Icon } from "@/components/ui";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar() {
  return (
    <header className="sticky top-0 z-sticky border-b border-line bg-canvas/85 backdrop-blur-xl lg:hidden">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <Link href="/home" className="flex items-center gap-2" aria-label="AvoMessage home">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-cta text-on-brand"
          >
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor" aria-hidden>
              <path d="M12 2C7 2 3 6.5 3 12c0 2.4.9 4.6 2.3 6.3L3 21l2.8-2.1c1.3.7 2.7 1.1 4.2 1.1h2c5 0 9-4.5 9-10S17 2 12 2Z" />
            </svg>
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            Avo<span className="text-brand-gradient">Message</span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/search"
            aria-label="Search"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="search" size={22} />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
