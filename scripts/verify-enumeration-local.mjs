import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
try {
  process.loadEnvFile();
} catch {}
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw Error("Local fixture only");
const db = new PrismaClient(),
  stamp = randomBytes(12).toString("hex"),
  groups = { existing: [], unknown: [] };
let user;
try {
  user = await db.user.create({
    data: {
      email: stamp + "@example.com",
      name: "Enumeration fixture",
      passwordHash: await hash("fixture-never-published-password", 12),
      initials: "EF",
      skills: [],
      interests: [],
    },
  });
  const canonical = [];
  // 16 randomized-order requests, under the real shared auth limiter. No evasion.
  const order = Array.from({ length: 8 }, () => ["existing", "unknown"])
    .flat()
    .sort(() => Math.random() - 0.5);
  for (const group of order) {
    const at = performance.now(),
      r = await fetch("http://localhost:3001/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:
            group === "existing"
              ? user.email
              : "unknown-" + stamp + "@example.com",
          password: "intentionally-wrong-password",
        }),
      });
    const b = await r.json();
    if (r.status !== 401)
      throw Error(
        "Expected auth401; rate limit or service failure must not be ignored",
      );
    if (r.headers.get("set-cookie")) throw Error("Failed auth set a cookie");
    canonical.push(
      JSON.stringify({ status: r.status, message: b.message, code: b.code }),
    );
    groups[group].push(performance.now() - at);
  }
  if (new Set(canonical).size !== 1)
    throw Error("Observable error envelope enumeration difference");
  const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length,
    median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  let greater = 0,
    ties = 0;
  for (const x of groups.existing)
    for (const y of groups.unknown) {
      if (x > y) greater++;
      if (x === y) ties++;
    }
  const delta =
    (2 * greater + ties) / (groups.existing.length * groups.unknown.length) - 1;
  console.log(
    JSON.stringify({
      samplesPerGroup: 8,
      existingMeanMs: mean(groups.existing),
      unknownMeanMs: mean(groups.unknown),
      existingMedianMs: median(groups.existing),
      unknownMedianMs: median(groups.unknown),
      cliffsDelta: delta,
      statusAndEnvelopeIdentical: true,
      noSessionCookie: true,
      scope:
        "small local exploratory timing sample, randomized order, NOT statistical resistance certification; independent high-sample signup/recovery/abuse evaluation remains",
    }),
  );
} finally {
  if (user) await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
}
