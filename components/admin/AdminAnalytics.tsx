/**
 * components/admin/AdminAnalytics.tsx — /admin/analytics.
 * Activity charts with a day-range selector.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState, Select } from "@/components/ui";
import { apiGet } from "@/lib/api-client";
import { StatCard } from "@/components/data/StatCard";
import { LineChart, BarChart } from "./Charts";
import type { AnalyticsData } from "@/lib/types";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export function AdminAnalytics() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No synchronous state reset before the first await — see AdminDashboard for
  // why (react-hooks/set-state-in-effect). The range selector and the retry
  // button set `loading` themselves, because those are user events.
  const load = useCallback(async () => {
    try {
      setData(await apiGet<AnalyticsData>("/api/admin/analytics", { params: { days } }));
      setError(null);
    } catch (e) {
      // `loading || !data` below used to pin the spinner on screen forever when
      // this request failed, with the failure visible only as a fading toast.
      setError(e instanceof Error ? e.message : "Could not load analytics");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">Platform analytics</h2>
        <Select
          value={days}
          onValueChange={(v) => {
            setLoading(true);
            setError(null);
            setDays(v);
          }}
          options={RANGES}
          label="Date range"
          className="w-44"
        />
      </div>

      {loading ? (
        <LoadingState message="Loading analytics…" />
      ) : error || !data ? (
        <ErrorState
          title="Couldn't load analytics"
          message={error ?? "No data returned."}
          onRetry={retry}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Daily active" value={data.dau.toLocaleString()} icon="users" tone="brand" />
            <StatCard label="Weekly active" value={data.wau.toLocaleString()} icon="users" tone="accent" />
            <StatCard label="Monthly active" value={data.mau.toLocaleString()} icon="users" tone="info" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Posts per day</CardTitle>
              </CardHeader>
              <CardContent>
                <LineChart points={data.postsPerDay} label={`Posts per day, last ${days} days`} color="var(--brand)" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Messages per day</CardTitle>
              </CardHeader>
              <CardContent>
                <LineChart points={data.messagesPerDay} label={`Messages per day, last ${days} days`} color="var(--accent)" />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-h3">Signups per day</CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart points={data.signupsPerDay} label={`Signups per day, last ${days} days`} color="var(--brand)" />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
