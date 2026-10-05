/**
 * components/posts/PostCard.tsx — full social post card.
 *
 * Owned by Frontend Engineer A.
 *
 * Features: author header (avatar, verified badge, @username, relative time,
 * visibility badge), hashtag/mention-rich body, media gallery, like/unlike
 * with spring animation, comment count (deep link), repost, bookmark, share
 * (copies link), overflow menu (edit/delete for own posts, report), and
 * optimistic updates with rollback on failure.
 *
 * Props take the canonical `Post` shape from `@/lib/api-types` (the same
 * shape every post endpoint returns — World feed, company feed,
 * announcements).
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogFooter,
  DropdownMenu,
  Icon,
  Textarea,
  UserBadges,
  toast,
  Tooltip,
  type IconName,
  type PresenceStatus,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiDelete, apiPost, apiPatch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { formatCount, fullDateTime, timeAgo } from "@/lib/format";
import { springBouncy } from "@/lib/motion";
import type { Post, PostVisibility } from "@/lib/api-types";
import { MediaGallery } from "./MediaGallery";
import { RichText } from "./RichText";
import { ReportDialog } from "./ReportDialog";

export interface PostCardProps {
  post: Post;
  /** Called after the post is deleted (parent removes it from the list). */
  onDeleted?: (id: string) => void;
  /** Called after the post is edited (parent updates it in the list). */
  onUpdated?: (post: Post) => void;
  /** Render the comment button as a link to the post detail page. Default true. */
  linkComments?: boolean;
  /**
   * The author's live presence. The list owner batches one `usePresence` call
   * for every author on screen and threads the result down, so a 20-post feed
   * costs one socket listener and one REST seed instead of twenty.
   */
  authorStatus?: PresenceStatus;
}

const VISIBILITY_META: Record<PostVisibility, { icon: IconName; label: string }> = {
  PUBLIC: { icon: "globe", label: "Public — anyone can see this" },
  FOLLOWERS: { icon: "users", label: "Followers — only your followers can see this" },
  COMPANY: { icon: "building", label: "Company — only company members can see this" },
  PRIVATE: { icon: "lock", label: "Only me" },
};

function VisibilityBadge({ visibility }: { visibility: PostVisibility }) {
  const meta = VISIBILITY_META[visibility];
  return (
    <Tooltip content={meta.label}>
      <span
        aria-label={meta.label}
        className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-tiny font-medium text-ink-2"
      >
        <Icon name={meta.icon} size={12} aria-hidden />
        {visibility === "PUBLIC" ? "Public" : visibility === "FOLLOWERS" ? "Followers" : visibility === "COMPANY" ? "Company" : "Only me"}
      </span>
    </Tooltip>
  );
}

export function PostCard({
  post: initial,
  onDeleted,
  onUpdated,
  linkComments = true,
  authorStatus,
}: PostCardProps) {
  const { user } = useSession();
  // Feature 1: a green dot marks a user who is active right now. Away / DND /
  // offline are deliberately not rendered in the feed — a grey dot on every
  // author would be pure noise, and a feed is not where you check availability.
  const authorPresence: PresenceStatus | undefined =
    authorStatus === "online" ? "online" : undefined;
  const [post, setPost] = useState(initial);
  const [likeBusy, setLikeBusy] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRepost, setConfirmRepost] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [editBusy, setEditBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reposting, setReposting] = useState(false);

  const liked = post.viewerState?.liked ?? false;
  const bookmarked = post.viewerState?.bookmarked ?? false;
  const isOwn = user?.id === post.author.id;

  // ── Like (optimistic with rollback) ──────────────────────────────────────
  const toggleLike = async () => {
    if (likeBusy || !user) return;
    setLikeBusy(true);
    const prev = post;
    setPost({
      ...post,
      counts: { ...post.counts, likes: post.counts.likes + (liked ? -1 : 1) },
      viewerState: { liked: !liked, bookmarked },
    });
    try {
      const res = liked
        ? await apiDelete<{ liked: boolean; likeCount: number }>(`/api/posts/${post.id}/like`)
        : await apiPost<{ liked: boolean; likeCount: number }>(`/api/posts/${post.id}/like`);
      setPost({
        ...post,
        counts: { ...post.counts, likes: res.likeCount },
        viewerState: { liked: res.liked, bookmarked },
      });
    } catch (e) {
      setPost(prev); // rollback
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't update like" });
    } finally {
      setLikeBusy(false);
    }
  };

  // ── Bookmark (optimistic with rollback) ─────────────────────────────────
  const toggleBookmark = async () => {
    if (bookmarkBusy || !user) return;
    setBookmarkBusy(true);
    const prev = post;
    setPost({ ...post, viewerState: { liked, bookmarked: !bookmarked } });
    try {
      if (bookmarked) await apiDelete(`/api/posts/${post.id}/bookmark`);
      else await apiPost(`/api/posts/${post.id}/bookmark`);
      toast({
        variant: "success",
        title: bookmarked ? "Removed from bookmarks" : "Saved to bookmarks",
      });
    } catch (e) {
      setPost(prev);
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't update bookmark" });
    } finally {
      setBookmarkBusy(false);
    }
  };

  // ── Repost ──────────────────────────────────────────────────────────────
  const doRepost = async () => {
    setReposting(true);
    try {
      const reposted = await apiPost<Post>(`/api/posts/${post.id}/repost`);
      setPost({ ...post, counts: { ...post.counts, shares: post.counts.shares + 1 } });
      setConfirmRepost(false);
      toast({ variant: "success", title: "Reposted", description: "Shared with your followers." });
      // Let feeds prepend the new repost copy.
      window.dispatchEvent(new CustomEvent("avo:post-created", { detail: reposted }));
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't repost" });
    } finally {
      setReposting(false);
    }
  };

  // ── Share (copy link) ───────────────────────────────────────────────────
  const share = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ variant: "success", title: "Link copied", description: "Share it anywhere." });
    } catch {
      toast({ variant: "info", title: "Copy this link", description: url });
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────
  const doDelete = async () => {
    setDeleting(true);
    try {
      await apiDelete(`/api/posts/${post.id}`);
      setConfirmDelete(false);
      toast({ variant: "success", title: "Post deleted" });
      onDeleted?.(post.id);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't delete post" });
    } finally {
      setDeleting(false);
    }
  };

  // ── Edit ────────────────────────────────────────────────────────────────
  const doEdit = async () => {
    const body = editBody.trim();
    if (!body || body === post.body) {
      setEditOpen(false);
      return;
    }
    if (body.length > 2000) {
      toast({ variant: "error", title: "Post is too long", description: "Maximum 2000 characters." });
      return;
    }
    setEditBusy(true);
    try {
      const updated = await apiPatch<Post>(`/api/posts/${post.id}`, { body });
      setPost(updated);
      setEditOpen(false);
      onUpdated?.(updated);
      toast({ variant: "success", title: "Post updated" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't update post" });
    } finally {
      setEditBusy(false);
    }
  };

  const menuSections = [
    {
      id: "post-actions",
      items: [
        ...(isOwn
          ? [
              { id: "edit", label: "Edit post", icon: "edit" as IconName, onSelect: () => { setEditBody(post.body); setEditOpen(true); } },
              { id: "delete", label: "Delete post", icon: "trash" as IconName, destructive: true, onSelect: () => setConfirmDelete(true) },
            ]
          : [
              { id: "report", label: "Report post", icon: "flag" as IconName, destructive: true, onSelect: () => setReportOpen(true) },
            ]),
      ],
    },
  ];

  return (
    <Card className="overflow-hidden" data-post-id={post.id}>
      <article className="p-4" aria-labelledby={`post-${post.id}-author`}>
        {/* Header */}
        <div className="flex items-start gap-3">
          <Link href={`/profile/${post.author.username}`} aria-label={`View ${post.author.name}'s profile`} className="shrink-0">
            <Avatar src={post.author.avatarUrl} name={post.author.name} size="md" status={authorPresence} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <Link
                id={`post-${post.id}-author`}
                href={`/profile/${post.author.username}`}
                className="truncate text-body-sm font-semibold text-ink hover:underline"
              >
                {post.author.name}
              </Link>
              {post.author.isVerified && (
                <span aria-label="Verified account" title="Verified account" className="text-brand-strong">
                  <Icon name="check" size={14} />
                </span>
              )}
              <UserBadges
                platformRole={post.author.platformRole}
                companies={post.author.companies}
              />
              <span className="truncate text-caption text-ink-3">@{post.author.username}</span>
              <span aria-hidden className="text-caption text-ink-3">·</span>
              <time dateTime={post.createdAt} title={fullDateTime(post.createdAt)} className="shrink-0 text-caption text-ink-3">
                {timeAgo(post.createdAt)}
              </time>
            </div>
            <div className="mt-1">
              <VisibilityBadge visibility={post.visibility} />
            </div>
          </div>
          <DropdownMenu
            label="Post options"
            align="end"
            trigger={
              <button
                type="button"
                aria-label="Post options"
                className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Icon name="dots" size={20} />
              </button>
            }
            sections={menuSections}
          />
        </div>

        {/* Body */}
        <div className="mt-2.5 whitespace-pre-wrap break-words text-body-sm leading-relaxed text-ink">
          <RichText text={post.body} />
        </div>

        {/* Media */}
        <MediaGallery media={post.media} />

        {/* Action bar.
            Deliberately `justify-start` with a tight gap, not `justify-between`.
            Five small controls spread edge-to-edge across a 566px bar left
            76.5px of dead space between every pair (measured on the live site),
            which reads as five unrelated things rather than one toolbar. */}
        <div className="mt-3 flex items-center justify-start gap-1 border-t border-line pt-1" role="group" aria-label="Post actions">
          {/* Like */}
          <motion.button
            type="button"
            onClick={() => void toggleLike()}
            disabled={likeBusy}
            aria-pressed={liked}
            aria-label={liked ? `Unlike post (${formatCount(post.counts.likes)} likes)` : `Like post (${formatCount(post.counts.likes)} likes)`}
            whileTap={{ scale: 0.85 }}
            className={cn(
              "flex min-h-11 min-w-11 items-center gap-1.5 rounded-full px-3 text-body-sm transition-colors duration-fast",
              liked ? "text-danger" : "text-ink-2 hover:bg-danger/10 hover:text-danger",
            )}
          >
            <motion.span
              key={String(liked)}
              initial={liked ? { scale: 0.4 } : false}
              animate={{ scale: 1 }}
              transition={springBouncy}
              className="flex"
              aria-hidden
            >
              <Icon name="heart" size={20} />
            </motion.span>
            <span className="text-caption font-medium tabular-nums">{formatCount(post.counts.likes)}</span>
          </motion.button>

          {/* Comments */}
          {linkComments ? (
            <Link
              href={`/post/${post.id}`}
              aria-label={`View comments (${formatCount(post.counts.comments)})`}
              className="flex min-h-11 min-w-11 items-center gap-1.5 rounded-full px-3 text-body-sm text-ink-2 transition-colors duration-fast hover:bg-info/10 hover:text-info-strong"
            >
              <Icon name="comment" size={20} aria-hidden />
              <span className="text-caption font-medium tabular-nums">{formatCount(post.counts.comments)}</span>
            </Link>
          ) : (
            <span className="flex min-h-11 items-center gap-1.5 px-3 text-ink-2" aria-label={`${post.counts.comments} comments`}>
              <Icon name="comment" size={20} aria-hidden />
              <span className="text-caption font-medium tabular-nums">{formatCount(post.counts.comments)}</span>
            </span>
          )}

          {/* Repost */}
          <button
            type="button"
            onClick={() => setConfirmRepost(true)}
            aria-label={`Repost (${formatCount(post.counts.shares)} reposts)`}
            className="flex min-h-11 min-w-11 items-center gap-1.5 rounded-full px-3 text-body-sm text-ink-2 transition-colors duration-fast hover:bg-success/10 hover:text-success-strong"
          >
            <Icon name="share" size={20} aria-hidden />
            <span className="text-caption font-medium tabular-nums">{formatCount(post.counts.shares)}</span>
          </button>

          {/* Bookmark */}
          <button
            type="button"
            onClick={() => void toggleBookmark()}
            disabled={bookmarkBusy}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark post"}
            className={cn(
              "flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-body-sm transition-colors duration-fast",
              bookmarked ? "text-brand-strong" : "text-ink-2 hover:bg-brand-soft hover:text-brand-strong",
            )}
          >
            <Icon name="bookmark" size={20} aria-hidden />
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={() => void share()}
            aria-label="Copy link to post"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-body-sm text-ink-2 transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="link" size={20} aria-hidden />
          </button>
        </div>
      </article>

      {/* Repost confirm */}
      <ConfirmDialog
        open={confirmRepost}
        onOpenChange={setConfirmRepost}
        title="Repost this post?"
        description="It will be shared with your followers as a public post."
        confirmLabel="Repost"
        icon="share"
        confirming={reposting}
        onConfirm={() => void doRepost()}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this post?"
        description="This can't be undone. Comments and likes on it will be removed too."
        confirmLabel="Delete"
        tone="danger"
        icon="trash"
        confirming={deleting}
        onConfirm={() => void doDelete()}
      />

      {/* Edit dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit post"
        size="md"
      >
        <div className="flex flex-col gap-4">
          <Textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={5}
            maxLength={2000}
            aria-label="Edit post body"
            className="w-full"
          />
          <div className="flex items-center justify-between">
            <span className={cn("text-caption tabular-nums", editBody.length > 2000 ? "text-danger" : "text-ink-3")}>
              {editBody.length} / 2000
            </span>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button loading={editBusy} disabled={!editBody.trim() || editBody.trim() === post.body} onClick={() => void doEdit()}>
                Save changes
              </Button>
            </DialogFooter>
          </div>
        </div>
      </Dialog>

      {/* Report dialog */}
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetType="POST"
        targetId={post.id}
        targetLabel={`@${post.author.username}'s post`}
      />
    </Card>
  );
}
