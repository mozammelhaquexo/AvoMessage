/**
 * components/manage/ManageAnalytics.tsx — company analytics for managers.
 *
 * Totals + 30-day series: member growth (cumulative), posts/day, messages/day.
 * Uses the shared hand-rolled SVG charts from the admin panel.
 */
"use client";

import { useEffect, useState } from "react";
import { BarChart, LineChart, type ChartPoint } from "@/components/admin/Charts";
import { StatCard } from "@/components/data/StatCard";
import { Card, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { apiGet, ApiError } from "@/lib/api-client";
import { useManage } from "./ManageShell";

interface AnalyticsData {
  totals: { members: number; posts: number; messages: number; teams: number; pendingInvites: number };
  memberGrowth: ChartPoint[];
  postsPerDay: ChartPoint[];
  messagesPerDay: ChartPoint[];
}

export function ManageAnalytics() {
  const { detail } = useManage();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const d = await apiGet<AnalyticsData>(`/api/companies/${detail.company.id}/analytics`);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.company.id]);

  if (loading) return <LoadingState message="Loading analytics…" />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!data) return <EmptyState title="No data" description="Analytics are not available yet." />;

  const t = data.totals;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-ink-2 mt-1">
          Growth and activity for {detail.company.name} — last 30 days.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Members" value={t.members.toLocaleString()} icon="users" tone="brand" />
        <StatCard label="Posts" value={t.posts.toLocaleString()} icon="comment" tone="accent" />
        <StatCard label="Messages" value={t.messages.toLocaleString()} icon="message" tone="info" />
        <StatCard label="Teams" value={t.teams.toLocaleString()} icon="users" tone="neutral" />
        <StatCard label="Pending invites" value={t.pendingInvites.toLocaleString()} icon="send" tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Member growth</h2>
          <p className="text-xs text-ink-3 mb-4">Total members over time</p>
          <LineChart points={data.memberGrowth} label="Member growth, last 30 days" color="var(--brand)" />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Posts per day</h2>
          <p className="text-xs text-ink-3 mb-4">Company posts published</p>
          <BarChart points={data.postsPerDay} label="Posts per day, last 30 days" color="var(--accent)" />
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-1">Messages per day</h2>
        <p className="text-xs text-ink-3 mb-4">Messages in company conversations</p>
        <LineChart points={data.messagesPerDay} label="Messages per day, last 30 days" color="var(--info, #38bdf8)" />
      </Card>
    </div>
  );
}
