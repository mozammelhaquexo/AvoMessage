/**
 * GET /api/health — production health check.
 *
 * Public, unauthenticated, no rate-limit coupling: load balancers and
 * orchestrators must be able to poll this without credentials or CSRF.
 * (proxy.ts only enforces CSRF on unsafe methods; GET is untouched.)
 *
 * Response shape:
 *   { status: "ok" | "degraded", version, uptime, startedAt,
 *     db: { ok: boolean, latencyMs?: number, error?: string,
 *           schema?: { ok: boolean, tableCount?: number, error?: string } } }
 *
 * HTTP 200 when the app is up; 503 when the database is unusable.
 * Never leaks secrets — driver errors are reduced to a short message with the
 * credentials redacted and no stack trace.
 *
 * WHY TWO PROBES. `SELECT 1` only proves a socket opened. A database where the
 * migrations were never applied answers `SELECT 1` happily and then fails every
 * real query, so a connectivity-only check reports a healthy service while the
 * whole app is down — which is exactly how a deployment can 500 on every write
 * while `/api/health` stays green. The second probe therefore reads a real
 * table (`LIMIT 0`, so it costs nothing and returns no rows) and the check is
 * only "ok" when both succeed.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const startedAt = new Date().toISOString();
// npm sets npm_package_version when the server is launched via `npm start`;
// fall back to the package.json version so non-npm launches still report one.
const version =
  process.env.npm_package_version ?? process.env.APP_VERSION ?? "0.0.0";

interface DbCheck {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  schema?: { ok: boolean; tableCount?: number; error?: string };
}

/**
 * Reduce a driver error to something safe to publish. Prisma and pg messages
 * name the host and the missing table — useful, and not secret — but a
 * connection URL that found its way into a message would carry the password,
 * so credentials are redacted defensively.
 */
function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : "database unreachable";
  return message.replace(/:\/\/[^@\s/]+@/g, "://<credentials>@").slice(0, 200);
}

async function checkDb(): Promise<DbCheck> {
  const t0 = Date.now();
  try {
    // Cheap round-trip; no tables touched.
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
  const latencyMs = Date.now() - t0;

  // How many tables this connection can actually see in `public`. Zero means
  // the string points at a different database than the one the migrations were
  // applied to — the distinction between "wrong database" and "wrong schema"
  // that a bare error message cannot make.
  let tableCount: number | undefined;
  try {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'
    `;
    tableCount = rows[0]?.n;
  } catch {
    // A failed count is not itself a failure; the probe below is the verdict.
  }

  try {
    // Schema-qualified on purpose: Prisma qualifies the tables it queries, so
    // an unqualified probe could succeed or fail purely on the connection's
    // search_path and report a problem that the application does not have.
    await prisma.$queryRaw`SELECT 1 FROM "public"."User" LIMIT 0`;
    return { ok: true, latencyMs, schema: { ok: true, tableCount } };
  } catch (err) {
    return { ok: false, latencyMs, schema: { ok: false, tableCount, error: describe(err) } };
  }
}

export async function GET() {
  const db = await checkDb();
  const body = {
    status: db.ok ? ("ok" as const) : ("degraded" as const),
    version,
    uptime: Math.floor(process.uptime()),
    startedAt,
    db,
  };
  return NextResponse.json(body, { status: db.ok ? 200 : 503 });
}
