/**
 * components/manage/ManageTeams.tsx — /manage/[slug]/teams.
 * Teams CRUD + per-team member management (add/remove/role).
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  Dialog,
  Drawer,
  EmptyState,
  FormField,
  Icon,
  Input,
  LoadingState,
  Select,
  Textarea,
  toast,
} from "@/components/ui";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useManage } from "./ManageShell";
import type { CompanyMemberView, Paginated, PublicTeam, TeamMemberView, TeamRole } from "@/lib/types";

export function ManageTeams() {
  const { detail } = useManage();
  const companyId = detail.company.id;
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<"create" | { id: string } | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<PublicTeam | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [managing, setManaging] = useState<PublicTeam | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTeams(await apiGet<PublicTeam[]>(`/api/teams`, { params: { companyId } }));
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load teams" });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setName("");
    setDescription("");
    setDialog("create");
  }

  function openEdit(t: PublicTeam) {
    setName(t.name);
    setDescription(t.description ?? "");
    setDialog({ id: t.id });
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (dialog === "create") {
        await apiPost(`/api/companies/${companyId}/teams`, {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        });
        toast({ variant: "success", title: "Team created" });
      } else if (dialog) {
        await apiPatch(`/api/teams/${dialog.id}`, {
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
        });
        toast({ variant: "success", title: "Team updated" });
      }
      setDialog(null);
      void load();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not save team" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await apiDelete(`/api/teams/${deleting.id}`);
      toast({ variant: "success", title: "Team deleted" });
      setDeleting(null);
      void load();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not delete team" });
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">Teams ({teams.length})</h2>
        <Button size="sm" onClick={openCreate}>
          <Icon name="plus" size={15} aria-hidden className="mr-1.5" />
          New team
        </Button>
      </div>

      {loading ? (
        <LoadingState message="Loading teams…" />
      ) : teams.length === 0 ? (
        <EmptyState
          icon="users"
          title="No teams yet"
          description="Create teams to organize members into working groups."
          actionLabel="Create a team"
          onAction={openCreate}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-semibold text-ink">{t.name}</p>
                    {t.description && <p className="mt-0.5 line-clamp-2 text-body-sm text-ink-2">{t.description}</p>}
                    <p className="mt-1 text-caption text-ink-3">
                      {t.memberCount} member{t.memberCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => setManaging(t)} aria-label={`Manage members of ${t.name}`}>
                      <Icon name="users" size={16} aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`}>
                      <Icon name="edit" size={16} aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`} className="text-danger hover:bg-danger/10">
                      <Icon name="trash" size={16} aria-hidden />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "create" ? "Create a team" : "Edit team"}
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <FormField label="Team name" required>
            {(fp) => <Input {...fp} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}
          </FormField>
          <FormField label="Description">
            {(fp) => <Textarea {...fp} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!name.trim()}>
              {dialog === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this team?"
        description="Members keep their company membership. The team's chat link will stop working."
        confirmLabel="Delete team"
        tone="danger"
        icon="trash"
        confirming={deleteBusy}
        onConfirm={() => void deleteTeam()}
      />

      <Drawer open={managing !== null} onOpenChange={(o) => !o && setManaging(null)} title={managing ? `${managing.name} — members` : "Team members"}>
        {managing && <TeamMemberManager team={managing} companyId={companyId} onChanged={() => void load()} />}
      </Drawer>
    </div>
  );
}

/* ── Per-team member management ────────────────────────────────────────── */

function TeamMemberManager({
  team,
  companyId,
  onChanged,
}: {
  team: PublicTeam;
  companyId: string;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<TeamMemberView[]>([]);
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberView[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tm, cm] = await Promise.all([
        apiGet<{ team: PublicTeam; members: TeamMemberView[] }>(`/api/teams/${team.id}`),
        apiGet<Paginated<CompanyMemberView>>(`/api/companies/${companyId}/members`, { params: { limit: 100 } }),
      ]);
      setMembers(tm.members);
      setCompanyMembers(cm.data);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load team members" });
    }
  }, [team.id, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const candidates = query.trim().length >= 2
    ? companyMembers
        .filter((m) => !members.some((tm) => tm.user.id === m.user.id))
        .filter(
          (m) =>
            m.user.name.toLowerCase().includes(query.trim().toLowerCase()) ||
            m.user.username.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];

  async function add(userId: string) {
    setBusy(userId);
    try {
      await apiPost(`/api/teams/${team.id}/members`, { userId });
      setQuery("");
      void load();
      onChanged();
      toast({ variant: "success", title: "Member added to team" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not add member" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    setBusy(userId);
    try {
      await apiDelete(`/api/teams/${team.id}/members/${userId}`);
      void load();
      onChanged();
      toast({ variant: "success", title: "Member removed from team" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not remove member" });
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(userId: string, role: TeamRole) {
    setBusy(userId);
    try {
      await apiPatch(`/api/teams/${team.id}/members/${userId}`, { role });
      void load();
      toast({ variant: "success", title: "Team role updated" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not change role" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-3">
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>
        <ul className="flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.user.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium text-ink">{m.user.name}</span>
                <span className="block truncate text-caption text-ink-3">@{m.user.username}</span>
              </span>
              <Select
                value={m.role}
                onValueChange={(v) => void changeRole(m.user.id, v as TeamRole)}
                options={[{ value: "MEMBER", label: "Member" }, { value: "MANAGER", label: "Manager" }]}
                label={`Team role for ${m.user.name}`}
                disabled={busy === m.user.id}
              />
              <Button variant="ghost" size="icon-sm" onClick={() => void remove(m.user.id)} aria-label={`Remove ${m.user.name} from team`}>
                <Icon name="x" size={15} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-3">Add from company</p>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company members" aria-label="Search company members" />
        {candidates.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {candidates.map((m) => (
              <li key={m.user.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-ink">{m.user.name}</span>
                  <span className="block truncate text-caption text-ink-3">@{m.user.username}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => void add(m.user.id)} loading={busy === m.user.id}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
