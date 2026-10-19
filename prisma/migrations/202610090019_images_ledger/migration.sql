CREATE TABLE "PublicImage" (
 "id" TEXT PRIMARY KEY, "storageKey" TEXT NOT NULL UNIQUE, "kind" TEXT NOT NULL,
 "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "size" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PublicImage_kind_check" CHECK (kind IN ('avatar','cover')),
 CONSTRAINT "PublicImage_size_check" CHECK (size BETWEEN 1 AND 2097152)
);
ALTER TABLE "User" ADD COLUMN "avatarId" TEXT;
ALTER TABLE "Project" ADD COLUMN "coverImageId" TEXT;
CREATE UNIQUE INDEX "User_avatarId_key" ON "User"("avatarId");
CREATE UNIQUE INDEX "Project_coverImageId_key" ON "Project"("coverImageId");
ALTER TABLE "User" ADD CONSTRAINT "User_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "PublicImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "PublicImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiPlan" ADD COLUMN "quotaLedgered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiTurn" ADD COLUMN "quotaLedgered" BOOLEAN NOT NULL DEFAULT false;
UPDATE "AiPlan" p SET "quotaLedgered"=true WHERE p."createdAt"<CURRENT_TIMESTAMP-interval '48 hours' OR EXISTS (SELECT 1 FROM "AiUsage" u WHERE u.id=p.id);
UPDATE "AiTurn" t SET "quotaLedgered"=true WHERE t."createdAt"<CURRENT_TIMESTAMP-interval '48 hours' OR EXISTS (SELECT 1 FROM "AiUsage" u WHERE u.id=t.id);
CREATE INDEX "AiPlan_pending_quota_idx" ON "AiPlan"("createdAt",id) WHERE NOT "quotaLedgered";
CREATE INDEX "AiTurn_pending_quota_idx" ON "AiTurn"("createdAt",id) WHERE NOT "quotaLedgered";
