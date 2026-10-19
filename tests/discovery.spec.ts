import { fixtureAccount } from "./fixtures";
import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { distanceKm } from "../apps/api/src/core/geo";
import { githubRepo } from "../apps/api/src/core/github-url";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = "http://localhost:3000/api/";
async function account(label: string) {
  return fixtureAccount(db, label);
}
async function cleanup(accounts: any[]) {
  const ids = accounts.map((a) => a.user.id);
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.hardwareStore.deleteMany({ where: { submittedById: { in: ids } } });
  await db.resource.deleteMany({ where: { submittedById: { in: ids } } });
  await db.connection.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.message.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.application.deleteMany({ where: { userId: { in: ids } } });
  await db.member.deleteMany({ where: { userId: { in: ids } } });
  await db.emailOutbox.deleteMany({
    where: { recipient: { in: accounts.map((a) => a.email) } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.aiUsage.deleteMany({ where: { userId: { in: ids } } });
  await db.adminAudit.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] },
  });
  for (const a of accounts) await a.ctx.dispose();
}
test.afterAll(() => db.$disconnect());
const projectInput = {
  title: "Round discovery test project",
  description:
    "This isolated project is used for roadmap and team integration tests.",
  category: "Robotics",
  tags: ["Python"],
  requiredSkills: ["Python"],
  positions: ["Developer"],
  city: "Test",
  remote: true,
  teamSize: 5,
};
test("geo calculations and constrained GitHub parsing", () => {
  expect(distanceKm(0, 0, 0, 0)).toBe(0);
  expect(distanceKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
  expect(distanceKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeCloseTo(343.556, 1);
  expect(githubRepo("https://github.com/public-apis/public-apis")).toEqual({
    owner: "public-apis",
    repo: "public-apis",
  });
  expect(() => githubRepo("https://evil.com/a/b")).toThrow();
  expect(() => githubRepo("https://github.com/a/b/issues")).toThrow();
});
test("store submission review, categories, favourites and moderator permissions", async () => {
  const a = await account("stores"),
    admin = await account("moderator");
  try {
    await db.user.update({
      where: { id: admin.user.id },
      data: { isAdmin: true },
    });
    const listing = {
      name: "Test hardware store",
      address: "123 testing street",
      city: "Coimbatore",
      lat: 11.0168,
      lng: 76.9558,
      categories: ["Sensors"],
      description: "Sensors and components for tests.",
    };
    const submitted = await (
      await a.ctx.post(base + "stores", { data: listing })
    ).json();
    expect(submitted.status).toBe("Pending");
    const list = await (
      await a.ctx.get(base + "stores?lat=11.0168&lng=76.9558&radiusKm=5")
    ).json();
    expect(list.items.some((x: any) => x.id === submitted.id)).toBe(false);
    expect(
      (
        await a.ctx.patch(base + `stores/${submitted.id}/review`, {
          data: { status: "Approved" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await admin.ctx.patch(base + `stores/${submitted.id}/review`, {
          data: { status: "Approved" },
        })
      ).status(),
    ).toBe(200);
    const approved = await (
      await a.ctx.get(
        base + "stores?lat=11.0168&lng=76.9558&radiusKm=5&category=Sensors",
      )
    ).json();
    const s = approved.items.find((x: any) => x.id === submitted.id);
    expect(s.distanceKm).toBe(0);
    expect(s.submittedById).toBeUndefined();
    await a.ctx.post(base + `stores/${s.id}/favorite`, {
      data: { enabled: true },
    });
    await a.ctx.post(base + `stores/${s.id}/favorite`, {
      data: { enabled: true },
    });
    const fav = await (await a.ctx.get(base + "stores?favorites=true")).json();
    expect(fav.items).toHaveLength(1);
    expect((await a.ctx.get(base + "stores?lat=100&lng=0")).status()).toBe(400);
  } finally {
    await cleanup([a, admin]);
  }
});
test("roadmap plans persist, only owner can import, repeated imports skip duplicates", async () => {
  const a = await account("planner"),
    b = await account("other");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: projectInput })
    ).json();
    const plan = await (
      await a.ctx.post(base + "ai/plan", {
        data: { prompt: "I want to build an obstacle avoiding drone." },
      })
    ).json();
    expect(plan.source).toBe("template");
    expect(plan.plan.steps.length).toBeGreaterThan(3);
    expect(plan.plan.safety.length).toBeGreaterThan(0);
    expect(
      (
        await b.ctx.post(base + `ai/plans/${plan.id}/tasks`, {
          data: { projectId: p.id },
        })
      ).status(),
    ).toBe(403);
    const first = await (
      await a.ctx.post(base + `ai/plans/${plan.id}/tasks`, {
        data: { projectId: p.id },
      })
    ).json();
    expect(first.created).toBe(plan.plan.steps.length);
    const repeats = await Promise.all(
      [1, 2].map(() =>
        a.ctx.post(base + `ai/plans/${plan.id}/tasks`, {
          data: { projectId: p.id },
        }),
      ),
    );
    for (const r of repeats) expect((await r.json()).created).toBe(0);
    expect(await db.task.count({ where: { projectId: p.id } })).toBe(
      plan.plan.steps.length,
    );
  } finally {
    await cleanup([a, b]);
  }
});
test("blocks stop connections and messages; reports can hide resources", async () => {
  const a = await account("blocker"),
    b = await account("blocked"),
    admin = await account("admin");
  try {
    await db.user.update({
      where: { id: admin.user.id },
      data: { isAdmin: true },
    });
    const c = await (
      await a.ctx.post(base + "connections/" + b.user.id)
    ).json();
    await b.ctx.patch(base + "connections/" + c.id);
    expect(
      (
        await a.ctx.post(base + "messages/" + b.user.id, {
          data: { content: "Hello before the block" },
        })
      ).status(),
    ).toBe(201);
    await a.ctx.post(base + "blocks/" + b.user.id);
    expect((await b.ctx.post(base + "connections/" + a.user.id)).status()).toBe(
      403,
    );
    expect(
      (
        await b.ctx.post(base + "messages/" + a.user.id, {
          data: { content: "Forbidden message" },
        })
      ).status(),
    ).toBe(403);
    const people = await (await a.ctx.get(base + "people")).json();
    expect(people.some((p: any) => p.id === b.user.id)).toBe(false);
    const r = await (
      await b.ctx.post(base + "resources", {
        data: {
          title: "Moderation test resource",
          description: "A test item for verifying moderation control.",
          url: "https://example.com/" + b.user.id,
          type: "Tool",
          tags: ["Test"],
        },
      })
    ).json();
    await a.ctx.post(base + "reports", {
      data: {
        targetType: "resource",
        targetId: r.id,
        reason: "This resource is inappropriate for the platform.",
      },
    });
    expect((await a.ctx.get(base + "admin/reports")).status()).toBe(403);
    const reports = await (await admin.ctx.get(base + "admin/reports")).json();
    const report = reports.find((x: any) => x.targetId === r.id);
    await admin.ctx.patch(base + "admin/reports/" + report.id, {
      data: { status: "Resolved", hideTarget: true },
    });
    expect(
      (await db.resource.findUniqueOrThrow({ where: { id: r.id } })).approved,
    ).toBe(false);
    const publicList = await (
      await a.ctx.get(base + "resources?search=Moderation")
    ).json();
    expect(publicList.items).toHaveLength(0);
  } finally {
    await cleanup([a, b, admin]);
  }
});
test("team ownership transfer and leave clear assignments and enforce owner policy", async () => {
  const a = await account("owner"),
    b = await account("member");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: projectInput })
    ).json();
    await db.member.create({ data: { projectId: p.id, userId: b.user.id } });
    const t = await (
      await a.ctx.post(base + `workspaces/${p.id}/tasks`, {
        data: { title: "Assigned task", assigneeId: a.user.id },
      })
    ).json();
    expect(
      (
        await b.ctx.patch(base + `workspaces/${p.id}/team/${a.user.id}`, {
          data: { role: "Member" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await a.ctx.post(base + `workspaces/${p.id}/team/leave`)).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.post(base + `workspaces/${p.id}/team/transfer`, {
          data: { userId: b.user.id },
        })
      ).status(),
    ).toBe(201);
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId,
    ).toBe(b.user.id);
    expect(
      (await a.ctx.post(base + `workspaces/${p.id}/team/leave`)).status(),
    ).toBe(201);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: t.id } })).assigneeId,
    ).toBeNull();
    expect((await a.ctx.get(base + `workspaces/${p.id}`)).status()).toBe(403);
    expect(
      (
        await b.ctx.delete(base + `workspaces/${p.id}/team/${b.user.id}`)
      ).status(),
    ).toBe(400);
  } finally {
    await cleanup([a, b]);
  }
});
test("browser nearby and planner screens work on mobile", async ({ page }) => {
  const a = await account("browser-new");
  try {
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Nearby hardware", exact: true })
      .click();
    await expect(page.locator(".store-card")).toHaveCount(5);
    await page.getByRole("button", { name: "Drone", exact: true }).click();
    await expect(page.locator(".store-card")).toHaveCount(1);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "AI assistant", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "I want to build an obstacle avoiding drone.",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Generate roadmap" }).click();
    await expect(page.locator(".roadmap li")).toHaveCount(7);
    await expect(page.locator(".ai-result .eyebrow")).toHaveText(
      "TEMPLATE PLAN",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await cleanup([a]);
  }
});
