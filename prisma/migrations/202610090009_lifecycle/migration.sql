-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "image" SET DEFAULT '/images/drone.svg';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "StorageDeletion" (
    "storageKey" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageDeletion_pkey" PRIMARY KEY ("storageKey")
);

-- CreateIndex
CREATE INDEX "StorageDeletion_dueAt_idx" ON "StorageDeletion"("dueAt");

