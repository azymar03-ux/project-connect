import { db } from "../apps/api/src/core/security";
import { processStorageScan } from "../apps/api/src/core/storage-scan";
// Operator-only CLI, no HTTP/manual clean override, no byte/name/signature logging.
async function main() {
  const apply = process.argv.includes("--apply"),
    run = process.argv.includes("--run");
  const statuses = [
    "pending",
    "error",
    "failed",
    "development-unscanned",
    ...(process.argv.includes("--include-clean") ? ["clean"] : []),
    ...(process.argv.includes("--include-quarantined") ? ["quarantined"] : []),
  ];
  try {
    if (run && (!apply || !process.env.CLAMD_HOST))
      throw Error("--run requires --apply and a configured private scanner");
    const before = await db.storageScan.groupBy({
      by: ["status"],
      _count: true,
    });
    let queued = 0;
    if (apply)
      queued =
        await db.$executeRaw`UPDATE "StorageScan" SET status='pending',generation=generation+1,attempts=0,"dueAt"=now(),"leaseUntil"=NULL,"errorCode"=NULL WHERE status=ANY(${statuses}::text[])`;
    let processed = 0;
    if (run)
      while (processed < 1000 && (await processStorageScan())) processed++;
    console.log(
      JSON.stringify({
        mode: apply ? "queued" : "dry-run",
        before,
        eligible: statuses,
        queued,
        processed,
        after: await db.storageScan.groupBy({ by: ["status"], _count: true }),
        note: "No quarantine bypass. Existing trusted digest is retained; changed bytes cannot be promoted. Run batches again for >1000 pending objects. Healthy daemon needed.",
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "FAILED");
  process.exitCode = 1;
});
