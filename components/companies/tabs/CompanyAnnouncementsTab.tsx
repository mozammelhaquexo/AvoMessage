/**
 * components/companies/tabs/CompanyAnnouncementsTab.tsx — company workspace Announcements tab.
 *
 * Extracted from CompanyWorkspace.tsx (code-review split; no behavior change).
 * Announcements are canonical `Post` objects now (same shape as company posts).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  EmptyState,
  Icon,
  LoadingState,
  Textarea,
  toast,
} from "@/components/ui";
import { formatRelative } from "@/lib/chat";
import type { Post } from "@/lib/api-types";
import type { Paginated } from "@/lib/types";

export function CompanyAnnouncementsTab({
  companyId,
  isManager,
}: {
  companyId: string;
  isManager: boolean;
}) {
  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<Paginated<Post>>(`/api/companies/${companyId}/announcements`, { params: { limit: 20 } });
      setItems(res.data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      const created = await apiPost<Post>(`/api/companies/${companyId}/announcements`, { body: body.trim() });
      setItems((prev) => [created, ...prev]);
      setBody("");
      toast({ variant: "success", title: "Announcement published" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not publish" });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      {isManager && (
        <Card>
          <CardContent className="p-4">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write an announcement for the whole company…"
              aria-label="Announcement text"
              rows={2}
              maxLength={2000}
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => void publish()} loading={posting} disabled={!body.trim()}>
                <Icon name="send" size={14} aria-hidden className="mr-1.5" />
                Announce
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {loading ? (
        <LoadingState message="Loading announcements…" />
      ) : items.length === 0 ? (
        <EmptyState icon="sparkles" title="No announcements" description="Official updates from managers will appear here." compact />
      ) : (
        items.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex gap-3 p-4">
              <Avatar src={a.author?.avatarUrl ?? null} name={a.author?.name ?? "?"} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-caption text-ink-3">
                  {a.author?.name} · {formatRelative(a.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">{a.body}</p>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
