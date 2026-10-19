import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient();
const queries = [
  [
    "recent unledgered plan",
    `SELECT id FROM "AiPlan" WHERE NOT "quotaLedgered" AND "createdAt">=now()-interval '48 hours' ORDER BY "createdAt",id LIMIT 501`,
    "AiPlan_pending_quota_idx",
  ],
  [
    "recent unledgered turn",
    `SELECT id FROM "AiTurn" WHERE NOT "quotaLedgered" AND "createdAt">=now()-interval '48 hours' ORDER BY "createdAt",id LIMIT 501`,
    "AiTurn_pending_quota_idx",
  ],
  [
    "scoped outgoing messages",
    `SELECT id FROM "Message" WHERE "senderId"='plan-check-nonexistent' AND id>'after-check' ORDER BY id LIMIT 101`,
    "Message_senderId_id_idx",
  ],
  [
    "scoped owned projects",
    `SELECT id FROM "Project" WHERE "ownerId"='plan-check-nonexistent' AND id>'after-check' ORDER BY id LIMIT 101`,
    "Project_ownerId_id_idx",
  ],
];
try {
  for (const [label, sql, index] of queries) {
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan=off`;
      return tx.$queryRawUnsafe("EXPLAIN (FORMAT JSON) " + sql);
    });
    const text = JSON.stringify(plan);
    const catalog =
      await db.$queryRaw`SELECT indisvalid,indisready FROM pg_index WHERE indexrelid=to_regclass(${`"${index}"`})`;
    if (
      catalog.length !== 1 ||
      !catalog[0].indisvalid ||
      !catalog[0].indisready
    )
      throw Error("Expected index invalid or absent: " + index);
    if (!text.includes("Index"))
      throw Error("No indexed access path selected: " + label);
    console.log(
      "PASS valid index exists: " +
        label +
        " -> " +
        index +
        "; exact index selected=" +
        text.includes(index),
    );
  }
  const history =
    await db.$queryRaw`SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const { readFile } = await import("node:fs/promises"),
    { createHash } = await import("node:crypto");
  for (const m of history) {
    const bytes = await readFile(
      "prisma/migrations/" + m.migration_name + "/migration.sql",
    );
    if (createHash("sha256").update(bytes).digest("hex") !== m.checksum)
      throw Error("Migration checksum mismatch");
  }
  console.log("PASS " + history.length + " applied migration checksums");
  console.log(
    "Scope: forced index availability on tiny local dataset, not normal planner choice or production query latency/load certification.",
  );
} finally {
  await db.$disconnect();
}
