/**
 * components/posts/CommentThread.tsx — threaded comments for a post.
 *
 * Top-level comments are cursor-paginated; replies arrive nested from the
 * API (server enforces depth ≤ 3). Supports like/unlike, reply, edit/delete
 * own, and report. New comments are added optimistically and rolled back
 * (or swapped for the server copy) on settle. All tree state is lifted to
 * the thread root so optimistic nodes and server pages never diverge.
 */
"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Avatar,
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  Spinner,
  Textarea,
  toast,
  type IconName,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiDelete, apiGet, apiPost, apiPatch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { useInfiniteList, useIntersectionObserver } from "@/lib/hooks";
import { formatCount, timeAgo } from "@/lib/format";
import { springBouncy } from "@/lib/motion";
import type { Comment, Page } from "@/lib/api-types";
import { RichText } from "./RichText";
import { ReportDialog } from "./ReportDialog";

const PAGE_SIZE = 20;

interface CommentThreadProps {
  postId: string;
  /** Called when the total comment count changes (parent updates the card). */
  onCountChange?: (delta: number) => void;
}

/* ── Tree helpers (pure) ──────────────────────────────────────────────── */

function mapTree(tree: Comment[], id: string, fn: (node: Comment) => Comment): Comment[] {
  return tree.map((node) => {
    if (node.id === id) return fn(node);
    if (node.replies.length) return { ...node, replies: mapTree(node.replies, id, fn) };
    return node;
  });
}

function insertReplyNode(tree: Comment[], parentId: string, reply: Comment): Comment[] {
  return mapTree(tree, parentId, (node) => ({ ...node, replies: [...node.replies, reply] }));
}

function removeNode(tree: Comment[], id: string): Comment[] {
  return tree
    .filter((node) => node.id !== id)
    .map((node) => (node.replies.length ? { ...node, replies: removeNode(node.replies, id) } : node));
}

/* ── Thread root ──────────────────────────────────────────────────────── */

export function CommentThread({ postId, onCountChange }: CommentThreadProps) {
  const list = useInfiniteList<Comment>(
    useCallback(
      (cursor: string | null) =>
        apiGet<Page<Comment>>(`/api/posts/${postId}/comments`, { params: { cursor, limit: PAGE_SIZE } }),
      [postId],
    ),
    (c) => c.id,
  );
  const sentinelRef = useIntersectionObserver(list.loadMore, { enabled: list.hasMore && !list.error });

  const patchNode = useCallback(
    (id: string, fn: (node: Comment) => Comment) => {
      list.setItems((prev) => mapTree(prev, id, fn));
    },
    [list],
  );

  const deleteNode = useCallback(
    (id: string) => {
      list.setItems((prev) => removeNode(prev, id));
      onCountChange?.(-1);
    },
    [list, onCountChange],
  );

  return (
    <section aria-label="Comments" className="flex flex-col">
      <CommentForm
        postId={postId}
        onOptimistic={(comment) => list.prepend([comment])}
        onResolve={(tempId, real) => {
          if (real) {
            list.setItems((prev) => prev.map((c) => (c.id === tempId ? real : c)));
            onCountChange?.(1);
          } else {
            list.removeWhere((c) => c.id === tempId);
          }
        }}
      />
      <div className="mt-4 flex flex-col gap-1">
        {list.loading ? (
          <div className="flex flex-col gap-4" aria-label="Loading comments">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="mt-2 h-12 w-full rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : list.error && list.items.length === 0 ? (
          <ErrorState
            title="Couldn't load comments"
            message={list.error.message}
            retryLabel="Try again"
            onRetry={list.retry}
            compact
          />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon="comment"
            title="No comments yet"
            description="Be the first to share your thoughts."
            compact
          />
        ) : (
          list.items.map((comment) => (
            <CommentNode
              key={comment.id}
              postId={postId}
              comment={comment}
              depth={0}
              patchNode={patchNode}
              deleteNode={deleteNode}
              insertReply={(parentId, reply) =>
                list.setItems((prev) => insertReplyNode(prev, parentId, reply))
              }
              resolveReply={(tempId, real) => {
                if (real) {
                  list.setItems((prev) =>
                    mapTree(prev, tempId, () => real),
                  );
                  onCountChange?.(1);
                } else {
                  list.setItems((prev) => removeNode(prev, tempId));
                }
              }}
            />
          ))
        )}
        {list.loadingMore && (
          <div className="flex justify-center py-4" aria-label="Loading more comments">
            <Spinner size="sm" />
          </div>
        )}
        {list.hasMore && !list.loading && !list.error && (
          <div ref={sentinelRef} aria-hidden className="h-4" />
        )}
      </div>
    </section>
  );
}

/* ── Single comment node ──────────────────────────────────────────────── */

interface NodeProps {
  postId: string;
  comment: Comment;
  depth: number;
  patchNode: (id: string, fn: (node: Comment) => Comment) => void;
  deleteNode: (id: string) => void;
  insertReply: (parentId: string, reply: Comment) => void;
  resolveReply: (tempId: string, real: Comment | null) => void;
}

function CommentNode({ postId, comment, depth, patchNode, deleteNode, insertReply, resolveReply }: NodeProps) {
  const { user } = useSession();
  const [likeBusy, setLikeBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [editBusy, setEditBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const liked = comment.liked ?? false;
  const isOwn = user?.id === comment.author.id;
  const canReply = depth < 2; // server enforces depth ≤ 3 (levels 0,1,2)

  const toggleLike = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    const prevLiked = liked;
    const prevCount = comment.likeCount;
    patchNode(comment.id, (c) => ({ ...c, liked: !liked, likeCount: c.likeCount + (liked ? -1 : 1) }));
    try {
      const res = liked
        ? await apiDelete<{ liked: boolean; likeCount: number }>(`/api/comments/${comment.id}/like`)
        : await apiPost<{ liked: boolean; likeCount: number }>(`/api/comments/${comment.id}/like`);
      patchNode(comment.id, (c) => ({ ...c, liked: res.liked, likeCount: res.likeCount }));
    } catch {
      patchNode(comment.id, (c) => ({ ...c, liked: prevLiked, likeCount: prevCount }));
      toast({ variant: "error", title: "Couldn't update like" });
    } finally {
      setLikeBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await apiDelete(`/api/comments/${comment.id}`);
      setConfirmDelete(false);
      toast({ variant: "success", title: "Comment deleted" });
      deleteNode(comment.id);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't delete comment" });
    } finally {
      setDeleting(false);
    }
  };

  const doEdit = async () => {
    const body = editBody.trim();
    if (!body || body === comment.body) {
      setEditOpen(false);
      return;
    }
    setEditBusy(true);
    try {
      const updated = await apiPatch<Comment>(`/api/comments/${comment.id}`, { body });
      patchNode(comment.id, (c) => ({ ...c, body: updated.body }));
      setEditOpen(false);
      toast({ variant: "success", title: "Comment updated" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't update comment" });
    } finally {
      setEditBusy(false);
    }
  };

  const menuSections = [
    {
      id: "comment-actions",
      items: [
        ...(isOwn
          ? [
              { id: "edit", label: "Edit", icon: "edit" as IconName, onSelect: () => { setEditBody(comment.body); setEditOpen(true); } },
              { id: "delete", label: "Delete", icon: "trash" as IconName, destructive: true, onSelect: () => setConfirmDelete(true) },
            ]
          : [{ id: "report", label: "Report", icon: "flag" as IconName, destructive: true, onSelect: () => setReportOpen(true) }]),
      ],
    },
  ];

  return (
    <div className={cn(depth > 0 && "ml-8 border-l-2 border-line pl-3 sm:ml-10")}>
      <article className="flex gap-2.5 py-2.5" aria-label={`Comment by ${comment.author.name}`}>
        <Link href={`/profile/${comment.author.username}`} className="shrink-0" aria-label={`View ${comment.author.name}'s profile`}>
          <Avatar src={comment.author.avatarUrl} name={comment.author.name} size="sm" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="rounded-xl rounded-tl-sm bg-surface-2 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <Link href={`/profile/${comment.author.username}`} className="text-body-sm font-semibold text-ink hover:underline">
                {comment.author.name}
              </Link>
              <span className="text-caption text-ink-3">@{comment.author.username}</span>
              <time dateTime={comment.createdAt} className="text-caption text-ink-3">
                {timeAgo(comment.createdAt)}
              </time>
            </div>
            {editOpen ? (
              <div className="mt-2 flex flex-col gap-2">
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  aria-label="Edit comment"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={editBusy} disabled={!editBody.trim()} onClick={() => void doEdit()}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-body-sm text-ink">
                <RichText text={comment.body} />
              </p>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1">
            <motion.button
              type="button"
              onClick={() => void toggleLike()}
              disabled={likeBusy}
              aria-pressed={liked}
              aria-label={liked ? "Unlike comment" : "Like comment"}
              whileTap={{ scale: 0.85 }}
              className={cn(
                "flex min-h-9 items-center gap-1 rounded-full px-2 text-caption font-medium transition-colors",
                liked ? "text-danger" : "text-ink-3 hover:bg-danger/10 hover:text-danger",
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
                <Icon name="heart" size={15} />
              </motion.span>
              {comment.likeCount > 0 && <span className="tabular-nums">{formatCount(comment.likeCount)}</span>}
            </motion.button>
            {canReply && (
              <button
                type="button"
                onClick={() => setReplyOpen((o) => !o)}
                aria-expanded={replyOpen}
                className="flex min-h-9 items-center rounded-full px-2 text-caption font-medium text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Reply
              </button>
            )}
            <DropdownMenu
              label="Comment options"
              trigger={
                <button
                  type="button"
                  aria-label="Comment options"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name="dots" size={16} />
                </button>
              }
              sections={menuSections}
            />
          </div>
          {replyOpen && (
            <CommentForm
              postId={postId}
              parentId={comment.id}
              autoFocus
              compact
              onOptimistic={(reply) => {
                insertReply(comment.id, reply);
                setReplyOpen(false);
              }}
              onResolve={resolveReply}
            />
          )}
        </div>
      </article>

      {/* Nested replies */}
      {comment.replies.length > 0 && (
        <div className="flex flex-col">
          {comment.replies.map((reply) => (
            <CommentNode
              key={reply.id}
              postId={postId}
              comment={reply}
              depth={depth + 1}
              patchNode={patchNode}
              deleteNode={deleteNode}
              insertReply={insertReply}
              resolveReply={resolveReply}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this comment?"
        description="This can't be undone."
        confirmLabel="Delete"
        tone="danger"
        icon="trash"
        confirming={deleting}
        onConfirm={() => void doDelete()}
      />
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetType="COMMENT"
        targetId={comment.id}
        targetLabel={`@${comment.author.username}'s comment`}
      />
    </div>
  );
}

/* ── Comment composer (optimistic with rollback) ──────────────────────── */

function CommentForm({
  postId,
  parentId,
  onOptimistic,
  onResolve,
  autoFocus = false,
  compact = false,
}: {
  /** The post these comments belong to. */
  postId: string;
  parentId?: string;
  onOptimistic: (comment: Comment) => void;
  /** Called with the server copy on success, or null on failure (rollback). */
  onResolve: (tempId: string, real: Comment | null) => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { user } = useSession();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    const text = body.trim();
    if (!text || posting) return;
    if (text.length > 1000) {
      toast({ variant: "error", title: "Comment is too long", description: "Maximum 1000 characters." });
      return;
    }
    setPosting(true);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const temp: Comment = {
      id: tempId,
      body: text,
      author: {
        id: user?.id ?? "me",
        name: user?.name ?? "You",
        username: user?.username ?? "you",
        avatarUrl: user?.avatarUrl ?? null,
        isVerified: user?.isVerified ?? false,
      },
      likeCount: 0,
      liked: false,
      parentId: parentId ?? null,
      replies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onOptimistic(temp);
    setBody("");
    try {
      const created = await apiPost<Comment>(`/api/posts/${postId}/comments`, {
        body: text,
        parentId: parentId ?? undefined,
      });
      onResolve(tempId, created);
    } catch (e) {
      onResolve(tempId, null);
      toast({ variant: "error", title: e instanceof Error ? e.message : "Couldn't post comment" });
      setBody(text);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className={cn("flex gap-2.5", compact ? "mt-2" : "mt-1")}>
      {!compact && <Avatar src={user?.avatarUrl} name={user?.name ?? "?"} size="sm" className="shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={parentId ? "Write a reply…" : "Write a comment…"}
          rows={compact ? 2 : 3}
          maxLength={1000}
          autoFocus={autoFocus}
          aria-label={parentId ? "Write a reply" : "Write a comment"}
          className="w-full"
        />
        <div className="flex items-center justify-between">
          <span className={cn("text-caption tabular-nums", body.length > 1000 ? "text-danger" : "text-ink-3")}>
            {body.length} / 1000
          </span>
          <Button size="sm" loading={posting} disabled={!body.trim()} onClick={() => void submit()}>
            {parentId ? "Reply" : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
