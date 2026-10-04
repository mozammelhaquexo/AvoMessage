/**
 * components/manage/ManageActivity.tsx — company activity feed for managers.
 *
 * Renders the company-scoped audit log as a human-readable timeline.
 * Backed by /api/companies/[id]/activity.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Button, Card, EmptyState, ErrorState, Icon, LoadingState, type IconName } from "@/components/ui";
import { apiGet, ApiError } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import type { PublicUser } from "@/lib/types";
import { useManage } from "./ManageShell";

interface ActivityItem {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: PublicUser | null;
}

interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

const ACTION_META: Record<string, { icon: IconName; text: (actor: string) => string }> = {
  "company.create": { icon: "building", text: (a) => `${a} created the company` },
  "company.update": { icon: "settings", text: (a) => `${a} updated company settings` },
  "company.deactivate": { icon: "alert", text: (a) => `${a} deactivated the company` },
  "company.member_add": { icon: "plus", text: (a) => `${a} added a member` },
  "company.member_remove": { icon: "x", text: (a) => `${a} removed a member` },
  "company.member_role_change": { icon: "shield", text: (a) => `${a} changed a member's role` },
  "company.announcement_create": { icon: "bell", text: (a) => `${a} published an announcement` },
  "company.post_create": { icon: "comment", text: (a) => `${a} posted in the company` },
  "company.account_create": { icon: "building", text: (a) => `${a} created a company account` },
  "company.join_request_create": { icon: "plus", text: (a) => `${a} requested to join` },
  "company.join_request_approve": { icon: "check", text: (a) => `${a} approved a join request` },
  "company.join_request_decline": { icon: "x", text: (a) => `${a} declined a join request` },
};

function describe(item: ActivityItem): { icon: IconName; text: string } {
  const actorName = item.actor ? item.actor.name || `@${item.actor.username}` : "Someone";
  const meta = ACTION_META[item.action];
  if (meta) return { icon: meta.icon, text: meta.text(actorName) };
  const pretty = item.action.replace(/^company\./, "").replace(/_/g, " ");
  return { icon: "clock", text: `${actorName} — ${pretty}` };
}

export function ManageActivity() {
  const { detail } = useManage();
  const companyId = detail.company.id;
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (c?: string | null, append = false) => {
      const url = `/api/companies/${companyId}/activity?limit=20${c ? `&cursor=${encodeURIComponent(c)}` : ""}`;
      const page = await apiGet<Page<ActivityItem>>(url);
      if (append) setItems((p) => [...p, ...page.data]);
      else setItems(page.data);
      setCursor(page.nextCursor);
    },
    [companyId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load(null, false);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(cursor, true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-sm text-ink-2 mt-1">
          Everything happening in {detail.company.name}, newest first.
        </p>
      </div>

      {loading ? (
        <LoadingState message="Loading activity…" />
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : items.length === 0 ? (
        <EmptyState title="No activity yet" description="Actions taken in this company will appear here." />
      ) : (
        <Card className="divide-y divide-line">
          {items.map((item) => {
            const { icon, text } = describe(item);
            return (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3.5">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                  <Icon name={icon} size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {item.actor && (
                      <Avatar name={item.actor.name} src={item.actor.avatarUrl} size="xs" />
                    )}
                    <p className="text-sm">{text}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-3" title={new Date(item.createdAt).toLocaleString()}>
                    {timeAgo(item.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {cursor && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
