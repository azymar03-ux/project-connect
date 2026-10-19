import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { HttpException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  mkdtemp,
  utimes,
  symlink,
  lstat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { fixtureAccount } from "./fixtures";
import {
  processStorageScan,
  byteHash,
  allowedScanStatus,
  exportPinsVerified,
} from "../apps/api/src/core/storage-scan";
import { processExportJob } from "../apps/api/src/core/export-job";
import { scavengeExportScratch } from "../apps/api/src/core/export-scratch";
import { publishObject } from "../apps/api/src/core/object-io";
const db = new PrismaClient(),
  base = "http://localhost:3001/api/";
test.afterAll(() => db.$disconnect());
async function fileFixture(label: string) {
  const a = await fixtureAccount(db, label);
  const project = await db.project.create({
    data: {
      ownerId: a.user.id,
      title: "Scan fixture",
      description: "Private disposable scan fixture",
      tags: [],
      requiredSkills: [],
      positions: [],
      category: "IoT",
      city: "Test",
      members: { create: { userId: a.user.id, role: "Owner" } },
    },
  });
  const key = randomBytes(24).toString("hex"),
    bytes = Buffer.from("Benign legacy attachment");
  await mkdir(resolve(".private-files"), { recursive: true });
  await writeFile(resolve(".private-files", key), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  const file = await db.projectFile.create({
    data: {
      projectId: project.id,
      uploaderId: a.user.id,
      name: "legacy.txt",
      size: bytes.length,
      mime: "text/plain",
      storageKey: key,
    },
  });
  await db.storageScan.create({
    data: { storageKey: key, size: bytes.length, dueAt: new Date(0) },
  });
  return {
    a,
    project,
    key,
    bytes,
    file,
    download: base + `workspaces/${project.id}/files/${file.id}/download`,
  };
}
async function clean(f: Awaited<ReturnType<typeof fileFixture>>) {
  const jobs = await db.accountExportJob.findMany({
    where: { userId: f.a.user.id },
  });
  await db.accountExportJob.deleteMany({ where: { userId: f.a.user.id } });
  await db.project.delete({ where: { id: f.project.id } });
  await db.user.delete({ where: { id: f.a.user.id } });
  await db.storageScan.deleteMany({ where: { storageKey: f.key } });
  await db.storageDeletion.deleteMany({
    where: {
      storageKey: {
        in: [
          f.key,
          ...jobs.flatMap((j) => (j.artifactKey ? [j.artifactKey] : [])),
        ],
      },
    },
  });
  for (const key of [
    f.key,
    ...jobs.flatMap((j) => (j.artifactKey ? [j.artifactKey] : [])),
  ])
    await rm(resolve(".private-files", key), { force: true });
  await f.a.ctx.dispose();
}
test("legacy pending bytes blocked; unavailable engine does not promote; clean scan unlocks; changed digest quarantines", async () => {
  const f = await fileFixture("scan-integrity");
  try {
    expect((await f.a.ctx.get(f.download)).status()).toBe(503);
    await processStorageScan({
      scanner: async () => {
        throw new HttpException("Unavailable fixture", 503);
      },
    });
    expect(
      (await db.storageScan.findUniqueOrThrow({ where: { storageKey: f.key } }))
        .status,
    ).toBe("error");
    await db.storageScan.update({
      where: { storageKey: f.key },
      data: { dueAt: new Date(0) },
    });
    await processStorageScan({ scanner: async () => "clean" });
    const response = await f.a.ctx.get(f.download);
    expect(response.status()).toBe(200);
    expect((await response.body()).equals(f.bytes)).toBe(true);
    await writeFile(
      resolve(".private-files", f.key),
      Buffer.alloc(f.bytes.length, 65),
    );
    expect((await f.a.ctx.get(f.download)).status()).toBe(503);
    const scan = await db.storageScan.findUniqueOrThrow({
      where: { storageKey: f.key },
    });
    expect(scan.status).toBe("quarantined");
    expect(scan.sha256).toBe(byteHash(f.bytes));
    await db.storageScan.update({
      where: { storageKey: f.key },
      data: { status: "pending", dueAt: new Date(0) },
    });
    await processStorageScan({ scanner: async () => "clean" });
    expect(
      (await db.storageScan.findUniqueOrThrow({ where: { storageKey: f.key } }))
        .status,
    ).toBe("quarantined");
  } finally {
    await clean(f);
  }
});
test("malware verdict quarantines, five scanner failures terminal; stale delayed worker cannot overwrite new generation", async () => {
  const f = await fileFixture("scan-fence");
  try {
    await processStorageScan({
      scanner: async () => {
        throw new HttpException("Malware fixture", 400);
      },
    });
    expect(
      (await db.storageScan.findUniqueOrThrow({ where: { storageKey: f.key } }))
        .status,
    ).toBe("quarantined");
    expect((await f.a.ctx.get(f.download)).status()).toBe(503);
    await db.storageScan.update({
      where: { storageKey: f.key },
      data: { status: "pending", attempts: 4, dueAt: new Date(0) },
    });
    await processStorageScan({
      scanner: async () => {
        throw Error("Offline");
      },
    });
    expect(
      (await db.storageScan.findUniqueOrThrow({ where: { storageKey: f.key } }))
        .status,
    ).toBe("failed");
    await db.storageScan.update({
      where: { storageKey: f.key },
      data: { status: "pending", dueAt: new Date(0) },
    });
    await processStorageScan({
      scanner: async () => {
        await db.storageScan.update({
          where: { storageKey: f.key },
          data: {
            status: "quarantined",
            generation: { increment: 1 },
            errorCode: "NEWER_VERDICT",
          },
        });
        return "clean";
      },
    });
    expect(
      (await db.storageScan.findUniqueOrThrow({ where: { storageKey: f.key } }))
        .errorCode,
    ).toBe("NEWER_VERDICT");
    expect(
      allowedScanStatus("development-unscanned", { NODE_ENV: "production" }),
    ).toBe(false);
  } finally {
    await clean(f);
  }
});
test("ZIP retains safety dependencies: later quarantine and missing pin deny previously ready download", async () => {
  const f = await fileFixture("scan-export");
  try {
    await processStorageScan({ scanner: async () => "clean" });
    const q = await f.a.ctx.post(base + "account/export/jobs"),
      job = await q.json();
    expect(q.status()).toBe(201);
    await processExportJob();
    await expect
      .poll(
        async () =>
          (
            await db.accountExportJob.findUniqueOrThrow({
              where: { id: job.id },
            })
          ).status,
        { timeout: 20000 },
      )
      .toBe("ready");
    expect(await exportPinsVerified(job.id)).toBe(true);
    const download = base + `account/export/jobs/${job.id}/download`;
    expect((await f.a.ctx.get(download)).status()).toBe(200);
    await db.storageScan.update({
      where: { storageKey: f.key },
      data: { status: "quarantined" },
    });
    expect((await f.a.ctx.get(download)).status()).toBe(404);
    await db.storageScan.update({
      where: { storageKey: f.key },
      data: { status: "clean" },
    });
    await db.accountExportPin.deleteMany({ where: { jobId: job.id } });
    expect(await exportPinsVerified(job.id)).toBe(false);
    expect((await f.a.ctx.get(download)).status()).toBe(404);
  } finally {
    await clean(f);
  }
});
test("snapshot refuses unverified file bytes and quarantined avatars are private even for owner", async () => {
  const f = await fileFixture("scan-public");
  let imageId: string | undefined;
  try {
    const q = await f.a.ctx.post(base + "account/export/jobs"),
      job = await q.json();
    await processExportJob();
    await expect
      .poll(
        async () =>
          (
            await db.accountExportJob.findUniqueOrThrow({
              where: { id: job.id },
            })
          ).status,
        { timeout: 20000 },
      )
      .toBe("failed");
    expect(
      (await db.accountExportJob.findUniqueOrThrow({ where: { id: job.id } }))
        .errorCode,
    ).toBe("EXPORT_OBJECT_UNVERIFIED");
    imageId = randomBytes(24).toString("base64url");
    await db.publicImage.create({
      data: {
        id: imageId,
        storageKey: f.key,
        kind: "avatar",
        width: 256,
        height: 256,
        size: f.bytes.length,
      },
    });
    await db.user.update({
      where: { id: f.a.user.id },
      data: { avatarId: imageId },
    });
    expect((await f.a.ctx.get(base + `images/${imageId}`)).status()).toBe(404);
    const list = await (
      await f.a.ctx.get(base + `workspaces/${f.project.id}/files`)
    ).json();
    expect(list[0].scanStatus).toBe("pending");
    expect(JSON.stringify(list)).not.toContain(f.key);
  } finally {
    await db.user.update({
      where: { id: f.a.user.id },
      data: { avatarId: null },
    });
    if (imageId) await db.publicImage.delete({ where: { id: imageId } });
    await clean(f);
  }
});
test("aged export crash scratch scavenger leaves fresh, unknown and symlink targets untouched; object collision never overwrites", async () => {
  const dir = await mkdtemp(resolve(".arena", "scratch-test-")),
    key = randomBytes(24).toString("hex");
  const now = Date.now(),
    old = resolve(dir, ".export-tmp-ABC123"),
    fresh = resolve(dir, ".export-tmp-DEF456"),
    unknown = resolve(dir, ".export-tmp-unrecognized-name"),
    link = resolve(dir, ".export-tmp-GHI789");
  try {
    for (const path of [old, fresh, unknown]) {
      await mkdir(path);
      await writeFile(resolve(path, "private.ndjson"), "fixture");
    }
    await utimes(old, new Date(0), new Date(0));
    await utimes(unknown, new Date(0), new Date(0));
    await symlink(unknown, link);
    expect(await scavengeExportScratch({ roots: [dir], now })).toBe(1);
    await expect(lstat(old)).rejects.toThrow();
    expect((await lstat(fresh)).isDirectory()).toBe(true);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(
      (await readFile(resolve(unknown, "private.ndjson"))).toString(),
    ).toBe("fixture");
    const src = resolve(".private-files", ".export-tmp-collision-test");
    await writeFile(src, "new", { flag: "wx" });
    await writeFile(resolve(".private-files", key), "original", { flag: "wx" });
    await expect(publishObject(key, src, 3)).rejects.toThrow();
    expect((await readFile(resolve(".private-files", key))).toString()).toBe(
      "original",
    );
    await rm(src);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(resolve(".private-files", key), { force: true });
  }
});

test("operations aggregate surfaces quarantine without private metadata; anonymous/non-admin cannot inspect it", async () => {
  const f = await fileFixture("scan-operations");
  try {
    await db.storageScan.update({
      where: { storageKey: f.key },
      data: { status: "quarantined" },
    });
    expect((await f.a.ctx.get(base + "admin/operations")).status()).toBe(403);
    await db.user.update({
      where: { id: f.a.user.id },
      data: { isAdmin: true },
    });
    const response = await f.a.ctx.get(base + "admin/operations"),
      body = await response.json();
    expect(response.status()).toBe(200);
    expect(body.quarantinedObjects).toBeGreaterThanOrEqual(1);
    expect(body.alerts.some((a: any) => a.code === "OBJECT_QUARANTINE")).toBe(
      true,
    );
    expect(JSON.stringify(body)).not.toContain(f.key);
    expect(JSON.stringify(body)).not.toContain(f.file.name);
    expect(JSON.stringify(body)).not.toContain(f.a.email);
  } finally {
    await clean(f);
  }
});
