/**
 * components/manage/ManageDashboard.tsx — /manage/[slug] dashboard.
 * Stat cards + pending invitations + recent joins + recent activity.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  LoadingState,
  toast,
} from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api-client";
import { companyRoleBadgeVariant, companyRoleLabel, isCompanyManagerRole } from "@/lib/company-roles";
import { formatRelative } from "@/lib/chat";
import { StatCard } from "@/components/data/StatCard";
import { useManage } from "./ManageShell";
import type {
  CompanyMemberView,
  InvitationView,
  Paginated,
  PostSummary,
  PublicTeam,
  AuditLogRow,
} from "@/lib/types";

export function ManageDashboard() {
  const { detail } = useManage();
  const companyId = detail.company.id;
  const [members, setMembers] = useState<CompanyMemberView[]>([]);
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [activity, setActivity] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [m, t, inv, p, a] = await Promise.all([
          apiGet<Paginated<CompanyMemberView>>(`/api/companies/${companyId}/members`, { params: { limit: 100 } }),
          apiGet<PublicTeam[]>(`/api/teams`, { params: { companyId } }),
          apiGet<InvitationView[]>("/api/invitations", { params: { companyId } }),
          apiGet<Paginated<PostSummary>>(`/api/companies/${companyId}/posts`, { params: { limit: 5 } }),
          apiGet<Paginated<AuditLogRow>>(`/api/companies/${companyId}/activity`, { params: { limit: 10 } }),
        ]);
        setMembers(m.data);
        setTeams(t);
        setInvitations(inv);
        setPosts(p.data);
        setActivity(a.data);
      } catch (e) {
        toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load dashboard data" });
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  if (loading) return <LoadingState message="Loading dashboard…" />;

  const managers = members.filter((m) => isCompanyManagerRole(m.role));
  const recentJoins = [...members].sort((a, b) => +new Date(b.joinedAt) - +new Date(a.joinedAt)).slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Members" value={detail.counts.members} icon="users" tone="brand" />
        <StatCard label="Managers" value={managers.length} icon="shield" tone="accent" />
        <StatCard label="Teams" value={teams.length} icon="users" tone="info" />
        <StatCard label="Pending invites" value={invitations.length} icon="send" tone="warning" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending invitations */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-h3">Pending invitations</CardTitle>
              <Link
                href={`/manage/${detail.company.slug}/invitations`}
                className="flex h-9 items-center rounded-md border border-line-strong px-4 text-body-sm font-medium text-ink hover:bg-surface-2"
              >
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {invitations.length === 0 ? (
              <EmptyState icon="send" title="No pending invitations" compact />
            ) : (
              invitations.slice(0, 5).map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} onRevoked={() => setInvitations((p) => p.filter((i) => i.id !== inv.id))} />
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent joins */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-h3">Recent joins</CardTitle>
              <Link
                href={`/manage/${detail.company.slug}/members`}
                className="flex h-9 items-center rounded-md border border-line-strong px-4 text-body-sm font-medium text-ink hover:bg-surface-2"
              >
                Manage members
              </Link>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentJoins.length === 0 ? (
              <EmptyState icon="users" title="No members yet" compact />
            ) : (
              recentJoins.map((m) => (
                <div key={m.user.id} className="flex items-center gap-3">
                  <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-medium text-ink">{m.user.name}</p>
                    <p className="text-caption text-ink-3">Joined {formatRelative(m.joinedAt)}</p>
                  </div>
                  <Badge variant={companyRoleBadgeVariant(m.role)}>{companyRoleLabel(m.role)}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent posts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Recent posts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {posts.length === 0 ? (
              <EmptyState icon="comment" title="No posts yet" compact />
            ) : (
              posts.map((p) => (
                <div key={p.id} className="flex gap-2.5">
                  <Avatar src={p.author?.avatarUrl ?? null} name={p.author?.name ?? "?"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-body-sm text-ink">{p.body}</p>
                    <p className="mt-0.5 text-caption text-ink-3">
                      {p.author?.name} · {formatRelative(p.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Activity log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {activity.length === 0 ? (
              <EmptyState icon="clock" title="No activity yet" compact />
            ) : (
              activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 text-body-sm">
                  <Icon name="info" size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">
                      <span className="font-medium">{a.actor?.name ?? "System"}</span>{" "}
                      <span className="text-ink-2">{humanizeAction(a.action)}</span>
                    </p>
                    <p className="text-caption text-ink-3">{formatRelative(a.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function humanizeAction(action: string): string {
  return action.replace(/^company\./, "").replace(/_/g, " ");
}

export function InvitationRow({
  invitation,
  onRevoked,
}: {
  invitation: InvitationView;
  onRevoked?: () => void;
}) {
  const [revoking, setRevoking] = useState(false);

  async function revoke() {
    setRevoking(true);
    try {
      // The revoke route resolves the invitation by id or raw token.
      await apiPost(`/api/invitations/${invitation.id}/revoke`, {});
      toast({ variant: "success", title: "Invitation revoked" });
      onRevoked?.();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not revoke invitation" });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
      <Icon name="send" size={16} aria-hidden className="shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-medium text-ink">{invitation.email}</p>
        <p className="text-caption text-ink-3">
          {invitation.role}
          {invitation.teamName ? ` · ${invitation.teamName}` : ""} · expires {formatRelative(invitation.expiresAt)}
        </p>
      </div>
      {onRevoked && (
        <Button size="sm" variant="ghost" onClick={() => void revoke()} loading={revoking} aria-label={`Revoke invitation for ${invitation.email}`}>
          <Icon name="x" size={14} aria-hidden />
        </Button>
      )}
    </div>
  );
}
