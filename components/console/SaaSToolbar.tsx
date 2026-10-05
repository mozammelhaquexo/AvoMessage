/**
 * components/console/SaaSToolbar.tsx — the shared toolbar for the Admin and
 * Manager consoles.
 *
 * Four controls, all of them doing real work:
 *
 *   - **Section palette** (`⌘K` / `Ctrl+K`) — substring search over the
 *     console's own sections (label + optional keywords), keyboard navigable
 *     with ↑/↓/Enter. Navigation goes through the router, so it is the same
 *     jump the nav tabs perform.
 *   - **Refresh** — `router.refresh()` re-runs the current route's server
 *     components and refetches the client data that hangs off them.
 *   - **Export CSV** — rendered only when a caller passes `onExport`, so the
 *     button never appears where it would do nothing.
 *   - **Shortcuts** (`?`) — a disclosure listing the keys this toolbar binds.
 *
 * Deliberately a page/panel-level component rather than a global one: the
 * palette needs to know which sections exist, and only the caller knows that.
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, Input, useClickOutside, useEscapeKey, type IconName } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { matchSections } from "@/lib/console-nav";

export interface SaaSToolbarSection {
  id: string;
  label: string;
  href: string;
  icon?: IconName;
  /** Extra search terms that should match this section. */
  keywords?: string[];
}

export interface SaaSToolbarProps {
  /** Sections the palette can jump to. Omit to hide the search box. */
  sections?: SaaSToolbarSection[];
  /** Extra shortcut rows shown in the `?` panel. */
  hints?: { keys: string; label: string }[];
  /** When provided, an Export CSV button is rendered. */
  onExport?: () => void;
  exportLabel?: string;
  /** Accessible label for the toolbar itself. */
  label?: string;
  className?: string;
  /** Rendered after the built-in controls — page-specific filters etc. */
  children?: ReactNode;
  /**
   * Which bar this is.
   *
   * `"console"` (default) is the console-level bar: the search palette,
   * Refresh and the shortcuts panel — one per console, rendered by the shell.
   *
   * `"page"` is a page-level bar. It renders ONLY what the page itself
   * supplies (Export CSV, `children`) because the console bar directly above
   * already owns search, Refresh and help. The Admin console shipped with
   * both: AdminShell rendered a full toolbar and then Applications, Content
   * and Managers each rendered a second, near-identical one — two search
   * boxes, two Refresh buttons and two help buttons stacked on one page.
   */
  variant?: "console" | "page";
}

/** True when the event target is somewhere the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** The platform never changes, so there is nothing to subscribe to. */
const subscribeToNothing = () => () => {};

export function SaaSToolbar({
  sections,
  hints,
  onExport,
  exportLabel = "Export CSV",
  label = "Console toolbar",
  className,
  children,
  variant = "console",
}: SaaSToolbarProps) {
  const isConsole = variant === "console";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);

  // Platform detection via `useSyncExternalStore` rather than a mount effect:
  // the server snapshot is `false`, so SSR and the first client render agree,
  // and no state is set synchronously inside an effect.
  const isMac = useSyncExternalStore(
    subscribeToNothing,
    () => /Mac|iP(hone|ad|od)/.test(typeof navigator === "undefined" ? "" : navigator.platform ?? ""),
    () => false,
  );

  const modKey = isMac ? "⌘" : "Ctrl";

  const matches = useMemo(
    () => matchSections(sections ?? [], query),
    [sections, query],
  );

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  useClickOutside(paletteRef, open, closePalette);
  useEscapeKey(open, () => {
    closePalette();
    inputRef.current?.blur();
  });
  useClickOutside(hintsRef, hintsOpen, () => setHintsOpen(false));
  useEscapeKey(hintsOpen, () => setHintsOpen(false));

  const go = useCallback(
    (href: string) => {
      closePalette();
      inputRef.current?.blur();
      router.push(href);
    },
    [closePalette, router],
  );

  // Global shortcuts. Bound on `window` so they work wherever focus sits,
  // except inside a text field (where `?` is just a question mark).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
        return;
      }
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setHintsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = matches[activeIndex];
      if (hit) {
        e.preventDefault();
        go(hit.href);
      }
    } else if (e.key === "Escape") {
      closePalette();
    }
  }

  function refresh() {
    setRefreshing(true);
    router.refresh();
    // `router.refresh()` resolves as soon as the request is kicked off, so a
    // short hold is the honest feedback: something was asked for, and the
    // route is re-rendering.
    window.setTimeout(() => setRefreshing(false), 700);
  }

  const shortcutRows = [
    { keys: `${modKey} K`, label: "Search sections" },
    { keys: "?", label: "Toggle this panel" },
    { keys: "↑ ↓", label: "Move through results" },
    { keys: "Enter", label: "Open the highlighted section" },
    { keys: "Esc", label: "Close the palette" },
    ...(hints ?? []),
  ];

  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/70 px-2 py-2 backdrop-blur",
        className,
      )}
    >
      {isConsole && sections && sections.length > 0 && (
        <div ref={paletteRef} className="relative min-w-[12rem] flex-1">
          <Icon
            name="search"
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onInputKeyDown}
            placeholder={`Search sections…  ${modKey} K`}
            aria-label="Search console sections"
            aria-expanded={open}
            aria-controls="saas-toolbar-palette"
            aria-autocomplete="list"
            role="combobox"
            className="h-9 pl-9 pr-3"
          />

          {open && (
            <ul
              id="saas-toolbar-palette"
              role="listbox"
              aria-label="Matching sections"
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop"
            >
              {matches.length === 0 ? (
                <li className="px-3 py-2 text-body-sm text-ink-3">No matching section.</li>
              ) : (
                matches.map((s, i) => (
                  <li key={s.id} role="option" aria-selected={i === activeIndex}>
                    <button
                      type="button"
                      // Pointer-down would steal focus from the input and the
                      // click-outside handler would fire first.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(s.href)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-body-sm",
                        i === activeIndex ? "bg-brand-soft text-ink" : "text-ink-2 hover:bg-surface-2",
                      )}
                    >
                      {s.icon && <Icon name={s.icon} size={15} aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      <span className="shrink-0 truncate text-caption text-ink-3">{s.href}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}

      {isConsole && (
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          loading={refreshing}
          aria-label="Refresh this page"
        >
          <Icon name="refresh" size={15} aria-hidden />
          <span className="ml-1.5">Refresh</span>
        </Button>
      )}

      {onExport && (
        <Button variant="outline" size="sm" onClick={onExport} aria-label={exportLabel}>
          <Icon name="download" size={15} aria-hidden />
          <span className="ml-1.5">{exportLabel}</span>
        </Button>
      )}

      {isConsole && (
        <div ref={hintsRef} className="relative">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Keyboard shortcuts"
            aria-expanded={hintsOpen}
            onClick={() => setHintsOpen((v) => !v)}
          >
            <Icon name="help" size={15} aria-hidden />
          </Button>
          {hintsOpen && (
            <div
              role="dialog"
              aria-label="Keyboard shortcuts"
              className="absolute right-0 top-[calc(100%+6px)] z-40 w-64 rounded-lg border border-line bg-surface p-3 shadow-pop"
            >
              <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-3">
                Shortcuts
              </p>
              <dl className="flex flex-col gap-1.5">
                {shortcutRows.map((row) => (
                  <div key={row.keys} className="flex items-center justify-between gap-3">
                    <dt className="text-body-sm text-ink-2">{row.label}</dt>
                    <dd>
                      <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-tiny text-ink-2">
                        {row.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}

      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
