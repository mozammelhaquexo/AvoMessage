/**
 * POST /api/admin/backup — snapshot every public table into Vercel KV.
 *
 * The intended caller is a Vercel Cron Job (see `vercel.json`):
 *
 *   {
 *     "crons": [{ "path": "/api/admin/backup", "schedule": "0 2 * * *" }]
 *   }
 *
 * Authentication: `Authorization: Bearer ${CRON_SECRET}`. The same header
 * value is supplied to the schedule; without it the route 401s. The same
 * token is also accepted from a logged-in SUPER_ADMIN (handy for an
 * on-demand "snapshot before I push this migration" button).
 *
 * Output: a JSON document under Vercel KV key
 *   `snapshot:full:<UTC-ISO-timestamp>`
 * holding `{ at, counts, tables: { [name]: rows[] } }`. The cron schedule
 * only keeps the last 30 snapshots (oldest are deleted on each call), so the
 * KV usage stays under a few MB even at 1 GB of source data.
 *
 * Restore: see docs/BACKUP_RUNBOOK.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

export const dynamic = "force-dynamic";
// The route is heavy (reads every row of every public table) and must not be
// prerendered. `maxDuration` lets a large snapshot finish on Vercel's
// default-function budget (10 s on Hobby); bump if your tables are bigger.
export const maxDuration = 300;
export const runtime = "nodejs";

const KV_MAX_SNAPSHOTS = 30;
const SENSITIVE_TABLES = new Set([
  // Never include plaintext credentials / hashes / recovery tokens in a backup.
  "Session",
  "PasswordReset",
  "OtpChallenge",
]);

interface BackupDoc {
  at: string;
  deployment?: string;
  rowCounts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

/** Returns the row count and rows of a single table. Capped to 5000 to bound
 *  payload size — a real "ship-the-whole-DB" backup belongs in pg_dump /
 *  Supabase's own backup, which is why this route documents `pg_dump` in
 *  the runbook. The cap exists so a 100 MB table does not produce a
 *  100 MB JSON string in Vercel KV. */
const ROW_CAP = 5_000;

async function snapshotTable(name: string): Promise<{ rows: unknown[]; count: number }> {
  // `$queryRawUnsafe` is the only Prisma API that accepts a fully dynamic
  // identifier. Table names come from `information_schema.tables` (Postgres's
  // own catalog), never from user input, so the lack of parameter binding
  // is not an injection risk here. Double-quoting makes the name safe even
  // if Postgres ever produced an unusual one.
  const quoted = `"${name.replace(/"/g, '""')}"`;
  const all = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT * FROM ${quoted} LIMIT ${ROW_CAP}`,
  );
  const cnt = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ${quoted}`,
  );
  return { rows: all as unknown[], count: cnt[0]?.n ?? 0 };
}

function kvConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function kvSet(key: string, value: string): Promise<void> {
  if (!kvConfigured()) return;
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: value,
  });
  if (!res.ok) throw new Error(`KV SET ${key} → ${res.status} ${await res.text()}`);
}

async function kvKeysByPrefix(prefix: string): Promise<string[]> {
  if (!kvConfigured()) return [];
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  // Upstash REST exposes SCAN with MATCH; cursor is returned in body.
  const out: string[] = [];
  let cursor = "0";
  for (let i = 0; i < 50; i++) {
    const res = await fetch(
      `${url}/scan/${cursor}/match/${encodeURIComponent(prefix)}*/count/100`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) break;
    const body = (await res.json()) as { result: [string, string[]] };
    cursor = body.result[0];
    out.push(...body.result[1]);
    if (cursor === "0") break;
  }
  return out;
}

async function kvDel(...keys: string[]): Promise<void> {
  if (!kvConfigured() || keys.length === 0) return;
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const path = keys.map((k) => encodeURIComponent(k)).join("/");
  await fetch(`${url}/del/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function buildBackup(): Promise<BackupDoc> {
  const tableNames = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name
  `;
  const tables: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};
  for (const { table_name } of tableNames) {
    if (SENSITIVE_TABLES.has(table_name)) {
      rowCounts[table_name] = 0; // we know the table exists but we redact it
      continue;
    }
    const { rows, count } = await snapshotTable(table_name);
    tables[table_name] = rows;
    rowCounts[table_name] = count;
  }
  return {
    at: new Date().toISOString(),
    deployment: process.env.VERCEL_DEPLOYMENT_ID,
    rowCounts,
    tables,
  };
}

async function enforceAuth(req: NextRequest): Promise<NextResponse | null> {
  // 1. CRON_SECRET (preferred — Vercel Cron supplies it via Bearer header).
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth === `Bearer ${expected}`) return null;
  }
  // 2. SUPER_ADMIN session (for a manual "snapshot now" button).
  try {
    const session = await requireSession(req);
    if (session.user.platformRole === "SUPER_ADMIN") return null;
  } catch {
    /* fall through to 401 */
  }
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "CRON_SECRET or SUPER_ADMIN required" } },
    { status: 401 },
  );
}

export async function POST(req: NextRequest) {
  const denied = await enforceAuth(req);
  if (denied) return denied;

  if (!kvConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "KV_NOT_CONFIGURED",
          message:
            "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable KV backups.",
        },
      },
      { status: 503 },
    );
  }

  const doc = await buildBackup();
  const key = `snapshot:full:${doc.at}`;
  await kvSet(key, JSON.stringify(doc));

  // Rotate: keep the last KV_MAX_SNAPSHOTS entries under snapshot:full:*
  const allKeys = await kvKeysByPrefix("snapshot:full:");
  if (allKeys.length > KV_MAX_SNAPSHOTS) {
    const sorted = allKeys.sort(); // ISO timestamps are lexicographically ordered
    const toDelete = sorted.slice(0, allKeys.length - KV_MAX_SNAPSHOTS);
    await kvDel(...toDelete);
  }

  return NextResponse.json({
    ok: true,
    key,
    at: doc.at,
    rowCounts: doc.rowCounts,
    kvUsage: { kept: Math.min(allKeys.length + 1, KV_MAX_SNAPSHOTS) },
  });
}

// GET is also allowed so a human can verify the route from a browser after
// supplying CRON_SECRET in the Authorization header.
export const GET = POST;