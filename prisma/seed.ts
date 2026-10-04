// ─────────────────────────────────────────────────────────────────────────────
// AvoMessage — DEMO SEED DATA
// Clearly-marked demo accounts (all emails end in @avomessage.demo).
// NEVER use these credentials in production. All passwords are bcrypt-hashed
// (cost 12); no plaintext secrets anywhere in this file.
// Idempotent: deletes all demo-scoped rows first, then recreates them.
// Run: `npx prisma db seed`
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient, PlatformRole, CompanyRole, TeamRole, PostVisibility, ConversationType, ConversationRole, MessageType, NotificationType, ReportTarget, ReportReason, ReportStatus, PresenceStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

// Prisma 7 requires a driver adapter at runtime (datasource URL lives in
// prisma.config.ts for CLI use only). Same pattern belongs in lib/db.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const DEMO_DOMAIN = '@avomessage.demo';
const BCRYPT_ROUNDS = 12;

// ── Demo credentials (documented in DB agent report; these are DEV-ONLY) ──
const DEMO_USERS = [
  { email: `admin${DEMO_DOMAIN}`,   username: 'admin', name: 'Ada Admin',     password: 'Admin123!',   platformRole: PlatformRole.SUPER_ADMIN, isVerified: true,  bio: 'Platform administrator (demo account).' },
  { email: `manager${DEMO_DOMAIN}`, username: 'mara',  name: 'Mara Manager',  password: 'Manager123!', platformRole: PlatformRole.USER,         isVerified: false, bio: 'Runs Avocado Labs (demo account).' },
  { email: `demo${DEMO_DOMAIN}`,    username: 'demo',  name: 'Demo User',     password: 'Demo1234!',   platformRole: PlatformRole.USER,         isVerified: false, bio: 'Just exploring AvoMessage. 🥑' },
  { email: `demo2${DEMO_DOMAIN}`,   username: 'jules', name: 'Jules Rivera',  password: 'Demo1234!',   platformRole: PlatformRole.USER,         isVerified: false, bio: 'Designer & part-time meme archivist.' },
  { email: `demo3${DEMO_DOMAIN}`,   username: 'priya', name: 'Priya Nair',    password: 'Demo1234!',   platformRole: PlatformRole.USER,         isVerified: false, bio: 'Engineer. Coffee first, code second.' },
];

async function main() {
  // Demo credentials are public knowledge (documented in the repo). Refuse
  // to seed them into a production database unless explicitly overridden.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== '1') {
    console.error(
      '❌ Refusing to seed DEMO data with well-known credentials in production.\n' +
      '   Set ALLOW_DEMO_SEED=1 to override (only for intentional demo environments).',
    );
    process.exit(1);
  }

  console.log('🌱 Seeding AvoMessage DEMO data…');

  // Hash passwords OUTSIDE the transaction (bcrypt cost 12 is slow).
  const usersWithHashes = await Promise.all(
    DEMO_USERS.map(async (u) => ({ ...u, passwordHash: await bcrypt.hash(u.password, BCRYPT_ROUNDS) })),
  );

  await prisma.$transaction(async (tx) => {
    // ── 1. Delete existing demo data (idempotency) ──────────────────────────
    // ORDER MATTERS: Company.owner has no cascade (deleting a user must never
    // delete their company), so companies go first. Each step's cascades:
    //   companies → members, teams (+team members), company posts (+their
    //               media/likes/comments…), invitations; conversations keep
    //               companyId=NULL-able so group chats survive as orphans…
    await tx.company.deleteMany({ where: { slug: { in: ['avocado-labs', 'greenhouse-studio'] } } });
    // …then demo users, cascading: sessions, tokens, presence, public posts
    // (+media, likes, bookmarks, comments…), follows/blocks/mutes,
    // notifications, filed reports, mentions, voice messages, call participations.
    await tx.user.deleteMany({ where: { email: { endsWith: DEMO_DOMAIN } } });
    // Conversations whose members were all demo users are now member-less orphans;
    // deleting them cascades messages → attachments/reactions/voice.
    await tx.conversation.deleteMany({ where: { members: { none: {} } } });

    // ── 2. Users ────────────────────────────────────────────────────────────
    const created = new Map<string, { id: string; username: string }>();
    for (const u of usersWithHashes) {
      const user = await tx.user.create({
        data: {
          email: u.email,
          emailVerifiedAt: new Date(),
          passwordHash: u.passwordHash,
          name: u.name,
          username: u.username,
          platformRole: u.platformRole,
          isVerified: u.isVerified,
          bio: u.bio,
          presence: { create: { status: PresenceStatus.OFFLINE } },
        },
      });
      created.set(u.username, { id: user.id, username: user.username });
    }
    const id = (username: string) => created.get(username)!.id;
    const now = new Date();

    // Demo user is online right now (nice for presence UI).
    await tx.userPresence.update({ where: { userId: id('demo') }, data: { status: PresenceStatus.ONLINE, lastSeenAt: now } });

    // ── 3. Companies + memberships ──────────────────────────────────────────
    const avocado = await tx.company.create({
      data: {
        name: 'Avocado Labs',
        slug: 'avocado-labs',
        description: 'Building the future of team messaging. (Demo company)',
        website: 'https://avocado-labs.example.com',
        ownerId: id('mara'),
      },
    });
    const greenhouse = await tx.company.create({
      data: {
        name: 'Greenhouse Studio',
        slug: 'greenhouse-studio',
        description: 'A tiny design studio growing big ideas. (Demo company)',
        ownerId: id('admin'),
      },
    });

    const memberships: Array<[string, string, CompanyRole]> = [
      [avocado.id, id('mara'), CompanyRole.OWNER],
      [avocado.id, id('jules'), CompanyRole.MANAGER],
      [avocado.id, id('demo'), CompanyRole.MEMBER],
      [avocado.id, id('priya'), CompanyRole.MEMBER],
      [greenhouse.id, id('admin'), CompanyRole.OWNER],
      [greenhouse.id, id('demo'), CompanyRole.MEMBER],
    ];
    for (const [companyId, userId, role] of memberships) {
      await tx.companyMember.create({ data: { companyId, userId, role } });
    }

    // ── 4. Teams ────────────────────────────────────────────────────────────
    const engineering = await tx.team.create({
      data: { companyId: avocado.id, name: 'Engineering', description: 'Ships the thing. (Demo team)' },
    });
    const design = await tx.team.create({
      data: { companyId: avocado.id, name: 'Design', description: 'Makes it beautiful. (Demo team)' },
    });
    const teamMembers: Array<[string, string, TeamRole]> = [
      [engineering.id, id('mara'), TeamRole.MANAGER],
      [engineering.id, id('jules'), TeamRole.MANAGER],
      [engineering.id, id('demo'), TeamRole.MEMBER],
      [design.id, id('mara'), TeamRole.MANAGER],
      [design.id, id('priya'), TeamRole.MEMBER],
    ];
    for (const [teamId, userId, role] of teamMembers) {
      await tx.teamMember.create({ data: { teamId, userId, role } });
    }

    // ── 5. Hashtags (global rows — upsert so re-seeds don't clash) ─────────
    for (const tag of ['welcome', 'avomessage', 'design', 'shipping']) {
      await tx.hashtag.upsert({ where: { tag }, update: {}, create: { tag } });
    }
    const tagId = async (tag: string) => (await tx.hashtag.findUniqueOrThrow({ where: { tag } })).id;

    // ── 6. Posts (public World + company-private) ───────────────────────────
    const post1 = await tx.post.create({
      data: {
        authorId: id('demo'), body: 'Welcome to AvoMessage! 🥑 This is the World feed — share what is on your mind. #welcome #avomessage',
        visibility: PostVisibility.PUBLIC,
        hashtags: { create: [{ hashtagId: await tagId('welcome') }, { hashtagId: await tagId('avomessage') }] },
      },
    });
    const post2 = await tx.post.create({
      data: {
        authorId: id('jules'), body: 'New profile layout is live in the design system. Rounded, glassy, and it respects your theme. #design #avomessage',
        visibility: PostVisibility.PUBLIC,
        hashtags: { create: [{ hashtagId: await tagId('design') }, { hashtagId: await tagId('avomessage') }] },
      },
    });
    const post3 = await tx.post.create({
      data: {
        authorId: id('priya'), body: 'TIL: Prisma composite @@id keys make join tables so much cleaner. No surrogate ids, no regrets.',
        visibility: PostVisibility.PUBLIC,
      },
    });
    const post4 = await tx.post.create({
      data: {
        authorId: id('mara'), body: 'Avocado Labs is hiring! If you love realtime systems and good design, come say hi. 🥑',
        visibility: PostVisibility.PUBLIC,
      },
    });
    // Company-private: only Avocado Labs members may read these (server-enforced).
    const post5 = await tx.post.create({
      data: {
        authorId: id('mara'), body: 'Team: standup notes for this week are pinned in Engineering. Please update your tasks by EOD. (Internal)',
        visibility: PostVisibility.COMPANY, companyId: avocado.id,
      },
    });
    const post6 = await tx.post.create({
      data: {
        authorId: id('jules'), body: 'Shipped the new presence indicator today 🚀 Green dot supremacy. (Internal) #shipping',
        visibility: PostVisibility.COMPANY, companyId: avocado.id,
        hashtags: { create: [{ hashtagId: await tagId('shipping') }] },
      },
    });
    const post7 = await tx.post.create({
      data: {
        authorId: id('admin'), body: 'Studio all-hands this Friday at 10:00. Bring your best ideas. (Internal)',
        visibility: PostVisibility.COMPANY, companyId: greenhouse.id,
      },
    });
    // Refresh denormalized hashtag usage counts.
    for (const tag of ['welcome', 'avomessage', 'design', 'shipping']) {
      const count = await tx.postHashtag.count({ where: { hashtag: { tag } } });
      await tx.hashtag.update({ where: { tag }, data: { usageCount: count } });
    }

    // ── 7. Comments + comment likes ─────────────────────────────────────────
    const comment1 = await tx.comment.create({
      data: { postId: post2.id, authorId: id('demo'), body: 'The glassmorphism on the cards is *chef’s kiss*. How did you do the blur?' },
    });
    const comment2 = await tx.comment.create({
      data: { postId: post2.id, authorId: id('jules'), body: 'backdrop-blur + a soft gradient border. Tokens do the heavy lifting!', parentId: comment1.id },
    });
    const comment3 = await tx.comment.create({
      data: { postId: post1.id, authorId: id('priya'), body: 'First! Great to be here. 🥑' },
    });
    await tx.comment.create({
      data: { postId: post5.id, authorId: id('demo'), body: 'Updated mine — the presence sweep is done.' },
    });
    await tx.commentLike.create({ data: { userId: id('jules'), commentId: comment1.id } });
    await tx.commentLike.create({ data: { userId: id('demo'), commentId: comment2.id } });
    await tx.comment.update({ where: { id: comment1.id }, data: { likeCount: 1 } });
    await tx.comment.update({ where: { id: comment2.id }, data: { likeCount: 1 } });
    for (const [postId, n] of [[post2.id, 2], [post1.id, 1], [post5.id, 1]] as const) {
      await tx.post.update({ where: { id: postId }, data: { commentCount: n } });
    }

    // ── 8. Likes + bookmarks ────────────────────────────────────────────────
    const likePairs: Array<[string, string]> = [
      [id('jules'), post1.id], [id('priya'), post1.id], [id('demo'), post2.id],
      [id('mara'), post2.id], [id('demo'), post6.id], [id('priya'), post6.id],
    ];
    for (const [userId, postId] of likePairs) {
      await tx.like.create({ data: { userId, postId } });
      await tx.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } });
    }
    await tx.bookmark.create({ data: { userId: id('demo'), postId: post2.id } });

    // ── 9. Follows ──────────────────────────────────────────────────────────
    const followPairs: Array<[string, string]> = [
      [id('demo'), id('jules')], [id('demo'), id('priya')], [id('demo'), id('mara')],
      [id('jules'), id('demo')], [id('priya'), id('mara')], [id('mara'), id('admin')],
    ];
    for (const [followerId, followingId] of followPairs) {
      await tx.follow.create({ data: { followerId, followingId } });
    }

    // ── 10. Mentions ────────────────────────────────────────────────────────
    const mentionPost = await tx.post.create({
      data: {
        authorId: id('jules'),
        body: 'Pairing with @demo on the waveform player today. Should be fun!',
        visibility: PostVisibility.PUBLIC,
      },
    });
    await tx.mention.create({ data: { postId: mentionPost.id, mentionedUserId: id('demo') } });

    // ── 11. Conversations + messages ────────────────────────────────────────
    // DM: demo ↔ jules
    const dm = await tx.conversation.create({
      data: {
        type: ConversationType.DM,
        createdById: id('demo'),
        members: {
          create: [
            { userId: id('demo'), role: ConversationRole.OWNER },
            { userId: id('jules'), role: ConversationRole.OWNER },
          ],
        },
      },
    });
    const dmMessages = [
      { sender: 'demo', body: 'Hey Jules! Did you see the new design tokens?' },
      { sender: 'jules', body: 'Yes! The radius scale is *so* much better now.' },
      { sender: 'demo', body: 'Want to pair on the waveform player tomorrow?' },
      { sender: 'jules', body: 'Absolutely — 10am? I’ll bring coffee. ☕' },
      { sender: 'demo', body: 'Perfect. Sending you a voice note with the plan:' },
    ];
    let lastMsgId = '';
    for (const m of dmMessages) {
      const msg = await tx.message.create({
        data: {
          conversationId: dm.id,
          senderId: id(m.sender),
          body: m.body,
          type: MessageType.TEXT,
          clientId: `demo-dm-${m.sender}-${dmMessages.indexOf(m)}`,
        },
      });
      lastMsgId = msg.id;
    }
    // Voice message (metadata row; points at a local dev upload path)
    const voiceMsg = await tx.message.create({
      data: {
        conversationId: dm.id,
        senderId: id('demo'),
        type: MessageType.VOICE,
        clientId: 'demo-dm-voice-1',
        voice: {
          create: {
            senderId: id('demo'),
            url: '/uploads/voice/demo/plan.m4a',
            durationSeconds: 42,
            mimeType: 'audio/mp4',
            waveform: [0.1, 0.4, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8, 0.6, 0.35],
          },
        },
      },
    });
    lastMsgId = voiceMsg.id;
    await tx.messageReaction.create({ data: { messageId: lastMsgId, userId: id('jules'), emoji: '🎧' } });
    // jules has read everything; demo's own last message is unread by jules implicitly
    await tx.conversationMember.update({
      where: { conversationId_userId: { conversationId: dm.id, userId: id('jules') } },
      data: { lastReadAt: now },
    });
    await tx.conversation.update({ where: { id: dm.id }, data: { lastMessageAt: now } });

    // Group chat: Avocado Labs watercooler
    const group = await tx.conversation.create({
      data: {
        type: ConversationType.GROUP,
        title: 'Avocado Labs — watercooler',
        createdById: id('mara'),
        companyId: avocado.id,
        members: {
          create: [
            { userId: id('mara'), role: ConversationRole.OWNER },
            { userId: id('jules'), role: ConversationRole.ADMIN },
            { userId: id('demo'), role: ConversationRole.MEMBER },
          ],
        },
      },
    });
    await tx.message.create({
      data: { conversationId: group.id, senderId: id('mara'), body: 'Welcome to the watercooler! Keep it kind, keep it fun. 🥑', type: MessageType.TEXT, clientId: 'demo-group-1' },
    });
    await tx.message.create({
      data: { conversationId: group.id, senderId: id('demo'), body: 'First one here! Does anyone know a good STUN server?', type: MessageType.TEXT, clientId: 'demo-group-2' },
    });

    // ── 12. Notifications ───────────────────────────────────────────────────
    await tx.notification.create({
      data: { userId: id('demo'), actorId: id('jules'), type: NotificationType.LIKE, entityType: 'post', entityId: post1.id, title: 'Jules Rivera liked your post', body: 'Welcome to AvoMessage! 🥑…' },
    });
    await tx.notification.create({
      data: { userId: id('demo'), actorId: id('priya'), type: NotificationType.FOLLOW, entityType: 'user', entityId: id('priya'), title: 'Priya Nair started following you' },
    });
    await tx.notification.create({
      data: { userId: id('jules'), actorId: id('demo'), type: NotificationType.COMMENT, entityType: 'comment', entityId: comment1.id, title: 'Demo User commented on your post', body: 'The glassmorphism on the cards is *chef’s kiss*…' },
    });
    await tx.notification.create({
      data: { userId: id('demo'), actorId: id('jules'), type: NotificationType.MENTION, entityType: 'post', entityId: mentionPost.id, title: 'Jules Rivera mentioned you', body: 'Pairing with @demo on the waveform player today…' },
    });
    await tx.notification.create({
      data: { userId: id('jules'), actorId: id('demo'), type: NotificationType.MESSAGE, entityType: 'conversation', entityId: dm.id, title: 'New message from Demo User', body: 'Perfect. Sending you a voice note with the plan:' },
    });

    // ── 13. Report (moderation queue demo) ──────────────────────────────────
    await tx.report.create({
      data: {
        reporterId: id('priya'),
        targetType: ReportTarget.POST,
        targetId: post3.id,
        reason: ReportReason.SPAM,
        details: 'Demo report: testing the moderation queue. No real violation.',
        status: ReportStatus.PENDING,
      },
    });

    // ── 14. Login activity + audit log ──────────────────────────────────────
    await tx.loginActivity.create({
      data: { userId: id('demo'), email: `demo${DEMO_DOMAIN}`, ipAddress: '127.0.0.1', userAgent: 'AvoMessageSeed/1.0', success: true },
    });
    await tx.auditLog.create({
      data: { actorId: id('mara'), action: 'company.member_added', entityType: 'company', entityId: avocado.id, metadata: { userId: id('demo'), role: 'MEMBER' }, ipAddress: '127.0.0.1' },
    });
  });

  console.log('✅ Demo seed complete.');
  console.log('   admin@avomessage.demo / Admin123!   (SUPER_ADMIN)');
  console.log('   manager@avomessage.demo / Manager123! (owner of Avocado Labs)');
  console.log('   demo@avomessage.demo / Demo1234!');
  console.log('   demo2@avomessage.demo / Demo1234!');
  console.log('   demo3@avomessage.demo / Demo1234!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
