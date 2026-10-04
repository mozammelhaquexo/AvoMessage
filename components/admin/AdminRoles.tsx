/**
 * components/admin/AdminRoles.tsx — /admin/roles.
 * Role distribution + the static permission matrix (docs/RBAC.md §2).
 *
 * Company roles are labelled through `@/lib/company-roles`, so a legacy OWNER
 * row reads as "Manager" here like everywhere else — the admin console must
 * never be the one place that says "Owner" (request 7).
 */
"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Icon, LoadingState, toast } from "@/components/ui";
import { apiGet } from "@/lib/api-client";
import { companyRoleLabel } from "@/lib/company-roles";
import { BarChart } from "./Charts";

interface RolesOverview {
  platformRoles: { role: string; count: number }[];
  companyRoles: { role: string; count: number }[];
  matrix: Record<string, string[]>;
}

const CAPABILITY_LABELS: Record<string, string> = {
  "platform.user_management": "Manage platform users",
  "platform.settings": "Manage system settings",
  "platform.reports": "Review reports queue",
  "platform.delete_any_content": "Delete any post / comment / message",
  "platform.audit_logs": "View audit logs",
  "platform.deactivate_company": "Deactivate any company",
  "company.edit_profile": "Edit company profile",
  "company.grant_manager_role": "Make someone a Manager",
  "company.revoke_manager_role": "Remove the Manager role",
  "company.remove_member": "Remove member",
  "company.invite": "Invite members",
  "company.manage_teams": "Create / edit / delete teams",
  "company.deactivate": "Deactivate company",
};

/** Platform roles are printed as-is; company roles are relabelled. */
function matrixLabel(role: string): string {
  return role === "OWNER" || role === "MANAGER" || role === "MEMBER"
    ? companyRoleLabel(role)
    : role;
}

export function AdminRoles() {
  const [data, setData] = useState<RolesOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<RolesOverview>("/api/admin/roles")
      .then(setData)
      .catch((e) => toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load roles" }))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return <LoadingState message="Loading roles…" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Platform roles</CardTitle>
          </CardHeader>
          <CardContent>
            {data.platformRoles.length === 0 ? (
              <EmptyState icon="lock" title="No data" compact />
            ) : (
              <BarChart
                points={data.platformRoles.map((r) => ({ date: r.role, count: r.count }))}
                label="Users per platform role"
                color="var(--brand)"
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Company roles</CardTitle>
          </CardHeader>
          <CardContent>
            {data.companyRoles.length === 0 ? (
              <EmptyState icon="lock" title="No data" compact />
            ) : (
              <BarChart
                points={data.companyRoles.map((r) => ({
                  date: companyRoleLabel(r.role),
                  count: r.count,
                }))}
                label="Memberships per company role"
                color="var(--accent)"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Permission matrix</CardTitle>
          <p className="text-body-sm text-ink-2">From docs/RBAC.md — enforced server-side; shown here for reference.</p>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-line">
            {Object.entries(data.matrix).map(([capability, roles]) => (
              <li key={capability} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex items-center gap-2 text-body-sm text-ink">
                  <Icon name="lock" size={14} aria-hidden className="text-ink-3" />
                  {CAPABILITY_LABELS[capability] ?? capability}
                </span>
                <span className="flex flex-wrap gap-1">
                  {roles.map((r) => (
                    <Badge
                      key={r}
                      variant={r.includes("ADMIN") ? "danger" : r === "MANAGER" ? "accent" : "neutral"}
                    >
                      {matrixLabel(r)}
                    </Badge>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
