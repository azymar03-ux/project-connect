import { root } from "./storage";
import { scavengeExportScratch } from "./export-scratch";
import {
  requireStoredScan,
  verifiedStoredBytes,
  exportPinsVerified,
} from "./storage-scan";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, appendFile } from "node:fs/promises";
import { openSync, closeSync, writeSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { Zip, ZipPassThrough } from "fflate";
import { db, lockUsers } from "./security";
import { exportDefinitions } from "./export-definitions";
import { publishObject } from "./object-io";
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_META = 64 * 1024 * 1024;
export async function validExportSession(
  userId: string,
  sessionHash: string,
  tx: Prisma.TransactionClient = db,
) {
  return Boolean(
    await tx.session.findFirst({
      where: {
        userId,
        tokenHash: sessionHash,
        expiresAt: { gt: new Date() },
        user: { suspendedAt: null, activationRequired: false },
      },
    }),
  );
}
export async function processExportJob(
  options: { afterSnapshot?: () => Promise<void> } = {},
) {
  const job = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(984514)::text`;
    const now = new Date();
    // This database-wide lease, not a process flag, fences all replicas.
    if (
      await tx.accountExportJob.count({
        where: { status: "building", leaseUntil: { gt: now } },
      })
    )
      return null;
    const next = await tx.accountExportJob.findFirst({
      where: {
        expiresAt: { gt: now },
        OR: [
          { status: "pending" },
          { status: "building", leaseUntil: { lt: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;
    await tx.accountExportPin.deleteMany({ where: { jobId: next.id } });
    return tx.accountExportJob.update({
      where: { id: next.id },
      data: {
        status: "building",
        attempts: { increment: 1 },
        leaseUntil: new Date(Date.now() + 180000),
      },
    });
  });
  if (!job) return false;
  let dir: string | undefined;
  const key = randomBytes(24).toString("hex"),
    deadline = Date.now() + 120000;
  const guard = async () => {
    if (Date.now() > deadline) throw Error("EXPORT_TIME_LIMIT");
    if (!(await validExportSession(job.userId, job.sessionHash)))
      throw Error("EXPORT_SESSION_REVOKED");
    if (
      !(await db.accountExportJob.count({
        where: {
          id: job.id,
          status: "building",
          attempts: job.attempts,
          leaseUntil: { gt: new Date() },
        },
      }))
    )
      throw Error("EXPORT_CANCELLED");
  };
  try {
    await guard();
    await mkdir(root, { recursive: true, mode: 0o700 });
    dir = await mkdtemp(resolve(root, ".export-tmp-"));
    const metadataPaths: string[] = [];
    let metadataSize = 0;
    const snapshotAt = await db.$transaction(
      async (tx) => {
        // DB snapshot and immutable byte pins are committed together. No network I/O.
        await lockUsers(tx, job.userId);
        const current = await tx.$queryRaw<
          { attempts: number; status: string }[]
        >`SELECT attempts,status FROM "AccountExportJob" WHERE id=${job.id} FOR UPDATE`;
        if (
          current[0]?.attempts !== job.attempts ||
          current[0]?.status !== "building"
        )
          throw Error("EXPORT_CANCELLED");
        if (!(await validExportSession(job.userId, job.sessionHash, tx)))
          throw Error("EXPORT_SESSION_REVOKED");
        const [{ now }] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT transaction_timestamp() AS now`;
        for (const [section, d] of Object.entries(exportDefinitions)) {
          const path = resolve(dir!, section + ".ndjson");
          await appendFile(path, "", { mode: 0o600 });
          metadataPaths.push(path);
          let after: string | undefined;
          for (;;) {
            if (Date.now() > deadline) throw Error("EXPORT_TIME_LIMIT");
            const rows: any[] = await (tx[d.model] as any).findMany({
              where: {
                AND: [
                  d.scope(job.userId),
                  ...(after ? [{ [d.field]: { gt: after } }] : []),
                ],
              },
              orderBy: { [d.field]: "asc" },
              take: 100,
              ...("select" in d ? { select: d.select } : {}),
            });
            if (!rows.length) break;
            const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
            metadataSize += Buffer.byteLength(text);
            if (metadataSize > MAX_META) throw Error("EXPORT_METADATA_LIMIT");
            await appendFile(path, text);
            after = rows.at(-1)[d.field];
          }
        }
        const pins: {
          storageKey: string;
          size: number;
          path: string;
          sha256: string;
        }[] = [];
        let after: string | undefined,
          total = 0;
        for (;;) {
          const rows = await tx.projectFile.findMany({
            where: {
              uploaderId: job.userId,
              project: { members: { some: { userId: job.userId } } },
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: "asc" },
            take: 100,
          });
          if (!rows.length) break;
          for (const f of rows) {
            total += f.size;
            if (total + metadataSize > MAX_BYTES || pins.length >= 10000)
              throw Error("EXPORT_SIZE_LIMIT");
            pins.push({
              storageKey: f.storageKey,
              sha256: await requireStoredScan(f.storageKey, undefined, tx),
              size: f.size,
              path: `attachments/${f.id}.bin`,
            });
          }
          after = rows.at(-1)!.id;
        }
        const images = await tx.publicImage.findMany({
          take: 10001,
          where: {
            OR: [
              { user: { id: job.userId } },
              { project: { ownerId: job.userId } },
            ],
          },
        });
        for (const image of images) {
          total += image.size;
          if (total + metadataSize > MAX_BYTES || pins.length >= 10000)
            throw Error("EXPORT_SIZE_LIMIT");
          pins.push({
            storageKey: image.storageKey,
            sha256: await requireStoredScan(image.storageKey, undefined, tx),
            size: image.size,
            path: `images/${image.id}.jpg`,
          });
        }
        pins.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
        for (const pin of pins) {
          await tx.storageDeletion.upsert({
            where: { storageKey: pin.storageKey },
            create: {
              storageKey: pin.storageKey,
              dueAt: new Date(Date.now() + 300000),
            },
            update: {},
          });
          const marker = await tx.$queryRaw<
            { state: string }[]
          >`SELECT state FROM "StorageDeletion" WHERE "storageKey"=${pin.storageKey} FOR UPDATE`;
          if (marker[0]?.state !== "pending")
            throw Error("EXPORT_OBJECT_RETIRING");
          await tx.accountExportPin.create({ data: { jobId: job.id, ...pin } });
        }
        await tx.accountExportJob.update({
          where: { id: job.id },
          data: { snapshotAt: now, expectedPinCount: pins.length },
        });
        return now;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60000,
        maxWait: 5000,
      },
    );
    if (options.afterSnapshot) await options.afterSnapshot();
    await guard();
    await db.storageDeletion.create({
      data: { storageKey: key, dueAt: new Date(Date.now() + 3600000) },
    });
    const zipPath = resolve(dir, "bundle.zip"),
      fd = openSync(zipPath, "wx", 0o600);
    let size = 0;
    const hash = createHash("sha256");
    const zip = new Zip((error, data) => {
      if (error) throw error;
      size += data.length;
      if (size > MAX_BYTES) throw Error("EXPORT_SIZE_LIMIT");
      hash.update(data);
      let offset = 0;
      while (offset < data.length) offset += writeSync(fd, data, offset);
    });
    function entry(name: string, bytes: Uint8Array) {
      const file = new ZipPassThrough(name);
      zip.add(file);
      file.push(bytes, true);
    }
    try {
      for (const path of metadataPaths) {
        await guard();
        const file = new ZipPassThrough(`data/${path.split("/").at(-1)}`);
        zip.add(file);
        for await (const bytes of createReadStream(path))
          file.push(bytes, false);
        file.push(new Uint8Array(), true);
      }
      const pins = await db.accountExportPin.findMany({
        where: { jobId: job.id },
      });
      const manifestFiles = [];
      for (const pin of pins) {
        await guard();
        const bytes = await verifiedStoredBytes(pin.storageKey, pin.size);
        if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
          throw Error("EXPORT_OBJECT_UNVERIFIED");
        entry(pin.path, bytes);
        manifestFiles.push({
          path: pin.path,
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
      entry(
        "manifest.json",
        Buffer.from(
          JSON.stringify(
            {
              version: 2,
              snapshot: true,
              snapshotAt,
              sections: Object.keys(exportDefinitions),
              files: manifestFiles,
              note: "Owner-scoped metadata; file bytes only for your uploads in current memberships, your avatar and owned covers. No received/private third-party message bodies or authentication secrets. NDJSON sections; attachments named by file ID. Limits: 64 MiB metadata, 256 MiB ZIP, 10000 objects, 120 seconds. ZIP expires in 24 hours and is bound to the requesting session.",
            },
            null,
            2,
          ),
        ),
      );
      zip.end();
    } finally {
      closeSync(fd);
    }
    await guard();
    await publishObject(key, zipPath, size);
    const sha256 = hash.digest("hex");
    await db.$transaction(async (tx) => {
      await lockUsers(tx, job.userId);
      const current = await tx.$queryRaw<
        { attempts: number; status: string }[]
      >`SELECT attempts,status FROM "AccountExportJob" WHERE id=${job.id} FOR UPDATE`;
      if (
        current[0]?.attempts !== job.attempts ||
        current[0]?.status !== "building"
      )
        throw Error("EXPORT_CANCELLED");
      if (!(await validExportSession(job.userId, job.sessionHash, tx)))
        throw Error("EXPORT_SESSION_REVOKED");
      if (!(await exportPinsVerified(job.id, tx, true)))
        throw Error("EXPORT_OBJECT_UNVERIFIED");
      const changed = await tx.accountExportJob.updateMany({
        where: {
          id: job.id,
          status: "building",
          attempts: job.attempts,
          leaseUntil: { gt: new Date() },
          expiresAt: { gt: new Date() },
        },
        data: {
          status: "ready",
          artifactKey: key,
          artifactSize: size,
          artifactSha256: sha256,
          leaseUntil: null,
        },
      });
      if (!changed.count) throw Error("EXPORT_CANCELLED");
      await tx.storageDeletion.update({
        where: { storageKey: key },
        data: { dueAt: job.expiresAt },
      });
      // Keep safety pins until job expiry/cancellation; cleanup only retains building bytes.
    });
  } catch (error) {
    const known = new Set([
      "EXPORT_TIME_LIMIT",
      "EXPORT_SIZE_LIMIT",
      "EXPORT_METADATA_LIMIT",
      "EXPORT_SESSION_REVOKED",
      "EXPORT_OBJECT_RETIRING",
      "EXPORT_CANCELLED",
      "EXPORT_OBJECT_UNVERIFIED",
    ]);
    const code =
      error instanceof Error && known.has(error.message)
        ? error.message
        : "EXPORT_BUILD_FAILED";
    await db.$transaction(async (tx) => {
      const changed = await tx.accountExportJob.updateMany({
        where: { id: job.id, status: "building", attempts: job.attempts },
        data: { status: "failed", errorCode: code, leaseUntil: null },
      });
      if (changed.count)
        await tx.accountExportPin.deleteMany({ where: { jobId: job.id } });
    });
    console.error(JSON.stringify({ level: "warn", code }));
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  return true;
}
export function startExportWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await scavengeExportScratch();
      await db.accountExportJob.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
          createdAt: { lt: new Date(Date.now() - 86400000) },
        },
      });
      await processExportJob();
    } catch {
      console.error(
        JSON.stringify({ level: "error", code: "EXPORT_WORKER_FAILED" }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 10000);
  timer.unref();
  void tick();
}
