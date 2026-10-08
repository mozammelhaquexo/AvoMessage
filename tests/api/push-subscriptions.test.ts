/**
 * The push-subscription endpoints.
 *
 * These two routes are what make a closed tab reachable at all: the browser
 * gets a public key, mints a subscription from it, and hands the endpoint back.
 * The interesting behaviour is not the happy path — it is the two things that
 * must NOT be possible:
 *
 *   - an unauthenticated POST. The endpoint and its keys decide WHERE a user's
 *     message notifications are delivered, so an unauthenticated cross-site
 *     POST could silently redirect somebody's messages, sender names and
 *     previews to an attacker's server. Hence the session check AND the CSRF
 *     double-submit check.
 *   - a DELETE that names somebody else's endpoint. The service layer scopes
 *     every delete by `userId`, and this proves it.
 *
 * Also pinned here: `endpoint` is globally UNIQUE, so re-subscribing the same
 * browser profile updates one row instead of accumulating dead ones — and on a
 * shared machine the row follows whoever is signed in.
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { saveSubscription } from '@/lib/services/push';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { GET as publicKeyRoute } from '@/app/api/push/public-key/route';
import {
  POST as subscribeRoute,
  DELETE as unsubscribeRoute,
} from '@/app/api/push/subscribe/route';
import { TestAgent, uniqueUser, errCode } from '../helpers';

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

async function verifiedAgent(prefix: string) {
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
  return { agent: a, user: created.user };
}

/** A unique, realistic push-service endpoint for one test. */
function endpointFor(label: string): string {
  return `https://fcm.googleapis.com/fcm/send/${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function subscriptionBody(endpoint: string) {
  return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
}

describe('GET /api/push/public-key', () => {
  it('returns a VAPID public key', async () => {
    const a = agent();
    const { res, json } = await a.call(publicKeyRoute, '/api/push/public-key');

    expect(res.status).toBe(200);
    const { publicKey } = json as { publicKey: string | null };
    expect(typeof publicKey).toBe('string');
    // 65-byte uncompressed P-256 point -> 87 base64url characters.
    expect(publicKey!.length).toBeGreaterThan(80);
  });

  it('needs no session — the service worker fetches it with no page open', async () => {
    // No cookies at all on this agent.
    const a = agent();
    const { res } = await a.call(publicKeyRoute, '/api/push/public-key', { csrf: false });
    expect(res.status).toBe(200);
  });

  it('returns the same key every time, so existing subscriptions stay valid', async () => {
    const a = agent();
    const first = await a.call(publicKeyRoute, '/api/push/public-key');
    const second = await a.call(publicKeyRoute, '/api/push/public-key');

    expect((first.json as { publicKey: string }).publicKey).toBe(
      (second.json as { publicKey: string }).publicKey,
    );
  });
});

describe('POST /api/push/subscribe', () => {
  it('refuses an unauthenticated caller', async () => {
    const a = new TestAgent({ csrfOnly: true });
    agents.push(a);
    const { res, json } = await a.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpointFor('anon')),
    });

    expect(res.status).toBe(401);
    expect(errCode(json)).toBe('UNAUTHENTICATED');
  });

  it('refuses a request without the CSRF double-submit header', async () => {
    const user = await verifiedAgent('pushNoCsrf');
    const endpoint = endpointFor('no-csrf');
    const { res, json } = await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
      // The cookie is present but the header is not — a cross-site form post.
      csrf: false,
    });

    expect(res.status).toBe(403);
    expect(errCode(json)).toBe('CSRF_INVALID');
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });

  it('stores the endpoint for the signed-in user', async () => {
    const user = await verifiedAgent('pushOk');
    const endpoint = endpointFor('ok');
    const { res, json } = await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });

    expect(res.status).toBe(200);
    expect((json as { ok: boolean }).ok).toBe(true);

    const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(user.user.id);
    expect(row!.p256dh).toBe('p256dh-key');
    expect(row!.auth).toBe('auth-secret');
    expect(row!.failureCount).toBe(0);
  });

  it('tolerates a request with no user agent', async () => {
    const user = await verifiedAgent('pushNoUa');
    const endpoint = endpointFor('no-ua');

    // The route reads `user-agent` for a "signed-in devices" list, but it is
    // decoration — a privacy browser or a service-worker fetch may omit it, and
    // the subscription must still be usable.
    const { res } = await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });

    expect(res.status).toBe(200);
    const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(row).not.toBeNull();
    expect(row!.userAgent).toBeNull();
  });

  it('stores the user agent when the client sends one', async () => {
    // Exercised at the service layer: TestAgent does not send a `user-agent`
    // header, and the value is worth pinning because it is what makes a
    // "signed in on these devices" list possible later.
    const user = await verifiedAgent('pushUa');
    const endpoint = endpointFor('ua');

    await saveSubscription(user.user.id, {
      endpoint,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0',
    });

    const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(row!.userAgent).toContain('Chrome/141');
  });

  it('updates one row when the same browser re-subscribes', async () => {
    const user = await verifiedAgent('pushResub');
    const endpoint = endpointFor('resub');

    await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });
    const { res } = await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: { endpoint, keys: { p256dh: 'rotated-p256dh', auth: 'rotated-auth' } },
    });

    expect(res.status).toBe(200);
    // The endpoint identifies one browser profile, so this must not accumulate.
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
    const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(row!.p256dh).toBe('rotated-p256dh');
    expect(row!.auth).toBe('rotated-auth');
  });

  it('re-points a shared browser at whoever is signed in now', async () => {
    const first = await verifiedAgent('pushSharedA');
    const second = await verifiedAgent('pushSharedB');
    const endpoint = endpointFor('shared');

    await first.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });
    await second.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });

    // One row, and it belongs to the current user — otherwise the previous
    // user's messages would be pushed to whoever is sitting there now.
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
    const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(row!.userId).toBe(second.user.id);
  });

  it('rejects a body with no keys', async () => {
    const user = await verifiedAgent('pushBadBody');
    const { res } = await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: { endpoint: endpointFor('bad') },
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty endpoint', async () => {
    const user = await verifiedAgent('pushEmpty');
    const { res } = await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: { endpoint: '   ', keys: { p256dh: 'a', auth: 'b' } },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/push/subscribe', () => {
  it('forgets the caller’s own endpoint', async () => {
    const user = await verifiedAgent('pushDel');
    const endpoint = endpointFor('del');
    await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });

    const { res, json } = await user.agent.call(unsubscribeRoute, '/api/push/subscribe', {
      method: 'DELETE',
      body: { endpoint },
    });

    expect(res.status).toBe(200);
    expect((json as { removed: number }).removed).toBe(1);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });

  it('cannot delete somebody else’s endpoint', async () => {
    const owner = await verifiedAgent('pushOwner');
    const attacker = await verifiedAgent('pushAttacker');
    const endpoint = endpointFor('victim');
    await owner.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });

    const { res, json } = await attacker.agent.call(unsubscribeRoute, '/api/push/subscribe', {
      method: 'DELETE',
      body: { endpoint },
    });

    expect(res.status).toBe(200);
    // Reported as "removed: 0" rather than 403: the caller learns nothing about
    // whether the endpoint exists, and the row is untouched.
    expect((json as { removed: number }).removed).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
  });

  it('is idempotent', async () => {
    const user = await verifiedAgent('pushDelTwice');
    const endpoint = endpointFor('del-twice');
    await user.agent.call(subscribeRoute, '/api/push/subscribe', {
      method: 'POST',
      body: subscriptionBody(endpoint),
    });

    await user.agent.call(unsubscribeRoute, '/api/push/subscribe', {
      method: 'DELETE',
      body: { endpoint },
    });
    const { res, json } = await user.agent.call(unsubscribeRoute, '/api/push/subscribe', {
      method: 'DELETE',
      body: { endpoint },
    });

    expect(res.status).toBe(200);
    expect((json as { removed: number }).removed).toBe(0);
  });
});
