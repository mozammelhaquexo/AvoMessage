/**
 * components/admin/AdminDashboard.tsx — /admin overview.
 * Metric cards + hand-rolled SVG charts from /api/admin/analytics.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, ErrorState, Icon, LoadingState } from "@/components/ui";
import { apiGet } from "@/lib/api-client";
import { StatCard } from "@/components/data/StatCard";
import { LineChart, BarChart } from "./Charts";
import type { AdminDashboard as DashboardStats, AnalyticsData } from "@/lib/types";

export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No synchronous state reset before the first await on purpose: resetting
  // `loading`/`error` in the effect body is a cascading render
  // (react-hooks/set-state-in-effect), and `loading` already starts true.
  // The retry button below does the reset, because that one is a user event.
  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        apiGet<DashboardStats>("/api/admin/dashboard"),
        apiGet<AnalyticsData>("/api/admin/analytics", { params: { days: 30 } }),
      ]);
      setStats(s);
      setAnalytics(a);
      setError(null);
    } catch (e) {
      // A toast alone was the bug here: it faded, `stats` stayed null, and the
      // `loading || !stats` guard below kept the spinner up forever.
      setError(e instanceof Error ? e.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount-only initial fetch. The rule flags `void load()` as a synchronous
    // setState, but `load` awaits before touching state, so no render cascades
    // here — it cannot see across the call boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only initial fetch
    void load();
  }, [load]);

  // Reset is a user event here, so it is allowed to set state synchronously.
  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  if (loading) return <LoadingState message="Loading dashboard…" />;
  if (error || !stats) {
    return <ErrorState title="Couldn't load the dashboard" message={error ?? "No data returned."} onRetry={retry} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Users" value={stats.users.toLocaleString()} icon="users" tone="brand" />
        <StatCard label="Posts" value={stats.posts.toLocaleString()} icon="comment" tone="accent" />
        <StatCard label="Messages" value={stats.messages.toLocaleString()} icon="message" tone="info" />
        <StatCard label="Companies" value={stats.companies.toLocaleString()} icon="building" tone="neutral" />
        <Link href="/admin/reports" className="block">
          <StatCard label="Pending reports" value={stats.reportsPending} icon="flag" tone={stats.reportsPending > 0 ? "danger" : "success"} hint="Open the queue" />
        </Link>
        <StatCard label="Signups (7d)" value={stats.signups7d.toLocaleString()} icon="sparkles" tone="success" />
      </div>

      {analytics && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Daily active" value={analytics.dau.toLocaleString()} tone="brand" />
            <StatCard label="Weekly active" value={analytics.wau.toLocaleString()} tone="accent" />
            <StatCard label="Monthly active" value={analytics.mau.toLocaleString()} tone="info" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Posts per day</CardTitle>
              </CardHeader>
              <CardContent>
                <LineChart points={analytics.postsPerDay} label="Posts per day, last 30 days" color="var(--brand)" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Messages per day</CardTitle>
              </CardHeader>
              <CardContent>
                <LineChart points={analytics.messagesPerDay} label="Messages per day, last 30 days" color="var(--accent)" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Signups per day</CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart points={analytics.signupsPerDay} label="Signups per day, last 30 days" color="var(--brand)" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Quick links</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-2 gap-2">
                  {[
                    { href: "/admin/users", label: "Manage users", icon: "users" as const },
                    { href: "/admin/reports", label: "Moderation queue", icon: "flag" as const },
                    { href: "/admin/managers", label: "Managers", icon: "building" as const },
                    { href: "/admin/audit-logs", label: "Audit logs", icon: "clock" as const },
                  ].map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-body-sm font-medium text-ink hover:bg-surface-2"
                      >
                        <Icon name={l.icon} size={16} aria-hidden className="text-ink-3" />
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
