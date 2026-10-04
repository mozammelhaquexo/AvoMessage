/**
 * lib/services/company-membership-policy.ts — how many companies one person may
 * belong to, and who is allowed to create one.
 *
 * ── The three tiers, and why "Manager" is not a platform role ──────────────
 *
 * `PlatformRole` is `SUPER_ADMIN | ADMIN | USER`. There is no MANAGER value,
 * and that is not an oversight: in this product a manager administers a
 * *company*, which is a company role. The manager-application flow grants a
 * company role, and the Admin panel is the only door to it (part 2, requests
 * 3 and 4). So "manager" is derived, never stored on the user:
 *
 *   ADMIN    platformRole is ADMIN or SUPER_ADMIN   → no limit
 *   MANAGER  holds a MANAGER (or legacy OWNER)
 *            company role anywhere                  → 3 companies
 *   USER     everyone else                          → 1 company
 *
 * The derivation itself lives in `resolveMemberTier()` in
 * lib/services/companies.ts, because it needs a database read. Everything in
 * THIS file is a pure function of numbers and strings, which is deliberate: the
 * real answer depends on how many memberships exist in the database, and a test
 * that has to arrange global database state to reach a branch is a test that
 * breaks the moment another file touches the same table. Here every branch is
 * reachable by passing a number.
 *
 * ── Where the rule is enforced ─────────────────────────────────────────────
 *
 * A membership row can be created in eight places, and all eight are covered —
 * see the call sites of `assertMembershipCapacity` and
 * `assertCanCreateCompany`. A rule enforced in seven of eight places is not a
 * rule.
 */
import { ConflictError, ForbiddenError } from "@/lib/api";
import { isPlatformAdminRole } from "@/lib/services/platform-admin-policy";

/* ------------------------------------------------------------------ */
/* The rule                                                            */
/* ------------------------------------------------------------------ */

export type MemberTier = "USER" | "MANAGER" | "ADMIN";

/** `null` means unlimited. */
export const MEMBERSHIP_LIMIT: Record<MemberTier, number | null> = {
  USER: 1,
  MANAGER: 3,
  ADMIN: null,
};

export function membershipLimitFor(tier: MemberTier): number | null {
  return MEMBERSHIP_LIMIT[tier];
}

/**
 * Derive the tier from the two facts that decide it.
 *
 * `managesAnyCompany` is "this person holds a MANAGER or OWNER role on at least
 * one company". It is passed in rather than looked up so this stays pure.
 */
export function tierFor(platformRole: string, managesAnyCompany: boolean): MemberTier {
  if (isPlatformAdminRole(platformRole)) return "ADMIN";
  return managesAnyCompany ? "MANAGER" : "USER";
}

export type CapacityVerdict = "ok" | "LIMIT_REACHED";

/** The whole rule, in one comparison. `current` is the count BEFORE the add. */
export function checkMembershipCapacity(
  current: number,
  limit: number | null,
): CapacityVerdict {
  if (limit === null) return "ok";
  return current < limit ? "ok" : "LIMIT_REACHED";
}

/**
 * The tier someone is in *after* being handed a manager role.
 *
 * Only the manager-application approval needs this, and it is the difference
 * between refusing a promotion and allowing it: the grant is itself what raises
 * the ceiling, so an applicant who is currently a plain member of one company
 * is judged against the manager's three, not the user's one. Without this, a
 * promotion could only ever be granted to somebody who was in no company at
 * all — which is not what the flow is for.
 */
export function tierAfterManagerGrant(tier: MemberTier): MemberTier {
  return tier === "USER" ? "MANAGER" : tier;
}

/* ------------------------------------------------------------------ */
/* Error codes the client branches on                                  */
/* ------------------------------------------------------------------ */

export const COMPANY_LIMIT_REACHED = "COMPANY_LIMIT_REACHED";
export const COMPANY_CREATE_FORBIDDEN = "COMPANY_CREATE_FORBIDDEN";

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/**
 * `subject` picks the voice: "self" when someone is hitting their own cap,
 * "other" when a manager is trying to add somebody who is already full.
 */
export function limitMessageFor(tier: MemberTier, subject: "self" | "other"): string {
  const limit = MEMBERSHIP_LIMIT[tier];
  if (limit === null) return "";

  if (tier === "MANAGER") {
    return subject === "self"
      ? `You can belong to ${limit} companies at most.`
      : `That person is already in ${limit} companies, which is the limit for a manager.`;
  }
  return subject === "self"
    ? `You can belong to ${limit} company. Ask an administrator if you need to move.`
    : `That person is already in ${limit} company. Ask an administrator to move them.`;
}

/* ------------------------------------------------------------------ */
/* Assertions                                                          */
/* ------------------------------------------------------------------ */

/** Throw when adding one more membership would break the cap. */
export function assertMembershipCapacity(
  tier: MemberTier,
  current: number,
  subject: "self" | "other" = "self",
): void {
  const limit = membershipLimitFor(tier);
  if (checkMembershipCapacity(current, limit) === "ok") return;
  throw new ConflictError(COMPANY_LIMIT_REACHED, limitMessageFor(tier, subject));
}

/**
 * Only a manager or an administrator may create a company.
 *
 * A plain user cannot create one — that is the product rule, and it is also
 * what keeps the cap meaningful: `createCompany` makes the creator a MANAGER of
 * the new company, so if any user could call it, the USER tier would have a
 * one-step route around its own limit.
 */
export function canCreateCompany(tier: MemberTier): boolean {
  return tier !== "USER";
}

export function assertCanCreateCompany(tier: MemberTier): void {
  if (canCreateCompany(tier)) return;
  throw new ForbiddenError(
    COMPANY_CREATE_FORBIDDEN,
    "Only a manager or an administrator can create a company. Ask your manager to add you to theirs.",
  );
}
