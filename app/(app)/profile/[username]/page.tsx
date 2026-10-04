/**
 * app/(app)/profile/[username]/page.tsx — user profile.
 *
 * Header (cover, avatar, bio, counts, online status), action row
 * (Edit / Follow / Message / Mute / Block / Report), and tabs (Posts, Media).
 * Post lists filter the world feed client-side by author.
 * Next.js 16: `params` is a Promise — unwrap with React.use().
 */
"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  TabPanel,
  Tabs,
  UserBadges,
  toPresenceStatus,
  toast,
} from "@/components/ui";
import { BackLink } from "@/components/layout/AppShell";
import { usePresence } from "@/lib/realtime/client";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { formatCount, fullDateTime } from "@/lib/format";
import type { Page, Post, PublicProfile } from "@/lib/api-types";
import { PostCard } from "@/components/posts/PostCard";
import { PostSkeletons } from "@/components/posts/PostFeed";
import { ReportDialog } from "@/components/posts/ReportDialog";
import { MyCompaniesCard } from "@/components/companies/MyCompaniesCard";

const AUTHOR_PAGE_SIZE = 20;
const AUTHOR_MAX_POSTS = 30;
const AUTHOR_MAX_PAGES = 6;

export default function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const router = useRouter();
  const { user: me } = useSession();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("posts");

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [messaging, setMessaging] = useState(false);

  // Feature 1 — live presence for this profile. Declared above the early
  // return so the hook order stays stable while the profile is loading.
  const presence = usePresence(profile ? [profile.id] : []);
  const profileStatus = toPresenceStatus(presence[profile?.id ?? ""]?.status);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await apiGet<PublicProfile>(`/api/users/${encodeURIComponent(username)}`);
      setProfile(p);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("UNKNOWN_ERROR", "Couldn't load this profile.", 0));
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    // Fetch-on-username-change: seeds loading state before the async load.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on username change
    void load();
  }, [load]);

  const patchViewerState = (patch: Partial<NonNullable<PublicProfile["viewerState"]>>) => {
    setProfile((p) =>
      p?.viewerState ? { ...p, viewerState: { ...p.viewerState, ...patch } } : p,
    );
  };
  const bumpFollowers = (delta: number) => {
    setProfile((p) =>
      p?.counts ? { ...p, counts: { ...p.counts, followers: Math.max(0, p.counts.followers + delta) } } : p,
    );
  };

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setActionBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setActionBusy(null);
    }
  };

  const toggleFollow = () =>
    runAction("follow", async () => {
      if (!profile) return;
      const following = profile.viewerState?.following;
      if (following) {
        await apiPost(`/api/users/${encodeURIComponent(username)}/unfollow`);
        patchViewerState({ following: false });
        bumpFollowers(-1);
      } else {
        await apiPost(`/api/users/${encodeURIComponent(username)}/follow`);
        patchViewerState({ following: true });
        bumpFollowers(1);
        toast({ variant: "success", title: `You're now following @${username}` });
      }
    });

  const toggleMute = () =>
    runAction("mute", async () => {
      if (!profile) return;
      const muted = profile.viewerState?.muted;
      if (muted) {
        await apiDelete(`/api/users/${encodeURIComponent(username)}/mute`);
        patchViewerState({ muted: false });
        toast({ variant: "success", title: `@${username} unmuted` });
      } else {
        await apiPost(`/api/users/${encodeURIComponent(username)}/mute`);
        patchViewerState({ muted: true });
        toast({ variant: "success", title: `@${username} muted`, description: "You won't see their posts in your feeds." });
      }
    });

  const doBlock = async () => {
    setConfirmBlock(false);
    await runAction("block", async () => {
      await apiPost(`/api/users/${encodeURIComponent(username)}/block`);
      toast({ variant: "success", title: `@${username} blocked` });
      router.push("/home");
    });
  };

  const startMessage = async () => {
    if (!profile) return;
    setMessaging(true);
    try {
      const convo = await apiPost<{ conversation: { id: string }; created: boolean }>("/api/conversations", {
        type: "DM",
        userIds: [profile.id],
      });
      router.push(`/messages/${convo.conversation.id}`);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't start conversation" });
    } finally {
      setMessaging(false);
    }
  };

  if (loading) return <ProfileSkeleton />;
  if (error || !profile) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <BackLink href="/home" label="Back" />
        <ErrorState
          title={error?.status === 404 ? "User not found" : "Couldn't load this profile"}
          message={
            error?.status === 404
              ? `@${username} doesn't exist or isn't visible to you.`
              : (error?.message ?? "Please try again.")
          }
          retryLabel="Try again"
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const vs = profile.viewerState;
  const isOwn = vs?.self ?? me?.id === profile.id;
  const limited = !profile.counts; // private account, not a follower

  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* Cover */}
      <div className="relative h-44 overflow-hidden bg-brand-gradient-soft sm:rounded-t-xl">
        {profile.coverUrl && (
          <img decoding="async" loading="lazy" src={profile.coverUrl} alt="" aria-hidden className="img-dim h-full w-full object-cover" />
        )}
      </div>

      <div className="rounded-b-xl border border-t-0 border-line bg-surface px-4 pb-4 sm:px-5">
        {/* Avatar + actions */}
        <div className="-mt-12 flex items-end justify-between gap-3">
          <Avatar
            src={profile.avatarUrl}
            name={profile.name}
            size="xl"
            // Feature 1: green when active. Away / DND are shown too (useful
            // here), but a grey "offline" dot on every profile is just noise.
            status={profileStatus === "offline" ? undefined : profileStatus}
            className="h-24 w-24 border-4 border-surface text-h1"
          />
          <div className="flex items-center gap-2 pb-1">
            {isOwn ? (
              <Button href="/settings" variant="outline" size="sm"><Icon name="edit" size={15} /> Edit profile</Button>
            ) : (
              <>
                {vs && !vs.blockedBy && (
                  <Button
                    size="sm"
                    variant={vs.following ? "outline" : "primary"}
                    loading={actionBusy === "follow"}
                    onClick={() => void toggleFollow()}
                  >
                    {vs.following ? "Following" : "Follow"}
                  </Button>
                )}
                {vs && !vs.blocked && !vs.blockedBy && (
                  <Button size="sm" variant="outline" loading={messaging} onClick={() => void startMessage()}>
                    <Icon name="message" size={15} /> Message
                  </Button>
                )}
                {!vs?.self && (
                  <DropdownMenu
                    label="Profile options"
                    trigger={
                      <button
                        type="button"
                        aria-label="Profile options"
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                      >
                        <Icon name="dots" size={18} />
                      </button>
                    }
                    sections={[
                      {
                        id: "profile-actions",
                        items: [
                          {
                            id: "mute",
                            label: vs?.muted ? "Unmute" : "Mute",
                            icon: "mute",
                            onSelect: () => void toggleMute(),
                          },
                          {
                            id: "block",
                            label: "Block",
                            icon: "block",
                            destructive: true,
                            onSelect: () => setConfirmBlock(true),
                          },
                          {
                            id: "report",
                            label: "Report",
                            icon: "flag",
                            destructive: true,
                            onSelect: () => setReportOpen(true),
                          },
                        ],
                      },
                    ]}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Identity */}
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="text-h2 font-bold tracking-tight">{profile.name}</h1>
            {profile.isVerified && (
              <span aria-label="Verified account" title="Verified account" className="text-brand-strong">
                <Icon name="check" size={16} />
              </span>
            )}
            {profile.isPrivate && (
              <Badge variant="neutral">
                <Icon name="lock" size={12} aria-hidden /> Private
              </Badge>
            )}
            {/* Features 2 + 8: Admin / Manager chip and the companies this
                person belongs to (empty on a limited profile). */}
            <UserBadges platformRole={profile.platformRole} companies={profile.companies} />
            {vs?.muted && <Badge variant="warning">Muted</Badge>}
          </div>
          <p className="text-body-sm text-ink-3">@{profile.username}</p>
          {profile.bio && (
            <p className="mt-2.5 whitespace-pre-wrap break-words text-body-sm text-ink">{profile.bio}</p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-3">
            {profile.location && (
              <span className="inline-flex items-center gap-1">
                <Icon name="pin" size={13} aria-hidden /> {profile.location}
              </span>
            )}
            {profile.website && (
              <a
                href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-strong hover:underline"
              >
                <Icon name="link" size={13} aria-hidden />
                {profile.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            <span className="inline-flex items-center gap-1" title={fullDateTime(profile.createdAt)}>
              <Icon name="calendar" size={13} aria-hidden /> Joined {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
          </div>
          {profile.counts && (
            <div className="mt-3 flex gap-5" role="group" aria-label="Profile stats">
              <span className="text-body-sm">
                <span className="font-bold text-ink">{formatCount(profile.counts.posts)}</span>{" "}
                <span className="text-ink-3">Posts</span>
              </span>
              <Link href={`/profile/${username}/followers`} className="text-body-sm hover:underline">
                <span className="font-bold text-ink">{formatCount(profile.counts.followers)}</span>{" "}
                <span className="text-ink-3">Followers</span>
              </Link>
              <Link href={`/profile/${username}/following`} className="text-body-sm hover:underline">
                <span className="font-bold text-ink">{formatCount(profile.counts.following)}</span>{" "}
                <span className="text-ink-3">Following</span>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Feature 9 — your own company memberships, with Leave. Own profile
          only: someone else's memberships are theirs to disclose, and the
          public profile already shows a company chip when visibility allows. */}
      {isOwn && (
        <div className="mt-4">
          <MyCompaniesCard />
        </div>
      )}

      {/* Tabs */}
      {limited ? (
        <div className="mt-4">
          <EmptyState
            icon="lock"
            title="This account is private"
            description={`Follow @${username} to see their posts.`}
            actionLabel={vs && !vs.following ? "Follow" : undefined}
            onAction={vs && !vs.following ? () => void toggleFollow() : undefined}
          />
        </div>
      ) : (
        <div className="mt-4">
          <Tabs
            value={tab}
            onValueChange={setTab}
            tabs={[
              { id: "posts", label: "Posts" },
              { id: "media", label: "Media" },
            ]}
            label="Profile content"
          >
            <TabPanel id="posts">
              <AuthorPosts username={username} mediaOnly={false} />
            </TabPanel>
            <TabPanel id="media">
              <AuthorPosts username={username} mediaOnly />
            </TabPanel>
          </Tabs>
        </div>
      )}

      <ConfirmDialog
        open={confirmBlock}
        onOpenChange={setConfirmBlock}
        title={`Block @${username}?`}
        description="They won't be able to see your posts or message you, and you won't see their content."
        confirmLabel="Block"
        tone="danger"
        icon="block"
        onConfirm={() => void doBlock()}
      />
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetType="USER"
        targetId={profile.id}
        targetLabel={`@${username}`}
      />
    </div>
  );
}

/** Author-filtered world feed (bounded client-side filter — see /home note). */
function AuthorPosts({ username, mediaOnly }: { username: string; mediaOnly: boolean }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const collected: Post[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < AUTHOR_MAX_PAGES && collected.length < AUTHOR_MAX_POSTS; page++) {
          const res: Page<Post> = await apiGet<Page<Post>>("/api/posts", { params: { cursor, limit: AUTHOR_PAGE_SIZE } });
          for (const p of res.data) {
            if (p.author.username === username && (!mediaOnly || p.media.length > 0)) {
              collected.push(p);
            }
          }
          if (!res.nextCursor) break;
          cursor = res.nextCursor;
        }
        if (!cancelled) setPosts(collected);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load posts.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, mediaOnly]);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load posts"
        message={error}
        retryLabel="Try again"
        onRetry={() => window.location.reload()}
        compact
      />
    );
  }
  if (posts === null) return <PostSkeletons count={3} />;
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={mediaOnly ? "image" : "comment"}
        title={mediaOnly ? "No media yet" : "No posts yet"}
        description={mediaOnly ? "Photos and videos will show up here." : "Posts will show up here."}
        compact
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl" aria-label="Loading profile">
      <Skeleton className="h-44 w-full sm:rounded-t-xl" />
      <div className="rounded-b-xl border border-t-0 border-line bg-surface px-4 pb-4 sm:px-5">
        <div className="-mt-12">
          <Skeleton className="h-24 w-24 rounded-full" />
        </div>
        <Skeleton className="mt-3 h-7 w-48 rounded" />
        <Skeleton className="mt-2 h-4 w-32 rounded" />
        <Skeleton className="mt-3 h-16 w-full rounded-lg" />
      </div>
      <PostSkeletons count={2} />
    </div>
  );
}
