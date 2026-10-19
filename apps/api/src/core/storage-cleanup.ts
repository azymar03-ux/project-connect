import { db } from "./security";
import { removeObject } from "./storage";
// Keys are random, never reused. Claim is terminal for publishing: upload
// transactions must lock their pending marker before adding file metadata.
export async function cleanupStorage(limit = 10) {
  const rows = await db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<
      { storageKey: string; attempts: number }[]
    >`UPDATE "StorageDeletion" SET state='deleting',"dueAt"=now()+interval '10 minutes',attempts=attempts+1 WHERE "storageKey" IN (SELECT "storageKey" FROM "StorageDeletion" WHERE "dueAt"<=now() ORDER BY "dueAt" FOR UPDATE SKIP LOCKED LIMIT ${limit}) RETURNING "storageKey",attempts`;
    const result = [];
    for (const r of claimed) {
      const persistent =
        (await tx.projectFile.findUnique({
          where: { storageKey: r.storageKey },
        })) ||
        (await tx.publicImage.findUnique({
          where: { storageKey: r.storageKey },
        }));
      if (persistent) {
        // A later retirement recreates its marker; preserve immediate delete semantics.
        await tx.storageDeletion.delete({
          where: { storageKey: r.storageKey },
        });
        continue;
      }
      const pinned =
        (await tx.accountExportPin.findFirst({
          where: {
            storageKey: r.storageKey,
            job: {
              status: "building",
              leaseUntil: { gt: new Date() },
              expiresAt: { gt: new Date() },
            },
          },
        })) ||
        (await tx.accountExportJob.findFirst({
          where: {
            artifactKey: r.storageKey,
            status: "ready",
            expiresAt: { gt: new Date() },
          },
        }));
      if (pinned) {
        await tx.storageDeletion.update({
          where: { storageKey: r.storageKey },
          data: {
            state: "pending",
            dueAt: new Date(Date.now() + 60000),
            attempts: 0,
          },
        });
        continue;
      }
      result.push(r);
    }
    return result;
  });
  for (const row of rows) {
    try {
      await removeObject(row.storageKey);
      await db.$executeRaw`DELETE FROM "StorageScan" s WHERE s."storageKey"=${row.storageKey} AND NOT EXISTS (SELECT 1 FROM "ProjectFile" f WHERE f."storageKey"=s."storageKey") AND NOT EXISTS (SELECT 1 FROM "PublicImage" i WHERE i."storageKey"=s."storageKey") AND NOT EXISTS (SELECT 1 FROM "AccountExportPin" p WHERE p."storageKey"=s."storageKey")`;
      await db.storageDeletion.deleteMany({
        where: {
          storageKey: row.storageKey,
          state: "deleting",
          attempts: row.attempts,
        },
      });
    } catch {
      await db.storageDeletion.updateMany({
        where: { storageKey: row.storageKey, attempts: row.attempts },
        data: {
          dueAt: new Date(
            Date.now() +
              Math.min(86400000, 60000 * 2 ** Math.min(10, row.attempts)),
          ),
          lastError: "OBJECT_DELETE_FAILED",
        },
      });
    }
  }
  return rows.length;
}
export function startStorageWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupStorage();
    } catch {
      console.error(
        JSON.stringify({ level: "error", code: "STORAGE_CLEANUP_FAILURE" }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
}
