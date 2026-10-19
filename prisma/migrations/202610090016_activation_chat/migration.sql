-- Quarantine legacy unverified accounts: mailbox owner must set a fresh credential.
ALTER TABLE "User" ADD COLUMN "activationRequired" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "activationRequired"=true, "passwordSet"=false WHERE "emailVerifiedAt" IS NULL;
DELETE FROM "Session" WHERE "userId" IN (SELECT id FROM "User" WHERE "activationRequired");
UPDATE "AccountToken" SET "usedAt"=CURRENT_TIMESTAMP WHERE "usedAt" IS NULL AND "userId" IN (SELECT id FROM "User" WHERE "activationRequired");
ALTER TABLE "Message" ADD COLUMN "requestId" TEXT;
ALTER TABLE "ProjectMessage" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "Message_senderId_receiverId_requestId_key" ON "Message"("senderId","receiverId","requestId");
CREATE UNIQUE INDEX "ProjectMessage_projectId_senderId_requestId_key" ON "ProjectMessage"("projectId","senderId","requestId");
CREATE INDEX "Message_senderId_receiverId_createdAt_id_idx" ON "Message"("senderId","receiverId","createdAt","id");
CREATE INDEX "ProjectMessage_projectId_createdAt_id_idx" ON "ProjectMessage"("projectId","createdAt","id");
