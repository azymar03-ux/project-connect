import { test, expect } from "@playwright/test";
import express from "express";
import { trustedProxies } from "../apps/api/src/core/proxy";
import { SharedLimiter, rateMiddleware } from "../apps/api/src/core/rate-limit";
test("proxy trust requires exact addresses and ignores spoofed forwarding from other peers", async () => {
  for (const raw of [
    "true",
    "1",
    "0.0.0.0/0",
    "10.0.0.0/8",
    "172.30.10.0/24",
    "::/0",
    "localhost",
    "127.0.0.1/8",
  ])
    expect(() => trustedProxies(raw)).toThrow();
  expect(trustedProxies()).toBe(false);
  const app = express(),
    limiter = new SharedLimiter();
  app.set("trust proxy", trustedProxies("192.0.2.2/32"));
  app.use(rateMiddleware(limiter));
  app.get("/api/test", (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const address = server.address() as any;
  const url = `http://127.0.0.1:${address.port}/api/test`;
  try {
    let r = await fetch(url, {
      headers: { "X-Forwarded-For": "198.51.100.9" },
    });
    expect((await r.json()).ip).toBe("127.0.0.1");
    app.set("trust proxy", trustedProxies("127.0.0.1/32"));
    r = await fetch(url, {
      headers: { "X-Forwarded-For": "203.0.113.66, 198.51.100.10" },
    });
    expect((await r.json()).ip).toBe("198.51.100.10");
    app.set("trust proxy", false);
    await Promise.all(
      Array.from({ length: 599 }, () => limiter.hit("read:127.0.0.1", 600)),
    );
    r = await fetch(url, { headers: { "X-Forwarded-For": "198.51.100.22" } });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
    expect(trustedProxies("::ffff:127.0.0.1/128")).toEqual([
      "::ffff:127.0.0.1/128",
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
