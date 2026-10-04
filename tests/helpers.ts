/**
 * Test helpers for API route tests.
 *
 * `TestAgent` is a tiny cookie jar around NextRequest/NextResponse: it stores
 * `avo_session` + `avo_csrf` from Set-Cookie headers and replays them,
 * including the `x-csrf-token` header that `handle()` requires on mutations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { POST as signupRoute } from '@/app/api/auth/signup/route';
import { POST as signupVerifyRoute } from '@/app/api/auth/signup/verify/route';

export interface AgentOptions {
  /** Start with a valid CSRF cookie+header pair but NO session (for 401 tests). */
  csrfOnly?: boolean;
}

function parseSetCookies(res: NextResponse): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const headers = res.headers.getSetCookie?.() ?? [];
  for (const h of headers) {
    const [pair] = h.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) out.push([pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()]);
  }
  return out;
}

let userSeq = 0;
/**
 * Unique credentials per test to avoid cross-test interference.
 *
 * The email is lowercased because the product lowercases it (`emailSchema` in
 * lib/validation.ts, and `normalizeEmail` in lib/services/otp.ts) — an address
 * is one inbox whatever its case. A fixture that kept the prefix's case would
 * make `findUnique({ where: { email: u.email } })` silently miss a row that
 * does exist, which is a confusing way to spend an afternoon. Usernames are
 * left alone: they ARE case-sensitive here.
 */
export function uniqueUser(prefix = 't') {
  userSeq += 1;
  const suffix = `${Date.now().toString(36)}${userSeq}`;
  return {
    name: `Test ${suffix}`,
    username: `${prefix}_${suffix}`.slice(0, 24),
    email: `${prefix}_${suffix}@example.com`.toLowerCase(),
    password: 'correct-horse-8',
  };
}

export class TestAgent {
  cookies = new Map<string, string>();
  /** DB ids of users created through this agent (for cleanup). */
  createdUserIds: string[] = [];
  /**
   * Addresses this agent asked for a code on. `OtpChallenge` has no relation to
   * `User` (a signup challenge exists before the user does), so it cannot be
   * reached through `createdUserIds` — it has to be tracked by email.
   */
  createdEmails: string[] = [];

  constructor(opts: AgentOptions = {}) {
    if (opts.csrfOnly) {
      const token = `test-csrf-${Math.random().toString(36).slice(2)}`;
      this.cookies.set('avo_csrf', token);
    }
  }

  private buildRequest(
    path: string,
    opts: { method?: string; body?: unknown; csrf?: boolean; csrfHeader?: string } = {},
  ): NextRequest {
    const method = opts.method ?? 'GET';
    const headers = new Headers();
    if (this.cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
      );
    }
    const withCsrf = opts.csrf ?? method !== 'GET';
    if (withCsrf && this.cookies.has('avo_csrf')) {
      // csrfHeader override lets tests simulate a mismatched double-submit pair.
      headers.set('x-csrf-token', opts.csrfHeader ?? this.cookies.get('avo_csrf')!);
    }
    if (opts.body !== undefined) headers.set('content-type', 'application/json');
    return new NextRequest(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  async call(
    handler: (req: NextRequest, ctx?: never) => Promise<NextResponse>,
    path: string,
    opts: { method?: string; body?: unknown; csrf?: boolean; csrfHeader?: string } = {},
  ): Promise<{ res: NextResponse; json: unknown }> {
    const res = await handler(this.buildRequest(path, opts));
    for (const [k, v] of parseSetCookies(res)) {
      if (v) this.cookies.set(k, v);
      else this.cookies.delete(k);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { res, json };
  }

  async callWithParams(
    // Route handlers declare concrete `ctx` shapes; they are not assignable to
    // `ctx?: unknown` under strictFunctionTypes, so `any` is required here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (req: NextRequest, ctx?: any) => Promise<NextResponse>,
    path: string,
    params: Record<string, string>,
    opts: { method?: string; body?: unknown; csrf?: boolean; csrfHeader?: string } = {},
  ) {
    const res = await handler(this.buildRequest(path, opts), {
      params: Promise.resolve(params),
    });
    for (const [k, v] of parseSetCookies(res)) {
      if (v) this.cookies.set(k, v);
      else this.cookies.delete(k);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { res, json };
  }

  trackUser(id: string) {
    this.createdUserIds.push(id);
  }

  /**
   * The one user this agent signed up as.
   *
   * Every helper in tests/api builds a fresh agent per user, so "the tracked
   * user" is unambiguous — and if that ever stops being true, this throws
   * rather than silently promoting the wrong person.
   */
  get userId(): string {
    if (this.createdUserIds.length !== 1) {
      throw new Error(
        `expected exactly 1 tracked user on this agent, got ${this.createdUserIds.length}`,
      );
    }
    return this.createdUserIds[0];
  }

  /** Record an address a challenge may have been issued for. */
  trackEmail(email: string) {
    this.createdEmails.push(email.trim().toLowerCase());
  }

  /**
   * Remove everything this agent created. The schema has no `onDelete: Cascade`
   * on User relations, so children must go before parents (each step is
   * best-effort — a failure must never fail the suite in afterAll).
   */
  async cleanup() {
    const emails = this.createdEmails;
    this.createdEmails = [];
    if (emails.length > 0) {
      await prisma.otpChallenge.deleteMany({ where: { email: { in: emails } } }).catch(() => undefined);
    }
    if (this.createdUserIds.length === 0) return;
    const ids = this.createdUserIds;
    this.createdUserIds = [];
    const run = (p: Promise<unknown>) => p.catch(() => undefined);
    try {
      // Companies owned by these users (tests usually delete their own, but a
      // mid-test failure can leave one behind).
      const owned = await prisma.company.findMany({
        where: { ownerId: { in: ids } },
        select: { id: true },
      });
      const companyIds = owned.map((c) => c.id);
      await run(prisma.companyMember.deleteMany({ where: { companyId: { in: companyIds } } }));
      await run(prisma.post.deleteMany({ where: { companyId: { in: companyIds } } }));
      await run(prisma.invitation.deleteMany({ where: { companyId: { in: companyIds } } }));
      await run(prisma.teamMember.deleteMany({ where: { team: { companyId: { in: companyIds } } } }));
      await run(prisma.team.deleteMany({ where: { companyId: { in: companyIds } } }));
      await run(prisma.company.deleteMany({ where: { id: { in: companyIds } } }));

      // Conversations the test users created or joined (Message.senderId is
      // SetNull, so messages must be deleted explicitly before users).
      const convos = await prisma.conversation.findMany({
        where: {
          OR: [{ createdById: { in: ids } }, { members: { some: { userId: { in: ids } } } }],
        },
        select: { id: true },
      });
      const convoIds = convos.map((c) => c.id);
      const messages = await prisma.message.findMany({
        where: { OR: [{ senderId: { in: ids } }, { conversationId: { in: convoIds } }] },
        select: { id: true },
      });
      const messageIds = messages.map((m) => m.id);
      if (messageIds.length > 0 || convoIds.length > 0) {
        await run(prisma.messageReaction.deleteMany({ where: { messageId: { in: messageIds } } }));
        await run(prisma.attachment.deleteMany({ where: { messageId: { in: messageIds } } }));
        await run(prisma.voiceMessage.deleteMany({ where: { messageId: { in: messageIds } } }));
      }
      await run(prisma.message.deleteMany({ where: { id: { in: messageIds } } }));
      await run(prisma.callParticipant.deleteMany({ where: { userId: { in: ids } } }));
      await run(prisma.call.deleteMany({ where: { initiatorId: { in: ids } } }));
      await run(prisma.conversationMember.deleteMany({ where: { conversationId: { in: convoIds } } }));
      await run(prisma.conversation.deleteMany({ where: { id: { in: convoIds } } }));

      await run(prisma.invitation.deleteMany({ where: { invitedById: { in: ids } } }));

      const posts = await prisma.post.findMany({
        where: { authorId: { in: ids } },
        select: { id: true },
      });
      const postIds = posts.map((p) => p.id);
      const comments = await prisma.comment.findMany({
        where: { OR: [{ authorId: { in: ids } }, { postId: { in: postIds } }] },
        select: { id: true },
      });
      const commentIds = comments.map((c) => c.id);

      await run(prisma.commentLike.deleteMany({ where: { OR: [{ userId: { in: ids } }, { commentId: { in: commentIds } }] } }));
      await run(prisma.like.deleteMany({ where: { OR: [{ userId: { in: ids } }, { postId: { in: postIds } }] } }));
      await run(prisma.bookmark.deleteMany({ where: { OR: [{ userId: { in: ids } }, { postId: { in: postIds } }] } }));
      await run(prisma.mention.deleteMany({ where: { OR: [{ mentionedUserId: { in: ids } }, { postId: { in: postIds } }] } }));
      await run(
        prisma.notification.deleteMany({
          where: {
            OR: [
              { userId: { in: ids } },
              { actorId: { in: ids } },
              { entityId: { in: [...postIds, ...commentIds, ...messageIds] } },
            ],
          },
        }),
      );
      await run(prisma.comment.deleteMany({ where: { id: { in: commentIds } } }));
      await run(prisma.post.deleteMany({ where: { id: { in: postIds } } }));

      await run(prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: ids } }, { followingId: { in: ids } }] } }));
      await run(prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } }));
      await run(prisma.mute.deleteMany({ where: { OR: [{ muterId: { in: ids } }, { mutedId: { in: ids } }] } }));

      await run(prisma.session.deleteMany({ where: { userId: { in: ids } } }));
      await run(prisma.verificationToken.deleteMany({ where: { userId: { in: ids } } }));
      await run(prisma.loginActivity.deleteMany({ where: { userId: { in: ids } } }));
      await run(prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } }));
      await run(prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } }));
      // `ManagerApplication.user` cascades on user delete, but an application
      // this agent REVIEWED (reviewedById is SetNull) would survive as an
      // orphan pointing at a row that no longer exists. Delete both directions.
      await run(
        prisma.managerApplication.deleteMany({
          where: { OR: [{ userId: { in: ids } }, { reviewedById: { in: ids } }] },
        }),
      );

      await run(prisma.user.deleteMany({ where: { id: { in: ids } } }));
    } catch {
      // best-effort: never fail afterAll
    }
  }
}

/** Error code extractor for the `{ error: { code, ... } }` envelope. */
export function errCode(json: unknown): string | null {
  if (typeof json === 'object' && json !== null && 'error' in json) {
    const e = (json as { error: { code?: string } }).error;
    return e?.code ?? null;
  }
  return null;
}

/**
 * Make a user a MANAGER, the way the product does it.
 *
 * `POST /api/companies` is refused for a plain user (`assertCanCreateCompany`,
 * lib/services/company-membership-policy.ts) — only a manager or an
 * administrator may create a company. Almost every API test needs a company
 * before it can test the thing it is actually about, so those tests need an
 * actor with the authority to make one.
 *
 * There is no endpoint that hands out the manager tier by itself. The product
 * path is "apply, then an administrator approves", and the approval is what
 * records the grant — so this writes the same row the approval would, exactly
 * as `verifiedAgent(asAdmin = true)` writes `platformRole` directly for the
 * same reason: the platform deliberately has no API for it.
 *
 * Note this is the ONLY thing that makes an approved-but-companyless manager a
 * manager (see the doc comment on `resolveMemberTier`), which is why these
 * files would fail loudly if that derivation regressed.
 */
export async function promoteToManager(userId: string): Promise<void> {
  const existing = await prisma.managerApplication.findFirst({
    where: { userId, status: 'APPROVED' },
    select: { id: true },
  });
  if (existing) return;
  await prisma.managerApplication.create({
    data: {
      userId,
      companyName: 'Test Co',
      position: 'Manager',
      status: 'APPROVED',
      reviewedAt: new Date(),
    },
  });
}

// ─── OTP signup ─────────────────────────────────────────────────────────────

export interface SignupBody {
  name: string;
  username: string;
  email: string;
  password: string;
}

/** Shape of the 202 response from `POST /api/auth/signup`. */
export interface SignupOtpChallenge {
  challengeId: string;
  email: string;
  expiresAt: string;
  resendAfterMs: number;
  /** Present only when the mailer cannot deliver — i.e. under vitest. */
  devCode?: string;
}

/**
 * Step 1 only: ask for a code. Creates nothing.
 *
 * Returned separately from the full flow because the gate is the whole point of
 * the feature — tests need to assert the state *between* the two calls (no user
 * row, no session) as much as the state after them.
 */
export async function requestSignupCode(agent: TestAgent, body: SignupBody) {
  agent.trackEmail(body.email);
  const step = await agent.call(signupRoute, '/api/auth/signup', {
    method: 'POST',
    body,
    csrf: false,
  });
  return { ...step, challenge: step.json as SignupOtpChallenge };
}

/**
 * The whole signup, the way the app performs it: request a code, then redeem
 * it. The account does not exist until the second call returns.
 *
 * The raw code is read from the 202 response rather than from an inbox —
 * `devCodeFor` (lib/services/otp.ts) hands it back only when the mailer is the
 * log driver, and tests/setup.ts pins that driver. With real SMTP the code goes
 * to the inbox and nowhere else, so this shortcut is unavailable on purpose.
 */
export async function signupViaOtp(agent: TestAgent, body: SignupBody) {
  const { challenge } = await requestSignupCode(agent, body);
  const step2 = await agent.call(signupVerifyRoute, '/api/auth/signup/verify', {
    method: 'POST',
    body: { challengeId: challenge.challengeId, code: challenge.devCode },
    csrf: false,
  });
  return { ...step2, challenge };
}
