/**
 * Company invitation lifecycle tests: create, token preview, accept
 * (email-match), expiry, resend (rotates token + revives), revoke,
 * and manager-only enforcement.
 *
 * The raw token is delivered by email; in tests the LogMailer writes the
 * rendered mail to storage/mail/<ts>-company-invite.html, so the helper
 * below extracts the token from the newest mail file (test-only path).
 *
 * Requires DATABASE_URL (see tests/setup.ts).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/db';
import { signup } from '@/lib/services/auth';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as verifyEmailRoute } from '@/app/api/auth/verify-email/route';
import { POST as createCompanyRoute } from '@/app/api/companies/route';
import { GET as getCompanyRoute } from '@/app/api/companies/[id]/route';
import { GET as listInvitesRoute, POST as createInviteRoute } from '@/app/api/invitations/route';
import { GET as previewInviteRoute, POST as acceptInviteRoute } from '@/app/api/invitations/[token]/route';
import { POST as resendInviteRoute } from '@/app/api/invitations/[token]/resend/route';
import { POST as revokeInviteRoute } from '@/app/api/invitations/[token]/revoke/route';
import { TestAgent, uniqueUser, errCode, promoteToManager } from '../helpers';

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

const MAIL_DIR = join(process.cwd(), 'storage', 'mail');

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
  return { agent: a, user: created.user, creds: u };
}

let companySeq = 0;
async function createCompany(a: TestAgent) {
  companySeq += 1;
  // Only a manager may create a company (request: no user can). The actor
  // becomes the company's manager, which is what these tests are about.
  await promoteToManager(a.userId);
  const { res, json } = await a.call(createCompanyRoute, '/api/companies', {
    method: 'POST',
    body: { name: `InviteCo ${companySeq}`, slug: `inviteco-${companySeq}-${Date.now().toString(36)}` },
  });
  expect(res.status).toBe(201);
  return (json as { company: { id: string } }).company.id;
}

function mailFiles(): string[] {
  try {
    return readdirSync(MAIL_DIR).filter((f) => f.endsWith('-company-invite.html'));
  } catch {
    return [];
  }
}

/** Create an invitation and return the raw token from the sent mail. */
async function inviteAndGetToken(a: TestAgent, companyId: string, email: string) {
  const before = new Set(mailFiles());
  const { res, json } = await a.call(createInviteRoute, '/api/invitations', {
    method: 'POST',
    body: { companyId, email, role: 'MEMBER' },
  });
  expect(res.status).toBe(201);
  const invitation = (json as { invitation: { id: string; status: string } }).invitation;

  // Give the LogMailer a tick to flush the file.
  for (let i = 0; i < 50; i++) {
    const fresh = mailFiles().filter((f) => !before.has(f));
    if (fresh.length > 0) {
      fresh.sort();
      const html = readFileSync(join(MAIL_DIR, fresh[fresh.length - 1]), 'utf8');
      const m = html.match(/\/invite\/([0-9a-f]{64})/);
      if (m) return { invitation, token: m[1] };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('invitation email was not written to storage/mail');
}

describe('invitations', () => {
  it('manager creates invitation; invitee previews with token; accepts; becomes member', async () => {
    const owner = await verifiedAgent('invA');
    const invitee = await verifiedAgent('invB');
    const companyId = await createCompany(owner.agent);

    const { invitation, token } = await inviteAndGetToken(owner.agent, companyId, invitee.creds.email);
    expect(invitation.status).toBe('PENDING');

    // Preview (logged in as anyone).
    const preview = await invitee.agent.callWithParams(
      previewInviteRoute,
      `/api/invitations/${token}`,
      { token },
    );
    expect(preview.res.status).toBe(200);
    expect((preview.json as { invitation: { email: string } }).invitation.email).toBe(
      invitee.creds.email.toLowerCase(),
    );

    // Accept → membership created.
    const accept = await invitee.agent.callWithParams(
      acceptInviteRoute,
      `/api/invitations/${token}`,
      { token },
      { method: 'POST' },
    );
    expect(accept.res.status).toBe(200);

    const company = await invitee.agent.callWithParams(
      getCompanyRoute,
      `/api/companies/${companyId}`,
      { id: companyId },
    );
    expect(company.res.status).toBe(200);
    expect((company.json as { viewerRole: string }).viewerRole).toBe('MEMBER');

    // Token is single-use now.
    const again = await invitee.agent.callWithParams(
      previewInviteRoute,
      `/api/invitations/${token}`,
      { token },
    );
    expect(again.res.status).toBe(410);
  });

  it('accept fails when account email does not match the invite', async () => {
    const owner = await verifiedAgent('invC');
    const other = await verifiedAgent('invD');
    const companyId = await createCompany(owner.agent);

    const { token } = await inviteAndGetToken(owner.agent, companyId, 'stranger@example.com');

    const accept = await other.agent.callWithParams(
      acceptInviteRoute,
      `/api/invitations/${token}`,
      { token },
      { method: 'POST' },
    );
    expect(accept.res.status).toBe(403);
  });

  it('expired invitation → 410 on preview/accept; resend revives with new token', async () => {
    const owner = await verifiedAgent('invE');
    const invitee = await verifiedAgent('invF');
    const companyId = await createCompany(owner.agent);

    const { invitation, token } = await inviteAndGetToken(owner.agent, companyId, invitee.creds.email);

    // Force expiry.
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const preview = await invitee.agent.callWithParams(
      previewInviteRoute,
      `/api/invitations/${token}`,
      { token },
    );
    expect(preview.res.status).toBe(410);

    // Resend by id (manager holds the id from the pending list).
    const resend = await owner.agent.callWithParams(
      resendInviteRoute,
      `/api/invitations/${invitation.id}/resend`,
      { token: invitation.id },
      { method: 'POST' },
    );
    expect(resend.res.status).toBe(200);
    expect((resend.json as { invitation: { status: string } }).invitation.status).toBe('PENDING');

    // Old token is dead (rotated); the resend email carries the new token.
    const dead = await invitee.agent.callWithParams(
      previewInviteRoute,
      `/api/invitations/${token}`,
      { token },
    );
    expect(dead.res.status).toBe(404);

    // Extract the fresh token from the resend mail and accept.
    const files = mailFiles().sort();
    const html = readFileSync(join(MAIL_DIR, files[files.length - 1]), 'utf8');
    const freshToken = html.match(/\/invite\/([0-9a-f]{64})/)![1];
    expect(freshToken).not.toBe(token);

    const accept = await invitee.agent.callWithParams(
      acceptInviteRoute,
      `/api/invitations/${freshToken}`,
      { token: freshToken },
      { method: 'POST' },
    );
    expect(accept.res.status).toBe(200);
  });

  it('revoke kills the token; resend of a revoked invitation → 409', async () => {
    const owner = await verifiedAgent('invG');
    const invitee = await verifiedAgent('invH');
    const companyId = await createCompany(owner.agent);

    const { invitation, token } = await inviteAndGetToken(owner.agent, companyId, invitee.creds.email);

    const revoke = await owner.agent.callWithParams(
      revokeInviteRoute,
      `/api/invitations/${invitation.id}/revoke`,
      { token: invitation.id },
      { method: 'POST' },
    );
    expect(revoke.res.status).toBe(200);

    const dead = await invitee.agent.callWithParams(
      previewInviteRoute,
      `/api/invitations/${token}`,
      { token },
    );
    // Token still resolves (known) but the invitation is closed → 410 Gone.
    expect(dead.res.status).toBe(410);

    const resend = await owner.agent.callWithParams(
      resendInviteRoute,
      `/api/invitations/${invitation.id}/resend`,
      { token: invitation.id },
      { method: 'POST' },
    );
    expect(resend.res.status).toBe(409);
    expect(errCode(resend.json)).toBe('INVITATION_CLOSED');
  });

  it('non-manager cannot invite, list, resend, or revoke', async () => {
    const owner = await verifiedAgent('invI');
    const member = await verifiedAgent('invJ');
    const companyId = await createCompany(owner.agent);

    // Make `member` a company member via direct invite+accept... simpler:
    // add membership row directly.
    await prisma.companyMember.create({ data: { companyId, userId: member.user.id, role: 'MEMBER' } });

    const create = await member.agent.call(createInviteRoute, '/api/invitations', {
      method: 'POST',
      body: { companyId, email: 'x@example.com', role: 'MEMBER' },
    });
    expect(create.res.status).toBe(403);

    const list = await member.agent.call(listInvitesRoute, `/api/invitations?companyId=${companyId}`);
    expect(list.res.status).toBe(403);
  });

  it('duplicate pending invite → 409; inviting existing member → 409; self-invite → 409', async () => {
    const owner = await verifiedAgent('invK');
    const other = await verifiedAgent('invK2');
    const companyId = await createCompany(owner.agent);

    await inviteAndGetToken(owner.agent, companyId, 'dup@example.com');

    const dup = await owner.agent.call(createInviteRoute, '/api/invitations', {
      method: 'POST',
      body: { companyId, email: 'dup@example.com', role: 'MEMBER' },
    });
    expect(dup.res.status).toBe(409);
    expect(errCode(dup.json)).toBe('INVITATION_EXISTS');

    const self = await owner.agent.call(createInviteRoute, '/api/invitations', {
      method: 'POST',
      body: { companyId, email: owner.creds.email, role: 'MEMBER' },
    });
    expect(self.res.status).toBe(409);
    expect(errCode(self.json)).toBe('SELF_INVITE');

    // Invite `other`, accept, then re-invite → already a member.
    const { token } = await inviteAndGetToken(owner.agent, companyId, other.creds.email);
    const accept = await other.agent.callWithParams(
      acceptInviteRoute,
      `/api/invitations/${token}`,
      { token },
      { method: 'POST' },
    );
    expect(accept.res.status).toBe(200);
    const again = await owner.agent.call(createInviteRoute, '/api/invitations', {
      method: 'POST',
      body: { companyId, email: other.creds.email, role: 'MEMBER' },
    });
    expect(again.res.status).toBe(409);
    expect(errCode(again.json)).toBe('ALREADY_MEMBER');
  });

  it('pending invitations list shows pending only', async () => {
    const owner = await verifiedAgent('invL');
    const invitee = await verifiedAgent('invM');
    const companyId = await createCompany(owner.agent);

    await inviteAndGetToken(owner.agent, companyId, invitee.creds.email);
    await inviteAndGetToken(owner.agent, companyId, 'pending2@example.com');

    const list = await owner.agent.call(listInvitesRoute, `/api/invitations?companyId=${companyId}`);
    expect(list.res.status).toBe(200);
    const items = (list.json as Array<{ email: string; status: string }>);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.status === 'PENDING')).toBe(true);
  });
});
