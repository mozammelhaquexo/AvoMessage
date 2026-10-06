/**
 * Presence staleness — "why is he still green when he closed the tab hours ago".
 *
 * Nothing writes OFFLINE when a browser goes away. On the polling transport
 * there is no socket disconnect to hang that off, and the socket server's own
 * disconnect grace only runs where a socket server runs at all. So OFFLINE is
 * inferred from the beats having stopped, and the read path is where that
 * inference has to happen.
 *
 * These tests pin the three states a viewer can be looking at, which are easy
 * to conflate and must not be:
 *
 *   fresh row   → the stored status is reported
 *   stale row   → OFFLINE, whatever the row still says
 *   no row      → OFFLINE
 *
 * Plus the property that makes the whole thing safe: a heartbeat brings a stale
 * row back, so an open-but-quiet tab is not condemned by the same rule that
 * clears a closed one.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as presenceGet, POST as presencePost } from '@/app/api/presence/route';
import { TestAgent, uniqueUser } from '../helpers';

const agents: TestAgent[] = [];
function agent() {
  const a = new TestAgent();
  agents.push(a);
  return a;
}
afterAll(async () => {
  for (const a of agents) await a.cleanup();
  await prisma.$disconnect();
});
beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

async function signedInAgent(prefix: string) {
  const u = uniqueUser(prefix);
  const created = await signup(
    { name: u.name, username: u.username, email: u.email, password: u.password },
    {},
  );
  const a = agent();
  a.trackUser(created.user.id);
  const v = await a.call(verifyEmailRoute, '/api/auth/verify-email', {
    method: 'POST',
    body: { token: created.verificationToken },
    csrf: false,
  });
  expect(v.res.status).toBe(200);
  const login = await a.call(loginRoute, '/api/auth/login', {
    method: 'POST',
    body: { email: u.email, password: u.password },
    csrf: false,
  });
  expect(login.res.status).toBe(200);
  return { agent: a, userId: created.user.id };
}

/** What the viewer would see for `userId`. */
async function readStatus(viewer: TestAgent, userId: string) {
  const { res, json } = await viewer.call(presenceGet, `/api/presence?ids=${userId}`);
  expect(res.status).toBe(200);
  const item = (json as { items: { userId: string; status: string }[] }).items.find(
    (i) => i.userId === userId,
  );
  return item?.status;
}

/** The stored status values, matching the Prisma enum. */
type StoredStatus = 'ONLINE' | 'AWAY' | 'DO_NOT_DISTURB' | 'OFFLINE';

/** Write a presence row directly, at a chosen age. */
async function seedPresence(userId: string, status: StoredStatus, ageMs: number) {
  const lastSeenAt = new Date(Date.now() - ageMs);
  await prisma.userPresence.upsert({
    where: { userId },
    create: { userId, status, lastSeenAt },
    update: { status, lastSeenAt },
  });
}

const FRESH = 10_000; // 10 s — inside the window
const STALE = 15 * 60_000; // 15 min — far outside it

describe('presence staleness on read', () => {
  it('reports the stored status while the row is fresh', async () => {
    const { agent: viewer, userId } = await signedInAgent('presFresh');
    await seedPresence(userId, 'ONLINE', FRESH);

    expect(await readStatus(viewer, userId)).toBe('ONLINE');
  });

  it('reports OFFLINE for a stale row, even though it still says ONLINE', async () => {
    const { agent: viewer, userId } = await signedInAgent('presStale');
    await seedPresence(userId, 'ONLINE', STALE);

    // The row is untouched — this is an inference at read time, not a write.
    const row = await prisma.userPresence.findUniqueOrThrow({ where: { userId } });
    expect(row.status).toBe('ONLINE');

    expect(await readStatus(viewer, userId)).toBe('OFFLINE');
  });

  it('reports OFFLINE for a user who has no presence row at all', async () => {
    const { agent: viewer, userId } = await signedInAgent('presNone');
    await prisma.userPresence.deleteMany({ where: { userId } });

    expect(await readStatus(viewer, userId)).toBe('OFFLINE');
  });

  it('keeps a non-ONLINE status while it is fresh, rather than flattening it to online', async () => {
    const { agent: viewer, userId } = await signedInAgent('presAway');
    await seedPresence(userId, 'AWAY', FRESH);

    expect(await readStatus(viewer, userId)).toBe('AWAY');
  });

  it('brings a stale row back to life on the next heartbeat', async () => {
    // This is the property that makes the rule safe to apply at all: the same
    // window that clears a closed tab must not condemn an open-but-quiet one,
    // and a single beat is enough to prove it is still there.
    const { agent: viewer, userId } = await signedInAgent('presRevive');
    await seedPresence(userId, 'ONLINE', STALE);
    expect(await readStatus(viewer, userId)).toBe('OFFLINE');

    const beat = await viewer.call(presencePost, '/api/presence', {
      method: 'POST',
      body: {},
    });
    expect(beat.res.status).toBe(200);

    expect(await readStatus(viewer, userId)).toBe('ONLINE');
  });

  it('a heartbeat with no status keeps the status it had', async () => {
    const { agent: viewer, userId } = await signedInAgent('presKeep');
    await seedPresence(userId, 'DO_NOT_DISTURB', STALE);

    await viewer.call(presencePost, '/api/presence', { method: 'POST', body: {} });

    expect(await readStatus(viewer, userId)).toBe('DO_NOT_DISTURB');
  });
});
