/**
 * components/manage/ManageMembers.tsx — /manage/[slug]/members.
 *
 * Member directory with role assignment, removal (ConfirmDialog), invite-by-
 * email, and the add-member flow.
 *
 * Role rules, both here and in `lib/services/companies.ts`:
 *   - OWNER is never assignable (request 7). The owner role is retired from the
 *     product; a legacy row that still holds it is shown read-only and labelled
 *     "Manager" via `@/lib/company-roles`.
 *   - A manager cannot make another manager (part 2, request 3). The Manager
 *     role is granted from the Admin console and only from there, so this page
 *     adds MEMBERS and never offers a promotion. Demoting stays available —
 *     taking a role away is not the same act as handing one out — and the
 *     server still refuses to demote the last manager.
 *
 * Adding a member is OTP-gated: the manager enters the details, a code goes to
 * the member's own address, and the account appears only when that address
 * confirms it. The manager never gets to assert somebody else's email.
 */
"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  FormField,
  Icon,
  Input,
  LoadingState,
  Select,
  toast,
} from "@/components/ui";
import { OtpStep } from "@/components/auth/otp-step";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-client";
import { companyRoleBadgeVariant, companyRoleLabel, isCompanyManagerRole } from "@/lib/company-roles";
import { formatRelative } from "@/lib/chat";
import { otpErrorMessage, type OtpChallenge } from "@/lib/otp-client";
import { DataTable } from "@/components/data/DataTable";
import { useManage } from "./ManageShell";
import type { CompanyMemberView, Paginated, PublicTeam } from "@/lib/types";

export function ManageMembers() {
  const { detail, refresh } = useManage();
  const { user } = useAuth();
  const companyId = detail.company.id;
  const viewerIsManager = isCompanyManagerRole(detail.viewerRole);

  const [members, setMembers] = useState<CompanyMemberView[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [removing, setRemoving] = useState<CompanyMemberView | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<Paginated<CompanyMemberView>>(`/api/companies/${companyId}/members`, {
        params: { limit: 100 },
      });
      setMembers(res.data);
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load members" });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.user.name.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q),
    );
  }, [members, query]);

  /** Legacy OWNER rows only; used to protect the last one from removal. */
  const ownerCount = useMemo(() => members.filter((m) => m.role === "OWNER").length, [members]);

  /**
   * Demote a manager back to MEMBER. There is no promotion counterpart: the
   * MANAGER role is granted only from the Admin console (part 2, request 3), and
   * the company-side endpoint rejects `role: "MANAGER"` with a 403.
   */
  async function removeManagerRole(member: CompanyMemberView) {
    try {
      await apiPatch(`/api/companies/${companyId}/members/${member.user.id}`, { role: "MEMBER" });
      toast({ variant: "success", title: `${member.user.name} is no longer a manager` });
      void load();
      refresh();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not change role" });
    }
  }

  async function removeMember() {
    if (!removing) return;
    setRemovingBusy(true);
    try {
      await apiDelete(`/api/companies/${companyId}/members/${removing.user.id}`);
      toast({ variant: "success", title: `${removing.user.name} removed` });
      setRemoving(null);
      void load();
      refresh();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not remove member" });
    } finally {
      setRemovingBusy(false);
    }
  }

  /**
   * Who may be demoted back to MEMBER. Legacy OWNER rows are excluded — the
   * company-side endpoint refuses to touch them (an admin can still demote
   * them) — and the last remaining manager must stay, or the company would be
   * left with nobody to administer it. The server enforces both rules; this
   * only keeps the button off the screen.
   */
  const managerCount = useMemo(
    () => members.filter((m) => isCompanyManagerRole(m.role)).length,
    [members],
  );

  function canDemote(member: CompanyMemberView): boolean {
    return (
      viewerIsManager &&
      isCompanyManagerRole(member.role) &&
      member.role !== "OWNER" &&
      managerCount > 1
    );
  }

  function canRemove(member: CompanyMemberView): boolean {
    if (member.user.id === user?.id) return true; // leaving is always allowed
    if (detail.viewerRole === "OWNER") {
      // Legacy owner: may remove anyone except the last remaining owner.
      return member.role !== "OWNER" || ownerCount > 1;
    }
    // Managers may only remove plain members — matches removeMember().
    return viewerIsManager && member.role === "MEMBER";
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Icon name="search" size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" aria-label="Search members" className="pl-9" />
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAccountOpen(true)}>
            <Icon name="user" size={15} aria-hidden className="mr-1.5" />
            Add member
          </Button>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Icon name="send" size={15} aria-hidden className="mr-1.5" />
            Invite by email
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading members…" />
      ) : (
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
                    <span className="block font-medium">
                      {m.user.name}
                      {m.user.id === user?.id && <span className="text-ink-3"> (you)</span>}
                    </span>
                    <span className="block text-caption text-ink-3">@{m.user.username}</span>
                  </span>
                </span>
              ),
              card: (m) => (
                <span className="flex items-center gap-2.5">
                  <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
                  <span className="flex-1">
                    <span className="block font-medium">{m.user.name}</span>
                    <span className="block text-caption text-ink-3">@{m.user.username}</span>
                  </span>
                </span>
              ),
            },
            {
              key: "role",
              header: "Role",
              sortable: true,
              sortValue: (m) => m.role,
              hideOnMobile: true,
              cell: (m) => (
                <Badge variant={companyRoleBadgeVariant(m.role)}>{companyRoleLabel(m.role)}</Badge>
              ),
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
          pageSize={20}
          actions={[
            {
              id: "demote",
              label: "Remove as manager",
              icon: "shield",
              hidden: (m) => !canDemote(m),
              onSelect: (m) => void removeManagerRole(m),
            },
            {
              id: "remove",
              label: "Remove from company",
              icon: "trash",
              destructive: true,
              hidden: (m) => !canRemove(m),
              onSelect: (m) => setRemoving(m),
            },
          ]}
          emptyTitle="No members found"
          emptyDescription="Invite people to grow the company."
        />
      )}

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} companyId={companyId} />
      <AddMemberDialog
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        companyId={companyId}
        companyName={detail.company.name}
        onDone={() => { void load(); refresh(); }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing?.user.id === user?.id ? "Leave this company?" : `Remove ${removing?.user.name}?`}
        description={
          removing?.user.id === user?.id
            ? "You will lose access to this company's workspace."
            : "They will lose access to the company workspace immediately."
        }
        confirmLabel={removing?.user.id === user?.id ? "Leave" : "Remove"}
        tone="danger"
        icon="logout"
        confirming={removingBusy}
        onConfirm={() => void removeMember()}
      />
    </div>
  );
}

/* ── Invite by email ───────────────────────────────────────────────────── */

function InviteDialog({
  open,
  onClose,
  companyId,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
}) {
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setTeamId("");
      setError(null);
      apiGet<PublicTeam[]>(`/api/teams`, { params: { companyId } }).then(setTeams).catch(() => setTeams([]));
    }
  }, [open, companyId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await apiPost("/api/invitations", {
        companyId,
        email: email.trim(),
        // Always MEMBER: an invite cannot hand out the Manager role — that is an
        // Admin-console action. The endpoint rejects anything else.
        role: "MEMBER",
        ...(teamId ? { teamId } : {}),
      });
      toast({ variant: "success", title: `Invitation sent to ${email.trim()}` });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invitation.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite by email" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <FormField label="Email" required>
          {(fp) => <Input {...fp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" required />}
        </FormField>
        <p className="text-caption text-ink-3">
          They join as a Member. Only an administrator can give someone the Manager role.
        </p>
        {teams.length > 0 && (
          <FormField label="Team (optional)">
            {(fp) => (
              <Select
                id={fp.id}
                value={teamId}
                onValueChange={setTeamId}
                options={[{ value: "", label: "No team" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                label="Team (optional)"
              />
            )}
          </FormField>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-danger-strong">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={sending} disabled={!email.trim()}>
            Send invite
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ── Add a member (OTP-gated) ───────────────────────────────────────────── */

/**
 * Two steps. Step 1 sends a code to the address the manager typed; step 2
 * enters it and only then is the account created and the membership added.
 *
 * The point is that the manager cannot assert somebody else's email: a typo, or
 * an address that is not theirs, simply never gets confirmed, and no account is
 * created for it. The server re-checks `requireCompanyManager` at verify time,
 * so a page left open while the manager is demoted cannot still add members.
 */
function AddMemberDialog({
  open,
  onClose,
  companyId,
  companyName,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setUsername("");
      setEmail("");
      setPassword("");
      setChallenge(null);
      setError(null);
    }
  }, [open]);

  /** The member's details, in the shape both the request and the resend want. */
  const memberBody = () => ({
    name: name.trim(),
    username: username.trim(),
    email: email.trim(),
    password,
  });

  const requestCode = () =>
    apiPost<OtpChallenge>(`/api/companies/${companyId}/members/otp`, memberBody());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      setChallenge(await requestCode());
    } catch (err) {
      setError(otpErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add a member"
      size="sm"
    >
      {challenge ? (
        <OtpStep
          challenge={challenge}
          purpose="member"
          companyName={companyName}
          onVerify={async (code) => {
            await apiPost("/api/otp/verify", { challengeId: challenge.challengeId, code });
            toast({ variant: "success", title: `${name.trim()} joined ${companyName}` });
            onClose();
            onDone();
          }}
          onResend={async () => {
            const fresh = await requestCode();
            setChallenge(fresh);
            return fresh;
          }}
          onBack={() => setChallenge(null)}
          backLabel="Edit the details"
          footer="The code goes to the member's own address. Nothing is created until they confirm it."
        />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormField label="Full name" required>
            {(fp) => <Input {...fp} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}
          </FormField>
          <FormField label="Username" required>
            {(fp) => <Input {...fp} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} maxLength={30} required />}
          </FormField>
          <FormField label="Email" required hint="The confirmation code is sent here, so it must be theirs.">
            {(fp) => <Input {...fp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
          </FormField>
          <FormField label="Password" required hint="They sign in with this once they confirm the code.">
            {(fp) => <Input {...fp} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />}
          </FormField>
          <p className="text-caption text-ink-3">
            The account joins as a Member. Only an administrator can give someone the Manager role.
          </p>
          {error && (
            <p role="alert" className="text-body-sm text-danger-strong">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={!email.trim() || !name.trim()}>
              Send code
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/* Re-exported for the invitations page to share the invite dialog. */
export { InviteDialog };
