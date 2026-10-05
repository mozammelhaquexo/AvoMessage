"use client";

/**
 * Tabs — accessible tablist with arrow-key navigation.
 * Controlled or uncontrolled. Panels render lazily on first activation, where
 * "activation" includes the currently-active panel — see the note in TabPanel
 * for the deep-linked-tab bug that distinction fixes.
 */

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import { cn } from "./utils";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Badge content (e.g. count). */
  badge?: ReactNode;
  disabled?: boolean;
}

interface TabsContextValue {
  activeId: string;
  setActiveId: (id: string) => void;
  baseId: string;
  visited: Set<string>;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tab components must be used inside <Tabs>");
  return ctx;
}

export interface TabsProps {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Accessible label for the tablist. */
  label: string;
  className?: string;
  children: ReactNode;
}

export function Tabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
  children,
}: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id ?? "");
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set([value ?? defaultValue ?? tabs[0]?.id ?? ""]),
  );
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeId = value ?? internal;
  const setActiveId = (id: string) => {
    setVisited((prev) => new Set(prev).add(id));
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
  };

  const focusTab = (index: number) => {
    const el = tabRefs.current[index];
    el?.focus();
    const tab = tabs[index];
    if (tab && !tab.disabled) setActiveId(tab.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const enabled = tabs.map((t, i) => ({ t, i })).filter(({ t }) => !t.disabled);
    const currentPos = enabled.findIndex(({ t }) => t.id === activeId);
    let nextPos: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextPos = (currentPos + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      nextPos = (currentPos - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") nextPos = 0;
    else if (e.key === "End") nextPos = enabled.length - 1;
    if (nextPos !== null && enabled[nextPos]) {
      e.preventDefault();
      focusTab(enabled[nextPos].i);
    }
  };

  return (
    <TabsContext.Provider value={{ activeId, setActiveId, baseId, visited }}>
      <div className={className}>
        <div
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line"
        >
          {tabs.map((tab, i) => {
            const selected = tab.id === activeId;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${tab.id}`}
                disabled={tab.disabled}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "relative flex min-h-11 shrink-0 items-center gap-2 px-4 text-body-sm font-medium",
                  "transition-colors duration-fast",
                  selected ? "text-brand-strong" : "text-ink-2 hover:text-ink",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "focus-visible:outline-2 focus-visible:outline-brand",
                )}
              >
                {tab.label}
                {tab.badge}
                {selected && (
                  <motion.span
                    layoutId={`${baseId}-indicator`}
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

/**
 * Should this panel be rendered at all?
 *
 * Panels render lazily on first activation — but "activation" has to include
 * the panel that is ALREADY active.
 *
 * `visited` only grows through `setActiveId`, which the tab buttons call. A
 * CONTROLLED `<Tabs>` can be switched from outside it, and Settings does
 * exactly that: it reads `?tab=` on mount and calls its own `setTab` directly.
 * That never reaches `setActiveId`, so `visited` stayed `{"profile"}` while
 * `activeId` was `"manager"` — the tab strip highlighted Manager and the panel
 * below it rendered nothing until the tab was clicked by hand.
 *
 * That is the reported symptom: "Settings section theke manager apply korar por
 * manager page e kichui show hoy na". The apply page redirects to
 * `/settings?tab=manager`, and the panel there was blank.
 *
 * Extracted and exported so the three cases are reachable from a test without
 * a DOM — see tests/tabs-deep-link.test.tsx.
 */
export function shouldRenderPanel(
  id: string,
  activeId: string,
  visited: ReadonlySet<string>,
): boolean {
  return id === activeId || visited.has(id);
}

export function TabPanel({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { activeId, baseId, visited } = useTabsContext();
  const selected = id === activeId;
  if (!shouldRenderPanel(id, activeId, visited)) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${id}`}
      aria-labelledby={`${baseId}-tab-${id}`}
      hidden={!selected}
      tabIndex={0}
      className={cn("pt-4 focus-visible:outline-2 focus-visible:outline-brand", className)}
    >
      {children}
    </div>
  );
}
