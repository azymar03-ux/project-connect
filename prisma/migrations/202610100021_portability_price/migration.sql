CREATE TABLE "AccountExportJob" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "sessionHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
 "leaseUntil" TIMESTAMP(3), "artifactKey" TEXT UNIQUE, "artifactSize" INTEGER, "artifactSha256" TEXT,
 "errorCode" TEXT, "snapshotAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AccountExportJob_status_check" CHECK ("status" IN ('pending','building','ready','failed','expired'))
);
CREATE INDEX "AccountExportJob_userId_createdAt_idx" ON "AccountExportJob"("userId","createdAt");
CREATE INDEX "AccountExportJob_status_leaseUntil_idx" ON "AccountExportJob"("status","leaseUntil");
CREATE INDEX "AccountExportJob_expiresAt_idx" ON "AccountExportJob"("expiresAt");
ALTER TABLE "AiUsage" ADD COLUMN "reservedMicroUsd" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_reservedMicroUsd_check" CHECK ("reservedMicroUsd">=0);
