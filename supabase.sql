-- =============================================================================
-- AvoMessage - complete database schema for Supabase / PostgreSQL
-- =============================================================================
--
-- HOW TO RUN (once, on a brand new project)
--   1. Supabase Dashboard -> SQL Editor -> New query
--   2. Paste this whole file, press Run.
--   Or from a terminal:  psql "$DATABASE_URL" -f supabase.sql
--
-- বাংলা: Supabase-এর SQL Editor-এ এই ফাইলটা পুরোটা পেস্ট করে Run চাপলেই
--        ডাটাবেস সম্পূর্ণ তৈরি হয়ে যাবে। ভুলে দুইবার Run করলেও কোনো এরর আসবে না।
--
-- WHAT IT DOES
--   1. Creates every enum, table, index, primary key and foreign key the app
--      needs (5 migrations, 194 statements).
--   2. Every statement is guarded, so a second run is a no-op instead of an error.
--   3. Records the Prisma migration bookkeeping rows in "_prisma_migrations"
--      with the exact checksums Prisma expects, so a later
--      `npx prisma migrate deploy` reports "No pending migrations to apply"
--      rather than replaying the schema.
--   4. Enables Row Level Security on every table. See the last section: this is
--      what stops the Supabase anon/public API key from reading password hashes.
--
-- GENERATED FILE - do not edit by hand.
-- Regenerate with:  node scripts/build-supabase-sql.mjs
-- Source of truth:  prisma/migrations/*/migration.sql
-- =============================================================================


-- -----------------------------------------------------------------------------
-- migration 20261002175802_init  (159 statements)
-- checksum 7138e7ec52a47ede0c90ba2632809daf30e92fc5a7d2cf558822b137526ebdb4
-- -----------------------------------------------------------------------------

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PlatformRole' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CompanyRole' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'TeamRole' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "TeamRole" AS ENUM ('MANAGER', 'MEMBER');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PostVisibility' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "PostVisibility" AS ENUM ('PUBLIC', 'FOLLOWERS', 'COMPANY', 'PRIVATE');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ConversationType' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "ConversationType" AS ENUM ('DM', 'GROUP');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ConversationRole' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "ConversationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'MessageType' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'FILE', 'VOICE', 'SYSTEM');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'AttachmentKind' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'FILE', 'VOICE');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CallType' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "CallType" AS ENUM ('AUDIO', 'VIDEO');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'CallStatus' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "CallStatus" AS ENUM ('INITIATED', 'RINGING', 'ONGOING', 'ENDED', 'MISSED', 'DECLINED', 'FAILED');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PresenceStatus' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE', 'AWAY', 'DO_NOT_DISTURB', 'OFFLINE');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'NotificationType' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "NotificationType" AS ENUM ('LIKE', 'COMMENT', 'FOLLOW', 'MENTION', 'MESSAGE', 'CALL_MISSED', 'INVITATION_RECEIVED', 'INVITATION_ACCEPTED', 'COMPANY_ROLE_CHANGED', 'TEAM_ADDED', 'REPORT_STATUS', 'SYSTEM');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ReportTarget' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "ReportTarget" AS ENUM ('POST', 'COMMENT', 'MESSAGE', 'USER');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ReportReason' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_SPEECH', 'NUDITY_OR_SEXUAL', 'VIOLENCE', 'MISINFORMATION', 'COPYRIGHT', 'OTHER');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ReportStatus' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'ACTIONED', 'DISMISSED');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'InvitationStatus' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'TokenType' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "TokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
  END IF;
END
$avo$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "bio" VARCHAR(280),
    "website" TEXT,
    "location" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoginActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserPresence" (
    "userId" TEXT NOT NULL,
    "status" "PresenceStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPresence_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Follow" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","followingId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Block" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Mute" (
    "muterId" TEXT NOT NULL,
    "mutedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mute_pkey" PRIMARY KEY ("muterId","mutedId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Post" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "visibility" "PostVisibility" NOT NULL DEFAULT 'PUBLIC',
    "companyId" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PostMedia" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "parentId" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentLike_pkey" PRIMARY KEY ("userId","commentId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Like" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Bookmark" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Hashtag" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Hashtag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PostHashtag" (
    "postId" TEXT NOT NULL,
    "hashtagId" TEXT NOT NULL,

    CONSTRAINT "PostHashtag_pkey" PRIMARY KEY ("postId","hashtagId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Mention" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "mentionedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL DEFAULT 'DM',
    "title" TEXT,
    "avatarUrl" TEXT,
    "createdById" TEXT,
    "companyId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConversationMember" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ConversationRole" NOT NULL DEFAULT 'MEMBER',
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "body" VARCHAR(4000),
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "clientId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageReaction" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId","userId","emoji")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Attachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VoiceMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "waveform" JSONB,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Call" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "initiatorId" TEXT NOT NULL,
    "type" "CallType" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'INITIATED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CallParticipant" (
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("callId","userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "NotificationType" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "title" TEXT,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "likes" BOOLEAN NOT NULL DEFAULT true,
    "comments" BOOLEAN NOT NULL DEFAULT true,
    "follows" BOOLEAN NOT NULL DEFAULT true,
    "mentions" BOOLEAN NOT NULL DEFAULT true,
    "messages" BOOLEAN NOT NULL DEFAULT true,
    "invitations" BOOLEAN NOT NULL DEFAULT true,
    "announcements" BOOLEAN NOT NULL DEFAULT true,
    "calls" BOOLEAN NOT NULL DEFAULT true,
    "security" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "description" VARCHAR(1000),
    "website" TEXT,
    "ownerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompanyMember" (
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("companyId","userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Team" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Invitation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "email" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" "ReportTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(1000),
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VerificationToken_userId_type_idx" ON "VerificationToken"("userId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoginActivity_userId_createdAt_idx" ON "LoginActivity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoginActivity_ipAddress_createdAt_idx" ON "LoginActivity"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_authorId_createdAt_idx" ON "Post"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_companyId_createdAt_idx" ON "Post"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_visibility_createdAt_idx" ON "Post"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PostMedia_postId_sortOrder_idx" ON "PostMedia"("postId", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommentLike_commentId_idx" ON "CommentLike"("commentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Like_postId_idx" ON "Like"("postId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Bookmark_userId_createdAt_idx" ON "Bookmark"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Hashtag_tag_key" ON "Hashtag"("tag");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Hashtag_usageCount_idx" ON "Hashtag"("usageCount" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PostHashtag_hashtagId_idx" ON "PostHashtag"("hashtagId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Mention_mentionedUserId_createdAt_idx" ON "Mention"("mentionedUserId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Conversation_companyId_idx" ON "Conversation"("companyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConversationMember_userId_conversationId_idx" ON "ConversationMember"("userId", "conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Message_conversationId_clientId_key" ON "Message"("conversationId", "clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Attachment_messageId_idx" ON "Attachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VoiceMessage_messageId_key" ON "VoiceMessage"("messageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Call_initiatorId_startedAt_idx" ON "Call"("initiatorId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Call_conversationId_idx" ON "Call"("conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Company_slug_idx" ON "Company"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompanyMember_userId_idx" ON "CompanyMember"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Team_companyId_idx" ON "Team"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Team_companyId_name_key" ON "Team"("companyId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invitation_companyId_status_idx" ON "Invitation"("companyId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invitation_email_status_idx" ON "Invitation"("email", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Session_userId_fkey' AND conrelid = '"Session"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VerificationToken_userId_fkey' AND conrelid = '"VerificationToken"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LoginActivity_userId_fkey' AND conrelid = '"LoginActivity"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "LoginActivity" ADD CONSTRAINT "LoginActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'UserPresence_userId_fkey' AND conrelid = '"UserPresence"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "UserPresence" ADD CONSTRAINT "UserPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Follow_followerId_fkey' AND conrelid = '"Follow"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Follow_followingId_fkey' AND conrelid = '"Follow"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Block_blockerId_fkey' AND conrelid = '"Block"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Block_blockedId_fkey' AND conrelid = '"Block"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Mute_muterId_fkey' AND conrelid = '"Mute"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Mute" ADD CONSTRAINT "Mute_muterId_fkey" FOREIGN KEY ("muterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Mute_mutedId_fkey' AND conrelid = '"Mute"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Mute" ADD CONSTRAINT "Mute_mutedId_fkey" FOREIGN KEY ("mutedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Post_authorId_fkey' AND conrelid = '"Post"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Post_companyId_fkey' AND conrelid = '"Post"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Post" ADD CONSTRAINT "Post_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PostMedia_postId_fkey' AND conrelid = '"PostMedia"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Comment_postId_fkey' AND conrelid = '"Comment"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Comment_authorId_fkey' AND conrelid = '"Comment"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Comment_parentId_fkey' AND conrelid = '"Comment"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommentLike_userId_fkey' AND conrelid = '"CommentLike"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CommentLike_commentId_fkey' AND conrelid = '"CommentLike"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Like_userId_fkey' AND conrelid = '"Like"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Like_postId_fkey' AND conrelid = '"Like"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Like" ADD CONSTRAINT "Like_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Bookmark_userId_fkey' AND conrelid = '"Bookmark"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Bookmark_postId_fkey' AND conrelid = '"Bookmark"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PostHashtag_postId_fkey' AND conrelid = '"PostHashtag"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PostHashtag_hashtagId_fkey' AND conrelid = '"PostHashtag"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "PostHashtag" ADD CONSTRAINT "PostHashtag_hashtagId_fkey" FOREIGN KEY ("hashtagId") REFERENCES "Hashtag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Mention_postId_fkey' AND conrelid = '"Mention"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Mention" ADD CONSTRAINT "Mention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Mention_commentId_fkey' AND conrelid = '"Mention"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Mention" ADD CONSTRAINT "Mention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Mention_mentionedUserId_fkey' AND conrelid = '"Mention"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Mention" ADD CONSTRAINT "Mention_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Conversation_companyId_fkey' AND conrelid = '"Conversation"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ConversationMember_conversationId_fkey' AND conrelid = '"ConversationMember"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ConversationMember_userId_fkey' AND conrelid = '"ConversationMember"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Message_conversationId_fkey' AND conrelid = '"Message"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Message_senderId_fkey' AND conrelid = '"Message"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'MessageReaction_messageId_fkey' AND conrelid = '"MessageReaction"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'MessageReaction_userId_fkey' AND conrelid = '"MessageReaction"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Attachment_messageId_fkey' AND conrelid = '"Attachment"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VoiceMessage_messageId_fkey' AND conrelid = '"VoiceMessage"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "VoiceMessage" ADD CONSTRAINT "VoiceMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VoiceMessage_senderId_fkey' AND conrelid = '"VoiceMessage"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "VoiceMessage" ADD CONSTRAINT "VoiceMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Call_conversationId_fkey' AND conrelid = '"Call"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Call" ADD CONSTRAINT "Call_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Call_initiatorId_fkey' AND conrelid = '"Call"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Call" ADD CONSTRAINT "Call_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CallParticipant_callId_fkey' AND conrelid = '"CallParticipant"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CallParticipant_userId_fkey' AND conrelid = '"CallParticipant"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Notification_userId_fkey' AND conrelid = '"Notification"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Notification_actorId_fkey' AND conrelid = '"Notification"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'NotificationPreference_userId_fkey' AND conrelid = '"NotificationPreference"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Company_ownerId_fkey' AND conrelid = '"Company"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CompanyMember_companyId_fkey' AND conrelid = '"CompanyMember"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CompanyMember_userId_fkey' AND conrelid = '"CompanyMember"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Team_companyId_fkey' AND conrelid = '"Team"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Team" ADD CONSTRAINT "Team_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'TeamMember_teamId_fkey' AND conrelid = '"TeamMember"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'TeamMember_userId_fkey' AND conrelid = '"TeamMember"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Invitation_companyId_fkey' AND conrelid = '"Invitation"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Invitation_teamId_fkey' AND conrelid = '"Invitation"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Invitation_invitedById_fkey' AND conrelid = '"Invitation"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Report_reporterId_fkey' AND conrelid = '"Report"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Report_reviewerId_fkey' AND conrelid = '"Report"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AuditLog_actorId_fkey' AND conrelid = '"AuditLog"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;


-- -----------------------------------------------------------------------------
-- migration 20261002223418_add_join_requests_and_brand_color  (8 statements)
-- checksum 85940d8fb399c0890869af6ab107b9ab264f8ba89a91fce81798772d717b3f63
-- -----------------------------------------------------------------------------

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'JoinRequestStatus' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');
  END IF;
END
$avo$;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "brandColor" VARCHAR(7);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompanyJoinRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" VARCHAR(500),
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CompanyJoinRequest_companyId_status_idx" ON "CompanyJoinRequest"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyJoinRequest_companyId_userId_key" ON "CompanyJoinRequest"("companyId", "userId");

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CompanyJoinRequest_companyId_fkey' AND conrelid = '"CompanyJoinRequest"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CompanyJoinRequest" ADD CONSTRAINT "CompanyJoinRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CompanyJoinRequest_userId_fkey' AND conrelid = '"CompanyJoinRequest"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CompanyJoinRequest" ADD CONSTRAINT "CompanyJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CompanyJoinRequest_reviewedById_fkey' AND conrelid = '"CompanyJoinRequest"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "CompanyJoinRequest" ADD CONSTRAINT "CompanyJoinRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;


-- -----------------------------------------------------------------------------
-- migration 20261003093910_add_reply_forward_manager_applications  (14 statements)
-- checksum 65cde77d2f1a84ec28a87f25a26af95f66fc888cf6391a99138fecfced8f5d75
-- -----------------------------------------------------------------------------

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ManagerApplicationStatus' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "ManagerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN');
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'MANAGER_APPLICATION'
  ) THEN
    -- AlterEnum
    -- This migration adds more than one value to an enum.
    -- With PostgreSQL versions 11 and earlier, this is not possible
    -- in a single migration. This can be worked around by creating
    -- multiple migrations, each migration adding only one value to
    -- the enum.


    ALTER TYPE "NotificationType" ADD VALUE 'MANAGER_APPLICATION';
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'MANAGER_APPLICATION_DECISION'
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'MANAGER_APPLICATION_DECISION';
  END IF;
END
$avo$;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "forwardedFromId" TEXT,
ADD COLUMN IF NOT EXISTS "replyToId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ManagerApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "companyName" VARCHAR(120) NOT NULL,
    "position" VARCHAR(120) NOT NULL,
    "companySize" INTEGER NOT NULL DEFAULT 0,
    "teamCount" INTEGER NOT NULL DEFAULT 0,
    "teamSize" INTEGER NOT NULL DEFAULT 0,
    "message" VARCHAR(1000),
    "status" "ManagerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" VARCHAR(500),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ManagerApplication_status_createdAt_idx" ON "ManagerApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ManagerApplication_userId_status_idx" ON "ManagerApplication"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ManagerApplication_companyId_idx" ON "ManagerApplication"("companyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_replyToId_idx" ON "Message"("replyToId");

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Message_replyToId_fkey' AND conrelid = '"Message"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Message_forwardedFromId_fkey' AND conrelid = '"Message"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "Message" ADD CONSTRAINT "Message_forwardedFromId_fkey" FOREIGN KEY ("forwardedFromId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ManagerApplication_userId_fkey' AND conrelid = '"ManagerApplication"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "ManagerApplication" ADD CONSTRAINT "ManagerApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ManagerApplication_companyId_fkey' AND conrelid = '"ManagerApplication"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "ManagerApplication" ADD CONSTRAINT "ManagerApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ManagerApplication_reviewedById_fkey' AND conrelid = '"ManagerApplication"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "ManagerApplication" ADD CONSTRAINT "ManagerApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$avo$;


-- -----------------------------------------------------------------------------
-- migration 20261003161825_add_otp_challenges  (4 statements)
-- checksum baf9e37b30f7a6119a61a16e5497a51b4797af426658f859cda4a68128035382
-- -----------------------------------------------------------------------------

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'OtpPurpose' AND n.nspname = 'public'
  ) THEN
    -- CreateEnum
    CREATE TYPE "OtpPurpose" AS ENUM ('SIGNUP', 'COMPANY_MEMBER', 'COMPANY_MANAGER');
  END IF;
END
$avo$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "OtpChallenge" (
    "id" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtpChallenge_email_purpose_createdAt_idx" ON "OtpChallenge"("email", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");


-- -----------------------------------------------------------------------------
-- migration 20261008060000_add_push_nicknames  (9 statements)
-- checksum 90c759022bb17e2954ac353ac34aedced2e712613d346ab262174ada3603dcf0
-- -----------------------------------------------------------------------------

-- Web Push endpoints, per-group nicknames and private contact nicknames.
--
-- Three features, one migration because they ship in one deploy:
--
--   1. "PushSubscription" — the only way a notification can reach a user whose
--      tab is closed. See the model comment in prisma/schema.prisma.
--   2. "ConversationMember"."nickname" — a member's own label inside one
--      conversation. Nullable, so every existing row already means "no
--      nickname, use my real name" and no backfill is needed.
--   3. "ContactNickname" — the private, per-viewer rename of another user.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContactNickname" (
    "ownerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "nickname" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactNickname_pkey" PRIMARY KEY ("ownerId","targetId")
);

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN IF NOT EXISTS "nickname" VARCHAR(60);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContactNickname_targetId_idx" ON "ContactNickname"("targetId");

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PushSubscription_userId_fkey' AND conrelid = '"PushSubscription"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ContactNickname_ownerId_fkey' AND conrelid = '"ContactNickname"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "ContactNickname" ADD CONSTRAINT "ContactNickname_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;

DO $avo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ContactNickname_targetId_fkey' AND conrelid = '"ContactNickname"'::regclass
  ) THEN
    -- AddForeignKey
    ALTER TABLE "ContactNickname" ADD CONSTRAINT "ContactNickname_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$avo$;


-- =============================================================================
-- Prisma migration bookkeeping
-- =============================================================================
-- Prisma decides whether the schema is current by comparing the checksums in
-- this table against prisma/migrations/*/migration.sql. Writing the rows here
-- makes the SQL Editor run equivalent to `prisma migrate deploy`, so the CLI
-- will not try to replay DDL that already exists.
--
-- The checksums below are sha256 of each migration.sql, byte for byte - the same
-- values the local development database holds.

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36)  PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64)  NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
);


INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, '7138e7ec52a47ede0c90ba2632809daf30e92fc5a7d2cf558822b137526ebdb4', now(), '20261002175802_init', NULL, NULL, now(), 1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20261002175802_init'
);


INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, '85940d8fb399c0890869af6ab107b9ab264f8ba89a91fce81798772d717b3f63', now(), '20261002223418_add_join_requests_and_brand_color', NULL, NULL, now(), 1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20261002223418_add_join_requests_and_brand_color'
);


INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, '65cde77d2f1a84ec28a87f25a26af95f66fc888cf6391a99138fecfced8f5d75', now(), '20261003093910_add_reply_forward_manager_applications', NULL, NULL, now(), 1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20261003093910_add_reply_forward_manager_applications'
);


INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, 'baf9e37b30f7a6119a61a16e5497a51b4797af426658f859cda4a68128035382', now(), '20261003161825_add_otp_challenges', NULL, NULL, now(), 1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20261003161825_add_otp_challenges'
);


INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, '90c759022bb17e2954ac353ac34aedced2e712613d346ab262174ada3603dcf0', now(), '20261008060000_add_push_nicknames', NULL, NULL, now(), 1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20261008060000_add_push_nicknames'
);


-- =============================================================================
-- Row Level Security
-- =============================================================================
-- WHY THIS MATTERS. Supabase exposes the `public` schema over its REST API to
-- anyone holding the anon/public key - and that key is shipped to the browser.
-- With RLS switched off, that key can SELECT every row in the database,
-- including "User"."passwordHash" and every session row.
--
-- Enabling RLS with NO policies attached denies all access to non-owner roles
-- (anon, authenticated) while leaving the table OWNER untouched. Prisma connects
-- as the Supabase `postgres` role, which owns these tables, so the application
-- keeps full read/write access. Nothing in the app uses the Supabase client
-- libraries, so no policy is needed.
--
-- IMPORTANT: do not add FORCE ROW LEVEL SECURITY here. Forcing it would apply
-- RLS to the owner as well and lock the application out of its own tables.

DO $avo$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END
$avo$;


-- =============================================================================
-- Sanity check - the last result set is what the SQL Editor displays.
-- Expect: tables = 41 (40 app tables + _prisma_migrations), enums = 20,
--         foreign_keys = 64, migrations = 5,
--         tables_without_rls = 0
-- =============================================================================

SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE')                       AS tables,
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname = 'public')                                     AS enums,
    (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public')                                     AS foreign_keys,
    (SELECT count(*) FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL)            AS migrations,
    (SELECT count(*) FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = false)                                AS tables_without_rls;
