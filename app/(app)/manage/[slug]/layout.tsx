/**
 * app/(app)/manage/[slug]/layout.tsx — server-side guard for a company console.
 *
 * Same reasoning as the admin layout: `ManageShell` resolved the viewer's role
 * in a `useEffect`, which runs after the shell has already been sent. The role
 * is now resolved on the server from the slug, so a plain member (or a
 * non-member) receives the refusal instead of the console.
 *
 * `getMembershipBySlug` is the same membership lookup the services use, so the
 * guard cannot drift from the API's own rule.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ManageShell } from "@/components/manage/ManageShell";
import { NotAuthorized } from "@/components/layout/NotAuthorized";
import { getCompany, getMembershipBySlug } from "@/lib/services/companies";
import { getServerSession } from "@/lib/server-session";

export const metadata: Metadata = { title: "Manage company" };

export default async function ManageLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}) {
  const { slug } = await params;
  const session = await getServerSession();
  if (!session) redirect("/login");

  const membership = await getMembershipBySlug(session.user, slug);
  if (!membership || (membership.role !== "OWNER" && membership.role !== "MANAGER")) {
    return (
      <NotAuthorized
        message="Only company managers and owners can access the management console. If you believe this is a mistake, ask a company owner to grant you the manager role."
      />
    );
  }

  // Fetch the detail here, on the server, and hand it to the shell. Otherwise
  // the console opens on a full-page spinner and then fetches the same object
  // over the network — the exact "premium" feel the console should not have.
  // A failure is not fatal: the shell falls back to fetching it client-side.
  let detail: Awaited<ReturnType<typeof getCompany>> | null = null;
  try {
    detail = await getCompany(session.user, membership.companyId);
  } catch {
    detail = null;
  }

  return (
    <ManageShell
      slug={slug}
      companyId={membership.companyId}
      role={membership.role}
      initialDetail={detail}
    >
      {children}
    </ManageShell>
  );
}
