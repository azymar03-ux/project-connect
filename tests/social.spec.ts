import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { fixtureAccount } from "./fixtures";
import { SharedLimiter, rateMiddleware } from "../apps/api/src/core/rate-limit";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
const db = new PrismaClient(),
  base = "http://localhost:3001/api/";
test.afterAll(() => db.$disconnect());
async function cleanup(as: any[]) {
  const ids = as.map((a) => a.user.id);
  await db.message.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.connection.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: as.map((a) => a.user.id) } } });
  for (const a of as) await a.ctx.dispose();
}
const projectData = {
  title: "Social integration project",
  description: "A private test fixture for public project update validation.",
  category: "IoT",
  tags: ["IoT"],
  requiredSkills: ["IoT"],
  positions: ["Developer"],
  city: "Test",
  remote: true,
  teamSize: 4,
};
test("follow idempotence, feed pagination, profile privacy, blocking and update permissions", async () => {
  const as = await Promise.all(
    ["social-owner", "social-reader", "social-outside"].map((l) =>
      fixtureAccount(db, l + "-" + randomUUID().slice(0, 5)),
    ),
  );
  const [o, r, x] = as;
  try {
    expect(
      (
        await o.ctx.patch(base + "me", {
          data: {
            name: o.user.name,
            role: "Builder",
            bio: "",
            city: "Test",
            skills: [],
            interests: [],
            education: "Test Institute",
            portfolioUrl: "https://example.com/portfolio",
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await o.ctx.patch(base + "me", {
          data: { portfolioUrl: "javascript:alert(1)" },
        })
      ).status(),
    ).toBe(400);
    const p = await (
      await o.ctx.post(base + "projects", { data: projectData })
    ).json();
    expect(
      (
        await x.ctx.post(base + `workspaces/${p.id}/updates`, {
          data: { content: "Unauthorized update" },
        })
      ).status(),
    ).toBe(403);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const response = await o.ctx.post(base + `workspaces/${p.id}/updates`, {
        data: { content: "Public milestone " + i },
      });
      expect(response.status()).toBe(201);
      ids.push((await response.json()).id);
    }
    const fs = await Promise.all(
      [1, 2].map(() =>
        r.ctx.post(base + "follows/" + o.user.id, { data: { enabled: true } }),
      ),
    );
    for (const f of fs) expect(f.status()).toBe(201);
    expect(
      await db.follow.count({
        where: { followerId: r.user.id, followingId: o.user.id },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { userId: o.user.id, kind: "follow", actorId: r.user.id },
      }),
    ).toBe(1);
    const profile = await (
      await r.ctx.get(base + "profiles/" + o.user.id)
    ).json();
    expect(profile.education).toBe("Test Institute");
    expect(profile.followers).toBe(1);
    for (const key of ["email", "passwordHash", "tokenHash"])
      expect(profile).not.toHaveProperty(key);
    const feed = await (
      await r.ctx.get(base + "feed?scope=following&limit=2")
    ).json();
    expect(feed.items).toHaveLength(2);
    expect(feed.nextCursor).toBeTruthy();
    const next = await (
      await r.ctx.get(
        base + "feed?scope=following&limit=2&cursor=" + feed.nextCursor,
      )
    ).json();
    expect(
      next.items.some((a: any) => feed.items.some((b: any) => a.id === b.id)),
    ).toBe(false);
    expect((await x.ctx.delete(base + "feed/" + ids[0])).status()).toBe(404);
    expect((await o.ctx.delete(base + "feed/" + ids[0])).status()).toBe(200);
    expect(
      (
        await r.ctx.post(base + "follows/" + r.user.id, {
          data: { enabled: true },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await r.ctx.post(base + "follows/" + o.user.id, {
          data: { enabled: false },
        })
      ).status(),
    ).toBe(201);
    expect(
      (await (await r.ctx.get(base + "feed?scope=following")).json()).items,
    ).toHaveLength(0);
    await r.ctx.post(base + "follows/" + o.user.id, {
      data: { enabled: true },
    });
    expect((await r.ctx.post(base + "blocks/" + o.user.id)).status()).toBe(201);
    expect(
      await db.follow.count({
        where: { followerId: r.user.id, followingId: o.user.id },
      }),
    ).toBe(0);
    expect((await r.ctx.get(base + "profiles/" + o.user.id)).status()).toBe(
      404,
    );
    expect(
      (
        await r.ctx.post(base + "follows/" + o.user.id, {
          data: { enabled: true },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await (await r.ctx.get(base + "feed")).json()).items.some(
        (a: any) => a.authorId === o.user.id,
      ),
    ).toBe(false);
  } finally {
    await cleanup(as);
  }
});
test("persistent private notifications, unread direct messages and connection dismissal", async () => {
  const as = await Promise.all(
    ["notify-a", "notify-b", "notify-x"].map((l) =>
      fixtureAccount(db, l + "-" + randomUUID().slice(0, 5)),
    ),
  );
  const [a, b, x] = as;
  try {
    const c = await (
      await a.ctx.post(base + "connections/" + b.user.id)
    ).json();
    expect((await b.ctx.patch(base + "connections/" + c.id)).status()).toBe(
      200,
    );
    expect(
      (
        await a.ctx.post(base + "messages/" + b.user.id, {
          data: { content: "A persistent unread message" },
        })
      ).status(),
    ).toBe(201);
    let counts = await (await b.ctx.get(base + "unread")).json();
    expect(counts.messages).toBe(1);
    expect(counts.notifications).toBeGreaterThan(0);
    const list = await (await b.ctx.get(base + "notifications?limit=1")).json();
    expect(list.nextCursor).toBeTruthy();
    expect(
      (await x.ctx.patch(base + "notifications/" + list.items[0].id)).status(),
    ).toBe(404);
    expect((await x.ctx.get(base + "notifications")).ok()).toBe(true);
    expect(
      (await (await x.ctx.get(base + "notifications")).json()).items,
    ).toHaveLength(0);
    expect(
      (
        await b.ctx.patch(base + "messages/" + a.user.id + "/read", {
          data: {
            throughId: (
              await db.message.findFirstOrThrow({
                where: { senderId: a.user.id, receiverId: b.user.id },
              })
            ).id,
          },
        })
      ).status(),
    ).toBe(200);
    expect((await (await b.ctx.get(base + "unread")).json()).messages).toBe(0);
    await b.ctx.patch(base + "notifications/read-all");
    expect(
      (await (await b.ctx.get(base + "unread")).json()).notifications,
    ).toBe(0);
    expect((await x.ctx.delete(base + "connections/" + c.id)).status()).toBe(
      404,
    );
    expect((await b.ctx.delete(base + "connections/" + c.id)).status()).toBe(
      200,
    );
    expect(
      (
        await a.ctx.post(base + "messages/" + b.user.id, {
          data: { content: "Must not reach disconnected member" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await cleanup(as);
  }
});
test("Redis counts atomic requests across clients, expires keys and fails closed", async () => {
  const a = new SharedLimiter(process.env.REDIS_URL),
    b = new SharedLimiter(process.env.REDIS_URL);
  await a.connect();
  await b.connect();
  try {
    expect(a.redis).not.toBeNull();
    const scope = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).hit(scope, 10, 250)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.every((r) => r.retryAfter >= 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect((await b.hit(scope, 10, 250)).allowed).toBe(true);
    a.redis!.disconnect();
    let status = 0,
      payload: any,
      called = false;
    const res: any = {
      status(n: number) {
        status = n;
        return this;
      },
      json(v: any) {
        payload = v;
      },
      getHeader() {
        return "test";
      },
    };
    await rateMiddleware(a)(
      { method: "GET", path: "/api/feed", ip: "192.0.2.1" } as any,
      res,
      () => {
        called = true;
      },
    );
    expect(status).toBe(503);
    expect(payload.code).toBe("RATE_LIMIT_UNAVAILABLE");
    expect(called).toBe(false);
  } finally {
    a.redis?.disconnect();
    await b.close();
  }
});
test("browser follow controls, feed composer, notifications, mobile and dialog keyboard behavior", async ({
  page,
}) => {
  const as = await Promise.all(
    ["social-browser", "social-target"].map((l) =>
      fixtureAccount(db, l + "-" + randomUUID().slice(0, 5)),
    ),
  );
  const [a, b] = as;
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: projectData })
    ).json();
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await expect(
      page.getByRole("button", { name: "Edit your profile", exact: true }),
    ).toBeVisible();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "People", exact: true })
      .click();
    const card = page.locator(".person-card").filter({ hasText: b.user.name });
    await card
      .getByRole("button", { name: "Follow builder", exact: true })
      .click();
    await expect(
      card.getByRole("button", { name: "Following", exact: true }),
    ).toBeVisible();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Activity feed", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Public project update" })
      .fill("Browser-tested public milestone");
    await page
      .getByRole("button", { name: "Publish update", exact: true })
      .click();
    await expect(
      page
        .locator(".feed-content")
        .filter({ hasText: "Browser-tested public milestone" }),
    ).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      scan.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await b.ctx.post(base + "follows/" + a.user.id, {
      data: { enabled: true },
    });
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await expect(
      page.locator(".notification-row").filter({ hasText: b.user.name }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mark all read", exact: true })
      .click();
    await expect(page.locator(".notification-row.unread")).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole("button", { name: "Edit your profile", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.goto("http://localhost:3000/people/" + a.user.id);
    await expect(
      page.getByRole("heading", { name: a.user.name, exact: true }),
    ).toBeVisible();
  } finally {
    await cleanup(as);
  }
});
test("sensitive path variants share quota; invalid cookie churn cannot mint new buckets", async () => {
  const limiter = new SharedLimiter(process.env.REDIS_URL);
  await limiter.connect();
  try {
    const ip = "test-" + randomUUID();
    const mw = rateMiddleware(limiter);
    async function run(path: string, cookie?: string) {
      let status = 200,
        next = false;
      const res: any = {
        status(n: number) {
          status = n;
          return this;
        },
        json() {},
        setHeader() {},
        getHeader() {},
      };
      await mw(
        {
          method: "POST",
          path,
          ip,
          cookies: cookie ? { pc_session: cookie } : {},
        } as any,
        res,
        () => {
          next = true;
        },
      );
      return { status, next };
    }
    const variants = [
      "/api/auth/login",
      "/API/Auth/Login/",
      "/api//auth/login",
      "/api/%61uth/login",
      "/api/auth/%E0%A4%A",
    ];
    for (let i = 0; i < 30; i++)
      expect((await run(variants[i % 5])).next).toBe(true);
    expect((await run("/api/auth/register")).status).toBe(429);
    expect((await run("/api/account/forgot")).next).toBe(true);
    for (let i = 0; i < 100; i++)
      expect((await run("/api/follows/target", randomUUID())).next).toBe(true);
    expect((await run("/api/follows/target", randomUUID())).status).toBe(429);
  } finally {
    await limiter.close();
  }
});
test("simultaneous block/follow and block/connection preserve blocked-user invariants", async () => {
  const as = await Promise.all(
    ["race-a", "race-b"].map((l) =>
      fixtureAccount(db, l + "-" + randomUUID().slice(0, 5)),
    ),
  );
  const [a, b] = as;
  try {
    for (let i = 0; i < 3; i++) {
      await a.ctx.delete(base + "blocks/" + b.user.id);
      const results = await Promise.all([
        a.ctx.post(base + "blocks/" + b.user.id),
        b.ctx.post(base + "follows/" + a.user.id, { data: { enabled: true } }),
        b.ctx.post(base + "connections/" + a.user.id),
      ]);
      expect(results[0].status()).toBe(201);
      expect([201, 403]).toContain(results[1].status());
      expect([201, 403]).toContain(results[2].status());
      expect(
        await db.follow.count({
          where: {
            OR: [
              { followerId: a.user.id, followingId: b.user.id },
              { followerId: b.user.id, followingId: a.user.id },
            ],
          },
        }),
      ).toBe(0);
      expect(
        await db.connection.count({
          where: {
            OR: [
              { senderId: a.user.id, receiverId: b.user.id },
              { senderId: b.user.id, receiverId: a.user.id },
            ],
          },
        }),
      ).toBe(0);
    }
  } finally {
    await cleanup(as);
  }
});
test("reported public updates can be hidden only by admins and leave a review record", async () => {
  const as = await Promise.all(
    ["moderated-author", "moderated-reader", "moderated-admin"].map((l) =>
      fixtureAccount(db, l + "-" + randomUUID().slice(0, 5)),
    ),
  );
  const [o, r, a] = as;
  try {
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const p = await (
        await o.ctx.post(base + "projects", { data: projectData })
      ).json(),
      u = await (
        await o.ctx.post(base + `workspaces/${p.id}/updates`, {
          data: { content: "This is a moderation fixture update." },
        })
      ).json();
    expect(
      (
        await r.ctx.post(base + "reports", {
          data: {
            targetType: "activity",
            targetId: u.id,
            reason: "Review this public fixture content.",
          },
        })
      ).status(),
    ).toBe(201);
    const report = await db.report.findFirstOrThrow({
      where: { targetId: u.id },
    });
    expect(
      (
        await r.ctx.patch(base + "admin/reports/" + report.id, {
          data: { status: "Resolved", hideTarget: true },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await a.ctx.patch(base + "admin/reports/" + report.id, {
          data: { status: "Resolved", hideTarget: true },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await r.ctx.get(base + "feed")).json()).items.some(
        (row: any) => row.id === u.id,
      ),
    ).toBe(false);
    expect(
      (await db.report.findUniqueOrThrow({ where: { id: report.id } })).status,
    ).toBe("Resolved");
    expect(
      (await db.activity.findUniqueOrThrow({ where: { id: u.id } })).hiddenAt,
    ).not.toBeNull();
  } finally {
    await cleanup(as);
  }
});
test("direct chat pages latest-first without duplicates and read markers preserve unseen arrivals", async () => {
  const as = await Promise.all(
    ["chat-a", "chat-b", "chat-x"].map((l) =>
      fixtureAccount(db, l + "-" + randomUUID().slice(0, 5)),
    ),
  );
  const [a, b, x] = as;
  try {
    const c = await (
      await a.ctx.post(base + "connections/" + b.user.id)
    ).json();
    await b.ctx.patch(base + "connections/" + c.id);
    await db.message.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        senderId: a.user.id,
        receiverId: b.user.id,
        content: "History message " + i,
        createdAt: new Date(Date.now() - 100000 + i * 1000),
      })),
    });
    const latest = await (
      await b.ctx.get(base + "messages/" + a.user.id)
    ).json();
    expect(latest.items).toHaveLength(50);
    expect(latest.items.at(-1).content).toBe("History message 64");
    const old = await (
      await b.ctx.get(
        base + "messages/" + a.user.id + "?cursor=" + latest.nextCursor,
      )
    ).json();
    expect(old.items).toHaveLength(15);
    expect(old.items.at(-1).content).toBe("History message 14");
    expect(old.nextCursor).toBeNull();
    const arrival = await (
      await a.ctx.post(base + "messages/" + b.user.id, {
        data: { content: "Unseen arrival after fetch" },
      })
    ).json();
    expect(
      (
        await b.ctx.patch(base + "messages/" + a.user.id + "/read", {
          data: { throughId: latest.items.at(-1).id },
        })
      ).status(),
    ).toBe(200);
    expect((await (await b.ctx.get(base + "unread")).json()).messages).toBe(1);
    expect(
      (
        await b.ctx.patch(base + "messages/" + x.user.id + "/read", {
          data: { throughId: arrival.id },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await b.ctx.get(base + "messages/" + a.user.id + "?cursor=unknown")
      ).status(),
    ).toBe(409);
    await b.ctx.patch(base + "messages/" + a.user.id + "/read", {
      data: { throughId: arrival.id },
    });
    expect((await (await b.ctx.get(base + "unread")).json()).messages).toBe(0);
  } finally {
    await cleanup(as);
  }
});
test("browser chat loads earlier history, retains it across polling and marks only open conversation read", async ({
  page,
}) => {
  page.setDefaultTimeout(10000);
  const as = await Promise.all(
    ["browser-chat-a", "browser-chat-b"].map((l) =>
      fixtureAccount(db, l + "-" + randomUUID().slice(0, 5)),
    ),
  );
  const [a, b] = as;
  try {
    const c = await (
      await a.ctx.post(base + "connections/" + b.user.id)
    ).json();
    await b.ctx.patch(base + "connections/" + c.id);
    await db.message.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        senderId: b.user.id,
        receiverId: a.user.id,
        content: "Browser history " + i,
        createdAt: new Date(Date.now() - 100000 + i * 1000),
      })),
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
    await expect(page.locator(".message-bubble")).toHaveCount(50);
    expect((await (await a.ctx.get(base + "unread")).json()).messages).toBe(55);
    await page.getByRole("button", { name: "Load earlier messages" }).click();
    await expect(page.locator(".message-bubble")).toHaveCount(55);
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Browser sends a persisted message");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator(".message-bubble")).toHaveCount(56);
    await expect(page.locator(".message-bubble").first()).toContainText(
      "Browser history 0",
    );
    await expect
      .poll(
        async () => (await (await a.ctx.get(base + "unread")).json()).messages,
      )
      .toBe(0);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Discover", exact: true })
      .click();
    await b.ctx.post(base + "messages/" + a.user.id, {
      data: { content: "Must remain unread outside chat" },
    });
    await expect
      .poll(
        async () => (await (await a.ctx.get(base + "unread")).json()).messages,
      )
      .toBe(1);
  } finally {
    await cleanup(as);
  }
});
