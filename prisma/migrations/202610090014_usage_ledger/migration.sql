-- AlterTable
ALTER TABLE "AiTurn" ALTER COLUMN "reservedTokens" SET DEFAULT 14000;

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "units" INTEGER NOT NULL DEFAULT 1,
    "reservedTokens" INTEGER NOT NULL DEFAULT 14000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsage_identityHash_createdAt_idx" ON "AiUsage"("identityHash", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_projectId_createdAt_idx" ON "AiUsage"("projectId", "createdAt");

