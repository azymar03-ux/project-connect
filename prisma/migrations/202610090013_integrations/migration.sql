-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTurn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "requestId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "source" TEXT NOT NULL DEFAULT 'template',
    "reservedTokens" INTEGER NOT NULL DEFAULT 12000,
    "actualTokens" INTEGER,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChatRead" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "throughAt" TIMESTAMP(3) NOT NULL,
    "throughId" TEXT NOT NULL,

    CONSTRAINT "ProjectChatRead_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "GithubLink" (
    "projectId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "installationId" TEXT,
    "lastDeliveryAt" TIMESTAMP(3),

    CONSTRAINT "GithubLink_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "GithubDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiTurn_userId_createdAt_idx" ON "AiTurn"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiTurn_status_leaseExpiresAt_idx" ON "AiTurn"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiTurn_userId_requestId_key" ON "AiTurn"("userId", "requestId");

-- CreateIndex
CREATE INDEX "GithubDelivery_receivedAt_idx" ON "GithubDelivery"("receivedAt");

-- CreateIndex
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTurn" ADD CONSTRAINT "AiTurn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTurn" ADD CONSTRAINT "AiTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChatRead" ADD CONSTRAINT "ProjectChatRead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChatRead" ADD CONSTRAINT "ProjectChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubLink" ADD CONSTRAINT "GithubLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

