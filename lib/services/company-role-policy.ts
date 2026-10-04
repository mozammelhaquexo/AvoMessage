/**
 * lib/services/company-role-policy.ts — who may hand out which company role.
 *
 * One rule, stated once, used by every manager-facing company path (add a
 * member, change a member's role, create an account, send an invitation):
 *
 *   A company manager may add MEMBERS. Nothing else.
 *
 *   - `OWNER` is retired from the product (request 7): the platform has one
 *     kind of company administrator, the Manager, and nobody is ever made an
 *     owner.
 *   - `MANAGER` is granted from the Admin panel and only from there (part 2,
 *     request 3) — a manager cannot create a peer.
 *
 * Demoting is deliberately NOT covered: a manager sending `role: "MEMBER"` for
 * someone who is already a manager is a reduction, not a grant, and stays
 * available. The last-manager invariant in `lib/services/companies.ts` guards
 * it separately.
 *
 * The Zod schemas (`companyMemberAssignableRoleSchema` in `lib/validation.ts`)
 * reject both values at the edge; this is the service-layer half of the same
 * rule, so a caller that reaches a service directly is bound by it too.
 */
import { ForbiddenError } from "@/lib/api";

/** Code the client branches on when a manager tries to grant a manager role. */
export const MANAGER_ROLE_ADMIN_ONLY = "MANAGER_ROLE_ADMIN_ONLY";

export function assertRoleAssignableByManager(role: string | null | undefined): void {
  if (role === "OWNER") {
    throw new ForbiddenError("FORBIDDEN", "Nobody can be made an owner of a company");
  }
  if (role === "MANAGER") {
    throw new ForbiddenError(
      MANAGER_ROLE_ADMIN_ONLY,
      "Only an administrator can give someone the Manager role"
    );
  }
}
