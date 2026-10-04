/**
 * components/admin/AdminUsers.tsx — /admin/users.
 * Search, role/status filters, suspend/restore with ConfirmDialog,
 * cursor-based "load more".
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
import { apiGet, apiPatch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-client";
import { formatRelative } from "@/lib/chat";
import { DataTable } from "@/components/data/DataTable";
import type { AdminUserRow, Paginated, PlatformRole } from "@/lib/types";

export function AdminUsers() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Load failure is a rendered state, not just a toast: a failed fetch used
  // to leave an empty list on screen, which reads as "no data".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [suspending, setSuspending] = useState<AdminUserRow | null>(null);
  const [busy, setBusy] = useState(false);

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
        const res = await apiGet<Paginated<AdminUserRow>>("/api/admin/users", {
          params: {
            limit: 25,
            ...(c ? { cursor: c } : {}),
            ...(debounced ? { search: debounced } : {}),
            ...(roleFilter ? { platformRole: roleFilter } : {}),
            ...(statusFilter ? { isActive: statusFilter } : {}),
          },
        });
        setRows((prev) => (append ? [...prev, ...res.data] : res.data));
        setCursor(res.nextCursor);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load users");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debounced, roleFilter, statusFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(u: AdminUserRow, active: boolean) {
    setBusy(true);
    try {
      await apiPatch(`/api/admin/users/${u.id}`, { isActive: active });
      setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, isActive: active } : r)));
      toast({ variant: "success", title: active ? `${u.name} restored` : `${u.name} suspended` });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(false);
      setSuspending(null);
    }
  }

  if (loadError && rows.length === 0) {
    return (
      <ErrorState
        title="Couldn't load users"
        message={loadError}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Icon name="search" size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, username, email" aria-label="Search users" className="pl-9" />
        </div>
        <Select
          value={roleFilter}
          onValueChange={setRoleFilter}
          options={[
            { value: "", label: "All roles" },
            { value: "USER", label: "User" },
            { value: "ADMIN", label: "Admin" },
            { value: "SUPER_ADMIN", label: "Super admin" },
          ]}
          label="Filter by role"
          className="w-40"
        />
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: "", label: "All statuses" },
            { value: "true", label: "Active" },
            { value: "false", label: "Suspended" },
          ]}
          label="Filter by status"
          className="w-40"
        />
      </div>

      <DataTable
        label="Platform users"
        loading={loading}
        columns={[
          {
            key: "user",
            header: "User",
            sortable: true,
            sortValue: (u) => u.name.toLowerCase(),
            cell: (u) => (
              <Link href={`/admin/users/${u.id}`} className="flex items-center gap-2.5 hover:underline">
                <Avatar src={u.avatarUrl} name={u.name} size="md" />
                <span>
                  <span className="block font-medium text-ink">{u.name}</span>
                  <span className="block text-caption text-ink-3">@{u.username} · {u.email}</span>
                </span>
              </Link>
            ),
            card: (u) => (
              <Link href={`/admin/users/${u.id}`} className="flex items-center gap-2.5">
                <Avatar src={u.avatarUrl} name={u.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{u.name}</span>
                  <span className="block truncate text-caption text-ink-3">@{u.username}</span>
                </span>
                <StatusBadges user={u} />
              </Link>
            ),
          },
          {
            key: "role",
            header: "Role",
            sortable: true,
            sortValue: (u) => u.platformRole,
            hideOnMobile: true,
            cell: (u) => <RoleBadge role={u.platformRole} />,
          },
          {
            key: "status",
            header: "Status",
            hideOnMobile: true,
            cell: (u) => <StatusBadges user={u} />,
          },
          {
            key: "joined",
            header: "Joined",
            sortable: true,
            sortValue: (u) => u.createdAt,
            hideOnMobile: true,
            cell: (u) => <span className="text-ink-2">{formatRelative(u.createdAt)}</span>,
          },
        ]}
        rows={rows}
        rowKey={(u) => u.id}
        actions={[
          {
            id: "suspend",
            label: "Suspend user",
            icon: "block",
            destructive: true,
            hidden: (u) => !u.isActive,
            onSelect: (u) => setSuspending(u),
          },
          {
            id: "restore",
            label: "Restore user",
            icon: "check",
            hidden: (u) => u.isActive,
            onSelect: (u) => void setActive(u, true),
          },
        ]}
        emptyTitle="No users found"
        emptyDescription="Try a different search or filter."
      />

      {cursor && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void load(cursor, true)} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={suspending !== null}
        onOpenChange={(o) => !o && setSuspending(null)}
        title={`Suspend ${suspending?.name}?`}
        description="They will be signed out everywhere immediately and won't be able to sign back in until restored."
        confirmLabel="Suspend user"
        tone="danger"
        icon="block"
        confirming={busy}
        onConfirm={() => {
          if (suspending) void setActive(suspending, false);
        }}
      />
    </div>
  );
}

export function RoleBadge({ role }: { role: PlatformRole }) {
  return (
    <Badge variant={role === "USER" ? "neutral" : role === "ADMIN" ? "accent" : "danger"}>
      {role}
    </Badge>
  );
}

function StatusBadges({ user: u }: { user: AdminUserRow }) {
  return (
    <span className="flex gap-1">
      <Badge variant={u.isActive ? "success" : "danger"}>{u.isActive ? "Active" : "Suspended"}</Badge>
      {!u.isVerified && <Badge variant="warning">Unverified</Badge>}
    </span>
  );
}

/** True when the signed-in admin is a super-admin (can grant ADMIN). */
export function useIsSuperAdmin(): boolean {
  const { user } = useAuth();
  return user?.platformRole === "SUPER_ADMIN";
}
