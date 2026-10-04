/**
 * lib/server-session.ts — resolve the session inside Server Components.
 *
 * `requireSession` (lib/permissions.ts) needs a NextRequest; layouts don't
 * have one. This builds a synthetic request from the `avo_session` cookie
 * read via `next/headers` and reuses `getSessionFromRequest` so the exact
 * same verification path (HMAC → hash → row → revoked/expiry/active) runs.
 *
 * SERVER-SIDE ONLY — never import from client components.
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { getSessionFromRequest, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/api-types";

export type ServerSession = Awaited<ReturnType<typeof getSessionFromRequest>>;

export async function getServerSession(): Promise<ServerSession> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;
  if (!value) return null;
  // Synthetic request carrying just the session cookie; getSessionFromRequest
  // only reads cookies, so nothing else is needed.
  const req = new NextRequest("http://localhost/", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${value}` },
  });
  return getSessionFromRequest(req);
}

/**
 * Serialize the Prisma user row into the SessionUser shape safe for client
 * component props (Date → ISO string).
 */
export function toSessionUser(user: NonNullable<ServerSession>["user"]): SessionUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    bio: user.bio,
    website: user.website,
    location: user.location,
    isPrivate: user.isPrivate,
    isVerified: user.isVerified,
    emailVerified: !!user.emailVerifiedAt,
    platformRole: user.platformRole,
    createdAt: user.createdAt.toISOString(),
  };
}
