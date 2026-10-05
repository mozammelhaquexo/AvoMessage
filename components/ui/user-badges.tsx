"use client";

/**
 * Identity chips rendered next to a user's name.
 *
 * DISPLAY ONLY. Every authorization decision is enforced server-side
 * (lib/permissions.ts + lib/services/admin.ts); nothing here grants access.
 * These exist so a viewer can tell at a glance that the person they are
 * messaging or reading is a platform Admin or a company Manager, and which
 * company that person belongs to.
 *
 * Colour convention matches the privileged-panel accents in Sidebar.tsx:
 * Admin = amber, Manager = violet. Keep the two in step.
 */

import { cn } from "./utils";
import { Icon } from "./icons";
import { companyRoleLabel, isCompanyManagerRole } from "@/lib/company-roles";

export type PlatformRoleName = "SUPER_ADMIN" | "ADMIN" | "USER";
export type CompanyRoleName = "OWNER" | "MANAGER" | "MEMBER";

export interface UserCompanyChip {
  name: string;
  slug?: string;
  role: CompanyRoleName;
}

/**
 * The chip shell, shared by every badge below.
 *
 * Sizing note: this used to render at 16px — larger than the 14px author name
 * it sits next to — because `cn()` was dropping `text-tiny` in favour of the
 * colour class that follows it. See components/ui/utils.ts for the fix. Now
 * that `text-tiny` (11px) actually lands, the chip is a real micro-badge:
 * uppercase + slight tracking so it reads as a label rather than small text,
 * `leading-none` with a 2px vertical pad so the pill hugs its own text instead
 * of the inherited 16px line box, and a 10px glyph to match.
 */
const CHIP =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-tiny font-semibold uppercase leading-none tracking-wide";

/** Glyph size inside a chip — kept with the type size above. */
const CHIP_ICON = 10;

/** True when the platform role carries admin powers (ADMIN or above). */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/** True when any of the given company roles is MANAGER or above. */
export function isManagerRole(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => isCompanyManagerRole(r));
}

export interface RoleBadgeProps {
  platformRole?: string | null;
  /** The user's company roles, if known. */
  companyRoles?: readonly string[] | null;
  className?: string;
}

/**
 * Renders "Admin" and/or "Manager" chips. A user can be both — a platform
 * admin may also manage a company — so the chips are independent, not either/or.
 */
export function RoleBadge({ platformRole, companyRoles, className }: RoleBadgeProps) {
  const admin = isAdminRole(platformRole);
  const manager = isManagerRole(companyRoles);
  if (!admin && !manager) return null;

  return (
    <>
      {admin && (
        <span
          title={
            platformRole === "SUPER_ADMIN"
              ? "Platform super-administrator"
              : "Platform administrator"
          }
          className={cn(CHIP, "bg-amber-500/15 text-amber-700 dark:text-amber-300", className)}
        >
          <Icon name="shield" size={CHIP_ICON} aria-hidden />
          {platformRole === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
        </span>
      )}
      {manager && (
        <span
          title="Company manager"
          className={cn(CHIP, "bg-violet-500/15 text-violet-700 dark:text-violet-300", className)}
        >
          <Icon name="chart" size={CHIP_ICON} aria-hidden />
          Manager
        </span>
      )}
    </>
  );
}

export interface CompanyBadgeProps {
  name: string;
  role?: CompanyRoleName;
  className?: string;
}

/** "which company is this person a member of" — one chip per company. */
export function CompanyBadge({ name, role, className }: CompanyBadgeProps) {
  return (
    <span
      // The role in the tooltip is the same label the rest of the UI shows, so
      // a legacy OWNER row reads "manager" here too (request 7).
      title={role ? `Member of ${name} (${companyRoleLabel(role).toLowerCase()})` : `Member of ${name}`}
      className={cn(
        // Same height as the role chips beside it. Not uppercase — this is a
        // proper noun, and shouting a company name is not the same thing as
        // labelling a role.
        "inline-flex max-w-[13rem] shrink-0 items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-tiny font-medium leading-none text-ink-2",
        className,
      )}
    >
      <Icon name="building" size={CHIP_ICON} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

export interface UserBadgesProps extends RoleBadgeProps {
  companies?: readonly UserCompanyChip[] | null;
  /** Cap the number of company chips shown; the rest collapse into "+N". */
  maxCompanies?: number;
  /** Render company chips at all. Role chips are unaffected. */
  showCompanies?: boolean;
}

/**
 * The full identity strip: Admin / Manager chips, then company membership
 * chips. Intended to sit immediately after a display name in a flex-wrap row.
 */
export function UserBadges({
  platformRole,
  companyRoles,
  companies,
  maxCompanies = 2,
  showCompanies = true,
  className,
}: UserBadgesProps) {
  const roles = companyRoles ?? (companies ?? []).map((c) => c.role);
  const shown = showCompanies ? (companies ?? []).slice(0, maxCompanies) : [];
  const overflow = showCompanies ? (companies ?? []).length - shown.length : 0;

  return (
    <>
      <RoleBadge platformRole={platformRole} companyRoles={roles} className={className} />
      {shown.map((c) => (
        <CompanyBadge key={c.slug ?? c.name} name={c.name} role={c.role} />
      ))}
      {overflow > 0 && (
        <span
          title={(companies ?? [])
            .slice(maxCompanies)
            .map((c) => c.name)
            .join(", ")}
          className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-tiny font-semibold leading-none text-ink-3"
        >
          +{overflow}
        </span>
      )}
    </>
  );
}
