/**
 * components/admin/AdminReports.tsx — /admin/reports + /admin/reports/[id].
 * Moderation queue with target snapshots and resolution actions
 * (dismiss / delete content / suspend user).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  toast,
} from "@/components/ui";
import { apiGet, apiPatch } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { DataTable } from "@/components/data/DataTable";
import { BackLink } from "@/components/layout/AppShell";
import type { Paginated, PublicUser, ReportStatus } from "@/lib/types";

interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  reporter: PublicUser | null;
  createdAt: string;
  snapshot: unknown;
}

const STATUS_FILTERS = ["", "PENDING", "IN_REVIEW", "ACTIONED", "DISMISSED"] as const;

export function AdminReports() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<string>("PENDING");

  const load = useCallback(
    async (c?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await apiGet<Paginated<ReportRow>>("/api/admin/reports", {
          params: { limit: 25, ...(c ? { cursor: c } : {}), ...(status ? { status } : {}) },
        });
        setRows((prev) => (append ? [...prev, ...res.data] : res.data));
        setCursor(res.nextCursor);
      } catch (e) {
        toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load reports" });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "", label: "All statuses" },
            ...STATUS_FILTERS.filter(Boolean).map((s) => ({ value: s, label: s.replace("_", " ") })),
          ]}
          label="Filter by status"
          className="w-48"
        />
      </div>

      <DataTable
        label="Moderation reports"
        loading={loading}
        columns={[
          {
            key: "report",
            header: "Report",
            cell: (r) => (
              <Link href={`/admin/reports/${r.id}`} className="block hover:underline">
                <span className="block font-medium text-ink">
                  {r.targetType} · {r.reason.replace(/_/g, " ")}
                </span>
                <span className="block text-caption text-ink-3">
                  by {r.reporter?.name ?? "—"} · {formatRelative(r.createdAt)}
                </span>
                {r.details && <span className="mt-0.5 line-clamp-2 block text-body-sm text-ink-2">{r.details}</span>}
              </Link>
            ),
            card: (r) => (
              <Link href={`/admin/reports/${r.id}`} className="block">
                <span className="block font-medium text-ink">
                  {r.targetType} · {r.reason.replace(/_/g, " ")}
                </span>
                <span className="block text-caption text-ink-3">
                  by {r.reporter?.name ?? "—"} · {formatRelative(r.createdAt)}
                </span>
              </Link>
            ),
          },
          {
            key: "status",
            header: "Status",
            hideOnMobile: true,
            cell: (r) => <ReportStatusBadge status={r.status} />,
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="No reports"
        emptyDescription="The moderation queue is clear."
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

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const variant =
    status === "PENDING" ? "warning" : status === "IN_REVIEW" ? "info" : status === "ACTIONED" ? "success" : "neutral";
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

/* ── Report detail ─────────────────────────────────────────────────────── */

interface ReportDetail extends ReportRow {
  reviewer: PublicUser | null;
  reviewedAt: string | null;
}

export function AdminReportDetail({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { action: "dismiss" | "delete_content" | "suspend_user" }>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await apiGet<ReportDetail>(`/api/admin/reports/${reportId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load report.");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(action: "dismiss" | "delete_content" | "suspend_user") {
    setBusy(true);
    try {
      await apiPatch(`/api/admin/reports/${reportId}`, {
        // "Dismiss" closes the report without action; the others are actioned.
        status: action === "dismiss" ? "DISMISSED" : "ACTIONED",
        action,
      });
      toast({ variant: "success", title: "Report resolved" });
      void load();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Resolution failed" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  if (loading) return <LoadingState message="Loading report…" />;
  if (error || !report) return <ErrorState message={error ?? "Report not found."} onRetry={() => void load()} />;

  /**
   * Shape of `report.snapshot`, built server-side by `reportTargetSnapshot`.
   * POST/COMMENT/MESSAGE targets come back as `{ body, author, deleted }`;
   * a USER target comes back as `{ user }` — there is no body to show.
   * Both shapes have to be understood here, or a report against a live account
   * renders as "Content unavailable".
   */
  const snapshot = report.snapshot as null | {
    body?: string;
    author?: { name?: string; username?: string };
    user?: { name?: string; username?: string };
    deleted?: boolean;
  };

  const actions: { id: "dismiss" | "delete_content" | "suspend_user"; label: string; hint: string; destructive?: boolean }[] = [
    { id: "dismiss", label: "Dismiss", hint: "No violation — notify the reporter." },
    ...(report.targetType === "USER"
      ? [{ id: "suspend_user" as const, label: "Suspend user", hint: "Deactivate the reported account and revoke sessions.", destructive: true }]
      : [{ id: "delete_content" as const, label: "Delete content", hint: `Remove the reported ${report.targetType.toLowerCase()}.`, destructive: true }]),
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <BackLink href="/admin/reports" label="Back to queue" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-h3">Report</CardTitle>
              <ReportStatusBadge status={report.status} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-body-sm">
            <div className="flex items-center gap-2.5">
              <Avatar src={report.reporter?.avatarUrl ?? null} name={report.reporter?.name ?? "?"} size="md" />
              <div>
                <p className="font-medium text-ink">{report.reporter?.name}</p>
                <p className="text-caption text-ink-3">{formatRelative(report.createdAt)}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-caption text-ink-3">Target</dt>
                <dd className="font-medium text-ink">{report.targetType}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-3">Reason</dt>
                <dd className="font-medium text-ink">{report.reason.replace(/_/g, " ")}</dd>
              </div>
            </dl>
            {report.details && (
              <div>
                <p className="text-caption text-ink-3">Details</p>
                <p className="mt-0.5 whitespace-pre-wrap text-ink">{report.details}</p>
              </div>
            )}
            {report.reviewer && (
              <p className="text-caption text-ink-3">
                Reviewed by {report.reviewer.name}
                {report.reviewedAt ? ` · ${formatRelative(report.reviewedAt)}` : ""}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Reported content</CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot && (snapshot.body || snapshot.author) ? (
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                {snapshot.author && (
                  <p className="text-caption font-medium text-ink-2">
                    {snapshot.author.name} @{snapshot.author.username}
                  </p>
                )}
                {snapshot.body && <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">{snapshot.body}</p>}
                {snapshot.deleted && (
                  <p className="mt-1 text-caption text-warning">This content has since been deleted.</p>
                )}
              </div>
            ) : snapshot?.user ? (
              // A report against a person, not a post. The account is the thing
              // under review, so show the account — not an empty "content" box.
              <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
                <Avatar src={null} name={snapshot.user.name ?? "?"} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{snapshot.user.name}</p>
                  <p className="text-caption text-ink-3">@{snapshot.user.username}</p>
                </div>
                <Link
                  href={`/admin/users/${report.targetId}`}
                  className="shrink-0 text-body-sm font-medium text-brand hover:underline"
                >
                  Open profile
                </Link>
              </div>
            ) : (
              <EmptyState icon="eye" title="Content unavailable" description="The reported content may have been deleted already." compact />
            )}
          </CardContent>
        </Card>
      </div>

      {report.status === "PENDING" || report.status === "IN_REVIEW" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Resolve</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {actions.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5">
                <div>
                  <p className="text-body-sm font-medium text-ink">{a.label}</p>
                  <p className="text-caption text-ink-3">{a.hint}</p>
                </div>
                <Button size="sm" variant={a.destructive ? "danger" : "outline"} onClick={() => setConfirm({ action: a.id })}>
                  {a.label}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <EmptyState icon="check" title="Resolved" description="This report has already been handled." compact />
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Resolve report?"
        description={
          confirm?.action === "suspend_user"
            ? "The reported user will be suspended and signed out everywhere."
            : confirm?.action === "delete_content"
              ? "The reported content will be permanently deleted for everyone."
              : "The report will be dismissed and the reporter notified."
        }
        confirmLabel="Confirm"
        tone={confirm?.action === "dismiss" ? "default" : "danger"}
        icon="flag"
        confirming={busy}
        onConfirm={() => {
          if (confirm) void resolve(confirm.action);
        }}
      />
    </div>
  );
}
