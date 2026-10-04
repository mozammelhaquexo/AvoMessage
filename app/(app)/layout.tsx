/**
 * app/(app)/layout.tsx — authenticated route group.
 * Requires a session (redirects to /login otherwise), then provides the
 * AuthProvider (seeded with the server session — no client round-trip) and
 * the AppShell chrome.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-client";
import { getServerSession, toSessionUser } from "@/lib/server-session";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: {
    default: "AvoMessage",
    template: "%s · AvoMessage",
  },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <AuthProvider initialUser={toSessionUser(session.user)}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
