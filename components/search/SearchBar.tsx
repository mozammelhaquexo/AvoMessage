/**
 * components/search/SearchBar.tsx — global search input.
 *
 * Owned by Frontend Engineer A.
 *
 * Submits to the documented `/search?q=` route (docs/ROUTES.md). The `compact`
 * variant renders the slim rail style used in the desktop RightPanel.
 *
 * Debounced suggestions (users + hashtags) in a dropdown, recent searches
 * persisted to localStorage, keyboard navigation, and submit → /search.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Icon } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiGet } from "@/lib/api-client";
import { useDebouncedValue } from "@/lib/hooks";
import type { HashtagResult, SearchUser } from "@/lib/api-types";

const RECENT_KEY = "avo:recent-searches";
const MAX_RECENT = 8;

export function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): void {
  const q = query.trim();
  if (!q || typeof window === "undefined") return;
  try {
    const next = [q, ...getRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function clearRecentSearches(): void {
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    /* storage unavailable */
  }
}

interface SearchBarProps {
  compact?: boolean;
  initialQuery?: string;
  autoFocus?: boolean;
  /** Called instead of navigating (used by inline contexts). */
  onSubmitQuery?: (query: string) => void;
  className?: string;
}

export function SearchBar({ compact = false, initialQuery = "", autoFocus = false, onSubmitQuery, className }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [tags, setTags] = useState<HashtagResult[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounced = useDebouncedValue(query.trim(), 250);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate recent searches when the dropdown opens
    setRecent(getRecentSearches());
  }, [focused]);

  // Suggestions.
  useEffect(() => {
    if (debounced.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale suggestions on query change
      setUsers([]);
      setTags([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      apiGet<{ data: SearchUser[] }>("/api/search", { params: { q: debounced, type: "users", limit: 5 } }).catch(() => ({ data: [] as SearchUser[] })),
      apiGet<{ data: HashtagResult[] }>("/api/search", { params: { q: debounced, type: "hashtags", limit: 5 } }).catch(() => ({ data: [] as HashtagResult[] })),
    ]).then(([u, t]) => {
      if (cancelled) return;
      setUsers(u.data);
      setTags(t.data);
      setActiveIndex(-1);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  // Close on outside click.
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [focused]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    saveRecentSearch(trimmed);
    setFocused(false);
    if (onSubmitQuery) onSubmitQuery(trimmed);
    else router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const suggestionItems: { key: string; label: React.ReactNode; run: () => void }[] = [
    ...users.map((u) => ({
      key: `u:${u.id}`,
      label: (
        <span className="flex items-center gap-2.5">
          <Avatar src={u.avatarUrl} name={u.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-body-sm font-medium text-ink">{u.name}</span>
            <span className="block truncate text-caption text-ink-3">@{u.username}</span>
          </span>
        </span>
      ),
      run: () => router.push(`/profile/${u.username}`),
    })),
    ...tags.map((t) => ({
      key: `t:${t.tag}`,
      label: (
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
            <Icon name="search" size={15} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body-sm font-medium text-ink">#{t.tag}</span>
            <span className="block text-caption text-ink-3">{t.usageCount} posts</span>
          </span>
        </span>
      ),
      run: () => router.push(`/hashtag/${encodeURIComponent(t.tag)}`),
    })),
  ];

  const showDropdown = focused && (query.trim().length === 0 ? recent.length > 0 : true);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && suggestionItems.length) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestionItems.length);
    } else if (e.key === "ArrowUp" && suggestionItems.length) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestionItems.length) % suggestionItems.length);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && suggestionItems[activeIndex]) {
        e.preventDefault();
        suggestionItems[activeIndex]!.run();
      } else {
        submit(query);
      }
    } else if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <form
        role="search"
        aria-label="Search AvoMessage"
        onSubmit={(e) => {
          e.preventDefault();
          submit(query);
        }}
      >
        <div className="relative">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            placeholder={compact ? "Search" : "Search people, posts, hashtags…"}
            autoFocus={autoFocus}
            autoComplete="off"
            aria-label="Search"
            aria-expanded={showDropdown}
            aria-controls="search-suggestions"
            role="combobox"
            aria-autocomplete="list"
            className={cn(
              "w-full rounded-full border border-line bg-surface-2 pl-10 pr-10 text-body-sm text-ink placeholder:text-ink-3",
              "transition-colors duration-fast hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none",
              compact ? "h-10" : "h-12",
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setUsers([]);
                setTags([]);
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      </form>

      {showDropdown && (
        <div
          id="search-suggestions"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 top-full z-dropdown mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          {query.trim().length === 0 ? (
            <>
              <div className="flex items-center justify-between px-4 pb-1 pt-3">
                <p className="text-tiny font-semibold uppercase tracking-wide text-ink-3">Recent</p>
                <button
                  type="button"
                  onClick={() => {
                    clearRecentSearches();
                    setRecent([]);
                  }}
                  className="text-caption font-medium text-brand-strong hover:underline"
                >
                  Clear
                </button>
              </div>
              <ul>
                {recent.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        submit(r);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                    >
                      <Icon name="clock" size={16} className="text-ink-3" aria-hidden />
                      <span className="truncate text-body-sm text-ink">{r}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : suggestionItems.length === 0 && debounced.length >= 2 ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                submit(query);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <Icon name="search" size={16} className="text-ink-3" aria-hidden />
              <span className="text-body-sm text-ink">
                Search for <span className="font-semibold">“{query.trim()}”</span>
              </span>
            </button>
          ) : (
            <ul>
              {suggestionItems.map((item, i) => (
                <li key={item.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      item.run();
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      "w-full px-3 py-2 text-left transition-colors",
                      i === activeIndex ? "bg-surface-2" : "bg-transparent",
                    )}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
