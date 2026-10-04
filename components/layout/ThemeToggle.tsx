/**
 * components/layout/ThemeToggle.tsx — light/dark/system theme switcher.
 * Hand-rolled sun/moon SVG (the icon set has no weather glyphs); respects
 * the same tokens as everything else.
 */
"use client";

import { useTheme } from "@/lib/theme";
import { cn } from "@/components/ui/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const cycle = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "system" ? "Theme: system" : `Theme: ${theme}`}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast",
        "hover:bg-surface-2 hover:text-ink active:bg-line/50",
        className,
      )}
    >
      {/* Both glyphs are always rendered; the `.dark` class that <ThemeScript />
          writes to <html> before first paint decides which one is visible.
          That keeps the icon correct from the very first frame (no flip after
          hydration) and keeps the SSR and client markup identical. */}
      <svg
        viewBox="0 0 24 24"
        className="hidden h-5 w-5 dark:block"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        className="block h-5 w-5 dark:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M20 13.2A8.2 8.2 0 0 1 10.8 4 8.2 8.2 0 1 0 20 13.2Z" />
      </svg>
    </button>
  );
}
