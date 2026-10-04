/**
 * components/companies/tabs/CompanyFeedTab.tsx — company workspace Feed tab.
 *
 * Extracted from CompanyWorkspace.tsx (code-review split; no behavior change).
 * Posts are the canonical `Post` shape — no adapter shim needed.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { PostCard } from "@/components/posts/PostCard";
import { PostComposer } from "@/components/posts/PostComposer";
import type { Post } from "@/lib/api-types";
import type { Paginated } from "@/lib/types";

export function CompanyFeedTab({ companyId }: { companyId: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (c?: string) => {
      if (c) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await apiGet<Paginated<Post>>(`/api/companies/${companyId}/posts`, {
          params: { limit: 10, ...(c ? { cursor: c } : {}) },
        });
        setPosts((prev) => (c ? [...prev, ...res.data] : res.data));
        setCursor(res.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load posts.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [companyId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4 py-4">
      <PostComposer companyId={companyId} onPosted={(p) => setPosts((prev) => [p, ...prev])} placeholder="Share an update with the company…" />
      {loading ? (
        <LoadingState message="Loading feed…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : posts.length === 0 ? (
        <EmptyState icon="comment" title="Nothing here yet" description="Company posts will show up here." compact />
      ) : (
        <>
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void load(cursor)} loading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
