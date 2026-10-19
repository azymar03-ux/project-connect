import { fixtureAccount } from "./fixtures";
import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = "http://localhost:3000/api/";
async function account(label: string) {
  return fixtureAccount(db, label);
}
async function clean(a: any[]) {
  const ids = a.map((u) => u.user.id);
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.emailOutbox.deleteMany({
    where: { recipient: { in: a.map((u) => u.email) } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const u of a) await u.ctx.dispose();
}
test.afterAll(() => db.$disconnect());
const input = {
  title: "Files and invites test",
  description: "A test project for private storage and secure invitations.",
  category: "IoT",
  tags: ["IoT"],
  requiredSkills: ["IoT"],
  positions: ["Maker"],
  city: "Test",
  remote: true,
  teamSize: 2,
};
test("invitations enforce capacity and file storage isolates project attachments", async () => {
  const a = await account("owner"),
    b = await account("member"),
    c = await account("outsider");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    const inv = await (
      await a.ctx.post(base + `workspaces/${p.id}/invitations`, {
        data: { userId: b.user.id },
      })
    ).json();
    expect(
      (
        await c.ctx.patch(base + "invitations/" + inv.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await b.ctx.patch(base + "invitations/" + inv.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await b.ctx.patch(base + "invitations/" + inv.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(200);
    const full = await (
      await a.ctx.post(base + `workspaces/${p.id}/invitations`, {
        data: { userId: c.user.id },
      })
    ).json();
    expect(
      (
        await c.ctx.patch(base + "invitations/" + full.id, {
          data: { status: "Accepted" },
        })
      ).status(),
    ).toBe(409);
    const f = await a.ctx.post(base + `workspaces/${p.id}/files`, {
      multipart: {
        file: {
          name: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Private project notes"),
        },
      },
    });
    expect(f.status()).toBe(201);
    const file = await f.json();
    expect(file.storageKey).toBeUndefined();
    expect((await c.ctx.get(base + `workspaces/${p.id}/files`)).status()).toBe(
      403,
    );
    expect(
      (
        await c.ctx.get(base + `workspaces/${p.id}/files/${file.id}/download`)
      ).status(),
    ).toBe(403);
    const download = await b.ctx.get(
      base + `workspaces/${p.id}/files/${file.id}/download`,
    );
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    expect(await download.text()).toBe("Private project notes");
    expect(
      (
        await b.ctx.delete(base + `workspaces/${p.id}/files/${file.id}`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await a.ctx.post(base + `workspaces/${p.id}/files`, {
          multipart: {
            file: {
              name: "x.svg",
              mimeType: "image/svg+xml",
              buffer: Buffer.from('<svg onload="alert(1)"/>'),
            },
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.post(base + `workspaces/${p.id}/files`, {
          multipart: {
            file: {
              name: "fake.png",
              mimeType: "image/png",
              buffer: Buffer.from("not-a-png"),
            },
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/files/${file.id}`)
      ).status(),
    ).toBe(200);
    expect(
      (
        await a.ctx.get(base + `workspaces/${p.id}/files/${file.id}/download`)
      ).status(),
    ).toBe(404);
  } finally {
    await clean([a, b, c]);
  }
});
test("browser file upload and download UI", async ({ page }) => {
  const a = await account("browser");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await page.getByRole("button", { name: p.title, exact: true }).click();
    await page.getByRole("button", { name: "Open project workspace" }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.locator("input[type=file]").setInputFiles({
      name: "browser-notes.md",
      mimeType: "text/plain",
      buffer: Buffer.from("# Workspace notes"),
    });
    await expect(
      page.getByText("browser-notes.md", { exact: true }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("browser-notes.md");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete browser-notes.md" }).click();
    await expect(
      page.getByText("browser-notes.md", { exact: true }),
    ).toHaveCount(0);
  } finally {
    const files = await db.projectFile.findMany({
      where: { uploaderId: a.user.id },
    });
    for (const f of files)
      await a.ctx.delete(base + `workspaces/${f.projectId}/files/${f.id}`);
    await clean([a]);
  }
});
