import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomUUID } from "node:crypto";
import { fixtureAccount } from "./fixtures";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = (process.env.FIXTURE_API_URL || "") + "/api/";
test.skip(
  !process.env.FIXTURE_API_URL,
  "Dedicated test-only API with provider preload required.",
);
test.afterAll(() => db.$disconnect());
async function clean(accounts: any[]) {
  const ids = accounts.map((a) => a.user.id);
  await db.project.deleteMany({ where: { ownerId: { in: ids } } });
  await db.emailOutbox.deleteMany({
    where: { recipient: { in: accounts.map((a) => a.email) } },
  });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.aiUsage.deleteMany({ where: { userId: { in: ids } } });
  for (const a of accounts) await a.ctx.dispose();
}
test("HTTP OAuth start/callback verifies fixture RSA identity, cookie binding and rejects replay/wrong nonce", async () => {
  const a = await fixtureAccount(db, "oauth-http"),
    b = await request.newContext();
  let newId = "";
  const email = "oauth-http-" + randomUUID() + "@example.com";
  try {
    const start = await b.get(base + "auth/google/start", { maxRedirects: 0 });
    expect(start.status()).toBe(302);
    const u = new URL(start.headers().location),
      state = u.searchParams.get("state")!,
      nonce = u.searchParams.get("nonce")!;
    expect(u.hostname).toBe("accounts.google.com");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const wrong = await a.ctx.get(
      base +
        "auth/google/callback?" +
        new URLSearchParams({
          state,
          code: nonce + "|" + email + "|" + randomUUID(),
        }),
      { maxRedirects: 0 },
    );
    expect(wrong.headers().location).toContain("authError");
    const code = nonce + "|" + email + "|" + randomUUID(),
      url =
        base + "auth/google/callback?" + new URLSearchParams({ state, code });
    const success = await b.get(url, { maxRedirects: 0 });
    expect(success.headers().location).toContain("auth=google");
    const me = await (await b.get(base + "me")).json();
    newId = me.id;
    expect(me.name).toBe("Fixture Google User");
    expect(me.email).toBeUndefined();
    expect(
      (await b.get(url, { maxRedirects: 0 })).headers().location,
    ).toContain("authError");
    const badStart = await b.get(base + "auth/google/start", {
        maxRedirects: 0,
      }),
      bad = new URL(badStart.headers().location);
    expect(
      (
        await b.get(
          base +
            "auth/google/callback?" +
            new URLSearchParams({
              state: bad.searchParams.get("state")!,
              code: "wrong-nonce|" + email + "|bad-subject",
            }),
          { maxRedirects: 0 },
        )
      ).headers().location,
    ).toContain("authError");
    expect(
      await db.oAuthState.count({
        where: {
          stateHash: (await import("node:crypto"))
            .createHash("sha256")
            .update(bad.searchParams.get("state")!)
            .digest("hex"),
        },
      }),
    ).toBe(0);
  } finally {
    if (newId) await db.user.deleteMany({ where: { id: newId } });
    await clean([a]);
    await b.dispose();
  }
});
test("HTTP GitHub webhook uses raw-byte signature, deduplicates events and does not store payload/secrets", async () => {
  const a = await fixtureAccount(db, "webhook-http");
  const delivery = randomUUID();
  try {
    const p = await (
      await a.ctx.post(base + "projects", {
        data: {
          title: "Webhook fixture project",
          description: "Project for local provider fixtures only.",
          category: "IoT",
          tags: ["IoT"],
          requiredSkills: ["Python"],
          positions: ["Developer"],
          city: "Test",
          remote: true,
          teamSize: 3,
        },
      })
    ).json();
    expect(
      (
        await a.ctx.put(base + `workspaces/${p.id}/github`, {
          data: { url: "https://github.com/fixture/repo" },
        })
      ).status(),
    ).toBe(200);
    const activity = await (
      await a.ctx.get(base + `workspaces/${p.id}/github/activity`)
    ).json();
    expect(activity.commits[0].title).toBe("Fixture commit");
    expect(activity.commits[1].url).toBeNull();
    const payload = JSON.stringify({
        repository: { full_name: "fixture/repo" },
        privateContent: "Never persist this test field",
      }),
      headers = {
        "Content-Type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": delivery,
        "x-hub-signature-256":
          "sha256=" +
          createHmac("sha256", "fixture-webhook-secret")
            .update(payload)
            .digest("hex"),
      };
    expect(
      (
        await a.ctx.post(base + "github/webhook", {
          headers,
          data: payload + " ",
        })
      ).status(),
    ).toBe(401);
    const sent = await (
      await a.ctx.post(base + "github/webhook", { headers, data: payload })
    ).json();
    expect(sent.duplicate).toBe(false);
    expect(
      (
        await (
          await a.ctx.post(base + "github/webhook", { headers, data: payload })
        ).json()
      ).duplicate,
    ).toBe(true);
    expect(
      await db.auditEvent.count({
        where: { projectId: p.id, action: "github.push" },
      }),
    ).toBe(1);
    const events = await db.auditEvent.findMany({ where: { projectId: p.id } });
    expect(JSON.stringify(events)).not.toContain("Never persist");
    expect(
      (await db.githubLink.findUniqueOrThrow({ where: { projectId: p.id } }))
        .lastDeliveryAt,
    ).toBeTruthy();
  } finally {
    await db.githubDelivery.deleteMany({ where: { id: delivery } });
    await clean([a]);
  }
});
test("HTTP streamed provider consent, usage persistence, failure, truncation and live cancellation are enforced", async () => {
  const a = await fixtureAccount(db, "stream-http"),
    b = await fixtureAccount(db, "stream-other");
  try {
    const c = await (
      await a.ctx.post(base + "assistant/conversations", {
        data: { title: "Stream provider fixture" },
      })
    ).json();
    const path = base + `assistant/conversations/${c.id}/messages`;
    expect(
      (
        await a.ctx.post(path, {
          data: { prompt: "Consent test", requestId: randomUUID() },
        })
      ).status(),
    ).toBe(400);
    const r = await a.ctx.post(path, {
      data: {
        prompt: "Fixture provider works",
        requestId: randomUUID(),
        providerConsent: true,
      },
    });
    expect(await r.text()).toContain("event: done");
    const row = await db.aiTurn.findFirstOrThrow({
      where: { conversationId: c.id },
    });
    expect(row.status).toBe("completed");
    expect(row.actualTokens).toBe(50);
    for (const prompt of ["provider-failure", "truncated-provider"]) {
      const failed = await a.ctx.post(path, {
        data: { prompt, requestId: randomUUID(), providerConsent: true },
      });
      expect(await failed.text()).toContain("event: failure");
      expect(
        (
          await db.aiTurn.findFirstOrThrow({
            where: { conversationId: c.id, prompt },
          })
        ).content,
      ).toBe("");
    }
    const cookie = (await a.ctx.storageState()).cookies.find(
      (c) => c.name === "pc_session",
    )!;
    const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "pc_session=" + cookie.value,
        },
        body: JSON.stringify({
          prompt: "slow-provider cancel fixture",
          requestId: randomUUID(),
          providerConsent: true,
        }),
      }),
      reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const tid = JSON.parse(first.split("data: ")[1].split("\n")[0]).turnId;
    expect(
      (await b.ctx.post(base + "assistant/turns/" + tid + "/cancel")).status(),
    ).toBe(404);
    expect(
      (await a.ctx.post(base + "assistant/turns/" + tid + "/cancel")).status(),
    ).toBe(201);
    let end = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      end += new TextDecoder().decode(chunk.value);
    }
    expect(end).toContain("cancelled");
    expect(
      (await db.aiTurn.findUniqueOrThrow({ where: { id: tid } })).status,
    ).toBe("cancelled");
    expect(
      (await db.aiTurn.findUniqueOrThrow({ where: { id: tid } })).content,
    ).toBe("");
  } finally {
    await clean([a, b]);
  }
});
test("HTTP private registration is enumeration-neutral, queues verification without a session and never overwrites credentials", async () => {
  const ctx = await request.newContext();
  const email = "private-signup-" + randomUUID() + "@example.com";
  let id = "";
  try {
    const input = {
      email,
      name: "Private registration fixture",
      password: "OriginalPassword2026!",
    };
    const first = await ctx.post(base + "auth/register", { data: input });
    expect(first.status()).toBe(201);
    expect(first.headers()["set-cookie"]).toBeUndefined();
    expect((await ctx.get(base + "me")).status()).toBe(401);
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    id = u.id;
    const again = await ctx.post(base + "auth/register", {
      data: { ...input, password: "DifferentPassword2026!" },
    });
    expect(await first.json()).toEqual(await again.json());
    expect(
      (await db.user.findUniqueOrThrow({ where: { id } })).passwordHash,
    ).toBe(u.passwordHash);
    const outbox = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: email, status: "Pending" },
    });
    const token = outbox.body.match(/token=([a-f0-9]{64})/)![1];
    expect(
      (
        await ctx.post(base + "account/verify", {
          data: {
            token,
            password: "FreshMailboxPassword2026!",
            name: "Mailbox owner",
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await ctx.post(base + "auth/login", {
          data: { email, password: "FreshMailboxPassword2026!" },
        })
      ).status(),
    ).toBe(201);
    expect((await ctx.get(base + "me")).status()).toBe(200);
  } finally {
    await db.emailOutbox.deleteMany({ where: { recipient: email } });
    if (id) await db.user.deleteMany({ where: { id } });
    await ctx.dispose();
  }
});
test("HTTP Places fixtures retain attribution, enforce authenticated query controls and separate live-provider content", async () => {
  const a = await fixtureAccount(db, "places-http");
  try {
    const r = await a.ctx.post(base + "places/search", {
      data: { lat: 11, lng: 77, radiusKm: 10, query: "hardware store" },
    });
    expect(r.status()).toBe(201);
    const b = await r.json();
    expect(b.items[0].displayName.text).toContain("Test fixture");
    expect(b.items[0].attributions[0].provider).toBe(
      "Test fixture attribution",
    );
    expect(b.attribution).toBe("Google Maps");
    expect(
      await db.hardwareStore.count({
        where: { name: { contains: "Test fixture shop" } },
      }),
    ).toBe(0);
    expect(
      (
        await a.ctx.post(base + "places/search", {
          data: { lat: 91, lng: 77, query: "hardware" },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await clean([a]);
  }
});

test("HTTP public resource metadata uses safe schema and cache without private provider credentials", async () => {
  const a = await fixtureAccount(db, "public-metadata");
  let resource;
  try {
    resource = await db.resource.create({
      data: {
        title: "Fixture public repo",
        description: "Local HTTP fixture",
        url: "https://github.com/fixture/repo",
        type: "Repository",
        tags: [],
        submittedById: a.user.id,
        approved: true,
      },
    });
    const path = base + `resources/${resource.id}/github-metadata`;
    const first = await a.ctx.post(path);
    expect(first.status()).toBe(201);
    expect((await first.json()).stars).toBe(12);
    expect(await (await a.ctx.post(path)).json()).toEqual(await first.json());
    await db.resource.update({
      where: { id: resource.id },
      data: { approved: false },
    });
    expect((await a.ctx.post(path)).status()).toBe(404);
  } finally {
    if (resource) await db.resource.deleteMany({ where: { id: resource.id } });
    await clean([a]);
  }
});
