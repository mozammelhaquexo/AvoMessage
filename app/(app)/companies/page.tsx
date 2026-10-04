import type { Metadata } from "next";
import { CompaniesDirectory } from "@/components/companies/CompaniesDirectory";
import { getServerSession } from "@/lib/server-session";
import { membershipStatusFor } from "@/lib/services/companies";

export const metadata: Metadata = { title: "Companies" };

/**
 * Server Component on purpose: whether the "New company" button belongs on
 * this page is an authorization fact, and it is decided here — before the first
 * paint — from the same policy functions that enforce it
 * (`membershipStatusFor` → `resolveMemberTier` → `canCreateCompany`).
 *
 * The alternative — letting the client work it out from its company list —
 * gets the important case wrong: an approved manager who has not created their
 * company yet holds no company role, so a list-based check would hide the
 * button from the one person meant to press it.
 *
 * The `(app)` layout has already redirected an unauthenticated visitor, so a
 * null session here is a race (cookie expired mid-render), not a state to
 * render for.
 */
export default async function CompaniesPage() {
  const session = await getServerSession();
  const status = session
    ? await membershipStatusFor(session.user.id, session.user.platformRole)
    : null;

  return (
    <CompaniesDirectory
      canCreateCompany={status?.canCreateCompany ?? false}
      membership={status ? { tier: status.tier, limit: status.limit, current: status.current } : null}
    />
  );
}
