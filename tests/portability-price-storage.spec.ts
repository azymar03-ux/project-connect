import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, utimes, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { unzipSync, strFromU8 } from "fflate";
import { fixtureAccount } from "./fixtures";
import { processExportJob } from "../apps/api/src/core/export-job";
import { cleanupStorage } from "../apps/api/src/core/storage-cleanup";
import { scanBytes } from "../apps/api/src/core/file-scanner";
import { reconcileObjects } from "../apps/api/src/core/storage-inventory";
import { reservationMicroUsd } from "../apps/api/src/core/ai-price";
import { drainQuota } from "../apps/api/src/core/ai-ledger";
import { reserveBudget } from "../apps/api/src/core/ai-budget";
import { socialTransaction, lockUsers } from "../apps/api/src/core/security";
import { validateRuntimeConfig } from "../apps/api/src/core/runtime-config";
const db = new PrismaClient(),
  base = "http://localhost:3001/api/";
test.afterAll(() => db.$disconnect());
async function clean(a: Awaited<ReturnType<typeof fixtureAccount>>) {
  await db.accountExportJob.deleteMany({ where: { userId: a.user.id } });
  const files = await db.projectFile.findMany({
    where: { uploaderId: a.user.id },
    select: { storageKey: true },
  });
  await db.project.deleteMany({ where: { ownerId: a.user.id } });
  await db.user.delete({ where: { id: a.user.id } });
  for (const f of files)
    await unlink(resolve(".private-files", f.storageKey)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  await a.ctx.dispose();
}
test("coherent portability ZIP contains all sections and exact bytes, excludes foreign data, is session-bound and expires", async () => {
  const a = await fixtureAccount(db, "zip"),
    b = await fixtureAccount(db, "zip-other");
  let key: string | undefined;
  try {
    const p = await db.project.create({
      data: {
        ownerId: a.user.id,
        title: "Portability test",
        description: "Immutable upload snapshot",
        tags: [],
        requiredSkills: [],
        positions: [],
        category: "IoT",
        city: "Test",
        members: { create: { userId: a.user.id, role: "Owner" } },
      },
    });
    const content = Buffer.from("Original UTF8 attachment: Chennai தமிழ்நாடு"),
      uploaded = await a.ctx.post(base + `workspaces/${p.id}/files`, {
        multipart: {
          file: { name: "source.txt", mimeType: "text/plain", buffer: content },
        },
      });
    expect(uploaded.status()).toBe(201);
    const f = await uploaded.json();
    await db.notification.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        userId: a.user.id,
        kind: "fixture",
        title: `snapshot-${i}`,
      })),
    });
    await db.notification.create({
      data: {
        userId: b.user.id,
        kind: "fixture",
        title: "DO_NOT_EXPORT_FOREIGN",
      },
    });
    const queued = await a.ctx.post(base + "account/export/jobs");
    expect(queued.status()).toBe(201);
    const job = await queued.json();
    expect([409, 201]).toContain(
      (await a.ctx.post(base + "account/export/jobs")).status(),
    );
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
    const row = await db.accountExportJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    key = row.artifactKey!;
    expect(await db.accountExportPin.count({ where: { jobId: job.id } })).toBe(
      1,
    );
    const download = await a.ctx.get(
      base + `account/export/jobs/${job.id}/download`,
    );
    expect(download.status()).toBe(200);
    const bytes = await download.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      row.artifactSha256,
    );
    const zip = unzipSync(bytes),
      manifest = JSON.parse(strFromU8(zip["manifest.json"]));
    expect(manifest.snapshot).toBe(true);
    expect(manifest.sections).toHaveLength(23);
    expect(Buffer.from(zip[`attachments/${f.id}.bin`]).equals(content)).toBe(
      true,
    );
    expect(manifest.files[0].sha256).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    expect(
      strFromU8(zip["data/notifications.ndjson"]).trim().split("\n"),
    ).toHaveLength(205);
    expect(strFromU8(zip["data/notifications.ndjson"])).not.toContain(
      "DO_NOT_EXPORT_FOREIGN",
    );
    const profile = JSON.parse(strFromU8(zip["data/profile.ndjson"]).trim());
    expect(profile.email).toBe(a.email);
    expect(profile.passwordHash).toBeUndefined();
    expect(profile.sessions).toBeUndefined();
    expect(strFromU8(zip["manifest.json"])).not.toContain(key!);
    expect(
      (
        await b.ctx.get(base + `account/export/jobs/${job.id}/download`)
      ).status(),
    ).toBe(404);
    const marker = await db.storageDeletion.findUniqueOrThrow({
      where: { storageKey: key! },
    });
    await db.storageDeletion.update({
      where: { storageKey: key! },
      data: { dueAt: new Date(0) },
    });
    await cleanupStorage(100);
    expect((await readFile(resolve(".private-files", key!))).length).toBe(
      bytes.length,
    );
    await db.session.deleteMany({ where: { userId: a.user.id } });
    expect(
      (
        await a.ctx.get(base + `account/export/jobs/${job.id}/download`)
      ).status(),
    ).toBe(401);
    await db.accountExportJob.update({
      where: { id: job.id },
      data: { expiresAt: new Date(0) },
    });
    await db.storageDeletion.update({
      where: { storageKey: key! },
      data: { dueAt: new Date(0) },
    });
    await cleanupStorage(100);
    await expect(readFile(resolve(".private-files", key!))).rejects.toThrow();
  } finally {
    await clean(a);
    await clean(b);
    if (key)
      await unlink(resolve(".private-files", key)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
});
test("export queued under a revoked session fails closed and cannot publish bytes", async () => {
  const a = await fixtureAccount(db, "zip-revoke");
  try {
    const queued = await a.ctx.post(base + "account/export/jobs");
    expect(queued.status()).toBe(201);
    const job = await queued.json();
    await db.session.deleteMany({ where: { userId: a.user.id } });
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
    const row = await db.accountExportJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.errorCode).toBe("EXPORT_SESSION_REVOKED");
    expect(row.artifactKey).toBeNull();
  } finally {
    await clean(a);
  }
});
test("scanner INSTREAM preserves bytes; detected, incomplete and unavailable replies fail closed", async () => {
  const received: Buffer[] = [];
  let reply = "stream: OK\0";
  const server = createServer((socket) => {
    let input = Buffer.alloc(0),
      done = false;
    socket.on("error", () => {
      /* client intentionally closes rejected scanner responses */
    });
    socket.on("data", (part) => {
      if (done) return;
      input = Buffer.concat([input, part]);
      if (input.length < 10) return;
      let at = 10;
      const chunks: Buffer[] = [];
      for (;;) {
        if (at + 4 > input.length) return;
        const n = input.readUInt32BE(at);
        at += 4;
        if (n === 0) {
          done = true;
          received.push(Buffer.concat(chunks));
          socket.end(reply);
          return;
        }
        if (at + n > input.length) return;
        chunks.push(input.subarray(at, at + n));
        at += n;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  try {
    const env = {
        NODE_ENV: "production",
        CLAMD_HOST: "127.0.0.1",
        CLAMD_PORT: String(port),
      },
      bytes = Buffer.alloc(180000, 65);
    expect(await scanBytes(bytes, env)).toBe("clean");
    expect(received[0].equals(bytes)).toBe(true);
    reply = "stream: Eicar-Test-Signature FOUND\0";
    await expect(scanBytes(Buffer.from("bad"), env)).rejects.toThrow(
      "rejected",
    );
    reply = "stream: ERROR\0";
    await expect(scanBytes(Buffer.from("bad"), env)).rejects.toThrow(
      "could not verify",
    );
    reply = "truncated";
    await expect(scanBytes(Buffer.from("bad"), env)).rejects.toThrow(
      "Incomplete",
    );
    await expect(
      scanBytes(Buffer.from("x"), { NODE_ENV: "production" }),
    ).rejects.toThrow("not configured");
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
test("legacy object inventory is read-only unless applied, queues only aged recognized orphans and cleanup deletes only queued orphans", async () => {
  const old = randomBytes(24).toString("hex"),
    recent = randomBytes(24).toString("hex");
  await mkdir(".private-files", { recursive: true });
  await writeFile(resolve(".private-files", old), "orphan");
  const objects = [
    { key: old, size: 6, modifiedAt: new Date(Date.now() - 3 * 86400000) },
    { key: recent, size: 1, modifiedAt: new Date() },
    { key: "../../bad", size: 1, modifiedAt: new Date(0) },
  ];
  try {
    const dry = await reconcileObjects(objects);
    expect(dry).toMatchObject({
      orphaned: 1,
      recent: 1,
      unknown: 1,
      queued: 0,
    });
    expect(
      await db.storageDeletion.findUnique({ where: { storageKey: old } }),
    ).toBeNull();
    const applied = await reconcileObjects(objects, true);
    expect(applied.queued).toBe(1);
    expect((await readFile(resolve(".private-files", old))).toString()).toBe(
      "orphan",
    );
    await db.storageDeletion.update({
      where: { storageKey: old },
      data: { dueAt: new Date(0) },
    });
    await cleanupStorage(100);
    await expect(readFile(resolve(".private-files", old))).rejects.toThrow();
  } finally {
    await db.storageDeletion.deleteMany({ where: { storageKey: old } });
    await unlink(resolve(".private-files", old)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
});
test("price ceilings use integer rounding and production requires explicit model pricing", () => {
  expect(
    reservationMicroUsd(14000, {
      OPENAI_API_KEY: "fixture",
      AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION: "10000000",
    }),
  ).toBe(140000n);
  expect(
    reservationMicroUsd(1, {
      OPENAI_API_KEY: "fixture",
      AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION: "1",
    }),
  ).toBe(1n);
  expect(reservationMicroUsd(14000, {})).toBe(0n);
  expect(() =>
    validateRuntimeConfig({
      NODE_ENV: "production",
      OPENAI_API_KEY: "fixture",
      AI_QUOTA_SECRET: "x".repeat(32),
    }),
  ).toThrow("model");
});
test("AI price ledger serializes concurrent user reservations and enforces integer cost limits", async () => {
  const a = await fixtureAccount(db, "price");
  const names = [
      "OPENAI_API_KEY",
      "AI_USER_DAILY_MICROUSD_BUDGET",
      "AI_GLOBAL_DAILY_MICROUSD_BUDGET",
      "AI_PROJECT_DAILY_MICROUSD_BUDGET",
    ] as const,
    old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    process.env.OPENAI_API_KEY = "fixture";
    process.env.AI_USER_DAILY_MICROUSD_BUDGET = "140000";
    process.env.AI_GLOBAL_DAILY_MICROUSD_BUDGET = "1000000000";
    await drainQuota();
    const reserve = () =>
      socialTransaction(async (tx) => {
        await lockUsers(tx, a.user.id);
        const data = await reserveBudget(tx, a.user.id);
        return tx.aiUsage.create({ data });
      });
    const result = await Promise.allSettled([reserve(), reserve()]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
    const ledger = await db.aiUsage.findFirstOrThrow({
      where: { userId: a.user.id },
    });
    expect(ledger.reservedMicroUsd).toBe(140000n);
    await expect(reserve()).rejects.toThrow("cost budget");
  } finally {
    for (const n of names) {
      if (old[n] === undefined) delete process.env[n];
      else process.env[n] = old[n];
    }
    await db.aiUsage.deleteMany({ where: { userId: a.user.id } });
    await clean(a);
  }
});
test("sitemap partitions include people and public projects but never archived, suspended or pending identities", async () => {
  const a = await fixtureAccount(db, "sitemap");
  try {
    const common = {
      ownerId: a.user.id,
      description: "Sitemap visibility fixture",
      tags: [],
      requiredSkills: [],
      positions: [],
      category: "IoT",
      city: "Test",
    };
    const visible = await db.project.create({
        data: { ...common, title: "Visible sitemap" },
      }),
      archived = await db.project.create({
        data: { ...common, title: "Archived sitemap", status: "Archived" },
      });
    const parts = await (await a.ctx.get(base + "sitemaps/partitions")).json();
    expect(parts.some((p: any) => p.kind === "people")).toBe(true);
    const partition = parts.find(
      (p: any) =>
        p.kind === "projects" && p.first <= visible.id && p.last >= visible.id,
    );
    expect(partition).toBeTruthy();
    const path = base + "sitemaps/entries?" + new URLSearchParams(partition);
    let entries = await (await a.ctx.get(path)).json();
    expect(entries.items.some((p: any) => p.id === visible.id)).toBe(true);
    expect(entries.items.some((p: any) => p.id === archived.id)).toBe(false);
    await db.user.update({
      where: { id: a.user.id },
      data: { suspendedAt: new Date() },
    });
    const anonymous = await fetch(path);
    entries = await anonymous.json();
    expect(entries.items.some((p: any) => p.id === visible.id)).toBe(false);
    expect((await fetch("http://localhost:3000/sitemap.xml")).status).toBe(200);
  } finally {
    await clean(a);
  }
});

test("export pins preserve snapshot bytes when upload metadata is deleted between database snapshot and ZIP build", async () => {
  const a = await fixtureAccount(db, "zip-pin");
  let objectKey: string | undefined, artifactKey: string | undefined;
  try {
    const p = await db.project.create({
      data: {
        ownerId: a.user.id,
        title: "Snapshot before edit",
        description: "Snapshot pin deletion race",
        tags: [],
        requiredSkills: [],
        positions: [],
        category: "IoT",
        city: "Test",
        members: { create: { userId: a.user.id, role: "Owner" } },
      },
    });
    const bytes = Buffer.from("Pin must preserve these exact bytes");
    const upload = await a.ctx.post(base + `workspaces/${p.id}/files`, {
      multipart: {
        file: { name: "pin.txt", mimeType: "text/plain", buffer: bytes },
      },
    });
    expect(upload.status()).toBe(201);
    const f = await upload.json();
    objectKey = (
      await db.projectFile.findUniqueOrThrow({ where: { id: f.id } })
    ).storageKey;
    // Start this fixture in building state and keep the background replica fenced.
    const state = await a.ctx.storageState(),
      token = state.cookies.find((c) => c.name === "pc_session")!.value;
    const job = await db.accountExportJob.create({
      data: {
        userId: a.user.id,
        sessionHash: createHash("sha256").update(token).digest("hex"),
        status: "pending",
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    let hook = false;
    await processExportJob({
      afterSnapshot: async () => {
        hook = true;
        expect(
          await db.accountExportPin.count({ where: { jobId: job.id } }),
        ).toBe(1);
        await db.project.update({
          where: { id: p.id },
          data: { title: "Changed after snapshot" },
        });
        await db.projectFile.delete({ where: { id: f.id } });
        await db.storageDeletion.update({
          where: { storageKey: objectKey! },
          data: { dueAt: new Date(0) },
        });
        await cleanupStorage(1000);
        expect(
          (await readFile(resolve(".private-files", objectKey!))).equals(bytes),
        ).toBe(true);
      },
    });
    expect(hook).toBe(true);
    const row = await db.accountExportJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("ready");
    artifactKey = row.artifactKey!;
    const zip = unzipSync(
      await readFile(resolve(".private-files", artifactKey)),
    );
    expect(strFromU8(zip["data/projects.ndjson"])).toContain(
      "Snapshot before edit",
    );
    expect(strFromU8(zip["data/projects.ndjson"])).not.toContain(
      "Changed after snapshot",
    );
    expect(Buffer.from(zip[`attachments/${f.id}.bin`]).equals(bytes)).toBe(
      true,
    );
    await db.storageDeletion.update({
      where: { storageKey: objectKey! },
      data: { dueAt: new Date(0) },
    });
    await cleanupStorage(1000);
    await expect(
      readFile(resolve(".private-files", objectKey!)),
    ).rejects.toThrow();
  } finally {
    await clean(a);
    for (const key of [objectKey, artifactKey].filter(
      (k): k is string => !!k,
    )) {
      await unlink(resolve(".private-files", key)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      await db.storageDeletion.deleteMany({ where: { storageKey: key } });
    }
  }
});

test("priced budgets cover global/project audiences and mixed legacy rows without aggregate undercount", async () => {
  const a = await fixtureAccount(db, "price-scopes");
  const names = [
      "OPENAI_API_KEY",
      "AI_USER_DAILY_MICROUSD_BUDGET",
      "AI_GLOBAL_DAILY_MICROUSD_BUDGET",
      "AI_PROJECT_DAILY_MICROUSD_BUDGET",
    ] as const,
    old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  let projectId: string | undefined;
  try {
    process.env.OPENAI_API_KEY = "fixture";
    process.env.AI_USER_DAILY_MICROUSD_BUDGET = "1000000000";
    process.env.AI_GLOBAL_DAILY_MICROUSD_BUDGET = "1";
    await drainQuota();
    const reserve = (p?: string) =>
      socialTransaction(async (tx) => {
        await lockUsers(tx, a.user.id);
        return reserveBudget(tx, a.user.id, p);
      });
    await expect(reserve()).rejects.toThrow("Service AI cost");
    process.env.AI_GLOBAL_DAILY_MICROUSD_BUDGET = "1000000000";
    const p = await db.project.create({
      data: {
        ownerId: a.user.id,
        title: "Cost scope",
        description: "Budget fixture",
        tags: [],
        requiredSkills: [],
        positions: [],
        category: "IoT",
        city: "Test",
      },
    });
    projectId = p.id;
    process.env.AI_PROJECT_DAILY_MICROUSD_BUDGET = "1";
    await expect(reserve(p.id)).rejects.toThrow("Project AI cost");
    process.env.AI_PROJECT_DAILY_MICROUSD_BUDGET = "1000000000";
    // $0.30 old booked + $0.14 current-price legacy + $0.14 new = $0.58.
    // max(sum(booked),sum(repriced)) + new would incorrectly be $0.44.
    process.env.AI_USER_DAILY_MICROUSD_BUDGET = "500000";
    await db.aiUsage.createMany({
      data: [
        {
          userId: a.user.id,
          identityHash: "mixed-a",
          reservedTokens: 14000,
          reservedMicroUsd: 300000n,
        },
        {
          userId: a.user.id,
          identityHash: "mixed-b",
          reservedTokens: 14000,
          reservedMicroUsd: 0n,
        },
      ],
    });
    await expect(reserve()).rejects.toThrow("Daily AI cost");
  } finally {
    for (const n of names) {
      if (old[n] === undefined) delete process.env[n];
      else process.env[n] = old[n];
    }
    await db.aiUsage.deleteMany({ where: { userId: a.user.id } });
    await clean(a);
  }
});

test("cancelled exports retain daily quota tombstones and another user's cancellation is forbidden", async () => {
  const a = await fixtureAccount(db, "export-cancel"),
    b = await fixtureAccount(db, "export-cancel-other");
  try {
    const state = await a.ctx.storageState(),
      token = state.cookies.find((c) => c.name === "pc_session")!.value;
    const hash = createHash("sha256").update(token).digest("hex");
    const job = await db.accountExportJob.create({
      data: {
        userId: a.user.id,
        sessionHash: hash,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    expect(
      (await b.ctx.delete(base + `account/export/jobs/${job.id}`)).status(),
    ).toBe(404);
    expect(
      (await a.ctx.delete(base + `account/export/jobs/${job.id}`)).status(),
    ).toBe(200);
    expect(
      (await db.accountExportJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("expired");
    await db.accountExportJob.createMany({
      data: Array.from({ length: 2 }, () => ({
        id: randomBytes(12).toString("hex"),
        userId: a.user.id,
        sessionHash: hash,
        status: "expired",
        expiresAt: new Date(0),
      })),
    });
    expect((await a.ctx.post(base + "account/export/jobs")).status()).toBe(429);
  } finally {
    await clean(a);
    await clean(b);
  }
});
