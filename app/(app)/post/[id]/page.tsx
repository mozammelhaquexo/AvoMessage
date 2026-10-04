/**
 * app/(app)/post/[id]/page.tsx — post detail with full comment thread.
 * Next.js 16: `params` is a Promise — unwrap with React.use().
 */
"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ErrorState, LoadingState } from "@/components/ui";
import { BackLink } from "@/components/layout/AppShell";
import { apiGet, ApiError } from "@/lib/api-client";
import { useEffect, useState } from "react";
import type { Post } from "@/lib/api-types";
import { PostCard } from "@/components/posts/PostCard";
import { CommentThread } from "@/components/posts/CommentThread";

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Fetch-on-route-change: the effect body legitimately seeds loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on id change
    setLoading(true);
    apiGet<Post>(`/api/posts/${id}`)
      .then((p) => {
        if (!cancelled) {
          setPost(p);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e : new ApiError("UNKNOWN_ERROR", "Couldn't load this post.", 0));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <BackLink href="/home" label="Back" />
      {loading ? (
        <LoadingState message="Loading post…" />
      ) : error || !post ? (
        <ErrorState
          title={error?.status === 404 ? "Post not found" : error?.code === "GONE" ? "Post deleted" : "Couldn't load this post"}
          message={
            error?.status === 404
              ? "This post doesn't exist or you don't have permission to see it."
              : error?.code === "GONE"
                ? "This post was deleted by its author."
                : (error?.message ?? "Please try again.")
          }
          retryLabel="Try again"
          onRetry={() => window.location.reload()}
        />
      ) : (
        <>
          <PostCard
            post={post}
            linkComments={false}
            onDeleted={() => router.push("/home")}
            onUpdated={(updated) => setPost(updated)}
          />
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="text-h3 font-bold">Comments</h2>
            <div className="mt-2">
              <CommentThread
                postId={post.id}
                onCountChange={(delta) =>
                  setPost((p) =>
                    p ? { ...p, counts: { ...p.counts, comments: Math.max(0, p.counts.comments + delta) } } : p,
                  )
                }
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
