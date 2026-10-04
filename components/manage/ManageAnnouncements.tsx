/**
 * components/manage/ManageAnnouncements.tsx — company announcements.
 *
 * Managers post announcements (COMPANY-visibility posts authored by managers);
 * all members can read them. Backed by /api/companies/[id]/announcements.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { PostCard } from "@/components/posts/PostCard";
import { Avatar, Button, Card, EmptyState, ErrorState, Icon, LoadingState, Textarea } from "@/components/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import type { Post } from "@/lib/api-types";
import { useManage } from "./ManageShell";

interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export function ManageAnnouncements() {
  const { detail } = useManage();
  const companyId = detail.company.id;
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(
    async (c?: string | null, append = false) => {
      const url = `/api/companies/${companyId}/announcements?limit=10${c ? `&cursor=${encodeURIComponent(c)}` : ""}`;
      const page = await apiGet<Page<Post>>(url);
      if (append) setPosts((p) => [...p, ...page.data]);
      else setPosts(page.data);
      setCursor(page.nextCursor);
    },
    [companyId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load(null, false);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load announcements");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(cursor, true);
    } finally {
      setLoadingMore(false);
    }
  };

  const publish = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const post = await apiPost<Post>(`/api/companies/${companyId}/announcements`, { body: text });
      setPosts((p) => [post, ...p]);
      setBody("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to publish announcement");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
        <p className="text-sm text-ink-2 mt-1">
          Broadcast messages to every member of {detail.company.name}.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex gap-3">
          <Avatar name={detail.company.name} src={detail.company.logoUrl} size="md" fallbackIcon="building" />
          <div className="flex-1 space-y-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Announce something to ${detail.company.name}…`}
              rows={3}
              maxLength={2000}
              aria-label="Announcement text"
            />
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
                <Icon name="building" size={14} />
                Visible to all company members
              </span>
              <Button onClick={publish} loading={posting} disabled={!body.trim()}>
                Publish
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <LoadingState message="Loading announcements…" />
      ) : error && posts.length === 0 ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : posts.length === 0 ? (
        <EmptyState
          title="No announcements yet"
          description="Publish the first announcement to keep your team in the loop."
        />
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              linkComments={false}
              onDeleted={(id) => setPosts((list) => list.filter((x) => x.id !== id))}
              onUpdated={(u) => setPosts((list) => list.map((x) => (x.id === u.id ? u : x)))}
            />
          ))}
          {cursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} loading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
