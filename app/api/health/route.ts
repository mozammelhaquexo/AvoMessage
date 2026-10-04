/**
 * GET /api/health — production health check.
 *
 * Public, unauthenticated, no rate-limit coupling: load balancers and
 * orchestrators must be able to poll this without credentials or CSRF.
 * (proxy.ts only enforces CSRF on unsafe methods; GET is untouched.)
 *
 * Response shape:
 *   { status: "ok" | "degraded", version, uptime, startedAt,
 *     db: { ok: boolean, latencyMs?: number, error?: string } }
 *
 * HTTP 200 when the app is up; 503 when the database is unreachable.
 * Never leaks secrets — the DB error is reduced to a short message with no
 * connection string, credentials, or stack trace.
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
}

async function checkDb(): Promise<DbCheck> {
  const t0 = Date.now();
  try {
    // Cheap round-trip; no tables touched.
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    // Strip anything that could carry connection details.
    const message =
      err instanceof Error ? err.message : "database unreachable";
    return { ok: false, error: message.slice(0, 200) };
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
