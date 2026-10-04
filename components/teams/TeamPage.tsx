/**
 * components/teams/TeamPage.tsx — /company/[slug]/teams/[teamId].
 * Team detail: members, edit (manager), group chat link (POST /api/teams/:id/chat).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
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
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Icon,
  Input,
  LoadingState,
  Textarea,
  toast,
} from "@/components/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-client";
import { DataTable } from "@/components/data/DataTable";
import { BackLink } from "@/components/layout/AppShell";
import { isCompanyManagerRole } from "@/lib/company-roles";
import type { CompanyMembership, PublicTeam, TeamMemberView } from "@/lib/types";

interface TeamDetail {
  team: PublicTeam;
  members: TeamMemberView[];
  companySlug: string;
  viewerCompanyRole: string;
}

export function TeamPage({ slug, teamId }: { slug: string; teamId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const mine = await apiGet<CompanyMembership[]>("/api/companies");
      const membership = mine.find((m) => m.company.slug === slug);
      if (!membership) {
        setForbidden(true);
        return;
      }
      const res = await apiGet<{ team: PublicTeam; members: TeamMemberView[] }>(`/api/teams/${teamId}`);
      setDetail({
        ...res,
        companySlug: slug,
        viewerCompanyRole: membership.role,
      });
      setName(res.team.name);
      setDescription(res.team.description ?? "");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setForbidden(true);
      else setError(e instanceof Error ? e.message : "Could not load the team.");
    } finally {
      setLoading(false);
    }
  }, [slug, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState message="Loading team…" />;
  if (forbidden || !detail) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState
          title="Not authorized"
          message="You don't have access to this team. Only company members can view it."
          onRetry={() => void load()}
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  const isManager = isCompanyManagerRole(detail.viewerCompanyRole);

  async function saveEdit() {
    setSaving(true);
    try {
      await apiPatch(`/api/teams/${teamId}`, {
        ...(name.trim() ? { name: name.trim() } : {}),
        description: description.trim() ? description.trim() : null,
      });
      setEditOpen(false);
      toast({ variant: "success", title: "Team updated" });
      void load();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam() {
    setDeleting(true);
    try {
      await apiDelete(`/api/teams/${teamId}`);
      toast({ variant: "success", title: "Team deleted" });
      router.push(`/company/${slug}`);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not delete team" });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function openChat() {
    setChatBusy(true);
    try {
      const res = await apiPost<{ id: string }>(`/api/teams/${teamId}/chat`, {});
      router.push(`/messages/${res.id}`);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not open team chat" });
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <BackLink href={`/company/${slug}`} label="Back to company" />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="font-display text-h2">{detail.team.name}</CardTitle>
              {detail.team.description && <p className="mt-1 text-body-sm text-ink-2">{detail.team.description}</p>}
              <p className="mt-1 text-caption text-ink-3">
                {detail.team.memberCount} member{detail.team.memberCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void openChat()} loading={chatBusy}>
                <Icon name="message" size={15} aria-hidden className="mr-1.5" />
                Team chat
              </Button>
              {isManager && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                    <Icon name="edit" size={15} aria-hidden className="mr-1.5" />
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                    <Icon name="trash" size={15} aria-hidden />
                    <span className="sr-only">Delete team</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <h2 className="mb-2 text-h3 font-semibold text-ink">Members</h2>
          <DataTable
            label="Team members"
            columns={[
              {
                key: "member",
                header: "Member",
                sortable: true,
                sortValue: (m) => m.user.name.toLowerCase(),
                cell: (m: TeamMemberView) => (
                  <span className="flex items-center gap-2.5">
                    <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
                    <span>
                      <span className="block font-medium">
                        {m.user.name}
                        {m.user.id === user?.id && <span className="text-ink-3"> (you)</span>}
                      </span>
                      <span className="block text-caption text-ink-3">@{m.user.username}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: "role",
                header: "Role",
                cell: (m: TeamMemberView) => (
                  <Badge variant={m.role === "MANAGER" ? "brand" : "neutral"}>{m.role}</Badge>
                ),
              },
            ]}
            rows={detail.members}
            rowKey={(m) => m.user.id}
            pageSize={25}
            emptyTitle="No members"
            emptyDescription="This team has no members yet."
          />
          {detail.members.length === 0 && <EmptyState icon="users" title="No members" compact />}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit team" size="sm">
        <div className="flex flex-col gap-3">
          <FormField label="Team name" required>
            {(fp) => <Input {...fp} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}
          </FormField>
          <FormField label="Description">
            {(fp) => <Textarea {...fp} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} loading={saving} disabled={!name.trim()}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this team?"
        description="Members keep their company membership, but the team and its chat link will be removed."
        confirmLabel="Delete team"
        tone="danger"
        icon="trash"
        confirming={deleting}
        onConfirm={() => void deleteTeam()}
      />
    </div>
  );
}

