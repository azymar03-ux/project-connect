import { chromium } from "playwright";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import sharp from "sharp";
try {
  process.loadEnvFile();
} catch {}
const base = "https://localhost:3443",
  db = new PrismaClient();
const email =
    "https-fixture-" + randomBytes(10).toString("hex") + "@example.com",
  password = "HttpsBrowserPassword2026!";
let user;
const browser = await chromium.launch(),
  context = await browser.newContext({ ignoreHTTPSErrors: true }),
  page = await context.newPage();
try {
  user = await db.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      name: "HTTPS Browser Builder",
      initials: "HB",
      skills: [],
      interests: [],
      emailVerifiedAt: new Date(),
    },
  });
  await page.goto(base);
  await page.locator(".sign-in").click();
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Edit your profile", exact: true })
    .waitFor();
  const cookie = (await context.cookies()).find((c) => c.name === "pc_session");
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === "Lax");
  const privateRead = await page.evaluate(async () => {
    const r = await fetch("/api/me");
    return { status: r.status, cache: r.headers.get("cache-control") };
  });
  assert.equal(privateRead.status, 200);
  assert.match(privateRead.cache, /no-store/);
  console.log(
    "PASS real Chromium HTTPS login stores Secure/HttpOnly/SameSite=Lax cookie and sends it on private fetch",
  );
  await page
    .getByRole("button", { name: "Edit your profile", exact: true })
    .click();
  const bytes = await sharp({
    create: { width: 300, height: 300, channels: 3, background: "#3465a8" },
  })
    .jpeg()
    .toBuffer();
  await page.getByLabel("Profile photo", { exact: true }).setInputFiles({
    name: "avatar.jpg",
    mimeType: "image/jpeg",
    buffer: bytes,
  });
  await page
    .getByRole("button", { name: "Remove profile photo", exact: true })
    .waitFor();
  const photo = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(photo.avatarId);
  const image = await page.evaluate(async (id) => {
    const r = await fetch("/api/images/" + id);
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      cache: r.headers.get("cache-control"),
    };
  }, photo.avatarId);
  assert.equal(image.status, 200);
  assert.equal(image.type, "image/jpeg");
  assert.match(image.cache, /no-store/);
  await page
    .getByRole("button", { name: "Remove profile photo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove profile photo", exact: true })
    .waitFor({ state: "hidden" });
  console.log("PASS HTTPS image upload/authorized inline derivative/removal");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Settings & profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose export section", exact: true })
    .click();
  await page.getByLabel("Export section", { exact: true }).waitFor();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download first page", exact: true })
    .click();
  assert.match((await download).suggestedFilename(), /profile-page-1/);
  console.log("PASS HTTPS authenticated paginated export browser download");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const revoked = await page.evaluate(
    async () => (await fetch("/api/me")).status,
  );
  assert.equal(revoked, 401);
  console.log("PASS HTTPS browser logout revokes session");
  console.log(
    "Scope: self-signed local TLS with Chromium ignoreHTTPSErrors; real Secure-cookie browser behavior, NOT trusted/public certificate, Caddy, OAuth/SMTP provider, hosted staging or production TLS certification.",
  );
} finally {
  if (user) {
    const u = await db.user.findUnique({ where: { id: user.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    if (u?.avatarId) {
      const image = await db.publicImage.findUnique({
        where: { id: u.avatarId },
      });
      await db.publicImage.deleteMany({ where: { id: u.avatarId } });
      if (image)
        await db.storageDeletion.upsert({
          where: { storageKey: image.storageKey },
          create: { storageKey: image.storageKey },
          update: {},
        });
    }
  }
  await context.close();
  await browser.close();
  await db.$disconnect();
}
