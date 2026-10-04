/**
 * app/(app)/bookmarks/page.tsx — saved posts.
 */
"use client";

import { useCallback } from "react";
import { apiGet } from "@/lib/api-client";
import type { Page, Post } from "@/lib/api-types";
import { PostFeed } from "@/components/posts/PostFeed";

export default function BookmarksPage() {
  const loadPage = useCallback(
    (cursor: string | null) => apiGet<Page<Post>>("/api/users/me/bookmarks", { params: { cursor, limit: 20 } }),
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-h1 font-bold tracking-tight">Bookmarks</h1>
      <PostFeed
        loadPage={loadPage}
        live={false}
        emptyTitle="No bookmarks yet"
        emptyDescription="Save posts you want to revisit with the bookmark button."
        emptyIcon="bookmark"
      />
    </div>
  );
}
