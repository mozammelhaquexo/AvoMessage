/**
 * components/profile/FollowList.tsx — paginated followers / following list.
 *
 * Shared by `/profile/[username]/followers` and `/profile/[username]/following`.
 * Both endpoints return `{ data, nextCursor }` of a slim user summary, and both
 * 403 with `PRIVATE_ACCOUNT` when the profile is private and the viewer is not
 * an approved follower.
 */
"use client";

import { useCallback } from "react";
import Link from "next/link";
import {
  Avatar,
  EmptyState,
  ErrorState,
  Icon,
  Spinner,
} from "@/components/ui";
import { apiGet, ApiError } from "@/lib/api-client";
import { useInfiniteList, useIntersectionObserver } from "@/lib/hooks";
import type { Page } from "@/lib/api-types";

interface FollowUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  isVerified: boolean;
}

export function FollowList({
  username,
  kind,
}: {
  username: string;
  kind: "followers" | "following";
}) {
  const list = useInfiniteList<FollowUser>(
    useCallback(
      (cursor: string | null) =>
        apiGet<Page<FollowUser>>(
          `/api/users/${encodeURIComponent(username)}/${kind}`,
          { params: { cursor, limit: 20 } },
        ),
      [username, kind],
    ),
    (u) => u.id,
  );

  const sentinelRef = useIntersectionObserver(list.loadMore, {
    enabled: list.hasMore && !list.error && !list.loading,
  });

  if (list.loading) {
    return (
      <div className="flex justify-center py-10" aria-label={`Loading ${kind}`}>
        <Spinner />
      </div>
    );
  }

  if (list.error) {
    // A private account hides its graph entirely — that is not an error the
    // viewer can retry their way out of, so show it as a locked state.
    if (list.error instanceof ApiError && list.error.code === "PRIVATE_ACCOUNT") {
      return (
        <EmptyState
          icon="lock"
          title="This account is private"
          description={`@${username} only shares their ${kind} with approved followers.`}
        />
      );
    }
    return (
      <ErrorState
        title={`Couldn't load ${kind}`}
        message={list.error.message}
        retryLabel="Try again"
        onRetry={list.retry}
      />
    );
  }

  if (list.items.length === 0) {
    return (
      <EmptyState
        icon="users"
        title={kind === "followers" ? "No followers yet" : "Not following anyone yet"}
        description={
          kind === "followers"
            ? `Nobody follows @${username} yet.`
            : `@${username} hasn't followed anyone yet.`
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2" role="list" aria-label={kind}>
      {list.items.map((u) => (
        <Link
          key={u.id}
          href={`/profile/${u.username}`}
          role="listitem"
          className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-surface-2"
        >
          <Avatar src={u.avatarUrl} name={u.name} size="md" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-body-sm font-semibold text-ink">{u.name}</span>
              {u.isVerified && (
                <span aria-label="Verified account" className="text-brand-strong">
                  <Icon name="check" size={14} />
                </span>
              )}
            </span>
            <span className="block truncate text-caption text-ink-3">@{u.username}</span>
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-ink-3" aria-hidden />
        </Link>
      ))}
      {list.loadingMore && (
        <div className="flex justify-center py-4" aria-label="Loading more">
          <Spinner />
        </div>
      )}
      {list.hasMore && !list.error && <div ref={sentinelRef} aria-hidden className="h-2" />}
    </div>
  );
}
