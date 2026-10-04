/**
 * app/(app)/home/page.tsx — home feed.
 *
 * Shows the same public feed as the World section: all public posts,
 * newest first, with live updates.
 *
 * NO COMPANY CONTENT. The company system — company posts, and the Bengali
 * "you have not been added to a company yet" state — lives in the Companies
 * section only. It used to also render here (`HomeCompanySection`), which put
 * a company prompt on a page that is about the public feed and showed a
 * companyless user the "ask your manager" card before they ever opened
 * Companies. Home is the public feed, full stop.
 */
"use client";

import { useCallback } from "react";
import { apiGet } from "@/lib/api-client";
import type { Page, Post } from "@/lib/api-types";
import { PostComposer } from "@/components/posts/PostComposer";
import { PostFeed } from "@/components/posts/PostFeed";

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
    </div>
  );
}
