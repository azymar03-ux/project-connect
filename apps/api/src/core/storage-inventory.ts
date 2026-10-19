import { opendir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "./security";
import { client, root } from "./storage";
export type InventoryObject = { key: string; modifiedAt: Date; size: number };
// Dry-run by default. Only recognized immutable keys older than 48h can be queued.
// Existing deletion worker rechecks references; this tool never deletes bytes.
export async function reconcileObjects(
  objects: InventoryObject[],
  apply = false,
) {
  if (objects.length > 1000) throw Error("INVENTORY_PAGE_LIMIT");
  const result = {
    inspected: objects.length,
    referenced: 0,
    staged: 0,
    recent: 0,
    unknown: 0,
    orphaned: 0,
    queued: 0,
  };
  const eligible = objects.filter((o) => /^[a-f0-9]{48}$/.test(o.key));
  const keys = eligible.map((o) => o.key);
  const [files, images, markers, pins, jobs] = await Promise.all([
    db.projectFile.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    }),
    db.publicImage.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    }),
    db.storageDeletion.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    }),
    db.accountExportPin.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    }),
    db.accountExportJob.findMany({
      where: { artifactKey: { in: keys } },
      select: { artifactKey: true },
    }),
  ]);
  const references = new Set(
    [...files, ...images, ...pins]
      .map((o) => o.storageKey)
      .concat(jobs.flatMap((o) => (o.artifactKey ? [o.artifactKey] : []))),
  );
  const staged = new Set(markers.map((o) => o.storageKey));
  for (const o of objects) {
    if (!/^[a-f0-9]{48}$/.test(o.key)) {
      result.unknown++;
      continue;
    }
    if (references.has(o.key)) {
      result.referenced++;
      continue;
    }
    if (staged.has(o.key)) {
      result.staged++;
      continue;
    }
    if (
      !Number.isFinite(o.modifiedAt.getTime()) ||
      Date.now() - o.modifiedAt.getTime() < 48 * 3600000
    ) {
      result.recent++;
      continue;
    }
    result.orphaned++;
    if (apply) {
      await db.storageDeletion.upsert({
        where: { storageKey: o.key },
        create: { storageKey: o.key, dueAt: new Date(Date.now() + 3600000) },
        update: {},
      });
      result.queued++;
    }
  }
  return result;
}
export async function inventoryStorage(apply = false) {
  const totals = {
    pages: 0,
    inspected: 0,
    referenced: 0,
    staged: 0,
    recent: 0,
    unknown: 0,
    orphaned: 0,
    queued: 0,
  };
  const merge = async (page: InventoryObject[]) => {
    const result = await reconcileObjects(page, apply);
    totals.pages++;
    for (const key of Object.keys(result) as (keyof typeof result)[])
      totals[key] += result[key];
    console.log(JSON.stringify({ event: "inventory-page", ...result }));
  };
  if (process.env.S3_BUCKET) {
    let cursor: string | undefined;
    do {
      const page = await client().send(
        new ListObjectsV2Command({
          Bucket: process.env.S3_BUCKET,
          MaxKeys: 1000,
          ContinuationToken: cursor,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      await merge(
        (page.Contents || []).map((o) => ({
          key: o.Key || "",
          modifiedAt: o.LastModified || new Date(NaN),
          size: o.Size || 0,
        })),
      );
      if (page.IsTruncated && !page.NextContinuationToken)
        throw Error("INVENTORY_CURSOR_MISSING");
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (cursor);
  } else {
    const dir = await opendir(root);
    let page: InventoryObject[] = [];
    for await (const entry of dir) {
      // Don't follow symlinks, nested directories or touch unknown names.
      const stat = await lstat(resolve(root, entry.name));
      page.push({
        key: entry.isFile() ? entry.name : "unrecognized",
        modifiedAt: stat.mtime,
        size: stat.size,
      });
      if (page.length === 1000) {
        await merge(page);
        page = [];
      }
    }
    if (page.length) await merge(page);
  }
  return totals;
}
