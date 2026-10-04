/**
 * lib/services/platform-admin-policy.ts — the one-administrator rule.
 *
 * AvoMessage has exactly ONE platform administrator (part 2, request 4). That
 * is two invariants, and both are needed:
 *
 *   - nobody can be PROMOTED into an admin role, so the count never reaches two;
 *   - the administrator cannot give the role up, so the count never reaches zero.
 *
 * The second matters as much as the first: an unadministrable platform is
 * unrecoverable through the UI — /admin closes to everyone and only a direct
 * database edit reopens it.
 *
 * The decision is a pure function of three values, which is deliberate: the real
 * answer depends on how many admins exist in the database, and a test that has
 * to arrange global database state to exercise a branch is a test that will
 * break the moment another test file touches the same table. Here every branch
 * is reachable by passing a number.
 */
import { ConflictError } from "@/lib/api";

/** ADMIN and SUPER_ADMIN are both "the administrator" for counting purposes. */
export const PLATFORM_ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export function isPlatformAdminRole(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export type AdminRoleChangeVerdict = "ok" | "SINGLE_ADMIN_ONLY" | "LAST_ADMIN";

/**
 * Decide whether a platform-role change is allowed.
 *
 * @param currentRole      the target's role now
 * @param nextRole         the role being requested
 * @param otherAdminCount  how many OTHER non-deleted accounts hold an admin role
 */
export function checkSingleAdminRule(
  currentRole: string,
  nextRole: string,
  otherAdminCount: number,
): AdminRoleChangeVerdict {
  // No change → nothing to refuse. Also means a no-op write stays a 200.
  if (nextRole === currentRole) return "ok";

  const gaining = isPlatformAdminRole(nextRole);
  const losing = isPlatformAdminRole(currentRole);

  // Count never reaches two. (A zero count means the platform currently has no
  // administrator at all — unreachable in practice, since only an admin can
  // call this, but it keeps the function total.)
  if (gaining && otherAdminCount > 0) return "SINGLE_ADMIN_ONLY";

  // Count never reaches zero.
  if (losing && !gaining && otherAdminCount === 0) return "LAST_ADMIN";

  return "ok";
}

/** Throw the error that matches a verdict, or return quietly on "ok". */
export function assertSingleAdminRule(
  currentRole: string,
  nextRole: string,
  otherAdminCount: number,
): void {
  const verdict = checkSingleAdminRule(currentRole, nextRole, otherAdminCount);
  if (verdict === "SINGLE_ADMIN_ONLY") {
    throw new ConflictError(
      "SINGLE_ADMIN_ONLY",
      "AvoMessage has exactly one administrator, and nobody else can be made one",
    );
  }
  if (verdict === "LAST_ADMIN") {
    throw new ConflictError(
      "LAST_ADMIN",
      "The only administrator cannot give up the role — the platform would have nobody to run it",
    );
  }
}
