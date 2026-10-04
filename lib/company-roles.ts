/**
 * lib/company-roles.ts — the single source of truth for company role labels.
 *
 * The `CompanyRole` enum still contains `OWNER` (it is a Prisma enum, and
 * dropping a value from it means a destructive migration for zero functional
 * gain). The PRODUCT rule, however, is that a company has exactly one kind of
 * administrator — the Manager — and nobody is ever an "owner" in the UI.
 *
 * So both `OWNER` and `MANAGER` render as "Manager" here, deliberately. A
 * legacy row that predates the rule still shows the correct, non-owner label
 * instead of leaking "Owner" into a table, a badge or a header.
 *
 * Use `companyRoleLabel()` for every user-visible role string, and
 * `isCompanyManagerRole()` for "is this role at least a manager" checks.
 */

import type { CompanyRole } from "@/lib/types";

/** Canonical, user-visible label per role. Never returns "Owner". */
export const COMPANY_ROLE_LABEL: Record<CompanyRole, string> = {
  OWNER: "Manager",
  MANAGER: "Manager",
  MEMBER: "Member",
};

/**
 * The roles that administer a company. `OWNER` is included so a legacy row
 * keeps its access and its invariants — only its LABEL is retired.
 *
 * Use this for "does this company still have an administrator?" checks and for
 * `role: { in: ... }` queries; use `isCompanyManagerRole` for a single value.
 */
export const COMPANY_ADMIN_ROLES: readonly CompanyRole[] = ["OWNER", "MANAGER"];

/** Badge tone per role, so every surface tints the same role the same way. */
export const COMPANY_ROLE_BADGE_VARIANT: Record<CompanyRole, "accent" | "neutral"> = {
  OWNER: "accent",
  MANAGER: "accent",
  MEMBER: "neutral",
};

/**
 * Label for a role that may arrive as a loose string (API payloads, table
 * rows) or be missing entirely. Anything unrecognised is a plain member.
 */
export function companyRoleLabel(role: CompanyRole | string | null | undefined): string {
  if (role === "OWNER" || role === "MANAGER") return COMPANY_ROLE_LABEL.MANAGER;
  return COMPANY_ROLE_LABEL.MEMBER;
}

/** Badge tone for a loose role string — mirrors `companyRoleLabel`. */
export function companyRoleBadgeVariant(
  role: CompanyRole | string | null | undefined
): "accent" | "neutral" {
  return role === "OWNER" || role === "MANAGER" ? "accent" : "neutral";
}

/**
 * True when the role administers the company. `OWNER` counts, because a
 * legacy owner row must keep its access — only the LABEL changes.
 */
export function isCompanyManagerRole(role: CompanyRole | string | null | undefined): boolean {
  return role === "OWNER" || role === "MANAGER";
}
