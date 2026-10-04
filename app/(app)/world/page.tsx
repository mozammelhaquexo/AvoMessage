/**
 * app/(app)/world/page.tsx — the public World feed.
 *
 * Chronological (server order) + Personalized (followed authors first, then
 * by engagement) toggle, infinite scroll, skeletons, empty/error recovery,
 * and live prepending of new posts via useFeedUpdates (behind a pill when
 * scrolled down).
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import type { Page, Post, SearchUser } from "@/lib/api-types";
import { PostComposer } from "@/components/posts/PostComposer";
import { PostFeed } from "@/components/posts/PostFeed";

const PAGE_SIZE = 20;

type Mode = "chronological" | "personalized";

export default function WorldPage() {
  const { user } = useSession();
  const [mode, setMode] = useState<Mode>("chronological");
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [feedKey, setFeedKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiGet<Page<SearchUser>>(`/api/users/${user.username}/following`, { params: { limit: 100 } })
      .then((res) => {
        if (!cancelled) setFollowingIds(new Set(res.data.map((u) => u.id)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadPage = useCallback(
    (cursor: string | null) => apiGet<Page<Post>>("/api/posts", { params: { cursor, limit: PAGE_SIZE } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feedKey],
  );

  /** Personalized ordering: followed authors first, then by engagement. */
  const sort = useMemo(() => {
    if (mode !== "personalized") return undefined;
    return (a: Post, b: Post) => {
      const aF = followingIds.has(a.author.id) || a.author.id === user?.id ? 1 : 0;
      const bF = followingIds.has(b.author.id) || b.author.id === user?.id ? 1 : 0;
      if (aF !== bF) return bF - aF;
      const aE = a.counts.likes * 2 + a.counts.comments * 3 + a.counts.shares * 4;
      const bE = b.counts.likes * 2 + b.counts.comments * 3 + b.counts.shares * 4;
      if (aE !== bE) return bE - aE;
      return b.createdAt.localeCompare(a.createdAt);
    };
  }, [mode, followingIds, user?.id]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 font-bold tracking-tight">World</h1>
        <SegmentedControl
          label="Feed ordering"
          size="sm"
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode);
            setFeedKey((k) => k + 1); // reset pagination on mode switch
          }}
          options={[
            { value: "chronological", label: "Latest" },
            { value: "personalized", label: "For you" },
          ]}
        />
      </div>

      <div className="hidden sm:block">
        <PostComposer placeholder="Share something with the world…" />
      </div>

      <PostFeed
        key={feedKey}
        loadPage={loadPage}
        sort={sort}
        livePill
        emptyTitle="The world is quiet"
        emptyDescription="Be the first to post — say hello to the community."
        emptyIcon="globe"
      />
    </div>
  );
}
