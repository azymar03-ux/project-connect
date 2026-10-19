import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fixtureAccount } from "./fixtures";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = "http://localhost:3000/api/";
test.afterAll(() => db.$disconnect());
test("project/direct send replay is scoped, conflict-safe and forward catch-up covers over fifty messages", async () => {
  const a = await fixtureAccount(db, "delivery"),
    b = await fixtureAccount(db, "delivery-other");
  try {
    const p = await db.project.create({
      data: {
        title: "Delivery fixture project",
        description: "Private delivery validation project.",
        ownerId: a.user.id,
        tags: ["IoT"],
        requiredSkills: ["Python"],
        positions: ["Builder"],
        category: "IoT",
        city: "Test",
        members: { create: [{ userId: a.user.id, role: "Owner" }] },
      },
    });
    const path = base + `workspaces/${p.id}/messages`,
      requestId = randomUUID();
    const one = await (
      await a.ctx.post(path, { data: { content: "First", requestId } })
    ).json();
    const retry = await (
      await a.ctx.post(path, { data: { content: "First", requestId } })
    ).json();
    expect(retry.id).toBe(one.id);
    expect(
      (
        await a.ctx.post(path, { data: { content: "Different", requestId } })
      ).status(),
    ).toBe(409);
    await db.projectMessage.createMany({
      data: Array.from({ length: 125 }, (_, i) => ({
        projectId: p.id,
        senderId: a.user.id,
        content: `Gap ${i}`,
        createdAt: new Date(Date.now() + i + 1),
      })),
    });
    const page = await (
      await a.ctx.get(path + `?after=${one.id}&limit=100`)
    ).json();
    expect(page.items).toHaveLength(100);
    const rest = await (
      await a.ctx.get(path + `?after=${page.nextCursor}&limit=100`)
    ).json();
    expect(rest.items).toHaveLength(25);
    expect(rest.nextCursor).toBeNull();
    expect((await b.ctx.get(path + `?after=${one.id}`)).status()).toBe(403);
    const [low, high] = [a.user.id, b.user.id].sort();
    await db.connection.create({
      data: {
        senderId: a.user.id,
        receiverId: b.user.id,
        userLowId: low,
        userHighId: high,
        status: "Accepted",
      },
    });
    const dm = base + `messages/${b.user.id}`,
      id = randomUUID();
    const results = await Promise.all([
      a.ctx.post(dm, { data: { content: "DM replay", requestId: id } }),
      a.ctx.post(dm, { data: { content: "DM replay", requestId: id } }),
    ]);
    expect((await results[0].json()).id).toBe((await results[1].json()).id);
    await db.block.create({
      data: { blockerId: b.user.id, blockedId: a.user.id },
    });
    expect(
      (
        await a.ctx.post(dm, { data: { content: "DM replay", requestId: id } })
      ).status(),
    ).toBe(403);
  } finally {
    await db.project.deleteMany({ where: { ownerId: a.user.id } });
    await db.message.deleteMany({ where: { senderId: a.user.id } });
    await db.connection.deleteMany({ where: { senderId: a.user.id } });
    await db.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});
test("milestone title/date/delete operations are owner-scoped, audited and archive-safe", async () => {
  const a = await fixtureAccount(db, "milestone"),
    b = await fixtureAccount(db, "milestone-other");
  try {
    const p = await db.project.create({
      data: {
        title: "Milestone fixture",
        description: "Milestone lifecycle validation.",
        ownerId: a.user.id,
        tags: [],
        requiredSkills: [],
        positions: [],
        category: "IoT",
        city: "Test",
        members: {
          create: [{ userId: a.user.id, role: "Owner" }, { userId: b.user.id }],
        },
      },
    });
    const path = base + `workspaces/${p.id}/milestones`;
    const m = await (
      await a.ctx.post(path, { data: { title: "Initial milestone" } })
    ).json();
    expect(
      (
        await b.ctx.patch(path + "/" + m.id, {
          data: { title: "Not authorized" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await a.ctx.patch(path + "/" + m.id, {
          data: { title: "Updated milestone", dueDate: "2026-11-01T12:00:00Z" },
        })
      ).status(),
    ).toBe(200);
    await db.project.update({
      where: { id: p.id },
      data: { status: "Archived" },
    });
    expect((await a.ctx.delete(path + "/" + m.id)).status()).toBe(409);
    await db.project.update({
      where: { id: p.id },
      data: { status: "In progress" },
    });
    expect((await a.ctx.delete(path + "/" + m.id)).status()).toBe(200);
    expect(
      await db.auditEvent.count({
        where: { projectId: p.id, action: { startsWith: "milestone." } },
      }),
    ).toBe(3);
  } finally {
    await db.project.deleteMany({ where: { ownerId: a.user.id } });
    await db.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});
test("private activation rejects original credential, clears stale sessions and requires mailbox-chosen credential", async () => {
  test.skip(
    !process.env.FIXTURE_API_URL,
    "Dedicated private registration API required",
  );
  const url = process.env.FIXTURE_API_URL + "/api/",
    ctx = await request.newContext(),
    email = `activation-${randomUUID()}@example.com`;
  let id = "";
  try {
    await ctx.post(url + "auth/register", {
      data: {
        email,
        name: "Attacker supplied",
        password: "AttackerPassword2026!",
      },
    });
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    id = u.id;
    expect(u.activationRequired).toBe(true);
    expect(
      (
        await ctx.post(url + "auth/login", {
          data: { email, password: "AttackerPassword2026!" },
        })
      ).status(),
    ).toBe(401);
    const mail = await db.emailOutbox.findFirstOrThrow({
        where: { recipient: email },
      }),
      token = mail.body.match(/token=([a-f0-9]{64})/)![1];
    expect(
      (await ctx.post(url + "account/verify", { data: { token } })).status(),
    ).toBe(400);
    expect(
      (
        await ctx.post(url + "account/verify", {
          data: {
            token,
            name: "Mailbox owner",
            password: "AttackerPassword2026!",
          },
        })
      ).status(),
    ).toBe(400);
    const stale = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        userId: id,
        tokenHash: createHash("sha256").update(stale).digest("hex"),
        expiresAt: new Date(Date.now() + 100000),
      },
    });
    expect(
      (
        await ctx.post(url + "account/verify", {
          data: {
            token,
            name: "Mailbox owner",
            password: "MailboxPassword2026!",
          },
        })
      ).status(),
    ).toBe(201);
    expect(await db.session.count({ where: { userId: id } })).toBe(0);
    expect(
      (
        await ctx.post(url + "auth/login", {
          data: { email, password: "AttackerPassword2026!" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await ctx.post(url + "auth/login", {
          data: { email, password: "MailboxPassword2026!" },
        })
      ).status(),
    ).toBe(201);
  } finally {
    await db.emailOutbox.deleteMany({ where: { recipient: email } });
    if (id) await db.user.deleteMany({ where: { id } });
    await ctx.dispose();
  }
});
test("activation preserves incoming safety blocks and password reset cannot activate with a preregistration password", async () => {
  const a = await fixtureAccount(db, "legacy-activation"),
    b = await fixtureAccount(db, "safety-block");
  const token = randomBytes(32).toString("hex");
  try {
    await db.user.update({
      where: { id: a.user.id },
      data: { activationRequired: true, passwordSet: false },
    });
    await db.block.createMany({
      data: [
        { blockerId: b.user.id, blockedId: a.user.id },
        { blockerId: a.user.id, blockedId: b.user.id },
      ],
    });
    await db.accountToken.create({
      data: {
        userId: a.user.id,
        purpose: "reset",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    expect(
      (
        await a.ctx.post(base + "account/reset-password", {
          data: { token, password: "TestPassword2026!" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.post(base + "account/reset-password", {
          data: { token, password: "FreshIdentityPassword2026!" },
        })
      ).status(),
    ).toBe(201);
    expect(
      await db.block.count({
        where: { blockerId: b.user.id, blockedId: a.user.id },
      }),
    ).toBe(1);
    expect(await db.block.count({ where: { blockerId: a.user.id } })).toBe(0);
    expect(
      (
        await a.ctx.post(base + "auth/login", {
          data: { email: a.email, password: "TestPassword2026!" },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await db.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});
test("moderation and owner review page beyond the first batch without duplicate rows", async () => {
  const a = await fixtureAccount(db, "paged-admin");
  const prefix = "page-" + randomUUID();
  try {
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await db.report.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        reporterId: a.user.id,
        targetType: "user",
        targetId: prefix + i,
        reason: "Pagination fixture only",
      })),
    });
    await db.hardwareStore.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        submittedById: a.user.id,
        name: prefix + i,
        address: "Test",
        city: "Test",
        lat: 11,
        lng: 77,
        categories: [],
      })),
    });
    await db.adminAudit.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        actorId: a.user.id,
        action: "pagination.fixture",
        targetId: prefix + i,
        payload: {},
      })),
    });
    for (const path of [
      "admin/reports?paged=true",
      "stores/pending?paged=true",
      "admin/audit?",
    ]) {
      const first = await (await a.ctx.get(base + path)).json();
      expect(first.items).toHaveLength(50);
      expect(first.nextCursor).toBeTruthy();
      const next = await (
        await a.ctx.get(base + path + "&cursor=" + first.nextCursor)
      ).json();
      expect(next.items.length).toBeGreaterThan(0);
      expect(
        first.items.some((x: any) =>
          next.items.some((y: any) => x.id === y.id),
        ),
      ).toBe(false);
    }
    const p = await db.project.create({
      data: {
        title: prefix,
        description: "Owner review pagination fixture.",
        ownerId: a.user.id,
        tags: [],
        requiredSkills: [],
        positions: [],
        category: "IoT",
        city: "Test",
      },
    });
    await db.user.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        id: prefix + i,
        email: prefix + i + "@example.com",
        name: prefix + i,
        initials: "PG",
        passwordHash: "disabled-fixture",
        skills: [],
        interests: [],
      })),
    });
    await db.application.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        projectId: p.id,
        userId: prefix + i,
        message: "Pagination review fixture.",
      })),
    });
    const first = await (
      await a.ctx.get(base + "applications?paged=true")
    ).json();
    expect(first.items).toHaveLength(50);
    const second = await (
      await a.ctx.get(
        base + "applications?paged=true&cursor=" + first.nextCursor,
      )
    ).json();
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
  } finally {
    await db.project.deleteMany({ where: { ownerId: a.user.id } });
    await db.hardwareStore.deleteMany({ where: { submittedById: a.user.id } });
    await db.adminAudit.deleteMany({ where: { actorId: a.user.id } });
    await db.user.deleteMany({
      where: { OR: [{ id: a.user.id }, { id: { startsWith: prefix } }] },
    });
    await a.ctx.dispose();
  }
});
test("browser uncertain delivery retries the same message only once and catches a long polling gap", async ({
  page,
}) => {
  const a = await fixtureAccount(db, "retry-browser"),
    b = await fixtureAccount(db, "retry-peer");
  try {
    const [low, high] = [a.user.id, b.user.id].sort();
    await db.connection.create({
      data: {
        senderId: a.user.id,
        receiverId: b.user.id,
        userLowId: low,
        userHighId: high,
        status: "Accepted",
      },
    });
    await b.ctx.post(base + "messages/" + a.user.id, {
      data: { content: "Initial boundary" },
    });
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await expect(
      page.getByRole("button", { name: "Edit your profile", exact: true }),
    ).toBeVisible();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Messages", exact: true })
      .click();
    await page.getByRole("button", { name: new RegExp(b.user.name) }).click();
    await expect(page.locator(".message-bubble")).toHaveCount(1);
    let lost = false;
    await page.route("**/api/messages/" + b.user.id, async (route) => {
      if (route.request().method() === "POST" && !lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Uncertain delivery fixture");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry message", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Retry message", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("");
    expect(
      await db.message.count({
        where: {
          senderId: a.user.id,
          receiverId: b.user.id,
          content: "Uncertain delivery fixture",
        },
      }),
    ).toBe(1);
    await db.message.createMany({
      data: Array.from({ length: 125 }, (_, i) => ({
        senderId: b.user.id,
        receiverId: a.user.id,
        content: "Catchup gap " + i,
        createdAt: new Date(Date.now() + i + 1),
      })),
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".message-bubble")).toHaveCount(127, {
      timeout: 15000,
    });
  } finally {
    await db.message.deleteMany({
      where: { OR: [{ senderId: a.user.id }, { senderId: b.user.id }] },
    });
    await db.connection.deleteMany({ where: { senderId: a.user.id } });
    await db.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});
