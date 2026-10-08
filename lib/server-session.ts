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
  // Fail open when the database is unreachable. A visitor carrying a stale
  // `avo_session` cookie from a previous deploy must still see the public
  // landing page (and `try again`) instead of the opaque "Something went
  // wrong" screen, when the only thing that's broken is the DB itself.
  // The cookie's HMAC verification still happens — we are only swallowing
  // errors raised *after* that, when the code tries to look the session
  // row up in a database that may be down, plan-limited, or suspended.
  // Routes that genuinely need an authenticated user (the (app) layout,
  // route handlers, `requireSession`) keep throwing — this is only the
  // soft-resolve used by layouts that decide between landing and home.
  try {
    return await getSessionFromRequest(req);
  } catch (err) {
    if (isTransientDbError(err)) {
      // eslint-disable-next-line no-console -- server-side diagnostic
      console.warn(
        "[server-session] treating DB-unreachable as signed-out:",
        err instanceof Error ? err.message.split("\n")[0] : String(err),
      );
      return null;
    }
    throw err;
  }
}

/**
 * True for errors that mean "couldn't reach / couldn't query the DB",
 * as opposed to "the query ran and returned an answer we don't like".
 *
 * Anything we identify here becomes "signed out" in soft-resolve paths.
 * The (app) layout / requireSession / API routes still see the real
 * exception — this is a layout-time courtesy, not a security boundary.
 */
function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // Prisma Accelerate / Prisma Postgres suspends answer with this exact
  // string on the free plan once the quota is exhausted. Treat as DB down.
  if (/planLimitReached|account has restrictions/i.test(msg)) return true;
  // Generic Prisma connectivity errors (P1xxx codes are operational).
  if (/^P1[0-9]{3}\b/.test(msg)) return true;
  // Prisma 7 wraps underlying-driver failures as P2039 (DriverAdapterError).
  // When the cause is a pool-exhaustion / connection-level failure (which is
  // what we see in production when Supavisor's session-mode pool fills up
  // with concurrent serverless invocations), this is also transient.
  if (/\bP2039\b/.test(msg)) {
    if (
      /EMAXCONNSESSION|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(msg)
    ) {
      return true;
    }
  }
  // node-postgres connection-level failures.
  const code = (err as { code?: string }).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "57P03" || // cannot_connect_now
    code === "08006" // connection_failure
  ) {
    return true;
  }
  return false;
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
