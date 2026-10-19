CREATE TABLE "AccountExportPin" (
 "jobId" TEXT NOT NULL REFERENCES "AccountExportJob"("id") ON DELETE CASCADE,
 "storageKey" TEXT NOT NULL, "size" INTEGER NOT NULL, "path" TEXT NOT NULL,
 PRIMARY KEY ("jobId", "storageKey")
);
CREATE INDEX "AccountExportPin_storageKey_idx" ON "AccountExportPin"("storageKey");
