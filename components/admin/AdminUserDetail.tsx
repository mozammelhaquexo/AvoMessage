/**
 * components/admin/AdminUserDetail.tsx — /admin/users/[id].
 * Profile, counts, login history, suspend/restore, verification.
 *
 * The platform role is read-only here. There is exactly one administrator and
 * the role cannot be handed out or given up (part 2, request 4), so a dropdown
 * would only ever offer an action the server refuses — the badge states the
 * fact and the caption says why.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  Icon,
  LoadingState,
  toast,
} from "@/components/ui";
import { apiGet, apiPatch } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { StatCard } from "@/components/data/StatCard";
import { BackLink } from "@/components/layout/AppShell";
import { RoleBadge } from "./AdminUsers";
import type { AdminUserRow } from "@/lib/types";

interface LoginActivityRow {
  id: string;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface UserDetail {
  user: AdminUserRow & { createdAt: string };
  counts: { posts: number; followers: number; following: number };
  loginActivity: LoginActivityRow[];
}

export function AdminUserDetail({ userId }: { userId: string }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiGet<UserDetail>(`/api/admin/users/${userId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load user.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      await apiPatch(`/api/admin/users/${userId}`, body);
      toast({ variant: "success", title: successMsg });
      void load();
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Action failed" });
    } finally {
      setBusy(false);
      setConfirmSuspend(false);
    }
  }

  if (loading) return <LoadingState message="Loading user…" />;
  if (error || !detail) {
    return <ErrorState message={error ?? "User not found."} onRetry={() => void load()} />;
  }

  const u = detail.user;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <BackLink href="/admin/users" label="Back to users" />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <Avatar src={u.avatarUrl} name={u.name} size="xl" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-h2 font-bold text-ink">{u.name}</h2>
            <p className="text-body-sm text-ink-2">@{u.username} · {u.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <RoleBadge role={u.platformRole} />
              <Badge variant={u.isActive ? "success" : "danger"}>{u.isActive ? "Active" : "Suspended"}</Badge>
              <Badge variant={u.isVerified ? "success" : "warning"}>{u.isVerified ? "Verified" : "Unverified"}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {u.isActive ? (
              <Button variant="danger" size="sm" onClick={() => setConfirmSuspend(true)}>
                <Icon name="block" size={15} aria-hidden className="mr-1.5" />
                Suspend
              </Button>
            ) : (
              <Button variant="success" size="sm" onClick={() => void patch({ isActive: true }, `${u.name} restored`)} loading={busy}>
                <Icon name="check" size={15} aria-hidden className="mr-1.5" />
                Restore
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Posts" value={detail.counts.posts} icon="comment" />
        <StatCard label="Followers" value={detail.counts.followers} icon="users" />
        <StatCard label="Following" value={detail.counts.following} icon="users" tone="accent" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Account actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body-sm text-ink-2">Platform role</span>
              <RoleBadge role={u.platformRole} />
            </div>
            <p className="text-caption text-ink-3">
              AvoMessage has exactly one administrator, and the role cannot be granted or given
              up. Changing it takes a direct database edit.
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-body-sm text-ink-2">Verified badge</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void patch({ isVerified: !u.isVerified }, u.isVerified ? "Badge removed" : "Badge granted")}
                loading={busy}
              >
                {u.isVerified ? "Remove badge" : "Grant badge"}
              </Button>
            </div>
            <p className="text-caption text-ink-3">
              A cosmetic badge shown next to the name. It has no effect on sign-in.
            </p>

            <div className="flex items-center justify-between gap-3">
              <span className="text-body-sm text-ink-2">Email verified</span>
              <span className="flex items-center gap-2">
                <Badge variant={u.emailVerifiedAt ? "success" : "warning"}>
                  {u.emailVerifiedAt ? new Date(u.emailVerifiedAt).toLocaleDateString() : "Not verified"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void patch(
                      { emailVerifiedAt: u.emailVerifiedAt ? null : new Date().toISOString() },
                      u.emailVerifiedAt ? "Email verification cleared" : "Email marked verified",
                    )
                  }
                  loading={busy}
                >
                  {u.emailVerifiedAt ? "Clear" : "Mark verified"}
                </Button>
              </span>
            </div>
            <p className="text-caption text-ink-3">
              An account with no verification date cannot sign in. This is the control that
              unblocks a user whose confirmation email never arrived.
            </p>

            <p className="text-caption text-ink-3">
              Joined {new Date(u.createdAt).toLocaleDateString()} · suspending revokes all sessions.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Recent login activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {detail.loginActivity.length === 0 ? (
              <p className="text-body-sm text-ink-3">No recorded logins.</p>
            ) : (
              detail.loginActivity.map((l) => (
                <div key={l.id} className="flex items-start gap-2.5 text-body-sm">
                  <Icon
                    name={l.success ? "check" : "x"}
                    size={15}
                    aria-hidden
                    className={l.success ? "mt-0.5 text-success" : "mt-0.5 text-danger"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">
                      {l.success ? "Successful sign-in" : `Failed sign-in${l.reason ? ` — ${l.reason}` : ""}`}
                    </p>
                    <p className="truncate text-caption text-ink-3">
                      {l.ipAddress ?? "unknown IP"} · {formatRelative(l.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmSuspend}
        onOpenChange={setConfirmSuspend}
        title={`Suspend ${u.name}?`}
        description="They will be signed out everywhere immediately and won't be able to sign back in until restored. This is audited."
        confirmLabel="Suspend user"
        tone="danger"
        icon="block"
        confirming={busy}
        onConfirm={() => void patch({ isActive: false }, `${u.name} suspended`)}
      />
    </div>
  );
}

