/**
 * components/admin/AdminAnnouncements.tsx — /admin/announcements.
 * Platform-wide announcements (published as PUBLIC posts).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  FormField,
  Icon,
  Input,
  LoadingState,
  Textarea,
  toast,
} from "@/components/ui";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import type { PostSummary } from "@/lib/types";

interface Announcement extends PostSummary {
  title: string | null;
}

export function AdminAnnouncements() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteContent, setDeleteContent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiGet<Announcement[]>("/api/admin/announcements"));
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load announcements" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish() {
    if (!body.trim()) return;
    setPublishing(true);
    try {
      const created = await apiPost<Announcement>("/api/admin/announcements", {
        body: body.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      setItems((prev) => [created, ...prev]);
      setTitle("");
      setBody("");
      toast({ variant: "success", title: "Announcement published platform-wide" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not publish" });
    } finally {
      setPublishing(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await apiDelete(`/api/admin/announcements/${deleting.id}`, undefined, {
        params: { deleteContent },
      });
      setItems((prev) => prev.filter((i) => i.id !== deleting.id));
      toast({ variant: "success", title: "Announcement removed" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not remove" });
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
      setDeleteContent(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Publish platform announcement</CardTitle>
          <p className="text-body-sm text-ink-2">Visible to every user. Use sparingly.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FormField label="Title (optional)">
            {(fp) => <Input {...fp} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Scheduled maintenance" />}
          </FormField>
          <FormField label="Body" required>
            {(fp) => <Textarea {...fp} value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder="What's happening…" />}
          </FormField>
          <div className="flex justify-end">
            <Button onClick={() => void publish()} loading={publishing} disabled={!body.trim()}>
              <Icon name="send" size={15} aria-hidden className="mr-1.5" />
              Publish
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-h3 font-semibold text-ink">Active announcements</h2>
        {loading ? (
          <LoadingState message="Loading announcements…" />
        ) : items.length === 0 ? (
          <EmptyState icon="sparkles" title="No announcements" compact />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex gap-3 p-4">
                  <Avatar src={a.author?.avatarUrl ?? null} name={a.author?.name ?? "?"} size="md" />
                  <div className="min-w-0 flex-1">
                    {a.title && <p className="text-body-sm font-semibold text-ink">{a.title}</p>}
                    <p className="whitespace-pre-wrap text-body-sm text-ink-2">{a.body}</p>
                    <p className="mt-1 text-caption text-ink-3">{formatRelative(a.createdAt)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(a)}
                    aria-label={`Remove announcement${a.title ? `: ${a.title}` : ""}`}
                    className="shrink-0 text-danger hover:bg-danger/10"
                  >
                    <Icon name="trash" size={15} aria-hidden />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove announcement?"
        description={
          <span className="flex flex-col gap-2">
            <span>This stops showing the announcement platform-wide.</span>
            <label className="flex cursor-pointer items-center gap-2 text-body-sm text-ink">
              <input
                type="checkbox"
                checked={deleteContent}
                onChange={(e) => setDeleteContent(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              Also delete the underlying post
            </label>
          </span>
        }
        confirmLabel="Remove"
        tone="danger"
        icon="trash"
        confirming={deleteBusy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
