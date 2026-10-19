import { GithubMetadataCache } from "../apps/api/src/core/github-metadata";
import { cursorKeys } from "../apps/api/src/core/cursor-keys";
import { searchPlaces } from "../apps/api/src/core/places";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Response, Request } from "express";
import { fixtureAccount } from "./fixtures";
import { fetchChatPage } from "../apps/web/app/components/chat-sync";
import { sseData } from "../apps/api/src/core/event-stream";
import { writeStream } from "../apps/api/src/core/stream-write";
import { GithubTokenCache } from "../apps/api/src/core/github-token-cache";
import { githubRequest } from "../apps/api/src/core/github-app";
import { HttpTelemetry, operationAlerts } from "../apps/api/src/core/telemetry";
import {
  chatPosition,
  parsePosition,
} from "../apps/api/src/core/chat-position";
const db = new PrismaClient(),
  base = "http://localhost:3001/api/";
test.afterAll(() => db.$disconnect());
async function clean(accounts: any[]) {
  const ids = accounts.map((a) => a.user.id);
  await db.message.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.connection.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  });
  await db.project.deleteMany({
    where: { ownerId: { in: accounts.map((a) => a.user.id) } },
  });
  await db.user.deleteMany({
    where: { id: { in: accounts.map((a) => a.user.id) } },
  });
  for (const a of accounts) await a.ctx.dispose();
}
test("bounded chat catch-up commits partial progress and reset is explicit", async () => {
  let calls = 0;
  const b = await fetchChatPage(
    async () => {
      calls++;
      return {
        items: Array.from({ length: 100 }, (_, id) => ({ id })),
        nextCursor: "next",
        afterPosition: "position",
      };
    },
    "messages/person",
    undefined,
    "old",
  );
  expect(calls).toBe(1);
  expect(b.items).toHaveLength(100);
  expect(b.afterPosition).toBe("position");
  const paths: string[] = [];
  const reset = await fetchChatPage(
    async (p) => {
      paths.push(p);
      if (p.includes("after"))
        throw Object.assign(Error(), { code: "CHAT_POSITION_EXPIRED" });
      return { items: [{ id: "recent" }] };
    },
    "messages/person",
    undefined,
    "deleted",
  );
  expect(reset.reset).toBe(true);
  expect(paths).toEqual([
    "messages/person?limit=100&after=deleted",
    "messages/person",
  ]);
  await expect(
    fetchChatPage(
      async () => {
        throw Error("network");
      },
      "messages/person",
      undefined,
      "old",
    ),
  ).rejects.toThrow("network");
});
test("chat positions cannot be forged using the caller's own session cookie", () => {
  const req = { cookies: { pc_session: "a".repeat(64) } } as Request;
  const token = chatPosition(
    { id: "row", createdAt: new Date() },
    "scope",
    req,
  )!;
  expect(parsePosition(token, "scope", req).id).toBe("row");
  expect(() => parsePosition(token, "different", req)).toThrow();
  expect(() =>
    parsePosition(token, "scope", {
      cookies: { pc_session: "b".repeat(64) },
    } as Request),
  ).toThrow();
  const payload = Buffer.from(
    JSON.stringify({
      id: "row",
      date: new Date(0).toISOString(),
      scope: "scope",
      expires: Date.now() + 99999,
    }),
  ).toString("base64url");
  const forgery =
    "p1." +
    payload +
    "." +
    createHmac("sha256", req.cookies.pc_session)
      .update("chat-position:" + payload)
      .digest("base64url");
  expect(() => parsePosition(forgery, "scope", req)).toThrow();
});
test("DM deleted boundaries, 205-row offline gap, token scope and revoked access", async () => {
  const a = await fixtureAccount(db, "position-a"),
    b = await fixtureAccount(db, "position-b"),
    c = await fixtureAccount(db, "position-c");
  try {
    await db.connection.create({
      data: {
        senderId: a.user.id,
        receiverId: b.user.id,
        userLowId: [a.user.id, b.user.id].sort()[0],
        userHighId: [a.user.id, b.user.id].sort()[1],
        status: "Accepted",
      },
    });
    await db.connection.create({
      data: {
        senderId: a.user.id,
        receiverId: c.user.id,
        userLowId: [a.user.id, c.user.id].sort()[0],
        userHighId: [a.user.id, c.user.id].sort()[1],
        status: "Accepted",
      },
    });
    const first = await db.message.create({
      data: {
        senderId: a.user.id,
        receiverId: b.user.id,
        content: "boundary",
        createdAt: new Date(Date.now() - 10000),
      },
    });
    const page = await (await a.ctx.get(base + "messages/" + b.user.id)).json();
    await db.message.delete({ where: { id: first.id } });
    await db.message.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        id: "reliable-" + randomUUID(),
        senderId: b.user.id,
        receiverId: a.user.id,
        content: "gap " + i,
        createdAt: new Date(Date.now() + i),
      })),
    });
    let boundary = page.afterPosition,
      total = 0;
    for (let i = 0; i < 3; i++) {
      const r = await a.ctx.get(
        base +
          `messages/${b.user.id}?limit=100&after=${encodeURIComponent(boundary)}`,
      );
      expect(r.status()).toBe(200);
      const body = await r.json();
      total += body.items.length;
      boundary = body.afterPosition;
    }
    expect(total).toBe(205);
    expect(
      (
        await (
          await a.ctx.get(base + `messages/${b.user.id}?after=${first.id}`)
        ).json()
      ).code,
    ).toBe("CHAT_POSITION_EXPIRED");
    expect(
      (
        await a.ctx.get(base + `messages/${b.user.id}?after=${first.id}`)
      ).status(),
    ).toBe(409);
    expect(
      (
        await a.ctx.get(
          base +
            `messages/${c.user.id}?after=${encodeURIComponent(page.afterPosition)}`,
        )
      ).status(),
    ).toBe(409);
    await db.connection.deleteMany({
      where: { senderId: a.user.id, receiverId: b.user.id },
    });
    expect(
      (
        await a.ctx.get(
          base + `messages/${b.user.id}?after=${encodeURIComponent(boundary)}`,
        )
      ).status(),
    ).toBe(403);
  } finally {
    await clean([a, b, c]);
  }
});
test("project deleted positions and parallel delivery idempotency remain scoped", async () => {
  const a = await fixtureAccount(db, "project-position"),
    b = await fixtureAccount(db, "project-outsider");
  try {
    const p = await db.project.create({
      data: {
        ownerId: a.user.id,
        title: "Reliability fixture",
        description: "Private chat fixture",
        tags: [],
        requiredSkills: [],
        positions: [],
        category: "IoT",
        city: "Test",
        members: { create: { userId: a.user.id, role: "Owner" } },
      },
    });
    const path = base + `workspaces/${p.id}/messages`,
      requestId = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        a.ctx.post(path, { data: { content: "single delivery", requestId } }),
      ),
    );
    expect(replies.map((r) => r.status())).toEqual(Array(8).fill(201));
    expect(
      new Set(await Promise.all(replies.map(async (r) => (await r.json()).id)))
        .size,
    ).toBe(1);
    expect(
      (
        await a.ctx.post(path, {
          data: { content: "altered retry", requestId },
        })
      ).status(),
    ).toBe(409);
    const confirmed = await (
      await a.ctx.get(path + "?requestId=" + requestId)
    ).json();
    expect(confirmed.status).toBe("committed");
    expect(Object.keys(confirmed).sort()).toEqual(["messageId", "status"]);
    expect(
      (await (await a.ctx.get(path + "?requestId=" + randomUUID())).json())
        .status,
    ).toBe("not_found");
    expect((await b.ctx.get(path + "?requestId=" + requestId)).status()).toBe(
      403,
    );
    const initial = await (await a.ctx.get(path)).json();
    await db.projectMessage.delete({ where: { id: initial.items[0].id } });
    await a.ctx.post(path, {
      data: { content: "after deletion", requestId: randomUUID() },
    });
    const next = await a.ctx.get(
      path + "?after=" + encodeURIComponent(initial.afterPosition),
    );
    expect(next.status()).toBe(200);
    expect((await next.json()).items[0].content).toBe("after deletion");
    expect(
      (
        await b.ctx.get(
          path + "?after=" + encodeURIComponent(initial.afterPosition),
        )
      ).status(),
    ).toBe(403);
  } finally {
    await clean([a, b]);
  }
});
test("stalled provider read cancellation settles even if upstream cancel hangs", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
      return new Promise(() => {});
    },
  });
  const pending = sseData(stream, controller.signal).next();
  controller.abort();
  await expect(pending).rejects.toThrow("CANCELLED");
  expect(cancelled).toBe(true);
});
test("SSE output backpressure handles drain, timeout, abort and listener cleanup", async () => {
  const res = Object.assign(new EventEmitter(), {
    write: () => false,
    destroyed: false,
    writableEnded: false,
  }) as unknown as Response;
  const controller = new AbortController();
  const pending = writeStream(res, "data", controller.signal, 1000);
  res.emit("drain");
  await pending;
  expect(res.listenerCount("close")).toBe(0);
  await expect(writeStream(res, "data", controller.signal, 10)).rejects.toThrow(
    "BACKPRESSURE_TIMEOUT",
  );
  expect(res.listenerCount("drain")).toBe(0);
  const stopped = writeStream(res, "data", controller.signal, 1000);
  controller.abort();
  await expect(stopped).rejects.toThrow("CANCELLED");
  expect(res.listenerCount("error")).toBe(0);
});
test("GitHub token single-flight, expiry, failure retry and in-flight revocation", async () => {
  let now = 1000,
    calls = 0;
  const cache = new GithubTokenCache(() => now, 2);
  const mint = async () => {
    calls++;
    return { token: "test-token-" + calls, expires: now + 3600000 };
  };
  const values = await Promise.all(
    Array.from({ length: 10 }, () => cache.get("repo", "42", mint)),
  );
  expect(calls).toBe(1);
  expect(new Set(values).size).toBe(1);
  now += 300001;
  await cache.get("repo", "42", mint);
  expect(calls).toBe(2);
  cache.invalidate("42");
  await cache.get("repo", "42", mint);
  expect(calls).toBe(3);
  await expect(
    cache.get("bad", "1", async () => {
      throw Error("denied");
    }),
  ).rejects.toThrow("denied");
  await cache.get("bad", "1", mint);
  expect(calls).toBe(4);
  let release!: (r: { token: string; expires: number }) => void;
  const old = cache.get(
    "race",
    "42",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  cache.invalidate("42");
  release({ token: "revoked", expires: now + 3600000 });
  await old;
  await cache.get("race", "42", mint);
  expect(calls).toBe(5);
  await expect(
    githubRequest(
      "/repos/owner/repo",
      undefined,
      async () =>
        new Response("{}", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    ),
  ).rejects.toThrow("GITHUB_RATE_LIMITED");
});
test("operations metrics bound cardinality, avoid private paths and expose alerts only to admin", async () => {
  const metrics = new HttpTelemetry(2);
  metrics.observe("GET /health", 200, 5);
  metrics.observe("GET /ready", 503, 150);
  for (let i = 0; i < 50; i++) metrics.observe("route" + i, 400, 20);
  const rows = metrics.snapshot().routes;
  expect(rows).toHaveLength(3);
  expect(rows.find((r) => r.route === "overflow")?.count).toBe(50);
  expect(
    operationAlerts({
      pendingMail: 100,
      failedMail: 1,
      storageBacklog: 101,
      failedStorage: 1,
      activeAi: 20,
    }),
  ).toHaveLength(5);
  const a = await fixtureAccount(db, "metrics");
  try {
    expect((await a.ctx.get(base + "admin/operations")).status()).toBe(403);
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const r = await a.ctx.get(base + "admin/operations");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.alerts).toBeInstanceOf(Array);
    expect(body.http.routes.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.http)).not.toContain(a.user.id);
    expect(JSON.stringify(body.http)).not.toContain(a.email);
  } finally {
    await clean([a]);
  }
});

test("Places contact and hours fields are billing-opt-in, schema bounded and transient", async () => {
  const masks: string[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    masks.push((options?.headers as any)["X-Goog-FieldMask"]);
    return new Response(
      JSON.stringify({
        places: [
          {
            id: "contact-fixture",
            displayName: { text: "Hardware fixture" },
            location: { latitude: 11, longitude: 77 },
            internationalPhoneNumber: "+91 0000000000",
            websiteUri: "https://example.com",
            currentOpeningHours: {
              openNow: true,
              weekdayDescriptions: ["Monday: 9–5"],
            },
          },
        ],
      }),
    );
  };
  const input = { lat: 11, lng: 77, radiusKm: 10, query: "hardware" };
  await searchPlaces(input, {
    key: "fixture",
    fetch: fetcher,
    contactDetails: false,
  });
  const result = await searchPlaces(input, {
    key: "fixture",
    fetch: fetcher,
    contactDetails: true,
  });
  expect(masks[0]).not.toContain("PhoneNumber");
  expect(masks[1]).toContain("places.currentOpeningHours");
  expect(result.items[0].currentOpeningHours?.openNow).toBe(true);
  expect(result.items[0].internationalPhoneNumber).toBe("+91 0000000000");
});

test("cursor signing keys support safe rotation and reject weak configured secrets", () => {
  const old = process.env.CHAT_POSITION_SECRET,
    previous = process.env.CHAT_POSITION_SECRET_PREVIOUS;
  const req = { cookies: { pc_session: "c".repeat(64) } } as Request;
  try {
    process.env.CHAT_POSITION_SECRET = "x".repeat(64);
    delete process.env.CHAT_POSITION_SECRET_PREVIOUS;
    const token = chatPosition(
      { id: "rotation", createdAt: new Date() },
      "scope",
      req,
    )!;
    process.env.CHAT_POSITION_SECRET = "y".repeat(64);
    process.env.CHAT_POSITION_SECRET_PREVIOUS = "x".repeat(64);
    expect(parsePosition(token, "scope", req).id).toBe("rotation");
    delete process.env.CHAT_POSITION_SECRET_PREVIOUS;
    expect(() => parsePosition(token, "scope", req)).toThrow();
    process.env.CHAT_POSITION_SECRET = "weak";
    expect(() => cursorKeys("CHAT_POSITION_SECRET")).toThrow("32 characters");
  } finally {
    if (old === undefined) delete process.env.CHAT_POSITION_SECRET;
    else process.env.CHAT_POSITION_SECRET = old;
    if (previous === undefined)
      delete process.env.CHAT_POSITION_SECRET_PREVIOUS;
    else process.env.CHAT_POSITION_SECRET_PREVIOUS = previous;
  }
});

test("public GitHub metadata refresh is bounded, single-flight, quota backed and never uses private credentials", async () => {
  let now = 1000,
    calls = 0,
    limited = false,
    budgetCalls = 0;
  const cache = new GithubMetadataCache(
    async (url, options) => {
      calls++;
      expect(String(url)).toBe("https://api.github.com/repos/owner/repo");
      expect((options?.headers as any).Authorization).toBeUndefined();
      if (limited)
        return new Response("{}", {
          status: 429,
          headers: { "retry-after": "60" },
        });
      return new Response(
        JSON.stringify({
          full_name: "owner/repo",
          stargazers_count: 12,
          updated_at: new Date(0).toISOString(),
          private: false,
        }),
      );
    },
    () => now,
    async () => {
      budgetCalls++;
      return true;
    },
  );
  await Promise.all(
    Array.from({ length: 10 }, () => cache.get("owner", "repo")),
  );
  expect(calls).toBe(1);
  expect(budgetCalls).toBe(1);
  now += 300001;
  await cache.refresh();
  expect(calls).toBe(2);
  limited = true;
  now += 300001;
  await expect(cache.get("owner", "repo")).rejects.toThrow(
    "GITHUB_RATE_LIMITED",
  );
  expect(calls).toBe(3);
  await expect(cache.get("owner", "repo")).rejects.toThrow(
    "GITHUB_RATE_LIMITED",
  );
  expect(calls).toBe(3);
  limited = false;
  now += 60001;
  await cache.get("owner", "repo");
  expect(calls).toBe(4);
  now += 900001;
  await cache.refresh();
  expect(calls).toBe(4);
});
