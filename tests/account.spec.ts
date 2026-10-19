import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = "http://localhost:3000/api/";
test.afterAll(() => db.$disconnect());
test("verification/reset tokens are one-use; reset revokes sessions and unknown emails return same message", async () => {
  const ctx = await request.newContext();
  const email = `account-test-${Date.now()}@example.com`;
  let id = "";
  try {
    const registered = await ctx.post(base + "auth/register", {
      data: {
        name: "Account tester",
        email,
        password: "OriginalPassword2026!",
      },
    });
    expect(registered.status()).toBe(201);
    id = (await registered.json()).id;
    const outbox = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: email },
    });
    const token = outbox.body.match(/token=([a-f0-9]{64})/)![1];
    const stored = await db.accountToken.findFirstOrThrow({
      where: { userId: id },
    });
    expect(stored.tokenHash).not.toBe(token);
    expect(
      (await ctx.post(base + "account/verify", { data: { token } })).status(),
    ).toBe(201);
    expect(
      (await ctx.post(base + "account/verify", { data: { token } })).status(),
    ).toBe(400);
    expect((await ctx.get(base + "me")).status()).toBe(401);
    await ctx.post(base + "auth/login", {
      data: { email, password: "OriginalPassword2026!" },
    });
    expect(
      (await (await ctx.get(base + "account")).json()).emailVerifiedAt,
    ).toBeTruthy();
    const real = await ctx.post(base + "account/forgot-password", {
      data: { email },
    });
    const unknown = await ctx.post(base + "account/forgot-password", {
      data: { email: "missing-" + email },
    });
    expect(await real.json()).toEqual(await unknown.json());
    const resetMail = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: email, subject: { contains: "Reset" } },
      orderBy: { createdAt: "desc" },
    });
    const resetToken = resetMail.body.match(/token=([a-f0-9]{64})/)![1];
    const state = await ctx.storageState();
    expect(
      (
        await ctx.post(base + "account/reset-password", {
          data: { token: resetToken, password: "UpdatedPassword2026!" },
        })
      ).status(),
    ).toBe(201);
    expect((await ctx.get(base + "me")).status()).toBe(401);
    expect(
      (
        await ctx.post(base + "account/reset-password", {
          data: { token: resetToken, password: "OtherPassword2026!" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await ctx.post(base + "auth/login", {
          data: { email, password: "OriginalPassword2026!" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await ctx.post(base + "auth/login", {
          data: { email, password: "UpdatedPassword2026!" },
        })
      ).status(),
    ).toBe(201);
    const stale = await request.newContext({ storageState: state });
    expect((await stale.get(base + "me")).status()).toBe(401);
    await stale.dispose();
    const sessions = await (await ctx.get(base + "account/sessions")).json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
    expect(sessions[0].tokenHash).toBeUndefined();
    expect(
      (
        await ctx.post(base + "account/password", {
          data: {
            currentPassword: "UpdatedPassword2026!",
            password: "FinalPassword2026!",
          },
        })
      ).status(),
    ).toBe(201);
    expect((await ctx.get(base + "me")).status()).toBe(401);
  } finally {
    await ctx.dispose();
    await db.emailOutbox.deleteMany({ where: { recipient: email } });
    if (id) await db.user.delete({ where: { id } });
  }
});
test("expired token fails; bearer token absent from public users", async () => {
  const ctx = await request.newContext();
  const email = `expired-test-${Date.now()}@example.com`;
  let id = "";
  try {
    const r = await ctx.post(base + "auth/register", {
      data: { email, name: "Expiry tester", password: "TestPassword2026!" },
    });
    id = (await r.json()).id;
    const mail = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: email },
    });
    const token = mail.body.match(/token=([a-f0-9]{64})/)![1];
    await db.accountToken.updateMany({
      where: { userId: id },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (await ctx.post(base + "account/verify", { data: { token } })).status(),
    ).toBe(400);
    const publicBody = JSON.stringify(
      await (await ctx.get(base + "people")).json(),
    );
    expect(publicBody).not.toContain(token);
    expect(publicBody).not.toContain("emailVerifiedAt");
  } finally {
    await ctx.dispose();
    await db.emailOutbox.deleteMany({ where: { recipient: email } });
    if (id) await db.user.delete({ where: { id } });
  }
});
test("account export redacts secrets and password-confirmed deletion revokes access", async () => {
  const ctx = await request.newContext(),
    email = `delete-test-${Date.now()}@example.com`;
  let id = "";
  try {
    const r = await ctx.post(base + "auth/register", {
      data: { email, name: "Delete tester", password: "TestPassword2026!" },
    });
    expect(r.status()).toBe(201);
    id = (await r.json()).id;
    const exp = await ctx.get(base + "account/export");
    expect(exp.status()).toBe(200);
    const data = await exp.json();
    expect(data.user.email).toBe(email);
    expect(JSON.stringify(data)).not.toContain("passwordHash");
    expect(JSON.stringify(data)).not.toContain("tokenHash");
    expect(
      (
        await ctx.delete(base + "account", { data: { password: "wrong" } })
      ).status(),
    ).toBe(400);
    expect(
      (
        await ctx.delete(base + "account", {
          data: { password: "TestPassword2026!" },
        })
      ).status(),
    ).toBe(200);
    expect((await ctx.get(base + "me")).status()).toBe(401);
    expect(await db.user.findUnique({ where: { id } })).toBeNull();
    id = "";
  } finally {
    await ctx.dispose();
    await db.emailOutbox.deleteMany({ where: { recipient: email } });
    if (id) await db.user.delete({ where: { id } });
  }
});
