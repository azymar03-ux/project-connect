import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { fixtureAccount } from "./fixtures";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { cleanupStorage } from "../apps/api/src/core/storage-cleanup";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = "http://localhost:3000/api/";
const input = {
  title: "Lifecycle integration project",
  description:
    "A project validating persistence, permissions and lifecycle rules.",
  category: "IoT",
  tags: ["sensor"],
  requiredSkills: ["Python"],
  positions: ["Developer"],
  city: "Test city",
  remote: true,
  teamSize: 5,
};
async function clean(accounts: any[]) {
  const ids = accounts.map((a) => a.user.id);
  const projects = await db.project.findMany({
      where: { ownerId: { in: ids } },
      select: { id: true },
    }),
    files = await db.projectFile.findMany({
      where: { projectId: { in: projects.map((p) => p.id) } },
      select: { storageKey: true },
    });
  if (files.length)
    await db.storageDeletion.createMany({ data: files, skipDuplicates: true });
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.notification.deleteMany({ where: { actorId: { in: ids } } });
  await db.emailOutbox.deleteMany({
    where: { recipient: { in: accounts.map((a) => a.email) } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.aiUsage.deleteMany({ where: { userId: { in: ids } } });
  await db.adminAudit.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await cleanupStorage(100);
  for (const a of accounts) await a.ctx.dispose();
}
test.afterAll(() => db.$disconnect());
test("server discovery paginates ranked results with bound cursors, scopes, filters and private-user redaction", async () => {
  const a = await fixtureAccount(db, "ranking"),
    b = await fixtureAccount(db, "rank-other");
  try {
    await db.user.update({
      where: { id: a.user.id },
      data: { skills: ["Python"], city: "Test city" },
    });
    const marker = "rank-" + a.user.id;
    for (let i = 0; i < 7; i++)
      await a.ctx.post(base + "projects", {
        data: {
          ...input,
          title: `${marker} project ${i}`,
          remote: i % 2 === 0,
        },
      });
    const first = await (
      await a.ctx.get(base + "discovery/projects?q=" + marker + "&limit=2")
    ).json();
    expect(first.items).toHaveLength(2);
    expect(first.items[0].match).toBe(95); // fit-v2: 25 base + 55 skill + 10 city + 5 public project-created update
    expect(first.items[0].matchReasons.recentPublicActivity).toBe(true);
    expect(first.items[0].matchReasons.matchedSkills).toEqual(["Python"]);
    expect(JSON.stringify(first)).not.toMatch(
      /passwordHash|tokenHash|emailVerifiedAt|"email"/,
    );
    let cursor = first.nextCursor,
      ids = first.items.map((p: any) => p.id);
    while (cursor) {
      const page = await (
        await a.ctx.get(
          base + `discovery/projects?q=${marker}&limit=2&cursor=${cursor}`,
        )
      ).json();
      ids.push(...page.items.map((p: any) => p.id));
      cursor = page.nextCursor;
    }
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(
      (
        await a.ctx.get(
          base + `discovery/projects?q=changed&cursor=${first.nextCursor}`,
        )
      ).status(),
    ).toBe(400);
    expect(
      (await a.ctx.get(base + "discovery/projects?cursor=bad")).status(),
    ).toBe(400);
    const remote = await (
      await a.ctx.get(base + `discovery/projects?q=${marker}&remote=true`)
    ).json();
    expect(remote.items).toHaveLength(4);
    await a.ctx.post(base + `projects/${ids[0]}/bookmark`);
    expect(
      (
        await (
          await a.ctx.get(base + "discovery/projects?scope=saved&q=" + marker)
        ).json()
      ).items,
    ).toHaveLength(1);
    const people = await (
      await a.ctx.get(
        base + "discovery/people?q=" + encodeURIComponent(b.user.name),
      )
    ).json();
    expect(people.items.some((p: any) => p.id === b.user.id)).toBe(true);
    await a.ctx.post(base + "blocks/" + b.user.id);
    expect(
      (
        await (
          await a.ctx.get(
            base + "discovery/people?q=" + encodeURIComponent(b.user.name),
          )
        ).json()
      ).items.some((p: any) => p.id === b.user.id),
    ).toBe(false);
  } finally {
    await clean([a, b]);
  }
});
test("cancel/reapply and owner review are idempotent, archived workspaces are read-only and recoverable", async () => {
  const a = await fixtureAccount(db, "life-owner"),
    b = await fixtureAccount(db, "life-applicant");
  try {
    const p = await (
        await a.ctx.post(base + "projects", { data: input })
      ).json(),
      apply = () =>
        b.ctx.post(base + `projects/${p.id}/apply`, {
          data: { message: "I can build the Python sensor pipeline." },
        });
    const [r1, r2] = await Promise.all([apply(), apply()]);
    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);
    let app = await r1.json();
    expect((await r2.json()).id).toBe(app.id);
    expect(
      await db.notification.count({
        where: { userId: a.user.id, kind: "application" },
      }),
    ).toBe(1);
    expect(
      (await b.ctx.delete(base + `projects/${p.id}/application`)).status(),
    ).toBe(200);
    expect(
      (
        await a.ctx.patch(base + "applications/" + app.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(409);
    app = await (await apply()).json();
    expect(app.status).toBe("Pending");
    await a.ctx.patch(base + `workspaces/${p.id}/project`, {
      data: { status: "Completed" },
    });
    expect(
      (
        await a.ctx.patch(base + "applications/" + app.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(409);
    await a.ctx.patch(base + `workspaces/${p.id}/project`, {
      data: { status: "In progress" },
    });
    expect(
      (
        await a.ctx.patch(base + "applications/" + app.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(200);
    const task = await (
      await b.ctx.post(base + `workspaces/${p.id}/tasks`, {
        data: { title: "Persist the sensor pipeline" },
      })
    ).json();
    await a.ctx.patch(base + `workspaces/${p.id}/project`, {
      data: { status: "Archived" },
    });
    expect(
      (
        await b.ctx.patch(base + `workspaces/${p.id}/tasks/${task.id}`, {
          data: { status: "Done" },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await b.ctx.post(base + `workspaces/${p.id}/messages`, {
          data: { content: "Blocked archive write" },
        })
      ).status(),
    ).toBe(409);
    expect((await b.ctx.get(base + "projects/" + p.id)).status()).toBe(200);
    expect(
      (
        await (await a.ctx.get(base + "discovery/projects?scope=mine")).json()
      ).items.some((v: any) => v.id === p.id),
    ).toBe(true);
    await a.ctx.patch(base + `workspaces/${p.id}/project`, {
      data: { status: "In progress" },
    });
    expect(
      (
        await b.ctx.patch(base + `workspaces/${p.id}/tasks/${task.id}`, {
          data: { status: "Done" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/project`, {
          data: { confirmTitle: p.title },
        })
      ).status(),
    ).toBe(409);
  } finally {
    await clean([a, b]);
  }
});
test("task labels, optimistic versions and all-task ordering reject stale edits and cross-project IDs", async () => {
  const a = await fixtureAccount(db, "task-owner");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    let t = await (
        await a.ctx.post(base + `workspaces/${p.id}/tasks`, {
          data: { title: "First task", labels: ["hardware"] },
        })
      ).json(),
      u = await (
        await a.ctx.post(base + `workspaces/${p.id}/tasks`, {
          data: { title: "Second task" },
        })
      ).json();
    const edited = await a.ctx.patch(
      base + `workspaces/${p.id}/tasks/${t.id}`,
      {
        data: {
          version: t.version,
          title: "Refined task",
          labels: ["hardware", "priority"],
          dueDate: "2026-12-01T12:00:00.000Z",
        },
      },
    );
    expect(edited.status()).toBe(200);
    expect(
      (
        await a.ctx.patch(base + `workspaces/${p.id}/tasks/${t.id}`, {
          data: { version: t.version, title: "Stale overwrite" },
        })
      ).status(),
    ).toBe(409);
    t = await edited.json();
    expect(
      (
        await a.ctx.patch(base + `workspaces/${p.id}/tasks/${t.id}`, {
          data: { labels: ["A", "a"] },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.patch(base + `workspaces/${p.id}/tasks/reorder`, {
          data: {
            items: [
              { id: u.id, version: u.version },
              { id: t.id, version: t.version },
            ],
          },
        })
      ).status(),
    ).toBe(200);
    const view = await (await a.ctx.get(base + `workspaces/${p.id}`)).json();
    expect(view.tasks.map((t: any) => t.id)).toEqual([u.id, t.id]);
    expect(view.tasks[1].labels).toEqual(["hardware", "priority"]);
    expect(
      (
        await a.ctx.patch(base + `workspaces/${p.id}/tasks/reorder`, {
          data: { items: [{ id: u.id, version: u.version }] },
        })
      ).status(),
    ).toBe(409);
    const other = await (
      await a.ctx.post(base + "projects", {
        data: { ...input, title: "Other isolated task project" },
      })
    ).json();
    expect(
      (
        await a.ctx.patch(base + `workspaces/${other.id}/tasks/${t.id}`, {
          data: { status: "Done" },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await clean([a]);
  }
});
test("storage validates decoded images and durable cleanup survives delete without exposing keys", async () => {
  const a = await fixtureAccount(db, "storage-owner");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    expect(
      (
        await a.ctx.post(base + `workspaces/${p.id}/files`, {
          multipart: {
            file: {
              name: "truncated.png",
              mimeType: "image/png",
              buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
            },
          },
        })
      ).status(),
    ).toBe(400);
    const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "#00aaff" },
      })
        .png()
        .toBuffer(),
      r = await a.ctx.post(base + `workspaces/${p.id}/files`, {
        multipart: {
          file: { name: "image.png", mimeType: "image/png", buffer: png },
        },
      });
    expect(r.status()).toBe(201);
    const file = await r.json(),
      row = await db.projectFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(
      await db.storageDeletion.count({ where: { storageKey: row.storageKey } }),
    ).toBe(0);
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/files/${file.id}`)
      ).status(),
    ).toBe(200);
    await cleanupStorage(100);
    await expect(
      readFile(resolve(".private-files", row.storageKey)),
    ).rejects.toThrow();
    expect(
      await db.storageDeletion.count({ where: { storageKey: row.storageKey } }),
    ).toBe(0);
    const f = await (
      await a.ctx.post(base + `workspaces/${p.id}/files`, {
        multipart: {
          file: {
            name: "project-notes.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("durable deletion"),
          },
        },
      })
    ).json();
    await a.ctx.patch(base + `workspaces/${p.id}/project`, {
      data: { status: "Archived" },
    });
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/project`, {
          data: { confirmTitle: "wrong" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/project`, {
          data: { confirmTitle: p.title },
        })
      ).status(),
    ).toBe(200);
    expect((await a.ctx.get(base + "projects/" + p.id)).status()).toBe(404);
    expect(await db.projectFile.count({ where: { id: f.id } })).toBe(0);
    await cleanupStorage(100);
  } finally {
    await clean([a]);
  }
});
test("browser stable project route, task edit labels/order and settings work at mobile width", async ({
  page,
}) => {
  const a = await fixtureAccount(db, "editor-browser");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    await a.ctx.post(base + `workspaces/${p.id}/tasks`, {
      data: { title: "Browser first task" },
    });
    await a.ctx.post(base + `workspaces/${p.id}/tasks`, {
      data: { title: "Browser second task" },
    });
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000/projects/" + p.id);
    await page
      .getByRole("button", { name: "Open project workspace", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit Browser first task", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Task title", exact: true })
      .fill("Browser refined task");
    await page
      .getByRole("textbox", { name: "Labels" })
      .fill("priority, design");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.locator(".task-card").first()).toContainText("priority");
    await page
      .getByRole("button", {
        name: "Move down Browser refined task",
        exact: true,
      })
      .click();
    await expect(page.locator(".task-card").first()).toContainText(
      "Browser second task",
    );
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Project title", exact: true })
      .fill("Browser edited project");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Browser edited project",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 720 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await clean([a]);
  }
});
test("notification opt-out persists and expanded export includes only private owner collections", async () => {
  const a = await fixtureAccount(db, "preferences"),
    b = await fixtureAccount(db, "follower");
  try {
    expect(
      (
        await a.ctx.patch(base + "account/preferences", {
          data: {
            notifySocial: false,
            notifyMessages: true,
            notifyWorkspace: true,
          },
        })
      ).status(),
    ).toBe(200);
    await b.ctx.post(base + "follows/" + a.user.id, {
      data: { enabled: true },
    });
    expect(
      await db.follow.count({
        where: { followerId: b.user.id, followingId: a.user.id },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { userId: a.user.id, kind: "follow" },
      }),
    ).toBe(0);
    await a.ctx.post(base + "follows/" + b.user.id, {
      data: { enabled: true },
    });
    const exported = await (await a.ctx.get(base + "account/export")).json();
    expect(exported.user.notifySocial).toBe(false);
    expect(exported.follows).toHaveLength(1);
    expect(exported.follows[0].followerId).toBe(a.user.id);
    expect(JSON.stringify(exported)).not.toMatch(
      /passwordHash|tokenHash|storageKey|cookieHash|verifier/,
    );
    expect(exported.truncated).toEqual([]);
  } finally {
    await clean([a, b]);
  }
});
test("member removal racing a task assignment cannot leave a nonmember assignee; transfer revokes prior owner writes", async () => {
  const a = await fixtureAccount(db, "race-owner"),
    b = await fixtureAccount(db, "race-member");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    await db.member.create({ data: { projectId: p.id, userId: b.user.id } });
    const task = await (
      await a.ctx.post(base + `workspaces/${p.id}/tasks`, {
        data: { title: "Concurrent membership task" },
      })
    ).json();
    const replies = await Promise.all([
      a.ctx.patch(base + `workspaces/${p.id}/tasks/${task.id}`, {
        data: { assigneeId: b.user.id },
      }),
      a.ctx.delete(base + `workspaces/${p.id}/team/${b.user.id}`),
    ]);
    expect([200, 400]).toContain(replies[0].status());
    expect(replies[1].status()).toBe(200);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId,
    ).toBeNull();
    await db.member.create({ data: { projectId: p.id, userId: b.user.id } });
    expect(
      (
        await a.ctx.post(base + `workspaces/${p.id}/team/transfer`, {
          data: { userId: b.user.id },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await a.ctx.patch(base + `workspaces/${p.id}/project`, {
          data: { title: "Unauthorized former owner edit" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await b.ctx.patch(base + `workspaces/${p.id}/project`, {
          data: { title: "Authorized transferred project" },
        })
      ).status(),
    ).toBe(200);
  } finally {
    await clean([a, b]);
  }
});
test("upload and account deletion racing do not leave dangling file metadata or memberships", async () => {
  const a = await fixtureAccount(db, "delete-project-owner"),
    b = await fixtureAccount(db, "delete-uploader");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    await db.member.create({ data: { projectId: p.id, userId: b.user.id } });
    const [r, deleted] = await Promise.all([
      b.ctx.post(base + `workspaces/${p.id}/files`, {
        multipart: {
          file: {
            name: "account-notes.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("race upload"),
          },
        },
      }),
      b.ctx.delete(base + "account", {
        data: { password: "TestPassword2026!" },
      }),
    ]);
    expect([201, 401, 403, 404]).toContain(r.status());
    expect(deleted.status()).toBe(200);
    expect(
      await db.projectFile.count({ where: { uploaderId: b.user.id } }),
    ).toBe(0);
    expect(await db.member.count({ where: { userId: b.user.id } })).toBe(0);
    await cleanupStorage(100);
  } finally {
    await clean([a, b]);
  }
});
test("AI content deletion preserves daily quota and prevents importing a deleted roadmap", async () => {
  const a = await fixtureAccount(db, "delete-ai");
  try {
    const p = await (
        await a.ctx.post(base + "projects", { data: input })
      ).json(),
      plan = await (
        await a.ctx.post(base + "ai/plan", {
          data: { prompt: "Build a smart sensor using Arduino and Python" },
        })
      ).json();
    expect((await a.ctx.delete(base + "ai/plans/" + plan.id)).status()).toBe(
      200,
    );
    const row = await db.aiPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(row.source).toBe("deleted");
    expect(row.prompt).toBe("");
    expect(row.plan).toEqual({});
    expect(
      (await (await a.ctx.get(base + "ai/plans")).json()).some(
        (p: any) => p.id === plan.id,
      ),
    ).toBe(false);
    expect(
      (
        await a.ctx.post(base + `ai/plans/${plan.id}/tasks`, {
          data: { projectId: p.id },
        })
      ).status(),
    ).toBe(404);
    expect(
      await db.aiPlan.count({
        where: {
          userId: a.user.id,
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      }),
    ).toBe(1);
  } finally {
    await clean([a]);
  }
});
