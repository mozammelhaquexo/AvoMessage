/**
 * components/admin/AdminManagers.tsx — /admin/managers.
 *
 * The merged "Managers" section (request 5). The admin nav used to carry two
 * entries — Managers (a flat list of people) and Companies (a list of
 * workspaces). They are one section now, because a manager only ever exists
 * inside a company: the row is the company, and the number beside it is how
 * many managers that company has. Clicking the name opens the full page
 * (`/admin/managers/[companyId]`).
 *
 * Company deactivate/reactivate lives here too, so folding the two sections
 * together did not drop a feature.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Icon,
  Input,
  Select,
  toast,
} from "@/components/ui";
import { apiDelete, apiGet, apiPatch } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { DataTable } from "@/components/data/DataTable";
import { SaaSToolbar } from "@/components/console/SaaSToolbar";
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import type { Paginated, PublicCompany } from "@/lib/types";

interface CompanyManagerRow extends PublicCompany {
  memberCount: number;
  managerCount: number;
}

/**
 * Orientation block for the section, answering "where is the Manager Section
 * and what is in it?" without a support ticket.
 *
 * The nav calls it "Managers" and the page lists companies, which reads as a
 * mismatch until you know the product rule: a manager only ever exists inside
 * a company, so the company row IS the manager row. Saying that out loud — and
 * pointing at Applications, where the pending requests actually arrive — is
 * cheaper than renaming anything, and it keeps the drill-down path obvious.
 */
function ManagerSectionIntro() {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3.5">
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
      >
        <Icon name="shield" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-body-sm font-semibold text-ink">Manager Section</h2>
        <p className="mt-0.5 text-body-sm text-ink-2">
          Every manager on AvoMessage lives inside a company, so this section lists
          companies — the number beside each one is how many managers it has. Open a
          company to add or remove its managers and members, or to deactivate it.
        </p>
        <p className="mt-1 text-caption text-ink-3">
          New requests to <span className="font-medium">become</span> a manager are reviewed
          under Applications, not here.
        </p>
      </div>
      <Button href="/admin/applications" variant="outline" size="sm" className="shrink-0">
        <Icon name="send" size={15} aria-hidden className="mr-1.5" />
        Manager applications
      </Button>
    </div>
  );
}

const MANAGER_COLUMNS: CsvColumn<CompanyManagerRow>[] = [
  { header: "id", value: (r) => r.id },
  { header: "company", value: (r) => r.name },
  { header: "slug", value: (r) => r.slug },
  { header: "managers", value: (r) => r.managerCount },
  { header: "members", value: (r) => r.memberCount },
  { header: "active", value: (r) => r.isActive },
  { header: "createdAt", value: (r) => r.createdAt },
];

export function AdminManagers() {
  const [rows, setRows] = useState<CompanyManagerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Load failure is a rendered state, not just a toast: a failed fetch used
  // to leave an empty list on screen, which reads as "no data".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [confirming, setConfirming] = useState<CompanyManagerRow | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The permanent-removal flow, kept separate from `confirming` so the two
   * dialogs cannot both claim the same row: deactivation is reversible and
   * deleting is not, and they must never look like the same decision.
   */
  const [deleting, setDeleting] = useState<CompanyManagerRow | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (c?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const res = await apiGet<Paginated<CompanyManagerRow>>("/api/admin/managers", {
          params: {
            limit: 25,
            ...(c ? { cursor: c } : {}),
            ...(debounced ? { search: debounced } : {}),
            ...(activeFilter ? { isActive: activeFilter } : {}),
          },
        });
        setRows((prev) => (append ? [...prev, ...res.data] : res.data));
        setCursor(res.nextCursor);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load managers");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debounced, activeFilter]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(c: CompanyManagerRow, active: boolean) {
    setBusy(true);
    try {
      await apiPatch(`/api/admin/managers/${c.id}`, { isActive: active });
      setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, isActive: active } : r)));
      toast({
        variant: "success",
        title: active ? `${c.name} reactivated` : `${c.name} deactivated`,
      });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  /**
   * Remove the company for good, then drop the row.
   *
   * Only offered for an already-deactivated company, and the server enforces
   * the same rule — so a row that went stale in an open tab gets a clear
   * refusal rather than deleting something that was reactivated underneath it.
   */
  async function removeCompany(c: CompanyManagerRow) {
    setRemoving(true);
    try {
      await apiDelete(`/api/admin/managers/${c.id}`);
      setRows((prev) => prev.filter((r) => r.id !== c.id));
      toast({ variant: "success", title: `${c.name} deleted` });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setRemoving(false);
      setDeleting(null);
    }
  }

  /** Export what is on screen — the loaded page, not a new query. */
  function exportCsv() {
    if (rows.length === 0) {
      toast({ variant: "warning", title: "Nothing to export yet" });
      return;
    }
    downloadCsv(csvFilename("managers"), toCsv(rows, MANAGER_COLUMNS));
    toast({
      variant: "success",
      title: `Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`,
    });
  }

  if (loadError && rows.length === 0) {
    return (
      <ErrorState
        title="Couldn't load managers"
        message={loadError}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ManagerSectionIntro />

      <SaaSToolbar
        variant="page"
        label="Managers toolbar"
        onExport={exportCsv}
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Icon
            name="search"
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies"
            aria-label="Search companies"
            className="pl-9"
          />
        </div>
        <Select
          value={activeFilter}
          onValueChange={setActiveFilter}
          options={[
            { value: "", label: "All" },
            { value: "true", label: "Active" },
            { value: "false", label: "Deactivated" },
          ]}
          label="Filter by status"
          className="w-44"
        />
      </div>

      <DataTable
        label="Companies and their managers"
        loading={loading}
        columns={[
          {
            key: "company",
            header: "Company",
            sortable: true,
            sortValue: (c) => c.name.toLowerCase(),
            cell: (c) => (
              <Link href={`/admin/managers/${c.id}`} className="flex items-center gap-2.5 hover:underline">
                <Avatar src={c.logoUrl} name={c.name} size="md" fallbackIcon="building" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{c.name}</span>
                  <span className="block truncate text-caption text-ink-3">/{c.slug}</span>
                </span>
              </Link>
            ),
            card: (c) => (
              <Link href={`/admin/managers/${c.id}`} className="flex items-center gap-2.5">
                <Avatar src={c.logoUrl} name={c.name} size="md" fallbackIcon="building" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{c.name}</span>
                  <span className="block truncate text-caption text-ink-3">
                    {c.managerCount} manager{c.managerCount === 1 ? "" : "s"} ·{" "}
                    {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                  </span>
                </span>
              </Link>
            ),
          },
          {
            key: "managers",
            header: "Managers",
            sortable: true,
            sortValue: (c) => c.managerCount,
            cell: (c) => (
              <Badge variant={c.managerCount > 0 ? "accent" : "neutral"}>
                <span className="tabular-nums">{c.managerCount}</span>
              </Badge>
            ),
          },
          {
            key: "members",
            header: "Members",
            sortable: true,
            sortValue: (c) => c.memberCount,
            hideOnMobile: true,
            cell: (c) => <span className="tabular-nums text-ink-2">{c.memberCount}</span>,
          },
          {
            key: "status",
            header: "Status",
            hideOnMobile: true,
            cell: (c) => (
              <Badge variant={c.isActive ? "success" : "danger"}>
                {c.isActive ? "Active" : "Deactivated"}
              </Badge>
            ),
          },
          {
            key: "created",
            header: "Created",
            sortable: true,
            sortValue: (c) => c.createdAt,
            hideOnMobile: true,
            cell: (c) => <span className="text-ink-2">{formatRelative(c.createdAt)}</span>,
          },
        ]}
        rows={rows}
        rowKey={(c) => c.id}
        actions={[
          {
            id: "deactivate",
            label: "Deactivate company",
            icon: "block",
            destructive: true,
            hidden: (c) => !c.isActive,
            onSelect: (c) => setConfirming(c),
          },
          {
            id: "reactivate",
            label: "Reactivate company",
            icon: "check",
            hidden: (c) => c.isActive,
            onSelect: (c) => void setActive(c, true),
          },
          {
            // Only on a deactivated row. Deactivating is the reversible step;
            // this is the one that does not come back, so it is never the
            // first thing offered for a live company.
            id: "delete",
            label: "Delete company",
            icon: "trash",
            destructive: true,
            hidden: (c) => c.isActive,
            onSelect: (c) => setDeleting(c),
          },
        ]}
        emptyTitle="No companies found"
        emptyDescription={
          debounced ? "Try a different search." : "No companies on the platform yet."
        }
      />

      {cursor && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void load(cursor, true)} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={`Deactivate ${confirming?.name}?`}
        description="All members will lose access immediately. A super-admin can reactivate it later."
        confirmLabel="Deactivate"
        tone="danger"
        icon="building"
        confirming={busy}
        onConfirm={() => {
          if (confirming) void setActive(confirming, false);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name} permanently?`}
        description="This cannot be undone. The company's memberships, teams and every post filed under it are deleted with it. Its conversations survive, but no longer belong to a company."
        confirmLabel="Delete permanently"
        tone="danger"
        icon="trash"
        confirming={removing}
        onConfirm={() => {
          if (deleting) void removeCompany(deleting);
        }}
      />
    </div>
  );
}
