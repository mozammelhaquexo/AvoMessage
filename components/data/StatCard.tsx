/**
 * components/data/StatCard.tsx — metric stat card for dashboards.
 */
"use client";

import type { ReactNode } from "react";
import { Card, CardContent, Icon, type IconName } from "@/components/ui";
import { cn } from "@/components/ui/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Optional sub-label, e.g. "+12 this week". */
  hint?: ReactNode;
  icon?: IconName;
  /** Accent tone for the icon chip. */
  tone?: "brand" | "accent" | "success" | "warning" | "danger" | "info" | "neutral";
  className?: string;
}

const tones: Record<NonNullable<StatCardProps["tone"]>, string> = {
  brand: "bg-brand-soft text-brand-strong",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/10 text-success-strong",
  warning: "bg-warning/10 text-warning-strong",
  danger: "bg-danger/10 text-danger-strong",
  info: "bg-info/10 text-info-strong",
  neutral: "bg-surface-2 text-ink-2",
};

export function StatCard({ label, value, hint, icon, tone = "brand", className }: StatCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-caption font-medium uppercase tracking-wider text-ink-3">{label}</p>
          <p className="mt-1 truncate text-h2 font-bold text-ink tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-caption text-ink-2">{hint}</p>}
        </div>
        {icon && (
          <span aria-hidden className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
            <Icon name={icon} size={22} />
          </span>
        )}
      </CardContent>
    </Card>
  );
}
