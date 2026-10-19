import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { fixtureAccount } from "./fixtures";
function monitor(base: string, token: string) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const p = spawn(process.execPath, ["scripts/check-operations.mjs"], {
      env: { ...process.env, MONITOR_BASE_URL: base, MONITOR_SESSION: token },
    });
    let output = "";
    p.stdout.on("data", (b) => (output += b));
    p.stderr.on("data", (b) => (output += b));
    p.on("close", (code) => resolve({ code, output }));
  });
}
test("monitor exits healthy/alert/failure, rejects redirects and redacts auth/private fields", async () => {
  let mode = "healthy";
  const token = "private-monitor-sentinel";
  const server = createServer((req, res) => {
    if (mode === "redirect") {
      res.writeHead(302, { Location: "/other" }).end();
      return;
    }
    if (req.url === "/api/ready") {
      res.writeHead(mode === "down" ? 503 : 200).end("{}");
      return;
    }
    expect(req.headers.cookie).toBe("pc_session=" + token);
    res.setHeader("Content-Type", "application/json");
    if (mode === "unauthorized") {
      res.writeHead(401).end("{}");
      return;
    }
    res.end(
      JSON.stringify(
        mode === "invalid"
          ? {}
          : {
              alerts:
                mode === "alert"
                  ? [
                      {
                        code: "MAIL_FAILED",
                        severity: "critical",
                        message: "private-sentinel",
                      },
                    ]
                  : [],
              pendingMail: 0,
              failedMail: mode === "alert" ? 1 : 0,
              storageBacklog: 0,
              failedStorage: 0,
              activeAi: 0,
              secret: "private-sentinel",
            },
      ),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port;
  try {
    for (const [scenario, code] of [
      ["healthy", 0],
      ["alert", 2],
      ["unauthorized", 1],
      ["invalid", 1],
      ["down", 1],
      ["redirect", 1],
    ] as const) {
      mode = scenario;
      const result = await monitor(base, token);
      expect(result.code, scenario).toBe(code);
      expect(result.output).not.toContain(token);
      expect(result.output).not.toContain("private-sentinel");
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("monitor authenticates real operations endpoint and rejects an ordinary user", async () => {
  const db = new PrismaClient(),
    a = await fixtureAccount(db, "monitor");
  try {
    const token = (await a.ctx.storageState()).cookies[0].value;
    const denied = await monitor("http://localhost:3001", token);
    expect(denied.code).toBe(1);
    expect(denied.output).toContain("MONITOR_SESSION_REQUIRES_RENEWAL");
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const allowed = await monitor("http://localhost:3001", token);
    expect([0, 2]).toContain(allowed.code);
    expect(
      JSON.parse(allowed.output).queues.pendingMail,
    ).toBeGreaterThanOrEqual(0);
    expect(allowed.output).not.toContain(token);
  } finally {
    await a.ctx.dispose();
    await db.user.delete({ where: { id: a.user.id } });
    await db.$disconnect();
  }
});

test("deployment preflight fails closed without configuration and does not print malformed secret values", async () => {
  const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
  await mkdir(".arena", { recursive: true, mode: 0o700 });
  const root = await mkdtemp(".arena/preflight-");
  const run = (file: string) =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
      const p = spawn(process.execPath, ["scripts/check-deployment.mjs"], {
        env: { ...process.env, DEPLOY_ENV_FILE: file },
      });
      let output = "";
      p.stdout.on("data", (b) => (output += b));
      p.stderr.on("data", (b) => (output += b));
      p.on("close", (code) => resolve({ code, output }));
    });
  try {
    expect((await run(root + "/missing")).code).toBe(2);
    await writeFile(
      root + "/bad.env",
      "PUBLIC_APP_URL=secret-value-not-a-url\nCHAT_POSITION_SECRET=too-short-secret\n",
      { mode: 0o600 },
    );
    const result = await run(root + "/bad.env");
    expect(result.code).toBe(2);
    expect(result.output).toContain("Invalid PUBLIC_APP_URL");
    expect(result.output).not.toContain("too-short-secret");
    expect(result.output).not.toContain("secret-value-not-a-url");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
