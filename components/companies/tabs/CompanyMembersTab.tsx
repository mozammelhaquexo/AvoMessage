/**
 * components/companies/tabs/CompanyMembersTab.tsx — company workspace Members tab.
 *
 * Extracted from CompanyWorkspace.tsx (code-review split; no behavior change).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { Avatar, Badge, Icon, Input } from "@/components/ui";
import { DataTable } from "@/components/data/DataTable";
import { companyRoleBadgeVariant, companyRoleLabel } from "@/lib/company-roles";
import { formatRelative } from "@/lib/chat";
import type { CompanyMemberView, Paginated } from "@/lib/types";

export function CompanyMembersTab({ companyId }: { companyId: string }) {
  const [members, setMembers] = useState<CompanyMemberView[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    apiGet<Paginated<CompanyMemberView>>(`/api/companies/${companyId}/members`, { params: { limit: 100 } })
      .then((r) => setMembers(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.user.name.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q),
    );
  }, [members, query]);

  return (
    <div className="py-4">
      <div className="relative mb-4 max-w-sm">
        <Icon name="search" size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" aria-label="Search members" className="pl-9" />
      </div>
      <DataTable
        label="Company members"
        columns={[
          {
            key: "member",
            header: "Member",
            sortable: true,
            sortValue: (m) => m.user.name.toLowerCase(),
            cell: (m) => (
              <span className="flex items-center gap-2.5">
                <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
                <span>
                  <span className="block font-medium">{m.user.name}</span>
                  <span className="block text-caption text-ink-3">@{m.user.username}</span>
                </span>
              </span>
            ),
            card: (m) => (
              <span className="flex items-center gap-2.5">
                <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
                <span>
                  <span className="block font-medium">{m.user.name}</span>
                  <span className="block text-caption text-ink-3">@{m.user.username}</span>
                </span>
                <Badge variant={companyRoleBadgeVariant(m.role)} className="ml-auto">{companyRoleLabel(m.role)}</Badge>
              </span>
            ),
          },
          {
            key: "role",
            header: "Role",
            sortable: true,
            sortValue: (m) => m.role,
            hideOnMobile: true,
            cell: (m) => <Badge variant={companyRoleBadgeVariant(m.role)}>{companyRoleLabel(m.role)}</Badge>,
          },
          {
            key: "joined",
            header: "Joined",
            sortable: true,
            sortValue: (m) => m.joinedAt,
            hideOnMobile: true,
            cell: (m) => <span className="text-ink-2">{formatRelative(m.joinedAt)}</span>,
          },
        ]}
        rows={filtered}
        rowKey={(m) => m.user.id}
        loading={loading}
        pageSize={20}
        emptyTitle="No members found"
      />
    </div>
  );
}
