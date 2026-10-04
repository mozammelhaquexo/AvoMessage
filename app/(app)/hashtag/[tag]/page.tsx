/**
 * app/(app)/hashtag/[tag]/page.tsx — hashtag timeline.
 * Next.js 16: `params` is a Promise — unwrap with React.use().
 */
"use client";

import { use } from "react";
import { useCallback } from "react";
import { BackLink } from "@/components/layout/AppShell";
import { apiGet } from "@/lib/api-client";
import type { Page, Post } from "@/lib/api-types";
import { PostFeed } from "@/components/posts/PostFeed";

export default function HashtagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = use(params);
  const decoded = decodeURIComponent(tag);

  const loadPage = useCallback(
    (cursor: string | null) =>
      apiGet<Page<Post>>(`/api/hashtags/${encodeURIComponent(decoded)}`, { params: { cursor, limit: 20 } }),
    [decoded],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <BackLink href="/world" label="Back to World" />
      <h1 className="text-h1 font-bold tracking-tight">
        <span className="text-brand-gradient">#{decoded}</span>
      </h1>
      <PostFeed
        loadPage={loadPage}
        livePill
        emptyTitle={`No posts with #${decoded} yet`}
        emptyDescription="Be the first to use this hashtag."
        emptyIcon="sparkles"
      />
    </div>
  );
}
