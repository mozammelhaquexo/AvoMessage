/**
 * app/(app)/home/page.tsx — home feed.
 *
 * Shows the same public feed as the World section: all public posts,
 * newest first, with live updates.
 */
"use client";

import { useCallback } from "react";
import { apiGet } from "@/lib/api-client";
import type { Page, Post } from "@/lib/api-types";
import { PostComposer } from "@/components/posts/PostComposer";
import { PostFeed } from "@/components/posts/PostFeed";
import { HomeCompanySection } from "@/components/companies/HomeCompanySection";

const PAGE_SIZE = 20;

export default function HomePage() {
  const loadPage = useCallback(
    (cursor: string | null) =>
      apiGet<Page<Post>>("/api/posts", { params: { cursor, limit: PAGE_SIZE } }),
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="hidden sm:block">
        <PostComposer
          placeholder="Share an update with your followers…"
          onCreated={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        />
      </div>

      <PostFeed
        loadPage={loadPage}
        livePill
        emptyTitle="It's quiet here"
        emptyDescription="Be the first to post — say hello to the community."
        emptyIcon="globe"
      />

      {/* The viewer's own company feed — members only, no other company's
          posts, and never a manager-application status. */}
      <HomeCompanySection />
    </div>
  );
}
