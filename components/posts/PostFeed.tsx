/**
 * components/posts/PostFeed.tsx — infinite post feed.
 *
 * Wraps useInfiniteList with post skeletons, empty/error states, an
 * intersection sentinel, pull-to-refresh (mobile), and live prepending:
 * - listens for the `avo:post-created` window event (composer, repost),
 * - optionally prepends realtime `feed:post:new` payloads via `live`.
 *
 * `filter` lets callers (e.g. /home) narrow server pages client-side;
 * `sort` lets /world apply the personalized ordering.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  Spinner,
  toPresenceStatus,
  type IconName,
} from "@/components/ui";
import { useInfiniteList, useIntersectionObserver } from "@/lib/hooks";
import { useFeedUpdates, usePresence } from "@/lib/realtime/client";
import type { FeedPostPayload } from "@/lib/realtime/events";
import { fadeUp } from "@/lib/motion";
import type { Page, Post } from "@/lib/api-types";
import { PostCard } from "./PostCard";

interface PostFeedProps {
  /** Fetch one page; receives the cursor (null for the first page). */
  loadPage: (cursor: string | null) => Promise<Page<Post>>;
  /** Client-side predicate applied to each page (e.g. home = followed only). */
  filter?: (post: Post) => boolean;
  /** Client-side ordering applied after each prepend (e.g. personalized). */
  sort?: (a: Post, b: Post) => number;
  /** Prepend realtime World posts as they arrive (default true). */
  live?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: IconName;
  /** When set, new live posts wait behind a pill instead of auto-prepending. */
  livePill?: boolean;
}

function adaptFeedPayload(payload: FeedPostPayload): Post {
  return {
    id: payload.id,
    body: payload.body,
    visibility: "PUBLIC",
    companyId: null,
    author: {
      id: payload.author?.id ?? payload.authorId,
      name: payload.author?.name ?? "Someone",
      username: payload.author?.username ?? "unknown",
      avatarUrl: payload.author?.avatarUrl ?? null,
      isVerified: false,
    },
    media: [],
    counts: { likes: payload.likeCount, comments: payload.commentCount, shares: 0 },
    viewerState: { liked: false, bookmarked: false },
    createdAt: payload.createdAt,
    updatedAt: payload.createdAt,
  };
}

export function PostFeed({
  loadPage,
  filter,
  sort,
  live = true,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Posts from people you follow will show up here.",
  emptyIcon = "sparkles",
  livePill = false,
}: PostFeedProps) {
  const filterRef = useRef(filter);
  // `filter` may be recreated by the caller on each render; keep the latest
  // without invalidating the page loader.
  useEffect(() => {
    filterRef.current = filter;
  });

  const list = useInfiniteList<Post>(
    useCallback(
      async (cursor: string | null) => {
        const page = await loadPage(cursor);
        const data = filterRef.current ? page.data.filter(filterRef.current) : page.data;
        return { data, nextCursor: page.nextCursor };
      },
      [loadPage],
    ),
    (p) => p.id,
  );

  const [pendingLive, setPendingLive] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const atTopRef = useRef(true);

  // Feature 1 — one presence subscription for the whole visible feed. Passing
  // the batched result down keeps this to a single socket listener and a single
  // REST seed, instead of one of each per PostCard.
  const authorIds = useMemo(
    () => [...new Set(list.items.map((p) => p.author.id))],
    [list.items],
  );
  const presence = usePresence(authorIds);

  const applyIncoming = useCallback(
    (posts: Post[]) => {
      if (sort) {
        list.setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const merged = [...posts.filter((p) => !seen.has(p.id)), ...prev];
          return merged.sort(sort);
        });
      } else {
        list.prepend(posts);
      }
    },
    [list, sort],
  );

  // Live prepend: composer/repost events always apply.
  useEffect(() => {
    const onCreated = (e: Event) => {
      const post = (e as CustomEvent<Post>).detail;
      if (!post?.id) return void list.refresh();
      if (filterRef.current && !filterRef.current(post)) return;
      applyIncoming([post]);
    };
    window.addEventListener("avo:post-created", onCreated);
    return () => window.removeEventListener("avo:post-created", onCreated);
  }, [applyIncoming, list]);

  // Realtime World posts.
  useFeedUpdates(
    useCallback(
      (payload: FeedPostPayload) => {
        if (!live) return;
        const post = adaptFeedPayload(payload);
        if (!post.id) return;
        if (filterRef.current && !filterRef.current(post)) return;
        if (livePill && !atTopRef.current) {
          setPendingLive((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
        } else {
          applyIncoming([post]);
        }
      },
      [live, livePill, applyIncoming],
    ),
  );

  // Track whether the user is at the top (for the live pill).
  useEffect(() => {
    const onScroll = () => {
      atTopRef.current = window.scrollY < 240;
      if (atTopRef.current && pendingLive.length) {
        applyIncoming(pendingLive);
        setPendingLive([]);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pendingLive, applyIncoming]);

  const sentinelRef = useIntersectionObserver(list.loadMore, {
    enabled: list.hasMore && !list.error && !list.loading,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await list.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  // Pull-to-refresh: simple touch gesture at the very top of the page.
  const touchStartY = useRef<number | null>(null);
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) touchStartY.current = e.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStartY.current;
      touchStartY.current = null;
      if (start === null || window.scrollY !== 0) return;
      const end = e.changedTouches[0]?.clientY ?? start;
      if (end - start > 120 && !list.loading) void onRefresh();
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.loading]);

  return (
    <div className="flex flex-col gap-3" role="feed" aria-label="Posts" aria-busy={list.loading}>
      {/* New-posts pill */}
      {pendingLive.length > 0 && (
        <div className="sticky top-16 z-sticky flex justify-center lg:top-4">
          <Button
            size="sm"
            className="shadow-lg"
            onClick={() => {
              applyIncoming(pendingLive);
              setPendingLive([]);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <Icon name="refresh" size={16} />
            {pendingLive.length} new {pendingLive.length === 1 ? "post" : "posts"}
          </Button>
        </div>
      )}

      {refreshing && (
        <div className="flex justify-center py-2" aria-label="Refreshing feed">
          <Spinner size="sm" />
        </div>
      )}

      {list.loading ? (
        <PostSkeletons />
      ) : list.error && list.items.length === 0 ? (
        <ErrorState
          title="Couldn't load the feed"
          message={list.error.message}
          retryLabel="Try again"
          onRetry={list.retry}
        />
      ) : list.items.length === 0 ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {list.items.map((post, i) => (
            <motion.div
              key={post.id}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              transition={{ delay: Math.min(i, 5) * 0.04 }}
            >
              <PostCard
                post={post}
                authorStatus={toPresenceStatus(presence[post.author.id]?.status)}
                onDeleted={(id) => list.removeWhere((p) => p.id === id)}
                onUpdated={(updated) =>
                  list.setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                }
              />
            </motion.div>
          ))}
          {list.error && (
            <ErrorState
              title="Couldn't load more posts"
              message={list.error.message}
              retryLabel="Try again"
              onRetry={list.retry}
              compact
            />
          )}
          {list.loadingMore && (
            <div className="flex justify-center py-4" aria-label="Loading more posts">
              <Spinner />
            </div>
          )}
          {list.hasMore && !list.error && <div ref={sentinelRef} aria-hidden className="h-2" />}
          {!list.hasMore && list.items.length > 0 && (
            <p className="py-6 text-center text-caption text-ink-3">You&apos;re all caught up.</p>
          )}
        </>
      )}
    </div>
  );
}

export function PostSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-label="Loading posts">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex gap-3">
            <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="mt-1 h-3 w-24 rounded" />
            </div>
          </div>
          <Skeleton className="mt-3 h-4 w-full rounded" />
          <Skeleton className="mt-2 h-4 w-3/4 rounded" />
          <Skeleton className="mt-3 h-44 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
