/**
 * components/admin/AdminContent.tsx — the content lists behind /admin/content.
 * Posts and comments with admin delete (ConfirmDialog). Deleted items shown
 * with a badge; deleting is a soft delete server-side.
 *
 * Each list reports its loaded rows upward via `onRowsChange` so the page-level
 * toolbar can export exactly what is on screen — the rows live here, but the
 * Export button lives one level up.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  toast,
} from "@/components/ui";
import { apiDelete, apiGet } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { DataTable } from "@/components/data/DataTable";
import type { Paginated, PublicUser } from "@/lib/types";

export interface AdminPost {
  id: string;
  body: string;
  visibility: string;
  author: PublicUser;
  deleted: boolean;
  createdAt: string;
}

export interface AdminComment {
  id: string;
  postId: string;
  body: string;
  author: PublicUser;
  deleted: boolean;
  createdAt: string;
}

export function AdminPosts({
  onRowsChange,
}: {
  onRowsChange?: (rows: AdminPost[]) => void;
}) {
  const [rows, setRows] = useState<AdminPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleting, setDeleting] = useState<AdminPost | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (c?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await apiGet<Paginated<AdminPost>>("/api/admin/posts", {
        params: { limit: 25, ...(c ? { cursor: c } : {}), includeDeleted: true },
      });
      setRows((prev) => (append ? [...prev, ...res.data] : res.data));
      setCursor(res.nextCursor);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load posts" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows, onRowsChange]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await apiDelete(`/api/admin/posts/${deleting.id}`);
      setRows((prev) => prev.map((r) => (r.id === deleting.id ? { ...r, deleted: true } : r)));
      toast({ variant: "success", title: "Post deleted" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not delete post" });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        label="Platform posts"
        loading={loading}
        columns={[
          {
            key: "post",
            header: "Post",
            cell: (p) => (
              <span>
                <span className="line-clamp-2 block max-w-xl text-body-sm text-ink">{p.body}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-3">
                  <Avatar src={p.author.avatarUrl} name={p.author.name} size="xs" />
                  {p.author.name} · {p.visibility} · {formatRelative(p.createdAt)}
                </span>
              </span>
            ),
            card: (p) => (
              <span>
                <span className="line-clamp-3 block text-body-sm text-ink">{p.body}</span>
                <span className="mt-1 block text-caption text-ink-3">
                  {p.author.name} · {formatRelative(p.createdAt)}
                  {p.deleted && " · deleted"}
                </span>
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            hideOnMobile: true,
            cell: (p) =>
              p.deleted ? <Badge variant="danger">Deleted</Badge> : <Badge variant="success">Live</Badge>,
          },
        ]}
        rows={rows}
        rowKey={(p) => p.id}
        actions={[
          {
            id: "delete",
            label: "Delete post",
            icon: "trash",
            destructive: true,
            hidden: (p) => p.deleted,
            onSelect: (p) => setDeleting(p),
          },
        ]}
        emptyTitle="No posts"
      />

      {cursor && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void load(cursor, true)} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this post?"
        description="The post will be removed for everyone. The author will not be notified automatically."
        confirmLabel="Delete post"
        tone="danger"
        icon="trash"
        confirming={busy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

export function AdminComments({
  onRowsChange,
}: {
  onRowsChange?: (rows: AdminComment[]) => void;
}) {
  const [rows, setRows] = useState<AdminComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleting, setDeleting] = useState<AdminComment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (c?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await apiGet<Paginated<AdminComment>>("/api/admin/comments", {
        params: { limit: 25, ...(c ? { cursor: c } : {}), includeDeleted: true },
      });
      setRows((prev) => (append ? [...prev, ...res.data] : res.data));
      setCursor(res.nextCursor);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load comments" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows, onRowsChange]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await apiDelete(`/api/admin/comments/${deleting.id}`);
      setRows((prev) => prev.map((r) => (r.id === deleting.id ? { ...r, deleted: true } : r)));
      toast({ variant: "success", title: "Comment deleted" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not delete comment" });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        label="Platform comments"
        loading={loading}
        columns={[
          {
            key: "comment",
            header: "Comment",
            cell: (c) => (
              <span>
                <span className="line-clamp-2 block max-w-xl text-body-sm text-ink">{c.body}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-3">
                  <Avatar src={c.author.avatarUrl} name={c.author.name} size="xs" />
                  {c.author.name} · {formatRelative(c.createdAt)}
                </span>
              </span>
            ),
            card: (c) => (
              <span>
                <span className="line-clamp-3 block text-body-sm text-ink">{c.body}</span>
                <span className="mt-1 block text-caption text-ink-3">
                  {c.author.name} · {formatRelative(c.createdAt)}
                  {c.deleted && " · deleted"}
                </span>
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            hideOnMobile: true,
            cell: (c) =>
              c.deleted ? <Badge variant="danger">Deleted</Badge> : <Badge variant="success">Live</Badge>,
          },
        ]}
        rows={rows}
        rowKey={(c) => c.id}
        actions={[
          {
            id: "delete",
            label: "Delete comment",
            icon: "trash",
            destructive: true,
            hidden: (c) => c.deleted,
            onSelect: (c) => setDeleting(c),
          },
        ]}
        emptyTitle="No comments"
      />

      {cursor && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void load(cursor, true)} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this comment?"
        description="The comment will be removed for everyone."
        confirmLabel="Delete comment"
        tone="danger"
        icon="trash"
        confirming={busy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
