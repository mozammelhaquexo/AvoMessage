/**
 * app/(app)/manage/page.tsx — the Manager Panel landing page.
 *
 * There was no index route here before: the sidebar linked straight to
 * `/manage/<slug>`, which is fine only while the viewer already manages a
 * company. An approved manager who has not created theirs yet had no slug, so
 * the nav entry vanished and the bare `/manage` URL was a 404. Both halves of
 * that are fixed now — the sidebar links here when there is no slug, and this
 * page decides what to show.
 *
 * THE DECISION IS MADE ON THE SERVER
 * Same reasoning as `manage/[slug]/layout.tsx` and `admin/layout.tsx`: a
 * client-side check runs after the markup has already been sent. The approval
 * state comes from the same service the API uses, so this page cannot disagree
 * with `/api/manager-applications`.
 *
 * WHY AN ADMIN SKIPS THE APPLICATION
 * "Admin jeno full access pay ebong se nijei admin abar nijei manager hoy" —
 * a platform administrator holds the highest platform role there is, and
 * asking them to file a request for a colleague to approve would be theatre.
 * So an ADMIN or SUPER_ADMIN is treated as approved here and lands directly on
 * "create your company", which is the only remaining step. The policy layer
 * already agrees: `tierFor()` maps an admin to the ADMIN tier, whose
 * `canCreateCompany()` is true.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagerLanding, type ManagerLandingState } from "@/components/manage/ManagerLanding";
import { isCompanyManagerRole } from "@/lib/company-roles";
import { getServerSession } from "@/lib/server-session";
import { listMyCompanies } from "@/lib/services/companies";
import { getMyApplication } from "@/lib/services/manager-applications";
import { isPlatformAdminRole } from "@/lib/services/platform-admin-policy";

export const metadata: Metadata = { title: "Manager panel" };

export default async function ManageIndexPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  // A company console already exists — go straight to it rather than making the
  // user pick from a list of one.
  const memberships = await listMyCompanies(session.user);
  const managed = memberships.find((m) => isCompanyManagerRole(m.role));
  if (managed) redirect(`/manage/${managed.company.slug}`);

  const isAdmin = isPlatformAdminRole(session.user.platformRole);
  if (isAdmin) {
    return <ManagerLanding state="approved" />;
  }

  // `getMyApplication` is scoped to the session user, so there is nothing to
  // authorize here beyond having a session.
  const application = await getMyApplication(session.user).catch(() => null);

  const state: ManagerLandingState =
    application?.status === "APPROVED"
      ? "approved"
      : application?.status === "PENDING"
        ? "pending"
        : "none";

  return <ManagerLanding state={state} />;
}
