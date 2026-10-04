/**
 * components/admin/AdminAuditLogs.tsx — /admin/audit-logs.
 * Filterable (actor, action, entity) + cursor pagination.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  Icon,
  Input,
  toast,
} from "@/components/ui";
import { apiGet } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { DataTable } from "@/components/data/DataTable";
import type { AuditLogRow, Paginated } from "@/lib/types";

export function AdminAuditLogs() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [applied, setApplied] = useState<{ action: string; entityType: string }>({ action: "", entityType: "" });

  const load = useCallback(
    async (c?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await apiGet<Paginated<AuditLogRow>>("/api/admin/audit-logs", {
          params: {
            limit: 30,
            ...(c ? { cursor: c } : {}),
            ...(applied.action ? { action: applied.action } : {}),
            ...(applied.entityType ? { entityType: applied.entityType } : {}),
          },
        });
        setRows((prev) => (append ? [...prev, ...res.data] : res.data));
        setCursor(res.nextCursor);
      } catch (e) {
        toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load audit logs" });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [applied],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="min-w-44 flex-1">
            <label htmlFor="audit-action" className="mb-1 block text-caption font-medium text-ink-2">
              Action (exact match)
            </label>
            <Input
              id="audit-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="e.g. user.suspend"
            />
          </div>
          <div className="min-w-44 flex-1">
            <label htmlFor="audit-entity" className="mb-1 block text-caption font-medium text-ink-2">
              Entity type
            </label>
            <Input
              id="audit-entity"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="e.g. company"
            />
          </div>
          <Button
            size="sm"
            onClick={() => setApplied({ action: action.trim(), entityType: entityType.trim() })}
          >
            <Icon name="filter" size={15} aria-hidden className="mr-1.5" />
            Apply filters
          </Button>
          {(applied.action || applied.entityType) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAction("");
                setEntityType("");
                setApplied({ action: "", entityType: "" });
              }}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      <DataTable
        label="Audit logs"
        loading={loading}
        columns={[
          {
            key: "action",
            header: "Action",
            cell: (l) => (
              <span>
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-ink">{l.action}</code>
                {l.entityType && (
                  <span className="ml-2 text-caption text-ink-3">
                    {l.entityType}{l.entityId ? ` · ${l.entityId.slice(0, 8)}…` : ""}
                  </span>
                )}
              </span>
            ),
            card: (l) => (
              <span>
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-ink">{l.action}</code>
                <span className="mt-1 block text-caption text-ink-3">
                  {l.actor?.name ?? "System"} · {formatRelative(l.createdAt)}
                </span>
              </span>
            ),
          },
          {
            key: "actor",
            header: "Actor",
            hideOnMobile: true,
            cell: (l) =>
              l.actor ? (
                <span className="flex items-center gap-2">
                  <Avatar src={l.actor.avatarUrl} name={l.actor.name} size="sm" />
                  <span className="text-ink-2">{l.actor.name}</span>
                </span>
              ) : (
                <span className="text-ink-3">System</span>
              ),
          },
          {
            key: "ip",
            header: "IP",
            hideOnMobile: true,
            cell: (l) => <span className="font-mono text-caption text-ink-3">{l.ipAddress ?? "—"}</span>,
          },
          {
            key: "time",
            header: "Time",
            sortable: true,
            sortValue: (l) => l.createdAt,
            hideOnMobile: true,
            cell: (l) => (
              <time dateTime={l.createdAt} className="text-ink-2">
                {formatRelative(l.createdAt)}
              </time>
            ),
          },
        ]}
        rows={rows}
        rowKey={(l) => l.id}
        emptyTitle="No audit entries"
        emptyDescription="Try different filters."
      />

      {cursor && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void load(cursor, true)} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
