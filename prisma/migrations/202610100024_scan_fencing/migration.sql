ALTER TABLE "StorageScan" ADD COLUMN generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0);
ALTER TABLE "AccountExportPin" ADD CONSTRAINT "AccountExportPin_storageKey_fkey" FOREIGN KEY ("storageKey") REFERENCES "StorageScan"("storageKey") ON DELETE RESTRICT ON UPDATE CASCADE;
