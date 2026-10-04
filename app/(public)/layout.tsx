/**
 * app/(public)/layout.tsx — public route group (/, /login, /signup, …).
 * Authenticated visitors are redirected to /home (per docs/ROUTES.md §5),
 * except on the pages they legitimately need while logged in: the
 * auth-continuation pages (verify-email, password reset) and the legal pages,
 * which are linked from Settings as well as from sign-up.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-client";
import { getServerSession } from "@/lib/server-session";

/** Paths an authenticated user may still visit inside the (public) group. */
const AUTHED_ALLOWLIST = new Set([
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/terms",
]);

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (session) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (!AUTHED_ALLOWLIST.has(pathname)) redirect("/home");
  }
  return <AuthProvider initialUser={null}>{children}</AuthProvider>;
}
