/**
 * app/(app)/profile/[username]/followers/page.tsx
 * Next.js 16: `params` is a Promise — unwrap with React.use().
 */
"use client";

import { use } from "react";
import { BackLink } from "@/components/layout/AppShell";
import { FollowList } from "@/components/profile/FollowList";

export default function FollowersPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <BackLink href={`/profile/${username}`} label="Back to profile" />
        <h1 className="mt-1 text-h1 font-bold tracking-tight">Followers</h1>
        <p className="text-body-sm text-ink-2">People who follow @{username}</p>
      </div>
      <FollowList username={username} kind="followers" />
    </div>
  );
}
