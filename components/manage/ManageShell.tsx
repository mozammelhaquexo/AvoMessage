/**
 * components/manage/ManageShell.tsx — sub-navigation for /manage/[slug].
 *
 * The authorization decision is NOT made here. `app/(app)/manage/[slug]/layout.tsx`
 * already resolved the viewer's membership on the server and rendered the
 * refusal itself, so by the time this component mounts the viewer is known to
 * be an OWNER or MANAGER. That is why `companyId` and `role` arrive as props:
 * the old version re-derived them by fetching the whole membership list on the
 * client, which meant a redundant round-trip and a loading flash on every open.
 *
 * The `viewerRole` re-check below is the second layer, not the boundary — it
 * catches a layout regression and gives a friendly state.
 */
"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, ErrorState, Icon, LoadingState } from "@/components/ui";
import { ScrollNav, type ScrollNavItem } from "@/components/ui/ScrollNav";
import { SaaSToolbar } from "@/components/console/SaaSToolbar";
import { cn } from "@/components/ui/utils";
import { apiGet, ApiError } from "@/lib/api-client";
import { companyRoleLabel, isCompanyManagerRole } from "@/lib/company-roles";
import type { CompanyDetail, CompanyRole } from "@/lib/types";

interface ManageContextValue {
  detail: CompanyDetail;
  refresh: () => void;
}

const ManageContext = createContext<ManageContextValue | null>(null);

export function useManage(): ManageContextValue {
  const ctx = useContext(ManageContext);
  if (!ctx) throw new Error("useManage must be used inside ManageShell");
  return ctx;
}

const SECTIONS: { id: string; label: string; icon: import("@/components/ui").IconName; href: (s: string) => string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "chart", href: (s: string) => `/manage/${s}` },
  { id: "analytics", label: "Analytics", icon: "chart", href: (s: string) => `/manage/${s}/analytics` },
  { id: "members", label: "Members", icon: "users", href: (s: string) => `/manage/${s}/members` },
  { id: "teams", label: "Teams", icon: "users", href: (s: string) => `/manage/${s}/teams` },
  { id: "invitations", label: "Invitations", icon: "send", href: (s: string) => `/manage/${s}/invitations` },
  { id: "join-requests", label: "Join requests", icon: "plus", href: (s: string) => `/manage/${s}/join-requests` },
  { id: "announcements", label: "Announcements", icon: "bell", href: (s: string) => `/manage/${s}/announcements` },
  { id: "activity", label: "Activity", icon: "clock", href: (s: string) => `/manage/${s}/activity` },
  { id: "branding", label: "Branding", icon: "sparkles", href: (s: string) => `/manage/${s}/branding` },
  { id: "settings", label: "Settings", icon: "settings", href: (s: string) => `/manage/${s}/settings` },
];

/** Palette search terms that are not in the label. */
const SECTION_KEYWORDS: Record<string, string[]> = {
  dashboard: ["overview", "home"],
  analytics: ["metrics", "growth", "charts"],
  members: ["people", "roles", "remove"],
  teams: ["groups", "squads"],
  invitations: ["invite", "pending"],
  "join-requests": ["requests", "approve", "apply"],
  announcements: ["broadcast", "notice"],
  activity: ["log", "history", "audit"],
  branding: ["logo", "colours", "colors", "cover"],
  settings: ["config", "company"],
};

export function ManageShell({
  slug,
  companyId,
  role,
  initialDetail,
  children,
}: {
  slug: string;
  /** Resolved server-side by the layout — the company this console manages. */
  companyId: string;
  /** The viewer's role in that company, as the server saw it. */
  role: CompanyRole;
  /**
   * The company detail, fetched on the server by the layout. When present the
   * console paints with real data instead of a full-page loading state; when
   * absent (the server lookup failed) it falls back to fetching here.
   */
  initialDetail?: CompanyDetail | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [detail, setDetail] = useState<CompanyDetail | null>(initialDetail ?? null);
  const [loading, setLoading] = useState(!initialDetail);
  const [authorized, setAuthorized] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Which company we already hold data for. The server-supplied detail counts,
  // so the mount effect does not immediately refetch what it was just given.
  const haveFor = useRef<string | null>(initialDetail ? companyId : null);

  useEffect(() => {
    // Nothing to do on mount when the server already handed us the detail.
    if (haveFor.current === companyId && refreshKey === 0) return;
    haveFor.current = companyId;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const d = await apiGet<CompanyDetail>(`/api/companies/${companyId}`);
        if (cancelled) return;
        // Second layer: the server already allowed this, but if the role the
        // API reports disagrees, refuse rather than render a console the
        // viewer may not be entitled to.
        if (!isCompanyManagerRole(d.viewerRole)) {
          setAuthorized(false);
          setDetail(null);
        } else {
          setDetail(d);
          setAuthorized(true);
        }
      } catch (e) {
        if (!cancelled && e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          setAuthorized(false);
          setDetail(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, refreshKey]);

  if (loading) return <LoadingState message="Loading management console…" />;

  if (!authorized || !detail) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorState
          title="Not authorized"
          message="Only company managers and owners can access the management console. If you believe this is a mistake, ask a company owner to grant you the manager role."
          retryLabel="Try again"
          onRetry={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    );
  }

  // Match on whole path segments. The dashboard href (`/manage/<slug>`) is a
  // string prefix of every other section, so a plain `startsWith` would light
  // up "Dashboard" on every sub-page and the real section would never
  // highlight. Exclude the dashboard from the prefix scan and fall back to it.
  const activeId =
    SECTIONS.filter((s) => s.id !== "dashboard").find(
      (s) => pathname === s.href(slug) || pathname.startsWith(`${s.href(slug)}/`),
    )?.id ?? "dashboard";

  // Materialise hrefs for the ScrollNav (it expects static hrefs).
  const navItems: ScrollNavItem[] = SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    href: s.href(slug),
  }));

  return (
    <ManageContext.Provider value={{ detail, refresh: () => setRefreshKey((k) => k + 1) }}>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar src={detail.company.logoUrl} name={detail.company.name} size="lg" fallbackIcon="building" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-h2 font-bold text-ink">{detail.company.name}</h1>
            <p className="text-body-sm text-ink-2">
              Management console · {companyRoleLabel(role)}
            </p>
          </div>
          <Link
            href={`/company/${slug}`}
            className="flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-2 text-body-sm font-medium text-ink hover:bg-surface-2"
          >
            <Icon name="globe" size={15} aria-hidden />
            View workspace
          </Link>
        </div>

        <ManageNavTabs activeId={activeId} navItems={navItems} />

        <SaaSToolbar
          label="Company console toolbar"
          className="mt-4"
          sections={navItems.map((s) => ({ ...s, keywords: SECTION_KEYWORDS[s.id] }))}
        />

        <div className="py-6">{children}</div>
      </div>
    </ManageContext.Provider>
  );
}

function ManageNavTabs({
  activeId,
  navItems,
}: {
  activeId: string;
  navItems: ScrollNavItem[];
}) {
  return (
    <ScrollNav
      items={navItems}
      activeId={activeId}
      ariaLabel="Management sections"
      renderItem={(s, active) => (
        <Link
          key={s.id}
          href={s.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-body-sm font-medium transition-colors duration-fast",
            active
              ? "border-brand text-brand-strong"
              : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink",
          )}
        >
          <Icon name={s.icon} size={16} aria-hidden />
          {s.label}
        </Link>
      )}
    />
  );
}
