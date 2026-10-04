/**
 * components/companies/tabs/CompanyManagersTab.tsx — company workspace Managers tab.
 *
 * Extracted from CompanyWorkspace.tsx (code-review split; no behavior change).
 *
 * Role labels go through `@/lib/company-roles`: a legacy OWNER row is shown as
 * "Manager", never "Owner" (request 7).
 */
"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { Avatar, Badge, Card, CardContent, EmptyState, LoadingState } from "@/components/ui";
import { companyRoleBadgeVariant, companyRoleLabel, isCompanyManagerRole } from "@/lib/company-roles";
import type { CompanyMemberView, Paginated } from "@/lib/types";

export function CompanyManagersTab({ companyId }: { companyId: string }) {
  const [managers, setManagers] = useState<CompanyMemberView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Paginated<CompanyMemberView>>(`/api/companies/${companyId}/members`, { params: { limit: 100 } })
      .then((r) => setManagers(r.data.filter((m) => isCompanyManagerRole(m.role))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <LoadingState message="Loading managers…" />;
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-2">
      {managers.map((m) => (
        <Card key={m.user.id}>
          <CardContent className="flex items-center gap-3 p-4">
            <Avatar src={m.user.avatarUrl} name={m.user.name} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold text-ink">{m.user.name}</p>
              <p className="truncate text-caption text-ink-3">@{m.user.username}</p>
            </div>
            <Badge variant={companyRoleBadgeVariant(m.role)}>{companyRoleLabel(m.role)}</Badge>
          </CardContent>
        </Card>
      ))}
      {managers.length === 0 && <EmptyState icon="shield" title="No managers" compact />}
    </div>
  );
}
