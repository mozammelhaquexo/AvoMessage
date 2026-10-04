/**
 * components/admin/Charts.tsx — hand-rolled responsive SVG charts.
 * No chart library is installed; these are lightweight, theme-aware
 * (CSS tokens), and accessible (each chart has role="img" + aria-label,
 * plus a visually-hidden data table for screen readers).
 */
"use client";

import { useId, useMemo } from "react";
import { EmptyState } from "@/components/ui";

export interface ChartPoint {
  date: string;
  count: number;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Axis label for a point's x value. ISO dates (YYYY-MM-DD) shorten to MM-DD;
 * any other string (role names, labels) is shown verbatim. The old code
 * unconditionally did `.slice(5)`, which turned "SUPER_ADMIN" into "_ADMIN".
 */
function xLabel(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(5, 10) : value;
}

function DataTableForSR({ points, label }: { points: ChartPoint[]; label: string }) {
  return (
    <table className="sr-only">
      <caption>{label} — data table</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.date}>
            <td>{p.date}</td>
            <td>{p.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const W = 600;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

interface LineChartProps {
  points: ChartPoint[];
  label: string;
  /** CSS color for the line/area (token var ok). */
  color?: string;
}

export function LineChart({ points, label, color = "var(--brand)" }: LineChartProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const { path, area, max, ticks } = useMemo(() => {
    const max = niceMax(Math.max(...points.map((p) => p.count), 0));
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const coords = points.map((p, i) => ({
      x: PAD.left + i * stepX,
      y: PAD.top + innerH - (p.count / max) * innerH,
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const area = `${path} L${(PAD.left + innerW).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${PAD.left},${(PAD.top + innerH).toFixed(1)} Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      value: Math.round(max * f),
      y: PAD.top + innerH - f * innerH,
    }));
    return { path, area, max, ticks };
  }, [points, innerW, innerH]);

  const xLabels = useMemo(() => {
    if (points.length === 0) return [];
    const idxs = [0, Math.floor(points.length / 2), points.length - 1];
    return [...new Set(idxs)].map((i) => ({
      x: PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : 0),
      label: xLabel(points[i].date),
    }));
  }, [points, innerW]);

  if (points.length === 0) {
    return <EmptyState icon="chart" title="No data yet" description={label} compact />;
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t.value}>
            <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {t.value}
            </text>
          </g>
        ))}
        {points.length > 0 && (
          <>
            <path d={area} fill={`url(#${id}-fill)`} />
            <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => {
              const x = PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : 0);
              const y = PAD.top + innerH - (p.count / max) * innerH;
              return (
                <circle key={p.date} cx={x} cy={y} r="3" fill="var(--bg-surface-1)" stroke={color} strokeWidth="2">
                  <title>{`${p.date}: ${p.count}`}</title>
                </circle>
              );
            })}
          </>
        )}
        {xLabels.map((l) => (
          <text key={l.label + l.x} x={l.x} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">
            {l.label}
          </text>
        ))}
      </svg>
      <DataTableForSR points={points} label={label} />
    </div>
  );
}

interface BarChartProps {
  points: ChartPoint[];
  label: string;
  color?: string;
  /** Max bars to render (aggregates the rest). */
  maxBars?: number;
}

export function BarChart({ points, label, color = "var(--accent)", maxBars = 30 }: BarChartProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const bars = useMemo(() => {
    let data = points;
    if (data.length > maxBars) {
      // Aggregate into maxBars buckets.
      const size = Math.ceil(data.length / maxBars);
      const buckets: ChartPoint[] = [];
      for (let i = 0; i < data.length; i += size) {
        const slice = data.slice(i, i + size);
        buckets.push({
          date: slice[0].date,
          count: slice.reduce((s, p) => s + p.count, 0),
        });
      }
      data = buckets;
    }
    const max = niceMax(Math.max(...data.map((p) => p.count), 0));
    const slot = data.length > 0 ? innerW / data.length : 0;
    const barW = Math.max(2, slot * 0.62);
    return data.map((p, i) => {
      const h = (p.count / max) * innerH;
      return {
        ...p,
        x: PAD.left + i * slot + (slot - barW) / 2,
        y: PAD.top + innerH - h,
        w: barW,
        h,
      };
    });
  }, [points, maxBars, innerW, innerH]);

  const ticks = useMemo(() => {
    // Derive the axis from the SAME aggregated series the bars are drawn from.
    // Using the raw `points` made the axis max disagree with the tallest bar
    // whenever bucketing kicked in (e.g. 90 daily points → 30 buckets).
    const max = niceMax(Math.max(...bars.map((b) => b.count), 0));
    return [0, 0.5, 1].map((f) => ({
      value: Math.round(max * f),
      y: PAD.top + innerH - f * innerH,
    }));
  }, [bars, innerH]);

  if (points.length === 0) {
    return <EmptyState icon="chart" title="No data yet" description={label} compact />;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => (
          <g key={t.value}>
            <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {t.value}
            </text>
          </g>
        ))}
        {bars.map((b) => (
          <rect key={b.date} x={b.x} y={b.y} width={b.w} height={Math.max(b.h, 1)} rx="3" fill={color} opacity="0.85">
            <title>{`${b.date}: ${b.count}`}</title>
          </rect>
        ))}
        {bars.length > 0 && (
          <>
            <text x={PAD.left} y={H - 8} fontSize="11" fill="var(--text-3)">
              {xLabel(bars[0].date)}
            </text>
            <text x={W - PAD.right} y={H - 8} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {xLabel(bars[bars.length - 1].date)}
            </text>
          </>
        )}
        <title id={id}>{label}</title>
      </svg>
      <DataTableForSR points={points} label={label} />
    </div>
  );
}
