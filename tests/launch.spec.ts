import { fixtureAccount } from "./fixtures";
import { test, expect, request as requestFactory } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient();
const base = "http://localhost:3000/api/";
async function account(label: string) {
  return fixtureAccount(db, label);
}
function noPrivate(value: any) {
  if (Array.isArray(value)) {
    for (const v of value) noPrivate(v);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      expect(["email", "passwordHash", "tokenHash", "sessions"]).not.toContain(
        k,
      );
      noPrivate(v);
    }
  }
}
async function cleanup(ids: string[]) {
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.resource.deleteMany({ where: { submittedById: { in: ids } } });
  await db.connection.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.message.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.application.deleteMany({ where: { userId: { in: ids } } });
  await db.member.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}
test.afterAll(() => db.$disconnect());
test("privacy, session revocation, exact origins and auth boundaries", async () => {
  const a = await account("privacy");
  try {
    const people = await a.ctx.get(base + "people");
    noPrivate(await people.json());
    noPrivate(await (await a.ctx.get(base + "projects")).json());
    noPrivate(await (await a.ctx.get(base + "resources")).json());
    const evil = await a.ctx.patch(base + "me", {
      headers: { Origin: "https://evil.e2b.app" },
      data: {},
    });
    expect(evil.status()).toBe(403);
    expect((await a.ctx.get(base + "workspaces/seed-project-0")).status()).toBe(
      403,
    );
    const old = await a.ctx.storageState();
    expect((await a.ctx.post(base + "auth/logout")).status()).toBe(201);
    const stale = await requestFactory.newContext({ storageState: old });
    expect((await stale.get(base + "me")).status()).toBe(401);
    await stale.dispose();
  } finally {
    await a.ctx.dispose();
    await cleanup([a.user.id]);
  }
});
test("atomic capacity, idempotent review and unique reciprocal requests", async () => {
  const accounts = await Promise.all(
    ["owner", "builder-a", "builder-b"].map(account),
  );
  const [o, a, b] = accounts;
  try {
    const p = await (
      await o.ctx.post(base + "projects", {
        data: {
          title: "Concurrent capacity test",
          description:
            "This isolated test project verifies atomic team capacity.",
          category: "Robotics",
          tags: ["Python"],
          requiredSkills: ["Python"],
          positions: ["Developer"],
          city: "Test city",
          remote: true,
          teamSize: 2,
        },
      })
    ).json();
    const apps = await Promise.all(
      [a, b].map(async (x) =>
        (
          await x.ctx.post(base + `projects/${p.id}/apply`, {
            data: { message: "I would like to join this test team." },
          })
        ).json(),
      ),
    );
    const results = await Promise.all(
      apps.map((app) =>
        o.ctx.patch(base + "applications/" + app.id, {
          data: { status: "Accepted" },
        }),
      ),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
    expect(await db.member.count({ where: { projectId: p.id } })).toBe(2);
    const accepted = apps[results.findIndex((r) => r.status() === 200)];
    expect(
      (
        await o.ctx.patch(base + "applications/" + accepted.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(200);
    const replies = await Promise.all([
      a.ctx.post(base + "connections/" + b.user.id),
      b.ctx.post(base + "connections/" + a.user.id),
    ]);
    for (const r of replies) expect(r.status()).toBe(201);
    expect(
      await db.connection.count({
        where: {
          OR: [
            { senderId: a.user.id, receiverId: b.user.id },
            { senderId: b.user.id, receiverId: a.user.id },
          ],
        },
      }),
    ).toBe(1);
    const row = await replies[0].json();
    expect(row.status).toBe("Pending");
    const recipient = row.receiverId === a.user.id ? a : b;
    expect(
      (await recipient.ctx.patch(base + "connections/" + row.id)).status(),
    ).toBe(200);
  } finally {
    for (const a of accounts) await a.ctx.dispose();
    await cleanup(accounts.map((a) => a.user.id));
  }
});
test("workspace and resources enforce membership and persist changes", async () => {
  const owner = await account("workspace"),
    other = await account("outsider");
  try {
    const p = await (
      await owner.ctx.post(base + "projects", {
        data: {
          title: "Workspace persistence test",
          description:
            "A private project for workspace validation and resources.",
          category: "IoT",
          tags: ["IoT"],
          requiredSkills: ["IoT"],
          positions: ["Developer"],
          city: "Test city",
          remote: true,
          teamSize: 5,
        },
      })
    ).json();
    expect(
      (
        await other.ctx.post(base + `workspaces/${p.id}/tasks`, {
          data: { title: "Unauthorized task" },
        })
      ).status(),
    ).toBe(403);
    const task = await (
      await owner.ctx.post(base + `workspaces/${p.id}/tasks`, {
        data: { title: "Build the prototype", assigneeId: owner.user.id },
      })
    ).json();
    expect(task.title).toBe("Build the prototype");
    expect(
      (
        await owner.ctx.patch(base + `workspaces/${p.id}/tasks/${task.id}`, {
          data: { status: "Done" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await owner.ctx.patch(base + `workspaces/${p.id}/tasks/${task.id}`, {
          data: { assigneeId: other.user.id },
        })
      ).status(),
    ).toBe(400);
    const resource = await (
      await owner.ctx.post(base + "resources", {
        data: {
          title: "A test resource",
          description:
            "Useful documentation for this automated integration test.",
          url: `https://example.com/resource-${p.id}`,
          type: "Documentation",
          tags: ["IoT"],
        },
      })
    ).json();
    await owner.ctx.post(base + `resources/${resource.id}/vote`, {
      data: { enabled: true },
    });
    await owner.ctx.post(base + `resources/${resource.id}/vote`, {
      data: { enabled: true },
    });
    expect(
      await db.resourceVote.count({ where: { resourceId: resource.id } }),
    ).toBe(1);
    expect(
      (
        await other.ctx.post(base + `resources/${resource.id}/projects/${p.id}`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await owner.ctx.post(base + `resources/${resource.id}/projects/${p.id}`)
      ).status(),
    ).toBe(201);
    const view = await (
      await owner.ctx.get(base + `workspaces/${p.id}`)
    ).json();
    noPrivate(view);
    expect(view.tasks[0].status).toBe("Done");
    expect(view.resources).toHaveLength(1);
    expect(view.auditEvents).toHaveLength(2);
    expect(
      (await other.ctx.get(base + `workspaces/${p.id}/messages`)).status(),
    ).toBe(403);
    expect(
      (
        await owner.ctx.post(base + `workspaces/${p.id}/messages`, {
          data: { content: "Team update: prototype complete." },
        })
      ).status(),
    ).toBe(201);
    const chat = await (
      await owner.ctx.get(base + `workspaces/${p.id}/messages`)
    ).json();
    expect(chat.items[0].content).toContain("prototype complete");
    expect(
      (
        await owner.ctx.post(base + "resources", {
          data: {
            title: "Bad link",
            description: "This is a deliberately unsafe link submission.",
            url: "javascript:alert(1)",
            type: "Tool",
            tags: [],
          },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await owner.ctx.dispose();
    await other.ctx.dispose();
    await cleanup([owner.user.id, other.user.id]);
  }
});
test("browser resources and accessible task status controls", async ({
  page,
}) => {
  page.setDefaultTimeout(10000);
  const a = await account("browser");
  try {
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await expect(
      page.getByRole("button", { name: "Edit your profile" }),
    ).toBeVisible();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Resources", exact: true })
      .click();
    await expect(page.locator(".resource-card").first()).toBeVisible();
    await page
      .getByRole("textbox", { name: "Search resources" })
      .fill("Arduino");
    await expect(page.locator(".resource-card")).toHaveCount(1);
    await page.getByRole("textbox", { name: "Search resources" }).fill("");
    await expect(page.locator(".resource-card")).toHaveCount(6);
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Discover", exact: true })
      .click();
    const p = await (
      await a.ctx.post(base + "projects", {
        data: {
          title: "Browser workspace test",
          description:
            "This project verifies task controls and browser navigation.",
          category: "Design",
          tags: ["Figma"],
          requiredSkills: ["Figma"],
          positions: ["Designer"],
          city: "Test",
          remote: true,
          teamSize: 4,
        },
      })
    ).json();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Edit your profile" }),
    ).toBeVisible();
    await page.getByRole("button", { name: p.title, exact: true }).click();
    await page.getByRole("button", { name: "Open project workspace" }).click();
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Task title", exact: true })
      .fill("Design the prototype");
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page.locator(".task-card")).toContainText(
      "Design the prototype",
    );
    await page
      .getByRole("combobox", { name: "Move Design the prototype" })
      .selectOption("Done");
    await expect(
      page.locator(".kanban-column").last().locator(".task-card"),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(page.locator(".progress-value")).toHaveText("100%");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await a.ctx.dispose();
    await cleanup([a.user.id]);
  }
});
