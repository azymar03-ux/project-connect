// Local disposable 10k/table evaluation. Rollback removes all data atomically.
import { PrismaClient, Prisma } from "@prisma/client";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const require = createRequire(import.meta.url);
try {
  process.loadEnvFile();
} catch {}
if (
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw Error("Local evaluation only");
const db = new PrismaClient(),
  stamp = "evaluation-" + Date.now() + "-";
try {
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`INSERT INTO "User"(id,email,"passwordHash",name,role,bio,education,"portfolioUrl",city,skills,interests,initials,color,"createdAt")
      SELECT ${stamp}||g,${stamp}||g||'@example.com','not-a-login','Scale fixture','Developer','','','','Chennai',ARRAY['Python','TypeScript'],ARRAY['Robotics'],'SF','purple',now() FROM generate_series(1,10000) g`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO "Project"(id,title,description,image,tags,"requiredSkills",positions,category,city,remote,status,"teamSize","createdAt","ownerId")
      SELECT ${stamp}||g,'Scale fixture','Disposable evaluation','/images/drone.svg',ARRAY['Robotics'],ARRAY['Python'],ARRAY['Builder'],'Robotics','Chennai',true,'In progress',5,now(),${stamp}||g FROM generate_series(1,10000) g`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO "AiUsage"(id,"identityHash","userId","projectId",units,"reservedTokens","reservedMicroUsd","createdAt")
      SELECT ${stamp}||g,${stamp}||g,${stamp}||g,${stamp}||g,1,14000,140000,now() FROM generate_series(1,10000) g`);
      await tx.$executeRaw`ANALYZE "User"`;
      await tx.$executeRaw`ANALYZE "Project"`;
      await tx.$executeRaw`ANALYZE "AiUsage"`;
      const { matchSql } = require("../artifacts/api/core/recommendations.js");
      const score = matchSql(
        "projects",
        { skills: ["Python"], interests: ["Robotics"], city: "Chennai" },
        Prisma.sql`false`,
      );
      for (const [label, sql] of [
        [
          "priced-global-24h",
          Prisma.sql`SELECT coalesce(sum(greatest("reservedMicroUsd",ceil("reservedTokens"::numeric*10000000/1000000))),0)::bigint FROM "AiUsage" WHERE "createdAt">now()-interval '24 hours'`,
        ],
        [
          "ranking-public-10k",
          Prisma.sql`SELECT p.id,${score} AS score FROM "Project" p WHERE p.status<>'Archived' ORDER BY score DESC,p."createdAt" DESC,p.id DESC LIMIT 51`,
        ],
        [
          "sitemap-partitions-10k",
          Prisma.sql`WITH r AS(SELECT p.id,(row_number() OVER(ORDER BY p.id)-1)/10000 AS part FROM "Project" p WHERE status<>'Archived') SELECT min(id),max(id) FROM r GROUP BY part`,
        ],
      ]) {
        const plans = await tx.$queryRaw(
            Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,
          ),
          plan = plans[0]["QUERY PLAN"][0];
        console.log(
          JSON.stringify({
            label,
            executionMs: plan["Execution Time"],
            actualRows: plan.Plan["Actual Rows"],
            rootNode: plan.Plan["Node Type"],
            scope:
              "10k extra rows/table, one local process, SQL not endpoint SLA",
          }),
        );
      }
      throw Error("ROLLBACK_EVALUATION");
    },
    { timeout: 60000 },
  );
} catch (e) {
  if (e.message !== "ROLLBACK_EVALUATION") throw e;
  console.log(
    "PASS disposable 10000 users + projects + price rows rolled back",
  );
} finally {
  await db.$disconnect();
  await require("../artifacts/api/core/security.js").db.$disconnect();
}
