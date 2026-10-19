ALTER TABLE "AccountExportJob" ADD COLUMN "expectedPinCount" INTEGER CHECK("expectedPinCount" IS NULL OR "expectedPinCount" BETWEEN 0 AND 10000);
-- A missing count never means a zero-object snapshot.
UPDATE "AccountExportJob" SET status='expired',"expiresAt"=CURRENT_TIMESTAMP,"leaseUntil"=NULL;
