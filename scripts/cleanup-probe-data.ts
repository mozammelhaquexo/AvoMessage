/**
 * scripts/cleanup-probe-data.ts — remove the users and challenges that the
 * verification scripts create.
 *
 * The live scripts (`verify-otp-flows.ts`, `verify-otp-ui-in-browser.mjs`) each
 * clean up after themselves on a successful run, but a run that fails part-way
 * through — or one that is killed — leaves rows behind. Over a few afternoons
 * that is a directory full of "Otp Member" and a pile of spent challenges.
 *
 * Scope is deliberately narrow: only addresses matching the probe patterns
 * below are touched, and every row is printed before it goes. There is no
 * "delete everything test-looking" mode, because a dev database that can be
 * wiped by a careless flag is worse than a slightly untidy one.
 *
 * Run:  npx tsx scripts/cleanup-probe-data.ts [--dry-run]
 *
 * No top-level await: this project's tsconfig emits CJS and esbuild rejects it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// Type-only: erased at compile time, so it cannot pull the client in before
// `loadEnv()` has run.
import type { PrismaClient } from '@prisma/client';

function loadEnv(): void {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * Address prefixes the verification scripts mint. Kept as an explicit list
 * rather than a regex so that adding a probe means editing this file — which is
 * the point.
 */
const PROBE_PREFIXES = [
  'otp_', // verify-otp-flows.ts (signup, member, manager, guard, expire)
  'sneak_', // verify-otp-flows.ts — the two refused-caller probes
  'uiprobe_', // verify-otp-ui-in-browser.mjs (signup)
  'uimem_', // ...and the member it adds
  'uimgr_', // ...and the manager it adds
  'probe_gate_', // verify-company-create-gate.mjs — the plain user it tries as
  'probe_mgr_', // ...and the applicant it gets approved (plus their company)
  'secadm_', // verify-single-admin.mjs — the account that must NOT reach /admin
  'probe_taken_', // orphaned: minted by a revision of the flows script that no
  // longer exists, but the row it created is still in the dev DB.
];

/**
 * Deliberately structural rather than `Prisma.UserWhereInput['OR']`: that type
 * is a union that includes `UserWhereInput[]`, so it will not narrow to the
 * equivalent clause for `OtpChallenge`, and the same filter is used for both.
 * A bare `{ email: { startsWith, mode } }` is assignable to either model's
 * `StringFilter`, which is all this needs.
 */
type ProbeEmailMatch = { email: { startsWith: string; mode: 'insensitive' } };

/**
 * `where` fragment matching any probe address.
 *
 * This client's `StringFilter` has no `like` — it exposes `equals / in / notIn /
 * lt / lte / gt / gte / contains / startsWith / endsWith / mode / not`. So the
 * prefix match is `startsWith`, and `mode: 'insensitive'` replaces what
 * `ILIKE` would have given us: an address stored before the fixture learned to
 * lowercase is still swept up.
 */
function probeEmailFilter(): ProbeEmailMatch[] {
  return PROBE_PREFIXES.map((p) => ({ email: { startsWith: p, mode: 'insensitive' } }));
}

interface RelatedIds {
  companyIds: string[];
  conversationIds: string[];
  messageIds: string[];
  postIds: string[];
}

/**
 * Every row that hangs off the probe users.
 *
 * Gathered before anything is deleted: the schema has no `onDelete: Cascade`
 * on User, so the delete order below is load-bearing, and the id sets have to
 * be known up front. It also means the dry-run can print what is about to go
 * rather than just the user count.
 */
async function collectRelated(client: PrismaClient, ids: string[]): Promise<RelatedIds> {
  if (ids.length === 0) {
    return { companyIds: [], conversationIds: [], messageIds: [], postIds: [] };
  }
  const companies = await client.company.findMany({
    where: { ownerId: { in: ids } },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);
  const conversations = await client.conversation.findMany({
    where: { OR: [{ createdById: { in: ids } }, { members: { some: { userId: { in: ids } } } }] },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);
  const messages = await client.message.findMany({
    where: { OR: [{ senderId: { in: ids } }, { conversationId: { in: conversationIds } }] },
    select: { id: true },
  });
  const posts = await client.post.findMany({ where: { authorId: { in: ids } }, select: { id: true } });
  return {
    companyIds,
    conversationIds,
    messageIds: messages.map((m) => m.id),
    postIds: posts.map((p) => p.id),
  };
}

async function main(): Promise<void> {
  loadEnv();
  const { prisma } = await import('../lib/db');
  const dryRun = process.argv.includes('--dry-run');

  const emailFilter = { OR: probeEmailFilter() };
  const users = await prisma.user.findMany({
    where: emailFilter,
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  const challenges = await prisma.otpChallenge.findMany({
    where: emailFilter,
    select: { id: true, email: true, purpose: true },
  });

  console.log(`probe users      : ${users.length}`);
  for (const u of users) console.log(`  - ${u.email}  (${u.name})`);
  console.log(`probe challenges : ${challenges.length}`);
  for (const c of challenges) console.log(`  - ${c.email}  ${c.purpose}`);

  if (users.length === 0 && challenges.length === 0) {
    console.log('\nnothing to do.');
    await prisma.$disconnect();
    return;
  }

  const ids = users.map((u) => u.id);
  const related = await collectRelated(prisma, ids);

  // A probe account can own a company, and deleting that company takes real
  // memberships with it. So the blast radius is printed on both paths — a
  // dry-run that only reports the user count is not a dry-run.
  if (ids.length > 0) {
    console.log('\nattached to those users:');
    console.log(`  companies     : ${related.companyIds.length}`);
    console.log(`  conversations : ${related.conversationIds.length}`);
    console.log(`  messages      : ${related.messageIds.length}`);
    console.log(`  posts         : ${related.postIds.length}`);
    if (related.companyIds.length > 0) {
      const owned = await prisma.company.findMany({
        where: { id: { in: related.companyIds } },
        select: { name: true, owner: { select: { email: true } } },
      });
      for (const c of owned) console.log(`    - ${c.name}  (owner: ${c.owner.email})`);
    }
    // Only companies the probe *owns* are deleted. One it merely belongs to is
    // left standing, with the membership removed — worth stating, because the
    // opposite assumption is the easy one to make.
    const elsewhere = await prisma.companyMember.count({
      where: { userId: { in: ids }, companyId: { notIn: related.companyIds } },
    });
    if (elsewhere > 0) {
      console.log(`  memberships in companies owned by someone else: ${elsewhere}`);
      console.log('    (the membership goes, the company stays)');
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing was deleted.');
    await prisma.$disconnect();
    return;
  }

  if (ids.length > 0) {
    // Children before parents — the schema has no onDelete: Cascade on User.
    await prisma.messageReaction.deleteMany({ where: { messageId: { in: related.messageIds } } });
    await prisma.attachment.deleteMany({ where: { messageId: { in: related.messageIds } } });
    await prisma.voiceMessage.deleteMany({ where: { messageId: { in: related.messageIds } } });
    await prisma.message.deleteMany({ where: { id: { in: related.messageIds } } });
    await prisma.callParticipant.deleteMany({ where: { userId: { in: ids } } });
    await prisma.call.deleteMany({ where: { initiatorId: { in: ids } } });
    await prisma.conversationMember.deleteMany({ where: { conversationId: { in: related.conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: related.conversationIds } } });

    await prisma.comment.deleteMany({ where: { OR: [{ authorId: { in: ids } }, { postId: { in: related.postIds } }] } });
    await prisma.like.deleteMany({ where: { OR: [{ userId: { in: ids } }, { postId: { in: related.postIds } }] } });
    await prisma.bookmark.deleteMany({ where: { OR: [{ userId: { in: ids } }, { postId: { in: related.postIds } }] } });
    await prisma.post.deleteMany({ where: { id: { in: related.postIds } } });

    await prisma.companyMember.deleteMany({ where: { OR: [{ userId: { in: ids } }, { companyId: { in: related.companyIds } }] } });
    await prisma.invitation.deleteMany({ where: { OR: [{ invitedById: { in: ids } }, { companyId: { in: related.companyIds } }] } });
    await prisma.teamMember.deleteMany({ where: { team: { companyId: { in: related.companyIds } } } });
    await prisma.team.deleteMany({ where: { companyId: { in: related.companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: related.companyIds } } });

    await prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: ids } }, { followingId: { in: ids } }] } });
    await prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } });
    await prisma.mute.deleteMany({ where: { OR: [{ muterId: { in: ids } }, { mutedId: { in: ids } }] } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.verificationToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.loginActivity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  // Every probe challenge, including any whose owner was already gone — the
  // prefix filter is authoritative here, not the user id list.
  const removedChallenges = await prisma.otpChallenge.deleteMany({
    where: emailFilter,
  });

  console.log(`\nremoved ${ids.length} user(s) and ${removedChallenges.count} challenge(s).`);
  await prisma.$disconnect();
}

void main();
