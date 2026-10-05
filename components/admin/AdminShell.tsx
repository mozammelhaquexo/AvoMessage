/**
 * components/admin/AdminShell.tsx — nav + SECOND-LAYER guard for /admin/*.
 *
 * The real boundary is `app/(app)/admin/layout.tsx`, which checks the role on
 * the server before rendering anything. This client check is the second layer:
 * it catches a layout regression and gives a friendlier state, but it must
 * never be the only thing standing between a user and the console.
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ErrorState, Icon, LoadingState } from "@/components/ui";
import { ScrollNav, type ScrollNavItem } from "@/components/ui/ScrollNav";
import { SaaSToolbar } from "@/components/console/SaaSToolbar";
import { cn } from "@/components/ui/utils";
import { useAuth } from "@/lib/auth-client";

const SECTIONS: ScrollNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "chart", href: "/admin" },
  { id: "users", label: "Users", icon: "users", href: "/admin/users" },
  { id: "applications", label: "Applications", icon: "send", href: "/admin/applications" },
  // Managers and Companies are ONE section now (request 5): a manager only
  // exists inside a company, so the merged page lists companies with their
  // manager counts and drills into each one.
  { id: "managers", label: "Managers", icon: "shield", href: "/admin/managers" },
  { id: "content", label: "Content", icon: "comment", href: "/admin/content" },
  { id: "reports", label: "Reports", icon: "flag", href: "/admin/reports" },
  { id: "moderation", label: "Moderation", icon: "shield", href: "/admin/moderation" },
  { id: "roles", label: "Roles", icon: "lock", href: "/admin/roles" },
  { id: "announcements", label: "Announcements", icon: "sparkles", href: "/admin/announcements" },
  { id: "audit", label: "Audit logs", icon: "clock", href: "/admin/audit-logs" },
  { id: "analytics", label: "Analytics", icon: "chart", href: "/admin/analytics" },
  { id: "settings", label: "Settings", icon: "settings", href: "/admin/settings" },
];

/**
 * Palette search terms that are not in the label.
 *
 * `managers` deliberately carries the words people actually type when they are
 * looking for it. "Where is the Manager Section?" is a question the nav should
 * answer from the palette alone, and "manager" / "manager panel" / "manager
 * section" were not in this list — the section was findable only by somebody
 * who already knew it was called "Managers".
 */
const SECTION_KEYWORDS: Record<string, string[]> = {
  dashboard: ["overview", "home", "stats"],
  users: ["accounts", "members", "people", "suspend"],
  applications: ["manager", "manager application", "apply", "approve", "review", "requests"],
  managers: [
    "manager",
    "managers",
    "manager panel",
    "manager section",
    "manage",
    "company",
    "companies",
    "workspaces",
    "organisations",
    "role",
    "grant",
    "promote",
  ],
  content: ["posts", "comments", "delete"],
  reports: ["abuse", "flag", "queue"],
  moderation: ["delete", "suspend", "message"],
  roles: ["permissions", "platform"],
  announcements: ["broadcast", "notice"],
  audit: ["logs", "history", "trail"],
  analytics: ["metrics", "growth", "charts"],
  settings: ["config", "platform"],
};

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [denied, setDenied] = useState(false);

  const isAdmin = !!user && (user.platformRole === "ADMIN" || user.platformRole === "SUPER_ADMIN");

  useEffect(() => {
    if (!loading && user && !isAdmin) setDenied(true);
  }, [loading, user, isAdmin]);

  if (loading) return <LoadingState message="Checking permissions…" />;

  if (denied || (!loading && user && !isAdmin)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState
          title="Not authorized"
          message="The admin console is restricted to platform administrators."
          retryLabel="Reload"
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (!user) return null; // AppShell redirects to /login.

  const activeId =
    SECTIONS.filter((s) => s.href !== "/admin")
      .find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))?.id ?? "dashboard";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-danger/10 text-danger" aria-hidden>
          <Icon name="shield" size={22} />
        </span>
        <div>
          <h1 className="font-display text-h2 font-bold text-ink">Admin console</h1>
          <p className="text-body-sm text-ink-2">
            Signed in as {user.name} · {user.platformRole}
          </p>
        </div>
      </div>

      <ScrollNav
        items={SECTIONS}
        activeId={activeId}
        ariaLabel="Admin sections"
        renderItem={(s, active) => (
          <Link
            key={s.id}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-body-sm font-medium transition-colors duration-fast",
              active
                ? "border-danger text-danger-strong"
                : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            <Icon name={s.icon} size={16} aria-hidden />
            {s.label}
          </Link>
        )}
      />

      <SaaSToolbar
        label="Admin console toolbar"
        className="mt-4"
        sections={SECTIONS.map((s) => ({ ...s, keywords: SECTION_KEYWORDS[s.id] }))}
      />

      <div className="py-6">{children}</div>
    </div>
  );
}
