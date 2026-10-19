import { reserveBudget } from "../apps/api/src/core/ai-budget";
import {
  stageImage,
  claimImage,
  prepareImage,
} from "../apps/api/src/core/public-image";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixtureAccount } from "./fixtures";
import { cleanupStorage } from "../apps/api/src/core/storage-cleanup";
import { root } from "../apps/api/src/core/storage";
import {
  quotaIdentity,
  backfillQuota,
  drainQuota,
} from "../apps/api/src/core/ai-ledger";
import { reserveAssistant } from "../apps/api/src/core/assistant-state";
const db = new PrismaClient(),
  base = "http://localhost:3001/api/";
test.afterAll(() => db.$disconnect());
async function image() {
  return sharp({
    create: { width: 320, height: 200, channels: 3, background: "#3565a8" },
  })
    .jpeg()
    .withMetadata({
      exif: { IFD0: { Copyright: "private metadata sentinel" } },
    })
    .toBuffer();
}
async function project(userId: string) {
  return db.project.create({
    data: {
      ownerId: userId,
      title: "Image project fixture",
      description: "Image ownership and archive visibility fixture.",
      tags: [],
      requiredSkills: [],
      positions: [],
      category: "IoT",
      city: "Test",
      members: { create: { userId, role: "Owner" } },
    },
  });
}
async function clean(accounts: any[]) {
  const ids = accounts.map((a) => a.user.id);
  const projects = await db.project.findMany({
    where: { ownerId: { in: ids } },
    select: { coverImageId: true },
  });
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { avatarId: true },
  });
  const imageIds = [
    ...projects.map((p) => p.coverImageId),
    ...users.map((u) => u.avatarId),
  ].filter((id): id is string => !!id);
  const images = await db.publicImage.findMany({
    where: { id: { in: imageIds } },
    select: { storageKey: true },
  });
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.aiUsage.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.publicImage.deleteMany({ where: { id: { in: imageIds } } });
  if (images.length)
    await db.storageDeletion.createMany({ data: images, skipDuplicates: true });
  await cleanupStorage(1000);
  for (const a of accounts) await a.ctx.dispose();
}
test("avatar derivatives strip metadata, never expose object keys and obey blocking, suspension, replacement and cleanup", async () => {
  const a = await fixtureAccount(db, "avatar"),
    b = await fixtureAccount(db, "avatar-peer");
  try {
    const uploaded = await a.ctx.post(base + "account/avatar", {
      multipart: {
        file: {
          name: "misnamed.txt",
          mimeType: "text/plain",
          buffer: await image(),
        },
      },
    });
    expect(uploaded.status()).toBe(201);
    const value = await uploaded.json();
    const row = await db.publicImage.findUniqueOrThrow({
      where: { id: value.avatarId },
    });
    expect(JSON.stringify(value)).not.toContain(row.storageKey);
    const r = await a.ctx.get("http://localhost:3001" + value.url);
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const meta = await sharp(await r.body()).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([256, 256, "jpeg"]);
    expect(meta.exif).toBeUndefined();
    expect(
      await b.ctx
        .get("http://localhost:3001" + value.url)
        .then((r) => r.status()),
    ).toBe(200);
    const profile = await (await a.ctx.get(base + "me")).json();
    expect(profile.avatarId).toBe(value.avatarId);
    expect(JSON.stringify(profile)).not.toContain(row.storageKey);
    await db.storageDeletion.create({ data: { storageKey: row.storageKey } });
    await cleanupStorage(1000);
    expect((await stat(resolve(root, row.storageKey))).size).toBe(row.size);
    await db.block.create({
      data: { blockerId: a.user.id, blockedId: b.user.id },
    });
    expect(
      (await b.ctx.get("http://localhost:3001" + value.url)).status(),
    ).toBe(404);
    await db.user.update({
      where: { id: a.user.id },
      data: { suspendedAt: new Date() },
    });
    expect(
      (await b.ctx.get("http://localhost:3001" + value.url)).status(),
    ).toBe(404);
    await db.user.update({
      where: { id: a.user.id },
      data: { suspendedAt: null },
    });
    const next = await a.ctx.post(base + "account/avatar", {
      multipart: {
        file: {
          name: "avatar.jpg",
          mimeType: "image/jpeg",
          buffer: await image(),
        },
      },
    });
    expect(next.status()).toBe(201);
    expect(
      (await a.ctx.get("http://localhost:3001" + value.url)).status(),
    ).toBe(404);
    await cleanupStorage(1000);
    await expect(stat(resolve(root, row.storageKey))).rejects.toThrow();
    const second = await next.json();
    expect((await a.ctx.delete(base + "account/avatar")).status()).toBe(200);
    expect(
      (await a.ctx.get("http://localhost:3001" + second.url)).status(),
    ).toBe(404);
  } finally {
    await clean([a, b]);
  }
});
test("cover owner controls, archive audience, concept replacement and permanent deletion retire all bytes", async () => {
  const a = await fixtureAccount(db, "cover"),
    b = await fixtureAccount(db, "cover-peer");
  let p: any;
  try {
    p = await project(a.user.id);
    const data = {
      multipart: {
        file: {
          name: "cover.jpg",
          mimeType: "image/jpeg",
          buffer: await image(),
        },
      },
    };
    expect(
      (await b.ctx.post(base + `workspaces/${p.id}/cover`, data)).status(),
    ).toBe(403);
    const response = await a.ctx.post(base + `workspaces/${p.id}/cover`, data);
    expect(response.status()).toBe(201);
    const cover = await response.json();
    const row = await db.publicImage.findUniqueOrThrow({
      where: { id: cover.coverImageId },
    });
    const publicP = await (await b.ctx.get(base + `projects/${p.id}`)).json();
    expect(publicP.image).toBe(cover.url);
    expect(JSON.stringify(publicP)).not.toContain(row.storageKey);
    await db.project.update({
      where: { id: p.id },
      data: { status: "Archived" },
    });
    expect(
      (await b.ctx.get("http://localhost:3001" + cover.url)).status(),
    ).toBe(404);
    expect(
      (await a.ctx.get("http://localhost:3001" + cover.url)).status(),
    ).toBe(200);
    expect(
      (await a.ctx.post(base + `workspaces/${p.id}/cover`, data)).status(),
    ).toBe(409);
    await db.project.update({
      where: { id: p.id },
      data: { status: "In progress" },
    });
    expect(
      (
        await a.ctx.patch(base + `workspaces/${p.id}/project`, {
          data: { image: "/images/energy.svg" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await a.ctx.get("http://localhost:3001" + cover.url)).status(),
    ).toBe(404);
    const again = await (
      await a.ctx.post(base + `workspaces/${p.id}/cover`, data)
    ).json();
    const second = await db.publicImage.findUniqueOrThrow({
      where: { id: again.coverImageId },
    });
    await db.project.update({
      where: { id: p.id },
      data: { status: "Archived" },
    });
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/project`, {
          data: { confirmTitle: p.title },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await a.ctx.get("http://localhost:3001" + again.url)).status(),
    ).toBe(404);
    await cleanupStorage(1000);
    await expect(stat(resolve(root, second.storageKey))).rejects.toThrow();
  } finally {
    await clean([a, b]);
  }
});
test("malformed, SVG, APNG and over-pixel uploads are rejected without publishing objects", async () => {
  const a = await fixtureAccount(db, "image-invalid");
  try {
    const count = await db.publicImage.count();
    const huge = await sharp({
      create: { width: 5000, height: 4000, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    const actl = Buffer.alloc(20);
    actl.writeUInt32BE(8, 0);
    actl.write("acTL", 4);
    actl.writeUInt32BE(2, 8);
    const apng = Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]);
    for (const buffer of [
      apng,
      Buffer.from('<svg onload="alert(1)"/>'),
      Buffer.from([255, 216, 255, 1, 2]),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      huge,
    ]) {
      expect(
        (
          await a.ctx.post(base + "account/avatar", {
            multipart: {
              file: { name: "avatar.png", mimeType: "image/png", buffer },
            },
          })
        ).status(),
      ).toBe(400);
    }
    expect(
      (
        await a.ctx.post(base + "account/avatar", {
          multipart: {
            file: {
              name: "huge.jpg",
              mimeType: "image/jpeg",
              buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
            },
          },
        })
      ).status(),
    ).toBe(413);
    expect(await db.publicImage.count()).toBe(count);
    expect((await a.ctx.get(base + "images/%2e%2e%2fprivate")).status()).toBe(
      404,
    );
  } finally {
    await clean([a]);
  }
});
test("paginated export covers more than one page, enforces session/section cursor binding and omits secrets", async () => {
  const a = await fixtureAccount(db, "export"),
    b = await fixtureAccount(db, "export-peer");
  try {
    await db.message.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        senderId: a.user.id,
        receiverId: b.user.id,
        content: "Export row " + i,
      })),
    });
    await db.message.create({
      data: {
        senderId: b.user.id,
        receiverId: a.user.id,
        content: "Private incoming sentinel",
      },
    });
    const manifest = await (
      await a.ctx.get(base + "account/export/sections")
    ).json();
    expect(manifest.sections).toContain("assistantTurns");
    const first = await (
      await a.ctx.get(
        base + "account/export/page?section=sentMessages&limit=100",
      )
    ).json();
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBeTruthy();
    const query = "&cursor=" + encodeURIComponent(first.nextCursor);
    expect(
      (
        await b.ctx.get(
          base + "account/export/page?section=sentMessages" + query,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.get(base + "account/export/page?section=projects" + query)
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.get(
          base +
            "account/export/page?section=sentMessages&cursor=" +
            encodeURIComponent(first.nextCursor + "x"),
        )
      ).status(),
    ).toBe(400);
    const second = await (
      await a.ctx.get(
        base + "account/export/page?section=sentMessages&limit=100" + query,
      )
    ).json();
    const third = await (
      await a.ctx.get(
        base +
          "account/export/page?section=sentMessages&limit=100&cursor=" +
          encodeURIComponent(second.nextCursor),
      )
    ).json();
    const rows = [...first.items, ...second.items, ...third.items];
    expect(rows).toHaveLength(205);
    expect(new Set(rows.map((r) => r.id)).size).toBe(205);
    expect(third.nextCursor).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Private incoming sentinel");
    for (const section of manifest.sections) {
      const r = await a.ctx.get(
        base + "account/export/page?section=" + section + "&download=true",
      );
      expect(r.status()).toBe(200);
      expect(r.headers()["cache-control"]).toContain("no-store");
      expect(r.headers()["content-disposition"]).toContain("attachment");
      const text = JSON.stringify(await r.json());
      for (const forbidden of [
        "passwordHash",
        "tokenHash",
        "storageKey",
        "identityHash",
        "leaseExpiresAt",
      ])
        expect(text).not.toContain(forbidden);
    }
    expect(
      (
        await a.ctx.get(base + "account/export/page?section=passwordHash")
      ).status(),
    ).toBe(400);
  } finally {
    await db.message.deleteMany({
      where: { senderId: { in: [a.user.id, b.user.id] } },
    });
    await clean([a, b]);
  }
});
test("bounded quota backfill is durable and idempotent, fails closed before reconciliation and retains legacy identity on account deletion", async () => {
  const a = await fixtureAccount(db, "legacy-quota");
  let usageIds: string[] = [];
  try {
    const conversation = await db.aiConversation.create({
      data: { userId: a.user.id, title: "Legacy quota" },
    });
    // Hold the same durable lock as the background worker while asserting the
    // unledgered transition. A live worker is allowed to reconcile immediately.
    const old = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${a.user.id} FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(984513)::text`;
      const row = await tx.aiPlan.create({
        data: {
          userId: a.user.id,
          prompt: "Legacy private sentinel",
          source: "llm",
          plan: {},
        },
      });
      await expect(reserveBudget(tx, a.user.id)).rejects.toThrow(
        "reconciliation",
      );
      const result = await backfillQuota(tx, new Date(), a.user.id, 1);
      expect(result.processed).toBe(1);
      expect(
        (await backfillQuota(tx, new Date(), a.user.id, 1)).processed,
      ).toBe(0);
      return row;
    });
    usageIds.push(old.id);
    await drainQuota();
    expect(await db.aiUsage.count({ where: { id: old.id } })).toBe(1);
    const legacy = await db.aiTurn.create({
      data: {
        userId: a.user.id,
        conversationId: conversation.id,
        requestId: randomUUID(),
        prompt: "Legacy turn",
        content: "Private legacy content",
        status: "completed",
        source: "llm",
        reservedTokens: 14000,
        actualTokens: 15000,
        leaseExpiresAt: new Date(),
      },
    });
    usageIds.push(legacy.id);
    const uploaded = await (
      await a.ctx.post(base + "account/avatar", {
        multipart: {
          file: {
            name: "avatar.jpg",
            mimeType: "image/jpeg",
            buffer: await image(),
          },
        },
      })
    ).json();
    const imageRow = await db.publicImage.findUniqueOrThrow({
      where: { id: uploaded.avatarId },
    });
    expect(
      (
        await a.ctx.delete(base + "account", {
          data: { password: "TestPassword2026!" },
        })
      ).status(),
    ).toBe(200);
    const ledger = await db.aiUsage.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    expect(ledger.identityHash).toBe(quotaIdentity(a.email));
    expect(ledger.userId).toBe("deleted-user");
    expect(ledger.reservedTokens).toBe(15000);
    expect(await db.aiTurn.findUnique({ where: { id: legacy.id } })).toBeNull();
    expect(
      await db.publicImage.findUnique({ where: { id: uploaded.avatarId } }),
    ).toBeNull();
    await cleanupStorage(1000);
    await expect(
      readFile(resolve(root, imageRow.storageKey)),
    ).rejects.toThrow();
  } finally {
    await db.aiUsage.deleteMany({ where: { id: { in: usageIds } } });
    await clean([a]);
  }
});
test("browser uploads/removes an avatar and downloads all pages of a chosen export section", async ({
  page,
}) => {
  const a = await fixtureAccount(db, "upload-browser");
  try {
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await page
      .getByRole("button", { name: "Edit your profile", exact: true })
      .click();
    await page.getByLabel("Profile photo", { exact: true }).setInputFiles({
      name: "avatar.jpg",
      mimeType: "image/jpeg",
      buffer: await image(),
    });
    await expect(
      page.getByRole("button", { name: "Remove profile photo", exact: true }),
    ).toBeVisible();
    const avatar = await db.user.findUniqueOrThrow({
      where: { id: a.user.id },
    });
    expect(avatar.avatarId).toBeTruthy();
    await page
      .getByRole("button", { name: "Remove profile photo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Remove profile photo", exact: true }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .first()
      .click();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Settings & profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Choose export section", exact: true })
      .click();
    await expect(
      page.getByLabel("Export section", { exact: true }),
    ).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download first page", exact: true })
      .click();
    expect((await download).suggestedFilename()).toContain(
      "projectconnect-profile-page-1",
    );
    await expect(
      page.getByText("Section complete: 1 page(s) downloaded.", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await clean([a]);
  }
});

test("concurrent avatar replacements and terminal cleanup claims cannot publish missing objects", async () => {
  const a = await fixtureAccount(db, "avatar-race");
  try {
    const bytes = await image();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        a.ctx.post(base + "account/avatar", {
          multipart: {
            file: { name: "photo.jpg", mimeType: "image/jpeg", buffer: bytes },
          },
        }),
      ),
    );
    for (const r of results) expect(r.status()).toBe(201);
    expect(
      await db.publicImage.count({ where: { user: { id: a.user.id } } }),
    ).toBe(1);
    const current = await db.user.findUniqueOrThrow({
      where: { id: a.user.id },
    });
    for (const r of results) {
      const v = await r.json();
      expect((await a.ctx.get("http://localhost:3001" + v.url)).status()).toBe(
        v.avatarId === current.avatarId ? 200 : 404,
      );
    }
    const prepared = await prepareImage(
      { buffer: bytes, size: bytes.length } as any,
      "avatar",
    );
    const key = await stageImage(prepared.buffer);
    await db.storageDeletion.update({
      where: { storageKey: key },
      data: { state: "deleting", dueAt: new Date() },
    });
    await expect(
      db.$transaction((tx) => claimImage(tx, key, "avatar", prepared)),
    ).rejects.toThrow("expired");
    await cleanupStorage(1000);
    await expect(stat(resolve(root, key))).rejects.toThrow();
  } finally {
    await clean([a]);
  }
});

test("reconciliation racing account deletion preserves identity counters without orphan content", async () => {
  const a = await fixtureAccount(db, "quota-race");
  const ids: string[] = [];
  try {
    await db.aiPlan.createMany({
      data: Array.from({ length: 24 }, () => ({
        userId: a.user.id,
        prompt: "Legacy race prompt",
        source: "llm",
        plan: {},
      })),
    });
    ids.push(
      ...(
        await db.aiPlan.findMany({
          where: { userId: a.user.id },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    const [_, deleted] = await Promise.all([
      drainQuota(),
      a.ctx.delete(base + "account", {
        data: { password: "TestPassword2026!" },
      }),
    ]);
    expect(deleted.status()).toBe(200);
    const rows = await db.aiUsage.findMany({ where: { id: { in: ids } } });
    expect(rows).toHaveLength(24);
    expect(
      rows.every(
        (r) =>
          r.userId === "deleted-user" &&
          r.identityHash === quotaIdentity(a.email),
      ),
    ).toBe(true);
    expect(await db.aiPlan.count({ where: { id: { in: ids } } })).toBe(0);
  } finally {
    await db.aiUsage.deleteMany({ where: { id: { in: ids } } });
    await clean([a]);
  }
});
test("project deletion materializes recent legacy quota before detaching the project audience", async () => {
  const a = await fixtureAccount(db, "project-ledger");
  const ids: string[] = [];
  try {
    const p = await project(a.user.id);
    const c = await db.aiConversation.create({
      data: { userId: a.user.id, projectId: p.id, title: "Legacy project" },
    });
    const plan = await db.aiPlan.create({
      data: {
        userId: a.user.id,
        projectId: p.id,
        prompt: "Legacy project",
        source: "llm",
        plan: {},
      },
    });
    const turn = await db.aiTurn.create({
      data: {
        userId: a.user.id,
        conversationId: c.id,
        requestId: randomUUID(),
        prompt: "Legacy turn",
        status: "completed",
        source: "llm",
        leaseExpiresAt: new Date(),
      },
    });
    ids.push(plan.id, turn.id);
    await db.project.update({
      where: { id: p.id },
      data: { status: "Archived" },
    });
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/project`, {
          data: { confirmTitle: p.title },
        })
      ).status(),
    ).toBe(200);
    const rows = await db.aiUsage.findMany({ where: { id: { in: ids } } });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) =>
          r.projectId === null && r.identityHash === quotaIdentity(a.email),
      ),
    ).toBe(true);
  } finally {
    await db.aiUsage.deleteMany({ where: { id: { in: ids } } });
    await clean([a]);
  }
});

test("expired legacy sources leave the indexed reconciliation queue without recreating expired identities", async () => {
  const a = await fixtureAccount(db, "expired-ledger");
  let id = "";
  try {
    const p = await db.aiPlan.create({
      data: {
        userId: a.user.id,
        prompt: "Old private content",
        source: "deleted",
        plan: {},
        createdAt: new Date(Date.now() - 72 * 3600000),
      },
    });
    id = p.id;
    await drainQuota();
    expect(
      (await db.aiPlan.findUniqueOrThrow({ where: { id } })).quotaLedgered,
    ).toBe(true);
    expect(await db.aiUsage.count({ where: { id } })).toBe(0);
  } finally {
    await clean([a]);
  }
});
