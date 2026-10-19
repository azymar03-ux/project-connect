CREATE TABLE "StorageScan" (
 "storageKey" TEXT PRIMARY KEY,
 size INTEGER NOT NULL CHECK(size >= 0 AND size <= 5242880),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','scanning','clean','development-unscanned','error','failed','quarantined')),
 sha256 TEXT CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
 "scannedAt" TIMESTAMP(3),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3),
 "errorCode" TEXT
);
CREATE INDEX "StorageScan_status_dueAt_idx" ON "StorageScan"(status,"dueAt");
INSERT INTO "StorageScan"("storageKey",size) SELECT "storageKey",size FROM "ProjectFile" UNION ALL SELECT "storageKey",size FROM "PublicImage";
ALTER TABLE "AccountExportPin" ADD COLUMN sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE "AccountExportPin" ALTER COLUMN sha256 DROP DEFAULT;
-- Old bundles have no retained safety pins; never let the new NOT EXISTS check succeed vacuously.
UPDATE "AccountExportJob" SET status='expired',"expiresAt"=CURRENT_TIMESTAMP,"leaseUntil"=NULL;
UPDATE "StorageDeletion" SET "dueAt"=CURRENT_TIMESTAMP WHERE "storageKey" IN (SELECT "artifactKey" FROM "AccountExportJob" WHERE "artifactKey" IS NOT NULL);
DELETE FROM "AccountExportPin";
