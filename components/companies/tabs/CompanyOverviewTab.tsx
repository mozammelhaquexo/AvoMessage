/**
 * components/companies/tabs/CompanyOverviewTab.tsx — company workspace Overview tab.
 *
 * Extracted from CompanyWorkspace.tsx (code-review split; no behavior change).
 */
"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
} from "@/components/ui";
import { StatCard } from "@/components/data/StatCard";
import { PostCard } from "@/components/posts/PostCard";
import { formatRelative } from "@/lib/chat";
import type { Post } from "@/lib/api-types";
import type { CompanyDetail, Paginated } from "@/lib/types";

export function CompanyOverviewTab({
  companyId,
  detail,
}: {
  companyId: string;
  detail: CompanyDetail;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [announcements, setAnnouncements] = useState<Post[]>([]);

  useEffect(() => {
    apiGet<Paginated<Post>>(`/api/companies/${companyId}/posts`, { params: { limit: 3 } })
      .then((r) => setPosts(r.data))
      .catch(() => {});
    apiGet<Paginated<Post>>(`/api/companies/${companyId}/announcements`, { params: { limit: 3 } })
      .then((r) => setAnnouncements(r.data))
      .catch(() => {});
  }, [companyId]);

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Members" value={detail.counts.members} icon="users" tone="brand" />
        <StatCard label="Teams" value={detail.counts.teams} icon="users" tone="accent" />
        <StatCard label="Posts" value={detail.counts.posts} icon="comment" tone="neutral" />
      </div>

      {announcements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-h3">
              <Icon name="sparkles" size={18} aria-hidden className="text-brand-strong" />
              Announcements
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {announcements.map((a) => (
              <div key={a.id} className="rounded-lg bg-brand-soft/50 p-3">
                <p className="whitespace-pre-wrap text-body-sm text-ink">{a.body}</p>
                <p className="mt-1 text-caption text-ink-3">
                  {a.author?.name} · {formatRelative(a.createdAt)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-h3 font-semibold text-ink">Recent posts</h2>
        {posts.length === 0 ? (
          <EmptyState icon="comment" title="No posts yet" description="Be the first to share an update with the company." compact />
        ) : (
          <div className="flex flex-col gap-3">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
