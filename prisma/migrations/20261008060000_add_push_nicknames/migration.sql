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
CREATE TABLE "PushSubscription" (
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
CREATE TABLE "ContactNickname" (
    "ownerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "nickname" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactNickname_pkey" PRIMARY KEY ("ownerId","targetId")
);

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN "nickname" VARCHAR(60);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "ContactNickname_targetId_idx" ON "ContactNickname"("targetId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactNickname" ADD CONSTRAINT "ContactNickname_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactNickname" ADD CONSTRAINT "ContactNickname_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
