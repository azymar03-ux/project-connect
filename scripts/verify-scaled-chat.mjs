// Disposable fixtures only; never alter user messages or planner settings.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
try {
  process.loadEnvFile();
} catch {}
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw Error("Local scale fixture only");
const db = new PrismaClient();
let a, b, p;
try {
  const user = (label) => ({
    name: "Scale fixture " + label,
    email: "scale-" + randomUUID() + "@example.com",
    passwordHash: "not-a-login",
    initials: "SF",
    skills: [],
    interests: [],
  });
  a = await db.user.create({ data: user("a") });
  b = await db.user.create({ data: user("b") });
  p = await db.project.create({
    data: {
      ownerId: a.id,
      title: "Scale fixture",
      description: "Disposable query-plan fixture",
      category: "IoT",
      city: "Test",
      tags: [],
      requiredSkills: [],
      positions: [],
    },
  });
  for (let batch = 0; batch < 20; batch++) {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: "scale-" + randomUUID(),
      senderId: a.id,
      content: "Disposable load fixture",
      createdAt: new Date(1700000000000 + (batch * 500 + i) * 1000),
    }));
    await db.message.createMany({
      data: rows.map((r) => ({ ...r, receiverId: b.id })),
    });
    await db.projectMessage.createMany({
      data: rows.map((r) => ({
        ...r,
        id: "scale-" + randomUUID(),
        projectId: p.id,
      })),
    });
  }
  await db.$executeRawUnsafe('ANALYZE "Message"');
  await db.$executeRawUnsafe('ANALYZE "ProjectMessage"');
  const marker = new Date(1700000000000 + 5000 * 1000);
  for (const [label, sql, args] of [
    [
      "DM indexed direction",
      `SELECT id FROM "Message" WHERE ("senderId"=$1 AND "receiverId"=$2) AND ("createdAt">$3 OR ("createdAt"=$3 AND id>'')) ORDER BY "createdAt",id LIMIT 101`,
      [a.id, b.id, marker],
    ],
    [
      "Project forward",
      `SELECT id FROM "ProjectMessage" WHERE "projectId"=$1 AND ("createdAt">$2 OR ("createdAt"=$2 AND id>'')) ORDER BY "createdAt",id LIMIT 101`,
      [p.id, marker],
    ],
  ]) {
    const [plan] = await db.$queryRawUnsafe(
      "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + sql,
      ...args,
    );
    const root = plan["QUERY PLAN"][0];
    assert.ok(JSON.stringify(root).includes("Index"));
    assert.equal(root.Plan["Actual Rows"], 101);
    console.log(
      JSON.stringify({
        check: label,
        fixtureRows: 10000,
        returnedRows: root.Plan["Actual Rows"],
        executionMs: root["Execution Time"],
        plan: root.Plan["Node Type"],
        indexUsed: true,
      }),
    );
  }
  console.log(
    "PASS bounded 10,000-message-per-table local query experiment; not sustained production load/SLO proof",
  );
} finally {
  if (a && b)
    await db.message.deleteMany({
      where: { senderId: a.id, receiverId: b.id },
    });
  if (p) await db.project.delete({ where: { id: p.id } });
  await db.user.deleteMany({
    where: { id: { in: [a?.id, b?.id].filter(Boolean) } },
  });
  await db.$disconnect();
}
