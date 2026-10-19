import { drainQuota } from "../apps/api/src/core/ai-ledger";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHmac } from "node:crypto";
import { fixtureAccount } from "./fixtures";
import { assistantStream } from "../apps/api/src/core/assistant-provider";
import {
  finishAssistant,
  expireAssistant,
} from "../apps/api/src/core/assistant-state";
import { validateRuntimeConfig } from "../apps/api/src/core/runtime-config";
import { reserveAssistant } from "../apps/api/src/core/assistant-state";
import { sseData } from "../apps/api/src/core/event-stream";
import { searchPlaces } from "../apps/api/src/core/places";
import {
  verifyGithubSignature,
  installationToken,
} from "../apps/api/src/core/github-app";
import { deliverOutbox } from "../apps/api/src/core/outbox";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = "http://localhost:3000/api/";
const input = {
  title: "Integration fixture project",
  description:
    "Private fixture for integration permissions and message markers.",
  category: "IoT",
  tags: ["IoT"],
  requiredSkills: ["Python"],
  positions: ["Developer"],
  city: "Test",
  remote: true,
  teamSize: 5,
};
async function clean(accounts: any[]) {
  const ids = accounts.map((a) => a.user.id);
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.notification.deleteMany({ where: { actorId: { in: ids } } });
  await db.member.deleteMany({ where: { userId: { in: ids } } });
  await db.adminAudit.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await db.emailOutbox.deleteMany({
    where: { recipient: { in: accounts.map((a) => a.email) } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.aiUsage.deleteMany({ where: { userId: { in: ids } } });
  for (const a of accounts) await a.ctx.dispose();
}
test.afterAll(() => db.$disconnect());
test("SSE provider parser handles split UTF-8 events, usage, truncation and cancellation", async () => {
  const encoder = new TextEncoder(),
    data =
      'data: {"choices":[{"delta":{"content":"Hello ☀"}}]}\n\ndata: {"usage":{"total_tokens":20}}\n\ndata: [DONE]\n\n',
    bytes = encoder.encode(data);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 3)
        c.enqueue(bytes.slice(i, i + 3));
      c.close();
    },
  });
  const events = [];
  for await (const e of assistantStream(
    [{ role: "user", content: "Explain sensors" }],
    new AbortController().signal,
    {
      key: "local-test-key",
      fetch: (async (_url: any, options: any) => {
        expect(options.redirect).toBe("error");
        expect(JSON.parse(options.body).stream).toBe(true);
        return new Response(stream);
      }) as typeof fetch,
    },
  ))
    events.push(e);
  expect(events).toEqual([{ delta: "Hello ☀" }, { tokens: 20 }]);
  const cancelled = new AbortController();
  cancelled.abort();
  const run = async () => {
    for await (const e of assistantStream(
      [{ role: "user", content: "Build a sensor" }],
      cancelled.signal,
      { key: "" },
    ))
      void e;
  };
  await expect(run()).rejects.toThrow("CANCELLED");
  const truncated = async () => {
    for await (const e of sseData(new Response("data: broken").body!)) void e;
  };
  await expect(truncated()).rejects.toThrow("TRUNCATED_STREAM");
});
test("private assistant streams persisted templates, deduplicates request IDs and keeps quotas after delete", async () => {
  const a = await fixtureAccount(db, "assistant-owner"),
    b = await fixtureAccount(db, "assistant-other");
  try {
    const c = await (
      await a.ctx.post(base + "assistant/conversations", {
        data: { title: "Sensor planning chat" },
      })
    ).json();
    expect(
      (await b.ctx.get(base + "assistant/conversations/" + c.id)).status(),
    ).toBe(404);
    const requestId = randomUUID(),
      prompt = "Build a safe smart home sensor project";
    const r = await a.ctx.post(
      base + `assistant/conversations/${c.id}/messages`,
      { data: { requestId, prompt } },
    );
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("text/event-stream");
    expect(await r.text()).toContain("event: done");
    const saved = await (
      await a.ctx.get(base + "assistant/conversations/" + c.id)
    ).json();
    expect(saved.turns).toHaveLength(1);
    expect(saved.turns[0].status).toBe("completed");
    expect(saved.turns[0].content).toContain("Built-in template");
    const duplicate = await (
      await a.ctx.post(base + `assistant/conversations/${c.id}/messages`, {
        data: { requestId, prompt },
      })
    ).json();
    expect(duplicate.duplicate).toBe(true);
    expect(
      (
        await a.ctx.post(base + `assistant/conversations/${c.id}/messages`, {
          data: { requestId, prompt: "Another prompt" },
        })
      ).status(),
    ).toBe(409);
    const exported = await (await a.ctx.get(base + "account/export")).json();
    expect(exported.assistantConversations[0].turns[0].prompt).toBe(prompt);
    expect(
      (await a.ctx.delete(base + "assistant/conversations/" + c.id)).status(),
    ).toBe(200);
    const tombstone = await db.aiTurn.findFirstOrThrow({
      where: { userId: a.user.id },
    });
    expect(tombstone.prompt).toBe("");
    expect(tombstone.content).toBe("");
    expect(tombstone.reservedTokens).toBe(14000);
    expect(tombstone.conversationId).toBeNull();
    expect(
      (await a.ctx.get(base + "assistant/conversations/" + c.id)).status(),
    ).toBe(404);
  } finally {
    await clean([a, b]);
  }
});
test("assistant atomic reservation limits one active response and cancellation respects account ownership", async () => {
  const a = await fixtureAccount(db, "assistant-quota"),
    b = await fixtureAccount(db, "assistant-cancel");
  try {
    const c = await db.aiConversation.create({
      data: { userId: a.user.id, title: "Quota fixture" },
    });
    const result = await Promise.allSettled([
      reserveAssistant(a.user.id, c.id, randomUUID(), "First message"),
      reserveAssistant(a.user.id, c.id, randomUUID(), "Second message"),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const turn = await db.aiTurn.findFirstOrThrow({
      where: { userId: a.user.id },
    });
    expect(
      (
        await b.ctx.post(base + "assistant/turns/" + turn.id + "/cancel")
      ).status(),
    ).toBe(404);
    expect(
      (
        await a.ctx.post(base + "assistant/turns/" + turn.id + "/cancel")
      ).status(),
    ).toBe(201);
    expect(
      (await db.aiTurn.findUniqueOrThrow({ where: { id: turn.id } })).status,
    ).toBe("cancelled");
    await db.aiPlan.createMany({
      data: Array.from({ length: 19 }, () => ({
        userId: a.user.id,
        prompt: "quota only",
        source: "deleted",
        plan: {},
      })),
    });
    await drainQuota();
    await expect(
      reserveAssistant(a.user.id, c.id, randomUUID(), "Over daily limit"),
    ).rejects.toThrow("Daily AI budget");
  } finally {
    await clean([a, b]);
  }
});
test("Places adapter is bounded, fixed-destination, attributed, no-key truthful and does not persist search data", async () => {
  const count = await db.hardwareStore.count();
  const result = await searchPlaces(
    { lat: 11, lng: 77, radiusKm: 10, query: "hardware stores" },
    {
      key: "fixture-server-key",
      fetch: (async (url: any, options: any) => {
        expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
        expect(options.headers["X-Goog-Api-Key"]).toBe("fixture-server-key");
        expect(options.headers["X-Goog-FieldMask"]).not.toContain("*");
        expect(JSON.parse(options.body).pageSize).toBe(20);
        return new Response(
          JSON.stringify({
            places: [
              {
                id: "fixture-place",
                displayName: { text: "Fixture shop, not live" },
                formattedAddress: "Local fixture",
                location: { latitude: 11, longitude: 77 },
                attributions: [{ provider: "Fixture attribution" }],
              },
              {
                id: "far",
                displayName: { text: "Far" },
                location: { latitude: 12, longitude: 78 },
              },
            ],
          }),
        );
      }) as typeof fetch,
    },
  );
  expect(result.items).toHaveLength(1);
  expect(result.attribution).toBe("Google Maps");
  expect(result.items[0].attributions[0].provider).toBe("Fixture attribution");
  expect(await db.hardwareStore.count()).toBe(count);
  await expect(
    searchPlaces(
      { lat: 11, lng: 77, radiusKm: 10, query: "hardware" },
      { key: "" },
    ),
  ).rejects.toThrow("PLACES_NOT_CONFIGURED");
  const a = await fixtureAccount(db, "places-status");
  try {
    expect(
      (await (await a.ctx.get(base + "places/status")).json()).configured,
    ).toBe(false);
    expect(
      (
        await a.ctx.post(base + "places/search", {
          data: { lat: 11, lng: 77, query: "hardware stores" },
        })
      ).status(),
    ).toBe(503);
  } finally {
    await clean([a]);
  }
});
test("GitHub signed payload validation and read-only installation JWT/token scopes", async () => {
  const body = Buffer.from('{"repository":{"full_name":"example/repo"}}'),
    secret = "local-webhook-fixture",
    signature =
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  expect(verifyGithubSignature(body, signature, secret)).toBe(true);
  expect(
    verifyGithubSignature(Buffer.from("modified"), signature, secret),
  ).toBe(false);
  expect(verifyGithubSignature(body, "sha256=bad", secret)).toBe(false);
  const { generateKeyPair, exportPKCS8, decodeJwt } = await import("jose"),
    { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const token = await installationToken("123", {
    appId: "1234",
    privateKey: await exportPKCS8(privateKey),
    fetch: (async (url: any, options: any) => {
      expect(url).toBe(
        "https://api.github.com/app/installations/123/access_tokens",
      );
      const jwt = options.headers.Authorization.slice(7);
      expect(decodeJwt(jwt).iss).toBe("1234");
      expect(JSON.parse(options.body).permissions).toEqual({
        contents: "read",
        metadata: "read",
        pull_requests: "read",
        issues: "read",
      });
      return new Response('{"token":"fixture-installation-token"}');
    }) as typeof fetch,
  });
  expect(token).toBe("fixture-installation-token");
});
test("GitHub workspace permission and missing-provider states are enforced without fake success", async () => {
  const a = await fixtureAccount(db, "github-owner"),
    b = await fixtureAccount(db, "github-outsider");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    expect((await b.ctx.get(base + `workspaces/${p.id}/github`)).status()).toBe(
      403,
    );
    expect(
      await (await a.ctx.get(base + `workspaces/${p.id}/github`)).json(),
    ).toEqual({ linked: false });
    expect(
      (
        await a.ctx.put(base + `workspaces/${p.id}/github`, {
          data: { url: "https://evil.example/owner/repo" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.ctx.put(base + `workspaces/${p.id}/github`, {
          data: { url: "https://github.com/owner/repo", installationId: "123" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await a.ctx.post(base + "github/webhook", { data: {} })).status(),
    ).toBe(503);
  } finally {
    await clean([a, b]);
  }
});
test("outbox concurrent delivery claims each message once and redacts exhausted bodies", async () => {
  const email = "outbox-" + randomUUID() + "@example.com";
  try {
    await db.emailOutbox.createMany({
      data: [
        {
          recipient: email,
          subject: "Fixture1",
          body: "private token fixture",
        },
        {
          recipient: email,
          subject: "Fixture2",
          body: "private token fixture",
        },
      ],
    });
    const seen = new Map<string, number>();
    const send = async (row: any) => {
      seen.set(row.id, (seen.get(row.id) || 0) + 1);
    };
    await Promise.all([
      deliverOutbox(db, send, 10, { recipient: email }),
      deliverOutbox(db, send, 10, { recipient: email }),
    ]);
    expect([...seen.values()]).toEqual([1, 1]);
    expect(
      await db.emailOutbox.count({
        where: { recipient: email, status: "Sent", body: "" },
      }),
    ).toBe(2);
    const failed = await db.emailOutbox.create({
      data: { recipient: email, subject: "Fail", body: "secret", attempts: 4 },
    });
    await deliverOutbox(
      db,
      async () => {
        throw Error("SMTP unavailable");
      },
      10,
      { recipient: email },
    );
    const row = await db.emailOutbox.findUniqueOrThrow({
      where: { id: failed.id },
    });
    expect(row.status).toBe("Failed");
    expect(row.body).toBe("");
    const lease = await db.emailOutbox.create({
      data: {
        recipient: email,
        subject: "Crash recovery",
        body: "secret",
        status: "Sending",
        attempts: 5,
        nextAttemptAt: new Date(0),
      },
    });
    await deliverOutbox(db, send, 10, { recipient: email });
    expect(
      (await db.emailOutbox.findUniqueOrThrow({ where: { id: lease.id } }))
        .body,
    ).toBe("");
  } finally {
    await db.emailOutbox.deleteMany({ where: { recipient: email } });
  }
});
test("admin suspension revokes sessions, blocks OAuth session creation and records protected audit", async () => {
  const a = await fixtureAccount(db, "admin-user"),
    b = await fixtureAccount(db, "suspended-user");
  try {
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    expect((await b.ctx.get(base + "admin/audit")).status()).toBe(403);
    expect(
      (
        await a.ctx.patch(base + "admin/users/" + b.user.id, {
          data: {
            suspended: true,
            reason: "Automated abuse moderation fixture",
          },
        })
      ).status(),
    ).toBe(200);
    expect((await b.ctx.get(base + "me")).status()).toBe(401);
    expect(await db.session.count({ where: { userId: b.user.id } })).toBe(0);
    expect(
      (
        await b.ctx.post(base + "auth/login", {
          data: { email: b.email, password: "TestPassword2026!" },
        })
      ).status(),
    ).toBe(403);
    expect(
      await db.adminAudit.count({
        where: { targetId: b.user.id, action: "user.suspended" },
      }),
    ).toBe(1);
    expect(
      (
        await a.ctx.patch(base + "admin/users/" + a.user.id, {
          data: {
            suspended: true,
            reason: "Unsafe administrator self lockout",
          },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await a.ctx.patch(base + "admin/users/" + b.user.id, {
          data: {
            suspended: false,
            reason: "Restore after fixture validation",
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await b.ctx.post(base + "auth/login", {
          data: { email: b.email, password: "TestPassword2026!" },
        })
      ).status(),
    ).toBe(201);
  } finally {
    await clean([a, b]);
  }
});
test("project chat read boundaries preserve unseen arrivals and reject other-project markers", async () => {
  const a = await fixtureAccount(db, "chat-marker-owner"),
    b = await fixtureAccount(db, "chat-marker-member");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    await db.member.create({ data: { userId: b.user.id, projectId: p.id } });
    const m = await (
      await a.ctx.post(base + `workspaces/${p.id}/messages`, {
        data: { content: "First visible team update" },
      })
    ).json();
    const newer = await (
      await a.ctx.post(base + `workspaces/${p.id}/messages`, {
        data: { content: "Unseen arrival" },
      })
    ).json();
    expect(
      (
        await b.ctx.patch(base + `workspaces/${p.id}/messages/read`, {
          data: { throughId: m.id },
        })
      ).status(),
    ).toBe(200);
    const unread = await (await b.ctx.get(base + "workspaces/unread")).json();
    expect(unread.items.find((r: any) => r.projectId === p.id).unread).toBe(1);
    await b.ctx.patch(base + `workspaces/${p.id}/messages/read`, {
      data: { throughId: newer.id },
    });
    await b.ctx.patch(base + `workspaces/${p.id}/messages/read`, {
      data: { throughId: m.id },
    });
    expect(
      (await (await b.ctx.get(base + "workspaces/unread")).json()).items.find(
        (r: any) => r.projectId === p.id,
      ).unread,
    ).toBe(0);
    const other = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    expect(
      (
        await a.ctx.patch(base + `workspaces/${other.id}/messages/read`, {
          data: { throughId: m.id },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await clean([a, b]);
  }
});
test("browser assistant conversation streams template guidance and deletes private saved content", async ({
  page,
}) => {
  page.setDefaultTimeout(10000);
  const a = await fixtureAccount(db, "assistant-browser");
  try {
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await expect(
      page.getByRole("button", { name: "Edit your profile" }),
    ).toBeVisible();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "AI assistant", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Ask the assistant", exact: true })
      .fill("Help build a safe smart home sensor");
    await page
      .getByRole("button", { name: "Send to assistant", exact: true })
      .click();
    await expect(page.locator(".conversation-messages")).toContainText(
      "Built-in template guidance",
    );
    await expect(page.locator(".conversation-messages")).toContainText(
      "completed",
    );
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Delete conversation", exact: true })
      .click();
    await expect(page.locator(".conversation-messages")).not.toContainText(
      "Built-in template",
    );
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

test("AI quota ledger survives account deletion and same-email recreation; cancelled/deleted turns never resurrect", async () => {
  const a = await fixtureAccount(db, "quota-erasure");
  let replacement: any,
    ledgerId = "";
  try {
    const c = await db.aiConversation.create({
      data: { userId: a.user.id, title: "Deletion budget fixture" },
    });
    const { turn } = await reserveAssistant(
      a.user.id,
      c.id,
      randomUUID(),
      "Quota survives deletion",
    );
    ledgerId = turn.id;
    await db.aiTurn.update({
      where: { id: turn.id },
      data: { status: "streaming" },
    });
    await a.ctx.post(base + "assistant/turns/" + turn.id + "/cancel");
    expect(
      (await finishAssistant(turn.id, "completed", "Must not resurrect", 20))
        .count,
    ).toBe(0);
    expect(
      (await db.aiTurn.findUniqueOrThrow({ where: { id: turn.id } })).content,
    ).toBe("");
    const usage = await db.aiUsage.findUniqueOrThrow({
      where: { id: turn.id },
    });
    await db.aiUsage.update({ where: { id: turn.id }, data: { units: 20 } });
    expect(
      (
        await a.ctx.delete(base + "account", {
          data: { password: "TestPassword2026!" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await db.aiUsage.findUniqueOrThrow({ where: { id: turn.id } })).userId,
    ).toBe("deleted-user");
    replacement = await db.user.create({
      data: {
        email: a.email,
        name: "Recreated fixture",
        passwordHash: "unused",
        initials: "RR",
        skills: [],
        interests: [],
      },
    });
    const newer = await db.aiConversation.create({
      data: { userId: replacement.id, title: "Recreated conversation" },
    });
    await expect(
      reserveAssistant(
        replacement.id,
        newer.id,
        randomUUID(),
        "Attempt to bypass deletion quota",
      ),
    ).rejects.toThrow("Daily AI budget");
    expect(
      (await db.aiUsage.findUniqueOrThrow({ where: { id: turn.id } }))
        .identityHash,
    ).toBe(usage.identityHash);
    expect(await db.aiTurn.count({ where: { userId: replacement.id } })).toBe(
      0,
    );
  } finally {
    await db.aiUsage.deleteMany({ where: { id: ledgerId } });
    if (replacement)
      await db.user.deleteMany({ where: { id: replacement.id } });
    await clean([a]);
  }
});

test("AI expired leases stop generation and runtime budget validation fails closed", async () => {
  const a = await fixtureAccount(db, "expired-ai");
  try {
    const c = await db.aiConversation.create({
      data: { userId: a.user.id, title: "Lease timeout fixture" },
    });
    const { turn } = await reserveAssistant(
      a.user.id,
      c.id,
      randomUUID(),
      "Expired reservation",
    );
    await db.aiTurn.update({
      where: { id: turn.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await expireAssistant();
    expect(
      (await db.aiTurn.findUniqueOrThrow({ where: { id: turn.id } })).status,
    ).toBe("interrupted");
    expect(
      (await finishAssistant(turn.id, "completed", "Late content", 10)).count,
    ).toBe(0);
    expect(() => validateRuntimeConfig({ AI_DAILY_LIMIT: "NaN" })).toThrow(
      "positive integer",
    );
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: "production",
        OPENAI_API_KEY: "fixture",
      }),
    ).toThrow("AI_QUOTA_SECRET");
    expect(() =>
      validateRuntimeConfig({ GOOGLE_PLACES_ENABLED: "true" }),
    ).toThrow("server API key");
    expect(() =>
      validateRuntimeConfig({
        AI_DAILY_LIMIT: "20",
        NODE_ENV: "production",
        OPENAI_API_KEY: "fixture",
        AI_QUOTA_SECRET: "x".repeat(32),
        OPENAI_MODEL: "approved-fixture-model",
        AI_PRICING_MODEL: "approved-fixture-model",
        AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION: "10000000",
        AI_USER_DAILY_MICROUSD_BUDGET: "1000000",
        AI_PROJECT_DAILY_MICROUSD_BUDGET: "2000000",
        AI_GLOBAL_DAILY_MICROUSD_BUDGET: "10000000",
      }),
    ).not.toThrow();
  } finally {
    await clean([a]);
  }
});

test("browser verification and recovery links from test outbox are one-use and fragments are cleared", async ({
  page,
}) => {
  page.setDefaultTimeout(10000);
  const a = await fixtureAccount(db, "mail-browser");
  try {
    await a.ctx.post(base + "account/verification");
    let row = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: a.email, status: "Pending" },
    });
    const token = row.body.match(/token=([a-f0-9]{64})/)![1];
    await test.step("Open verification fragment", async () => {
      await page.goto("http://localhost:3000/account/verify#token=" + token, {
        waitUntil: "domcontentloaded",
      });
    });
    await page.getByLabel("Your profile name").fill("Mailbox owner");
    await page.getByLabel("New password").fill("MailboxChosenPassword2026!");
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("email is verified");
    expect(new URL(page.url()).hash).toBe("");
    await a.ctx.post(base + "account/forgot-password", {
      data: { email: a.email },
    });
    row = await db.emailOutbox.findFirstOrThrow({
      where: {
        recipient: a.email,
        status: "Pending",
        subject: { contains: "Reset" },
      },
    });
    const reset = row.body.match(/token=([a-f0-9]{64})/)![1];
    await test.step("Open recovery fragment", async () => {
      await page.goto("http://localhost:3000/account/reset#token=" + reset, {
        waitUntil: "domcontentloaded",
      });
    });
    await page
      .getByRole("textbox", { name: "New password", exact: true })
      .fill("BrowserNewPassword2026!");
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("reset");
    expect((await a.ctx.get(base + "me")).status()).toBe(401);
    expect(
      (
        await a.ctx.post(base + "auth/login", {
          data: { email: a.email, password: "BrowserNewPassword2026!" },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await a.ctx.post(base + "account/reset-password", {
          data: { token: reset, password: "AnotherPassword2026!" },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await clean([a]);
  }
});

test("new assistant, GitHub and administrator screens have no serious/critical accessibility violations", async ({
  page,
}) => {
  page.setDefaultTimeout(10000);
  const a = await fixtureAccount(db, "integration-accessibility");
  try {
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000");
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "AI assistant", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Ask the assistant", exact: true }),
    ).toBeVisible();
    let results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    await page.goto("http://localhost:3000/projects/" + p.id);
    await page
      .getByRole("button", { name: "Open project workspace", exact: true })
      .click();
    await page.getByRole("button", { name: "GitHub", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "GitHub repository", exact: true }),
    ).toBeVisible();
    results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    await page.goto("http://localhost:3000");
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Moderation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account moderation", exact: true }),
    ).toBeVisible();
    results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact || ""),
      ),
    ).toEqual([]);
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

test("project AI quotas and association permissions are independent of private conversation ownership", async () => {
  const a = await fixtureAccount(db, "ai-project-owner"),
    b = await fixtureAccount(db, "ai-project-other");
  try {
    const p = await (
      await a.ctx.post(base + "projects", { data: input })
    ).json();
    expect(
      (
        await b.ctx.post(base + "assistant/conversations", {
          data: { title: "Unauthorized project chat", projectId: p.id },
        })
      ).status(),
    ).toBe(403);
    const c = await (
      await a.ctx.post(base + "assistant/conversations", {
        data: { title: "Private project chat", projectId: p.id },
      })
    ).json();
    const { turn } = await reserveAssistant(
      a.user.id,
      c.id,
      randomUUID(),
      "Project budget reservation",
    );
    await a.ctx.post(base + "assistant/turns/" + turn.id + "/cancel");
    await db.aiUsage.update({
      where: { id: turn.id },
      data: {
        reservedTokens: 280000,
        identityHash: "separate-budget-identity",
        userId: "project-cost-fixture",
      },
    });
    await expect(
      reserveAssistant(a.user.id, c.id, randomUUID(), "Exceed project cost"),
    ).rejects.toThrow("Project AI budget");
    expect(
      (await b.ctx.get(base + "assistant/conversations/" + c.id)).status(),
    ).toBe(404);
    await db.aiUsage.deleteMany({ where: { id: turn.id } });
    expect(
      (
        await a.ctx.patch(base + `workspaces/${p.id}/project`, {
          data: { status: "Archived" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await a.ctx.delete(base + `workspaces/${p.id}/project`, {
          data: { confirmTitle: p.title },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await db.aiConversation.findUniqueOrThrow({ where: { id: c.id } }))
        .projectId,
    ).toBeNull();
  } finally {
    await clean([a, b]);
  }
});
