/**
 * components/admin/AdminCompanies.tsx — SUPERSEDED, no longer imported.
 *
 * This was the standalone `/admin/companies` section. Request 5 merged it into
 * `/admin/managers` (see `AdminManagers.tsx` for the merged list and
 * `AdminManagerCompany.tsx` for the per-company page), and `/admin/companies`
 * now redirects there.
 *
 * Kept on disk on purpose: this workspace is not a git repo, so deleting it
 * would be unrecoverable. Safe to delete once that is acceptable.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  Input,
  Select,
  toast,
} from "@/components/ui";
import { apiGet, apiPatch } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { DataTable } from "@/components/data/DataTable";
import type { Paginated, PublicCompany } from "@/lib/types";

interface CompanyRow extends PublicCompany {
  memberCount: number;
}

export function AdminCompanies() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [confirming, setConfirming] = useState<CompanyRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (c?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await apiGet<Paginated<CompanyRow>>("/api/admin/companies", {
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
        toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load companies" });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debounced, activeFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(c: CompanyRow, active: boolean) {
    setBusy(true);
    try {
      await apiPatch(`/api/admin/companies/${c.id}`, { isActive: active });
      setRows((prev) => prev.map((r) => (r.id === c.id ? { ...r, isActive: active } : r)));
      toast({ variant: "success", title: active ? `${c.name} reactivated` : `${c.name} deactivated` });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Icon name="search" size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies" aria-label="Search companies" className="pl-9" />
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
        label="Companies"
        loading={loading}
        columns={[
          {
            key: "company",
            header: "Company",
            sortable: true,
            sortValue: (c) => c.name.toLowerCase(),
            cell: (c) => (
              <span className="flex items-center gap-2.5">
                <Avatar src={c.logoUrl} name={c.name} size="md" fallbackIcon="building" />
                <span>
                  <span className="block font-medium text-ink">{c.name}</span>
                  <span className="block text-caption text-ink-3">/{c.slug}</span>
                </span>
              </span>
            ),
            card: (c) => (
              <span className="flex items-center gap-2.5">
                <Avatar src={c.logoUrl} name={c.name} size="md" fallbackIcon="building" />
                <span className="flex-1">
                  <span className="block font-medium text-ink">{c.name}</span>
                  <span className="block text-caption text-ink-3">/{c.slug}</span>
                </span>
                <Badge variant={c.isActive ? "success" : "danger"}>{c.isActive ? "Active" : "Deactivated"}</Badge>
              </span>
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
              <Badge variant={c.isActive ? "success" : "danger"}>{c.isActive ? "Active" : "Deactivated"}</Badge>
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
        ]}
        emptyTitle="No companies found"
        emptyDescription={debounced ? "Try a different search." : "No companies on the platform yet."}
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
    </div>
  );
}
