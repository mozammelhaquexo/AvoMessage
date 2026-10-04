/**
 * lib/hooks.ts — shared client hooks.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api-client";
import type { Page } from "./api-types";

/** Debounce a fast-changing value (search inputs, typing). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Observe when an element scrolls into view (infinite-scroll sentinel). */
export function useIntersectionObserver(
  onIntersect: () => void,
  opts: { enabled?: boolean; rootMargin?: string } = {},
): (node: HTMLElement | null) => void {
  const { enabled = true, rootMargin = "600px" } = opts;
  const callbackRef = useRef(onIntersect);
  // Keep the latest callback without re-creating the observer.
  useEffect(() => {
    callbackRef.current = onIntersect;
  });

  return useCallback(
    (node: HTMLElement | null) => {
      if (!node || !enabled) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) callbackRef.current();
        },
        { rootMargin },
      );
      observer.observe(node);
      // Disconnect when React detaches the node.
      return () => observer.disconnect();
    },
    [enabled, rootMargin],
  );
  // Note: the returned ref callback intentionally creates a fresh observer per
  // node attach; React calls the previous ref with null on detach.
}

export interface InfiniteList<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  /** Prepend items (live updates), deduping by `getId`. */
  prepend: (newItems: T[]) => void;
  /** Remove items matching a predicate (e.g. after delete). */
  removeWhere: (predicate: (item: T) => boolean) => void;
  loadMore: () => void;
  refresh: () => Promise<void>;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  retry: () => void;
}

/**
 * Cursor-paginated infinite list over a `{ data, nextCursor }` endpoint.
 * `loadPage(cursor)` must be stable or wrapped — it is read via ref.
 */
export function useInfiniteList<T>(
  loadPage: (cursor: string | null) => Promise<Page<T>>,
  getId: (item: T) => string,
): InfiniteList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const loadPageRef = useRef(loadPage);
  // `loadPage` may be recreated by the caller on each render; read it via
  // ref so the fetch callback stays stable.
  useEffect(() => {
    loadPageRef.current = loadPage;
  });
  const inFlightRef = useRef(false);

  const fetchPage = useCallback(
    async (pageCursor: string | null, reset: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const page = await loadPageRef.current(pageCursor);
        setItems((prev) => {
          const seen = new Set(prev.map(getId));
          const fresh = page.data.filter((it) => !seen.has(getId(it)));
          return reset ? page.data : [...prev, ...fresh];
        });
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setError(null);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e
            : new ApiError("UNKNOWN_ERROR", "Failed to load. Please try again.", 0),
        );
      } finally {
        inFlightRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    // getId is expected to be a stable module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const loadMore = useCallback(() => {
    if (loading || loadingMore || error || !hasMore) return;
    void fetchPage(cursor, false);
  }, [loading, loadingMore, error, hasMore, cursor, fetchPage]);

  const refresh = useCallback(async () => {
    setCursor(null);
    setHasMore(true);
    await fetchPage(null, true);
  }, [fetchPage]);

  const retry = useCallback(() => {
    if (loading) return;
    void fetchPage(cursor, items.length === 0);
  }, [loading, cursor, items.length, fetchPage]);

  const prepend = useCallback(
    (newItems: T[]) => {
      setItems((prev) => {
        const seen = new Set(prev.map(getId));
        const fresh = newItems.filter((it) => !seen.has(getId(it)));
        return fresh.length ? [...fresh, ...prev] : prev;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const removeWhere = useCallback((predicate: (item: T) => boolean) => {
    setItems((prev) => prev.filter((it) => !predicate(it)));
  }, []);

  // Initial page load on mount. This is the canonical fetch-on-mount
  // pattern: there is no user event to hoist the fetch into.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only initial fetch
    void fetchPage(null, true);
  }, [fetchPage]);

  return {
    items,
    setItems,
    prepend,
    removeWhere,
    loadMore,
    refresh,
    hasMore,
    loading,
    loadingMore,
    error,
    retry,
  };
}

/** Previous value (for edge-triggered effects). */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  // Canonical usePrevious: the ref still holds the value from the previous
  // render until this render's effect runs.
  // eslint-disable-next-line react-hooks/refs -- intentional: read previous render's value
  return ref.current;
}
