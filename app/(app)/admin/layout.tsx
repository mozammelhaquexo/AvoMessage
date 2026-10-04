/**
 * app/(app)/admin/layout.tsx — server-side guard for the whole admin console.
 *
 * This used to be a pass-through: `AdminShell` checked the role in a
 * `useEffect`, so the shell's navigation and the page's markup were already
 * sent to any signed-in user before the check ran. A client-side check is a
 * UX nicety, not a boundary — the role is decided HERE, on the server, before
 * a single privileged byte is rendered.
 *
 * The API routes were already guarded (`assertAdmin` in lib/services/admin.ts),
 * so this closes the presentation gap rather than a data leak.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { NotAuthorized } from "@/components/layout/NotAuthorized";
import { getServerSession } from "@/lib/server-session";

export const metadata: Metadata = { title: "Admin console" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const role = session.user.platformRole;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return (
      <NotAuthorized message="The admin console is restricted to platform administrators." />
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
