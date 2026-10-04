/**
 * components/admin/AdminManagerCompany.tsx — /admin/managers/[companyId].
 *
 * The full page behind a company name in the merged Managers section
 * (request 5): how many managers the company has, every manager, and how many
 * users sit under each one.
 *
 * "Users under a manager" is the distinct people on the teams that manager
 * leads. Teams are the only per-manager grouping the data model has
 * (`TeamMember.role = MANAGER`), so a manager who leads no team reports zero —
 * said plainly, rather than padded with the company's whole member list, which
 * every manager would otherwise appear to "own".
 *
 * Deactivate/reactivate lives here as well, so the detail page is a complete
 * replacement for the old Companies section.
 *
 * This page is also the only place a company can gain a manager (part 2,
 * request 3). Company-side screens add members and nothing else, so the
 * promote/demote controls below are the whole of that capability.
 *
 * Two ways in: promote an existing member, or add a brand-new manager. The
 * second is OTP-gated — the admin enters the details, a code goes to that
 * person's own address, and the user + MANAGER membership appear only once the
 * address confirms it.
 */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
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
  ErrorState,
  FormField,
  Icon,
  Input,
  LoadingState,
  toast,
} from "@/components/ui";
import { OtpStep } from "@/components/auth/otp-step";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { companyRoleBadgeVariant, companyRoleLabel } from "@/lib/company-roles";
import { otpErrorMessage, type OtpChallenge } from "@/lib/otp-client";
import { formatRelative } from "@/lib/chat";
import type { PublicCompany, PublicUser } from "@/lib/types";

interface ManagerUnder {
  user: PublicUser;
  role: string;
  joinedAt: string;
  teamsLed: { id: string; name: string; memberCount: number }[];
  usersUnder: number;
}

interface CompanyManagerDetail {
  company: PublicCompany;
  counts: { managers: number; members: number; teams: number; usersInTeams: number };
  managers: ManagerUnder[];
  members: { user: PublicUser; role: string; joinedAt: string }[];
  membersTruncated: boolean;
}

export function AdminManagerCompany({ companyId }: { companyId: string }) {
  const [detail, setDetail] = useState<CompanyManagerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The "add a brand-new manager" dialog. */
  const [addOpen, setAddOpen] = useState(false);
  /** userId currently being promoted/demoted, so only that row shows a spinner. */
  const [roleBusy, setRoleBusy] = useState<string | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setDetail(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<CompanyManagerDetail>(`/api/admin/managers/${companyId}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load this company");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, reloadKey]);

  async function setActive(active: boolean) {
    if (!detail) return;
    setBusy(true);
    try {
      await apiPatch(`/api/admin/managers/${detail.company.id}`, { isActive: active });
      setDetail({ ...detail, company: { ...detail.company, isActive: active } });
      toast({
        variant: "success",
        title: active
          ? `${detail.company.name} reactivated`
          : `${detail.company.name} deactivated`,
      });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  /**
   * Grant or revoke the Manager role. The server re-checks both the admin guard
   * and the last-manager invariant, so a stale page cannot get past either.
   */
  async function setRole(userId: string, role: "MANAGER" | "MEMBER", name: string) {
    setRoleBusy(userId);
    try {
      await apiPatch(`/api/admin/managers/${companyId}/members/${userId}`, { role });
      // Reload rather than patch local state: counts and the manager/member
      // split both move, and the server is the one that computed them.
      setDetail(null);
      setReloadKey((k) => k + 1);
      toast({
        variant: "success",
        title:
          role === "MANAGER"
            ? `${name} is now a manager`
            : `${name} is no longer a manager`,
      });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setRoleBusy(null);
    }
  }

  if (detail === null && error === null) {
    return <LoadingState message="Loading company…" />;
  }

  if (error !== null || !detail) {
    return (
      <ErrorState
        title="Couldn't load this company"
        message={error ?? "Not found"}
        retryLabel="Try again"
        onRetry={retry}
      />
    );
  }

  const { company, counts, managers, members, membersTruncated } = detail;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/managers"
        className="inline-flex w-fit items-center gap-1.5 text-body-sm font-medium text-ink-2 hover:underline"
      >
        <Icon name="chevronLeft" size={16} aria-hidden />
        All companies
      </Link>

      <p className="text-body-sm text-ink-2">
        A company manager cannot make another manager. The Manager role is granted from this page
        and only from this page.
      </p>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar src={company.logoUrl} name={company.name} size="lg" fallbackIcon="building" />
            <div className="min-w-0">
              <CardTitle className="truncate">{company.name}</CardTitle>
              <p className="text-caption text-ink-3">/{company.slug}</p>
            </div>
          </div>
          <Badge variant={company.isActive ? "success" : "danger"}>
            {company.isActive ? "Active" : "Deactivated"}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Managers" value={counts.managers} emphasis />
            <Stat label="Members" value={counts.members} />
            <Stat label="Teams" value={counts.teams} />
            <Stat label="People in teams" value={counts.usersInTeams} />
          </dl>

          <div className="flex flex-wrap gap-2">
            {company.isActive ? (
              <Button variant="outline" onClick={() => setConfirming(true)}>
                <Icon name="block" size={16} aria-hidden className="mr-1.5" />
                Deactivate company
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void setActive(true)} loading={busy}>
                <Icon name="check" size={16} aria-hidden className="mr-1.5" />
                Reactivate company
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Managers */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Icon name="shield" size={18} aria-hidden className="text-ink-3" />
            Managers
            <span className="text-body-sm font-normal text-ink-3">({counts.managers})</span>
          </CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={15} aria-hidden className="mr-1.5" />
            Add manager
          </Button>
        </CardHeader>
        <CardContent>
          {managers.length === 0 ? (
            <p className="text-body-sm text-ink-3">
              This company has no managers yet. Add one above, or promote an existing member below.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {managers.map((m) => (
                <li
                  key={m.user.id}
                  className="rounded-lg border border-line bg-surface-2/40 p-3.5"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <Avatar src={m.user.avatarUrl} name={m.user.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/profile/${m.user.username}`}
                        className="block truncate font-medium text-ink hover:underline"
                      >
                        {m.user.name}
                      </Link>
                      <span className="flex flex-wrap items-center gap-1.5 text-caption text-ink-3">
                        <span>@{m.user.username}</span>
                        <Badge variant={companyRoleBadgeVariant(m.role)}>
                          {companyRoleLabel(m.role)}
                        </Badge>
                        <span>· since {formatRelative(m.joinedAt)}</span>
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block text-h3 font-semibold tabular-nums text-ink">
                        {m.usersUnder}
                      </span>
                      <span className="block text-caption text-ink-3">
                        {m.usersUnder === 1 ? "user under them" : "users under them"}
                      </span>
                    </div>
                  </div>

                  {m.teamsLed.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {m.teamsLed.map((t) => (
                        <li
                          key={t.id}
                          className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-tiny text-ink-2"
                        >
                          <Icon name="users" size={12} aria-hidden />
                          {t.name}
                          <span className="tabular-nums text-ink-3">({t.memberCount})</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-caption text-ink-3">
                      Leads no teams yet, so no users are assigned under them.
                    </p>
                  )}

                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      // The last manager cannot be demoted — the server refuses
                      // it, so don't offer it.
                      disabled={managers.length <= 1}
                      loading={roleBusy === m.user.id}
                      onClick={() => void setRole(m.user.id, "MEMBER", m.user.name)}
                      title={
                        managers.length <= 1
                          ? "A company must keep at least one manager"
                          : undefined
                      }
                    >
                      Remove as manager
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon name="users" size={18} aria-hidden className="text-ink-3" />
            Members
            <span className="text-body-sm font-normal text-ink-3">({counts.members})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-body-sm text-ink-3">No members besides the managers.</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-line">
                {members.map((m) => (
                  <li key={m.user.id} className="flex items-center gap-3 py-2.5">
                    <Avatar src={m.user.avatarUrl} name={m.user.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/profile/${m.user.username}`}
                        className="block truncate text-body-sm font-medium text-ink hover:underline"
                      >
                        {m.user.name}
                      </Link>
                      <span className="block truncate text-caption text-ink-3">
                        @{m.user.username}
                      </span>
                    </span>
                    <span className="shrink-0 text-caption text-ink-3">
                      joined {formatRelative(m.joinedAt)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      loading={roleBusy === m.user.id}
                      onClick={() => void setRole(m.user.id, "MANAGER", m.user.name)}
                    >
                      Make manager
                    </Button>
                  </li>
                ))}
              </ul>
              {membersTruncated && (
                <p className="mt-2 text-caption text-ink-3">
                  Showing the first {members.length} members.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AddManagerDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        companyId={company.id}
        companyName={company.name}
        onDone={() => {
          // Reload rather than patch: counts, the manager/member split and the
          // per-manager team rollup all move, and the server computed them.
          setDetail(null);
          setReloadKey((k) => k + 1);
        }}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Deactivate ${company.name}?`}
        description="All members will lose access immediately. A super-admin can reactivate it later."
        confirmLabel="Deactivate"
        tone="danger"
        icon="building"
        confirming={busy}
        onConfirm={() => void setActive(false)}
      />
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-caption font-medium text-ink-3">{label}</dt>
      <dd
        className={
          emphasis
            ? "text-h2 font-semibold tabular-nums text-ink"
            : "text-h3 font-semibold tabular-nums text-ink-2"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/* ── Add a manager (OTP-gated) ──────────────────────────────────────────── */

/**
 * Creates a brand-new user and gives them the MANAGER role in this company.
 *
 * The role is not sent: the server fixes it from the challenge's purpose
 * (`COMPANY_MANAGER`), so this form cannot be turned into a way to mint a plain
 * member, let alone an owner. And the account exists only after the invited
 * person's own address confirms the code — which is the only thing that makes
 * "this email belongs to this person" true rather than assumed.
 */
function AddManagerDialog({
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

  const managerBody = () => ({
    name: name.trim(),
    username: username.trim(),
    email: email.trim(),
    password,
  });

  const requestCode = () =>
    apiPost<OtpChallenge>(`/api/admin/managers/${companyId}/members/otp`, managerBody());

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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add a manager" size="sm">
      {challenge ? (
        <OtpStep
          challenge={challenge}
          purpose="manager"
          companyName={companyName}
          onVerify={async (code) => {
            await apiPost("/api/otp/verify", { challengeId: challenge.challengeId, code });
            toast({ variant: "success", title: `${name.trim()} is now a manager of ${companyName}` });
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
          footer={`They become a manager of ${companyName} as soon as the code is confirmed.`}
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
            They join {companyName} with the Manager role. This page is the only place that role is
            handed out.
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
