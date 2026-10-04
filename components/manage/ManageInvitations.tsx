/**
 * components/manage/ManageInvitations.tsx — /manage/[slug]/invitations.
 * Pending invitation list + resend + revoke + new invite.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Icon,
  LoadingState,
  toast,
} from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api-client";
import { formatRelative } from "@/lib/chat";
import { useManage } from "./ManageShell";
import { InviteDialog } from "./ManageMembers";
import type { InvitationView } from "@/lib/types";

export function ManageInvitations() {
  const { detail } = useManage();
  const companyId = detail.company.id;
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvitations(await apiGet<InvitationView[]>("/api/invitations", { params: { companyId } }));
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not load invitations" });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(inv: InvitationView) {
    setBusy(inv.id);
    try {
      await apiPost(`/api/invitations/${inv.id}/revoke`, {});
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
      toast({ variant: "success", title: "Invitation revoked" });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not revoke invitation" });
    } finally {
      setBusy(null);
    }
  }

  async function resend(inv: InvitationView) {
    setBusy(inv.id);
    try {
      await apiPost(`/api/invitations/${inv.id}/resend`, {});
      toast({ variant: "success", title: `Invitation re-sent to ${inv.email}` });
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : "Could not re-send invitation" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">Pending invitations ({invitations.length})</h2>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <Icon name="plus" size={15} aria-hidden className="mr-1.5" />
          New invitation
        </Button>
      </div>

      {loading ? (
        <LoadingState message="Loading invitations…" />
      ) : invitations.length === 0 ? (
        <EmptyState
          icon="send"
          title="No pending invitations"
          description="Invite people by email to grow the company."
          actionLabel="Invite someone"
          onAction={() => setInviteOpen(true)}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {invitations.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <Icon name="send" size={18} aria-hidden className="shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-semibold text-ink">{inv.email}</p>
                  <p className="text-caption text-ink-3">
                    Invited by {inv.invitedBy?.name ?? "—"} · {formatRelative(inv.createdAt)} · expires{" "}
                    {formatRelative(inv.expiresAt)}
                  </p>
                </div>
                <Badge variant="brand">{inv.role}</Badge>
                {inv.teamName && <Badge variant="accent">{inv.teamName}</Badge>}
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => void resend(inv)} loading={busy === inv.id}>
                    Resend
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void revoke(inv)} loading={busy === inv.id} aria-label={`Revoke invitation for ${inv.email}`} className="text-danger hover:bg-danger/10">
                    <Icon name="x" size={14} aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <InviteDialog open={inviteOpen} onClose={() => { setInviteOpen(false); void load(); }} companyId={companyId} />
    </div>
  );
}
