/**
 * components/admin/AdminApplications.tsx — /admin/applications (+ /[id]).
 *
 * The reviewer's half of feature 10.
 *
 * There is deliberately NO company picker here. The product rule is that a
 * manager creates their OWN company, so the reviewer decides on the person, not
 * on which company to drop them into. Approval grants the MANAGER role only if
 * the application already points at a real company (an applicant who named one
 * that exists); otherwise the application is simply approved and the applicant
 * creates their company themselves.
 *
 * The service does the role grant in the same transaction that flips the
 * status, so "approved but no panel appeared" cannot happen.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  Icon,
  Input,
  LoadingState,
  Select,
  Textarea,
  toast,
} from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { DataTable } from "@/components/data/DataTable";
import { SaaSToolbar } from "@/components/console/SaaSToolbar";
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import type {
  ManagerApplicationItem,
  ManagerApplicationStatus,
  Page,
} from "@/lib/api-types";

/**
 * Export columns. Mirrors what the table shows plus the fields the reviewer
 * needs to justify a decision (headcount, teams, the applicant's own note).
 */
const APPLICATION_COLUMNS: CsvColumn<ManagerApplicationItem>[] = [
  { header: "id", value: (r) => r.id },
  { header: "status", value: (r) => r.status },
  { header: "applicant", value: (r) => r.applicant?.name ?? "" },
  { header: "username", value: (r) => r.applicant?.username ?? "" },
  { header: "company", value: (r) => r.company?.name ?? r.companyName },
  { header: "position", value: (r) => r.position },
  { header: "companySize", value: (r) => r.companySize },
  { header: "teamCount", value: (r) => r.teamCount },
  { header: "teamSize", value: (r) => r.teamSize },
  { header: "submittedAt", value: (r) => r.createdAt },
  { header: "reviewedAt", value: (r) => r.reviewedAt },
  { header: "reviewNote", value: (r) => r.reviewNote },
  { header: "message", value: (r) => r.message },
];

const STATUS_FILTERS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "DECLINED", label: "Declined" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];

const STATUS_VARIANT: Record<
  ManagerApplicationStatus,
  "warning" | "success" | "danger" | "neutral"
> = {
  PENDING: "warning",
  APPROVED: "success",
  DECLINED: "danger",
  WITHDRAWN: "neutral",
};

/* ── List ─────────────────────────────────────────────────────────────────── */

export function AdminApplications() {
  const [rows, setRows] = useState<ManagerApplicationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");

  const load = useCallback(
    async (c?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await apiGet<Page<ManagerApplicationItem>>("/api/admin/manager-applications", {
          params: {
            limit: 25,
            ...(c ? { cursor: c } : {}),
            ...(status ? { status } : {}),
            ...(applied ? { search: applied } : {}),
          },
        });
        setRows((prev) => (append ? [...prev, ...res.data] : res.data));
        setCursor(res.nextCursor);
      } catch (e) {
        toast({
          variant: "error",
          title: e instanceof Error ? e.message : "Could not load applications",
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [status, applied],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /** Export what is currently on screen — the loaded page, not a new query. */
  function exportCsv() {
    if (rows.length === 0) {
      toast({ variant: "warning", title: "Nothing to export yet" });
      return;
    }
    const csv = toCsv(rows, APPLICATION_COLUMNS);
    downloadCsv(csvFilename(`manager-applications-${status.toLowerCase()}`), csv);
    toast({
      variant: "success",
      title: `Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SaaSToolbar
        label="Applications toolbar"
        sections={[
          {
            id: "applications",
            label: "Applications",
            href: "/admin/applications",
            keywords: ["manager", "review", "approve", "decline"],
          },
          { id: "managers", label: "Managers", href: "/admin/managers" },
          { id: "users", label: "Users", href: "/admin/users" },
          { id: "content", label: "Content", href: "/admin/content" },
        ]}
        onExport={exportCsv}
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Select
            label="Status"
            value={status}
            onValueChange={setStatus}
            options={STATUS_FILTERS}
          />
        </div>
        <div className="min-w-52 flex-1">
          <label htmlFor="app-search" className="mb-1 block text-caption font-medium text-ink-2">
            Search
          </label>
          <Input
            id="app-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setApplied(search.trim());
            }}
            placeholder="Name, username, company or position"
          />
        </div>
        <Button size="sm" onClick={() => setApplied(search.trim())}>
          <Icon name="search" size={15} aria-hidden className="mr-1.5" />
          Search
        </Button>
        {applied && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setApplied("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <DataTable
        label="Manager applications"
        loading={loading}
        columns={[
          {
            key: "applicant",
            header: "Applicant",
            sortable: true,
            sortValue: (r) => r.applicant?.name.toLowerCase() ?? "",
            cell: (r) => (
              <Link
                href={`/admin/applications/${r.id}`}
                className="flex items-center gap-2.5 hover:underline"
              >
                <Avatar src={r.applicant?.avatarUrl ?? null} name={r.applicant?.name ?? "?"} size="md" />
                <span>
                  <span className="block font-medium text-ink">{r.applicant?.name ?? "Unknown"}</span>
                  <span className="block text-caption text-ink-3">
                    @{r.applicant?.username ?? "unknown"}
                  </span>
                </span>
              </Link>
            ),
            card: (r) => (
              <Link href={`/admin/applications/${r.id}`} className="flex items-center gap-2.5">
                <Avatar src={r.applicant?.avatarUrl ?? null} name={r.applicant?.name ?? "?"} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">
                    {r.applicant?.name ?? "Unknown"}
                  </span>
                  <span className="block truncate text-caption text-ink-3">
                    {r.companyName} · {r.position}
                  </span>
                </span>
              </Link>
            ),
          },
          {
            key: "company",
            header: "Company",
            sortable: true,
            sortValue: (r) => r.companyName.toLowerCase(),
            hideOnMobile: true,
            cell: (r) => <span className="text-ink-2">{r.companyName}</span>,
          },
          {
            key: "position",
            header: "Position",
            hideOnMobile: true,
            cell: (r) => <span className="text-ink-2">{r.position}</span>,
          },
          {
            key: "team",
            header: "Team",
            hideOnMobile: true,
            cell: (r) => (
              <span className="text-ink-2">
                {r.teamCount} team{r.teamCount === 1 ? "" : "s"} · {r.teamSize}/team
              </span>
            ),
          },
          {
            key: "submitted",
            header: "Submitted",
            sortable: true,
            sortValue: (r) => r.createdAt,
            hideOnMobile: true,
            cell: (r) => <span className="text-ink-2">{formatRelative(r.createdAt)}</span>,
          },
          {
            key: "status",
            header: "Status",
            cell: (r) => <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>,
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle={status === "PENDING" ? "No applications waiting" : "Nothing here"}
        emptyDescription={
          status === "PENDING" ? "New manager applications will appear here." : undefined
        }
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

/* ── Detail ───────────────────────────────────────────────────────────────── */

export function AdminApplicationDetail({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [application, setApplication] = useState<ManagerApplicationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"APPROVE" | "DECLINE" | null>(null);
  const [confirm, setConfirm] = useState<"APPROVE" | "DECLINE" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const app = await apiGet<ManagerApplicationItem>(
        `/api/admin/manager-applications/${applicationId}`,
      );
      setApplication(app);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this application");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: "APPROVE" | "DECLINE") {
    if (!application) return;
    setBusy(action);
    try {
      await apiPost(`/api/admin/manager-applications/${applicationId}`, {
        action,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast({
        variant: "success",
        title: action === "APPROVE" ? "Application approved" : "Application declined",
      });
      setConfirm(null);
      router.push("/admin/applications");
    } catch (e) {
      toast({
        variant: "error",
        title: e instanceof Error ? e.message : "Could not record the decision",
      });
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingState message="Loading application…" />;
  if (error || !application) {
    return (
      <ErrorState
        title="Couldn't load this application"
        message={error ?? "Not found"}
        retryLabel="Try again"
        onRetry={() => void load()}
      />
    );
  }

  const pending = application.status === "PENDING";

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/applications"
        className="inline-flex w-fit items-center gap-1.5 text-body-sm font-medium text-ink-2 hover:underline"
      >
        <Icon name="chevronLeft" size={16} aria-hidden />
        All applications
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Icon name="shield" size={18} aria-hidden className="text-ink-3" />
            Manager application
          </CardTitle>
          <Badge variant={STATUS_VARIANT[application.status]}>{application.status}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Applicant */}
          <div className="flex items-center gap-3">
            <Avatar
              src={application.applicant?.avatarUrl ?? null}
              name={application.applicant?.name ?? "?"}
              size="lg"
            />
            <div className="min-w-0">
              <Link
                href={`/profile/${application.applicant?.username ?? ""}`}
                className="block truncate font-semibold text-ink hover:underline"
              >
                {application.applicant?.name ?? "Unknown"}
              </Link>
              <span className="block text-caption text-ink-3">
                @{application.applicant?.username ?? "unknown"} · applied{" "}
                {formatRelative(application.createdAt)}
              </span>
            </div>
          </div>

          {/* Details */}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Company" value={application.companyName} />
            <Detail label="Position" value={application.position} />
            <Detail label="Company size" value={`${application.companySize} people`} />
            <Detail label="Teams they'd run" value={`${application.teamCount}`} />
            <Detail label="People per team" value={`${application.teamSize}`} />
            <Detail
              label="Linked company"
              value={application.company ? application.company.name : "Not on AvoMessage yet"}
            />
          </dl>

          {application.message && (
            <div>
              <p className="text-caption font-medium text-ink-2">Applicant&apos;s note</p>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-ink-2">
                {application.message}
              </p>
            </div>
          )}

          {!pending && (
            <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
              <p className="text-caption font-medium text-ink-2">
                Decided {application.reviewedAt ? formatRelative(application.reviewedAt) : ""}
                {application.reviewer ? ` by ${application.reviewer.name}` : ""}
              </p>
              {application.reviewNote && (
                <p className="mt-1 whitespace-pre-wrap text-body-sm text-ink-2">
                  {application.reviewNote}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {pending && (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-caption text-ink-2">
              Approving makes{" "}
              <span className="font-medium text-ink">
                {application.applicant?.name ?? "this applicant"}
              </span>{" "}
              a manager. There is no company to choose — a manager creates their
              own company, and new managers are added to a company from{" "}
              <Link href="/admin/managers" className="font-semibold underline">
                Managers
              </Link>
              .
            </p>

            <div>
              <label htmlFor="review-note" className="mb-1 block text-caption font-medium text-ink-2">
                Note to the applicant (optional)
              </label>
              <Textarea
                id="review-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="Explain the decision — this is shown to the applicant."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setConfirm("APPROVE")} disabled={busy !== null}>
                <Icon name="check" size={16} aria-hidden className="mr-1.5" />
                Approve
              </Button>
              <Button variant="outline" onClick={() => setConfirm("DECLINE")} disabled={busy !== null}>
                Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm === "APPROVE" ? "Approve this application?" : "Decline this application?"}
        description={
          confirm === "APPROVE"
            ? `${application.applicant?.name ?? "This user"} becomes a manager${
                application.company ? ` of ${application.company.name}` : ""
              } and can create or run their company.`
            : "The applicant is notified. They can apply again later."
        }
        confirmLabel={confirm === "APPROVE" ? "Approve" : "Decline"}
        tone={confirm === "APPROVE" ? "default" : "danger"}
        icon={confirm === "APPROVE" ? "check" : "alert"}
        confirming={busy !== null}
        onConfirm={() => {
          if (confirm) void decide(confirm);
        }}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption font-medium text-ink-3">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
