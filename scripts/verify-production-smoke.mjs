import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
try {
  process.loadEnvFile();
} catch {}
const api = "http://localhost:3003/api/",
  web = "http://localhost:3002",
  db = new PrismaClient();
let user;
try {
  for (const [label, url] of [
    ["built web", web],
    ["built web to production API proxy", web + "/api/ready"],
    ["production API Redis + DB readiness", api + "ready"],
  ]) {
    const r = await fetch(url);
    assert.equal(r.status, 200);
    console.log("PASS " + label + " HTTP 200");
  }
  const login = await fetch(api + "auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: web },
    body: JSON.stringify({
      email: "demo@projectconnect.dev",
      password: "BuildTogether2026!",
    }),
  });
  assert.equal(login.status, 201);
  const profile = await login.json(),
    cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  console.log(
    "PASS production session cookie HttpOnly + Secure + SameSite=Lax",
  );
  for (const endpoint of ["me", "feed", "notifications", "unread"]) {
    const r = await fetch(web + "/api/" + endpoint, {
      headers: { Cookie: cookie.split(";")[0] },
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /no-store/);
    assert.ok(r.headers.get("x-request-id"));
    console.log(
      "PASS built web authenticated production " +
        endpoint +
        " private/no-store",
    );
  }
  const forbidden = await fetch(web + "/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie.split(";")[0], Origin: "https://evil.example" },
  });
  assert.equal(forbidden.status, 403);
  console.log("PASS production exact-origin rejection through built proxy");
  user = await db.user.create({
    data: {
      name: "Production gate fixture",
      email: "smoke-" + randomBytes(8).toString("hex") + "@example.com",
      passwordHash: "unused-local-fixture",
      initials: "SG",
      skills: [],
      interests: [],
    },
  });
  const signup = await fetch(web + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: web },
    body: JSON.stringify({
      name: "Duplicate fixture",
      email: user.email,
      password: "PrivateRegistration2026!",
    }),
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.headers.get("set-cookie"), null);
  assert.equal((await signup.json()).id, undefined);
  console.log(
    "PASS production private registration returns neutral acknowledgement without session",
  );
  const webHeaders = await fetch(web);
  assert.match(
    webHeaders.headers.get("content-security-policy"),
    /object-src 'none'/,
  );
  console.log("PASS built web production baseline CSP");
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const input = {
    title: "Verification gate fixture project",
    description:
      "Local fixture project verifying production email publication gate.",
    category: "IoT",
    tags: ["sensor"],
    requiredSkills: ["Python"],
    positions: ["Developer"],
    city: "Test",
    remote: true,
    teamSize: 3,
  };
  const blocked = await fetch(web + "/api/projects", {
    method: "POST",
    headers: {
      Cookie: "pc_session=" + token,
      "Content-Type": "application/json",
      Origin: web,
    },
    body: JSON.stringify(input),
  });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, "EMAIL_VERIFICATION_REQUIRED");
  await db.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date() },
  });
  const accepted = await fetch(web + "/api/projects", {
    method: "POST",
    headers: {
      Cookie: "pc_session=" + token,
      "Content-Type": "application/json",
      Origin: web,
    },
    body: JSON.stringify(input),
  });
  assert.equal(accepted.status, 201);
  console.log(
    "PASS production unverified publishing denied; verified publishing accepted",
  );
  const samples = [],
    statuses = {};
  for (let batch = 0; batch < 5; batch++)
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const start = performance.now(),
          r = await fetch(web + "/api/discovery/projects?limit=12");
        await r.arrayBuffer();
        samples.push(performance.now() - start);
        statuses[r.status] = (statuses[r.status] || 0) + 1;
      }),
    );
  samples.sort((a, b) => a - b);
  assert.equal(statuses[200], 50);
  console.log(
    "PASS bounded local built-proxy discovery concurrency smoke: " +
      JSON.stringify({
        requests: 50,
        concurrency: 10,
        statuses,
        p50Ms: Math.round(samples[24]),
        p95Ms: Math.round(samples[47]),
      }),
  );
  await fetch(web + "/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie.split(";")[0], Origin: web },
  });
  console.log(
    "Scope: built web proxy routes to production API3003. HTTP local header-level secure-cookie validation only; NOT real browser HTTPS, Docker/Caddy deployment, or production load certification.",
  );
} finally {
  if (user) {
    await db.project.deleteMany({ where: { ownerId: user.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  }
  await db.$disconnect();
}
