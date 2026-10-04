/**
 * components/manage/ManageJoinRequests.tsx — review membership requests.
 *
 * Managers see pending requests with approve/decline actions; history tabs
 * show approved and declined requests.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, LoadingState, SegmentedControl } from "@/components/ui";
import { apiGet, apiPatch, ApiError } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import type { PublicUser } from "@/lib/types";
import { useManage } from "./ManageShell";

interface JoinRequest {
  id: string;
  companyId: string;
  message: string | null;
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: string;
  user: PublicUser;
}

const TABS = [
  { id: "PENDING", label: "Pending" },
  { id: "APPROVED", label: "Approved" },
  { id: "DECLINED", label: "Declined" },
] as const;

export function ManageJoinRequests() {
  const { detail } = useManage();
  const companyId = detail.company.id;
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("PENDING");
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiGet<JoinRequest[]>(`/api/companies/${companyId}/join-requests?status=${tab}`);
    setRequests(data);
  }, [companyId, tab]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load requests");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const review = async (id: string, action: "APPROVE" | "DECLINE") => {
    setActing(id);
    try {
      await apiPatch(`/api/companies/${companyId}/join-requests/${id}`, { action });
      // Move it out of the current list (it changed status).
      setRequests((r) => r.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to review request");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Join requests</h1>
        <p className="text-sm text-ink-2 mt-1">
          Approve or decline people asking to join {detail.company.name}.
        </p>
      </div>

      <SegmentedControl
        label="Filter join requests by status"
        options={TABS.map((t) => ({ value: t.id, label: t.label }))}
        value={tab}
        onValueChange={(v) => setTab(v as (typeof TABS)[number]["id"])}
      />

      {loading ? (
        <LoadingState message="Loading requests…" />
      ) : error && requests.length === 0 ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : requests.length === 0 ? (
        <EmptyState
          title={tab === "PENDING" ? "No pending requests" : `No ${tab.toLowerCase()} requests`}
          description={
            tab === "PENDING"
              ? "When someone asks to join your company, they'll appear here."
              : "Nothing here yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {error && <p className="text-sm text-danger">{error}</p>}
          {requests.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={r.user.name} src={r.user.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{r.user.name}</span>
                    <span className="text-xs text-ink-3">@{r.user.username}</span>
                    <Badge
                      variant={r.status === "PENDING" ? "warning" : r.status === "APPROVED" ? "success" : "neutral"}
                    >
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </Badge>
                  </div>
                  {r.message && <p className="mt-1.5 text-sm text-ink-2">“{r.message}”</p>}
                  <p className="mt-1 text-xs text-ink-3">Requested {timeAgo(r.createdAt)}</p>
                </div>
                {r.status === "PENDING" && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => review(r.id, "APPROVE")}
                      loading={acting === r.id}
                      disabled={acting !== null}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => review(r.id, "DECLINE")}
                      disabled={acting !== null}
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
