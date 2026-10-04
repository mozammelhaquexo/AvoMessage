import { NextRequest, NextResponse } from 'next/server';
import { handle, ok, parseJson } from '@/lib/api';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/permissions';
import { presenceUpdateSchema } from '@/lib/validation';
import type { PresencePayload } from '@/lib/realtime/events';

/**
 * GET /api/presence?ids=<id>,<id>
 *
 * REST seed for presence.
 *
 * Why this exists: `broadcastPresence` in lib/realtime/server.ts only fans
 * `presence:update` out to the `conversation:*` and `company:*` rooms a user
 * belongs to. A viewer therefore has NO presence at all for anyone they share
 * no room with — which is most of the Home feed, the profile page, and the
 * admin user list. This endpoint supplies an initial snapshot so those surfaces
 * can render an accurate dot; the socket then keeps it fresh wherever a shared
 * room exists.
 *
 * Every requested id gets an entry. A user with no `UserPresence` row has never
 * opened a socket, so they are reported OFFLINE rather than omitted — the
 * client can then render a dot without guessing.
 */
const MAX_IDS = 100;

export const GET = handle(async (req: NextRequest): Promise<NextResponse> => {
  await requireSession(req);

  const raw = new URL(req.url).searchParams.get('ids') ?? '';
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_IDS);

  if (ids.length === 0) return ok({ items: [] as PresencePayload[] });

  const rows = await prisma.userPresence.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, status: true, lastSeenAt: true },
  });

  const byId = new Map<string, { status: string; lastSeenAt: Date }>(
    rows.map((row: { userId: string; status: string; lastSeenAt: Date }) => [row.userId, row]),
  );

  const items: PresencePayload[] = ids.map((userId) => {
    const row = byId.get(userId);
    return {
      userId,
      status: (row?.status ?? 'OFFLINE') as PresencePayload['status'],
      lastSeenAt: (row?.lastSeenAt ?? new Date()).toISOString(),
    };
  });

  return ok({ items });
});

/**
 * POST /api/presence — body `{ status?: 'ONLINE' | 'AWAY' | 'DO_NOT_DISTURB' }`.
 *
 * The write half of the REST realtime transport (`lib/realtime/polling.ts`).
 * A Socket.io connection marks its user online as a side effect of connecting;
 * a poller has no connection to hang that off, so it publishes here instead —
 * immediately on connect, then on a 30 s heartbeat. Without this every user of
 * a polling deployment would read as OFFLINE forever, because nothing would
 * ever write a `UserPresence` row.
 *
 * Omitted `status` is a heartbeat: touch `lastSeenAt`, keep the current
 * status. `OFFLINE` is deliberately not settable — going offline is the
 * server's inference when a client stops beating, not a client's claim.
 */
export const POST = handle(async (req: NextRequest): Promise<NextResponse> => {
  const { user } = await requireSession(req);
  const input = await parseJson(req, presenceUpdateSchema);

  const now = new Date();
  const row = await prisma.userPresence.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      status: input.status ?? 'ONLINE',
      lastSeenAt: now,
    },
    update: {
      ...(input.status ? { status: input.status } : {}),
      lastSeenAt: now,
    },
    select: { userId: true, status: true, lastSeenAt: true },
  });

  const presence: PresencePayload = {
    userId: row.userId,
    status: row.status,
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
  return ok({ presence });
});
