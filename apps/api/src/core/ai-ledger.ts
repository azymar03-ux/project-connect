import { reservationMicroUsd } from "./ai-price";
import { createHmac } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { db } from "./security";
export function quotaIdentity(email: string) {
  const secret = process.env.AI_QUOTA_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.OPENAI_API_KEY &&
    !secret
  )
    throw new HttpException(
      "Provider quota identity secret is not configured.",
      503,
    );
  return createHmac(
    "sha256",
    secret || "projectconnect-local-development-quota-key",
  )
    .update(email.trim().toLowerCase())
    .digest("hex");
}
// Call only while holding advisory 984513. AiUsage deliberately has no foreign keys:
// worker must not acquire user/project locks after the global lock. Deletion takes
// user/project then global, and materializes its own ledger before erasing identity.
export async function backfillQuota(
  tx: Prisma.TransactionClient,
  now: Date,
  userId?: string,
  limit = 100,
  projectId?: string,
) {
  const since = new Date(now.getTime() - 48 * 3600000);
  const plans = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "AiPlan" WHERE NOT "quotaLedgered" AND "createdAt">=${since} AND (${userId || null}::text IS NULL OR "userId"=${userId || null}) AND (${projectId || null}::text IS NULL OR "projectId"=${projectId || null}) ORDER BY "createdAt",id LIMIT ${limit + 1}`;
  const turns = await tx.$queryRaw<
    { id: string }[]
  >`SELECT t.id FROM "AiTurn" t LEFT JOIN "AiConversation" c ON c.id=t."conversationId" WHERE NOT t."quotaLedgered" AND t."createdAt">=${since} AND (${userId || null}::text IS NULL OR t."userId"=${userId || null}) AND (${projectId || null}::text IS NULL OR c."projectId"=${projectId || null}) ORDER BY t."createdAt",t.id LIMIT ${limit + 1}`;
  const pids = plans.slice(0, limit).map((r) => r.id),
    tids = turns.slice(0, limit).map((r) => r.id);
  const [ps, ts] = await Promise.all([
    tx.aiPlan.findMany({
      where: { id: { in: pids } },
      select: {
        id: true,
        userId: true,
        projectId: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    }),
    tx.aiTurn.findMany({
      where: { id: { in: tids } },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        reservedTokens: true,
        actualTokens: true,
        user: { select: { email: true } },
        conversation: { select: { projectId: true } },
      },
    }),
  ]);
  const data = [
    ...ps.map((p) => ({
      id: p.id,
      userId: p.userId,
      projectId: p.projectId,
      createdAt: p.createdAt,
      identityHash: quotaIdentity(p.user.email),
      reservedTokens: 14000,
      reservedMicroUsd: reservationMicroUsd(14000),
    })),
    ...ts.map((t) => ({
      id: t.id,
      userId: t.userId,
      projectId: t.conversation?.projectId || null,
      createdAt: t.createdAt,
      identityHash: quotaIdentity(t.user.email),
      reservedTokens: Math.max(14000, t.reservedTokens, t.actualTokens || 0),
      reservedMicroUsd: reservationMicroUsd(
        Math.max(14000, t.reservedTokens, t.actualTokens || 0),
      ),
    })),
  ];
  if (data.length) await tx.aiUsage.createMany({ data, skipDuplicates: true });
  if (pids.length)
    await tx.aiPlan.updateMany({
      where: { id: { in: pids } },
      data: { quotaLedgered: true },
    });
  if (tids.length)
    await tx.aiTurn.updateMany({
      where: { id: { in: tids } },
      data: { quotaLedgered: true },
    });
  return {
    processed: data.length,
    more: plans.length > limit || turns.length > limit,
  };
}
export async function drainQuota() {
  // Bounded work per tick, separately committed so rejected reservations cannot
  // roll back the transition forever. A later tick resumes via partial indexes.
  for (let i = 0; i < 10; i++) {
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout='2s'`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(984513)::text`;
        const [{ now }] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp() AS now`;
        const result = await backfillQuota(tx, now, undefined, 500);
        if (process.env.OPENAI_API_KEY) {
          const old = await tx.aiUsage.findMany({
            where: {
              reservedMicroUsd: 0n,
              createdAt: { gte: new Date(now.getTime() - 86400000) },
            },
            take: 500,
          });
          for (const entry of old)
            await tx.aiUsage.update({
              where: { id: entry.id },
              data: {
                reservedMicroUsd: reservationMicroUsd(entry.reservedTokens),
              },
            });
          if (old.length === 500) result.more = true;
        }
        // Source tombstones may outlive the 48h ledger. Remove expired sources
        // from partial-index work queues without recreating expired identities.
        const expiredPlans =
          await tx.$executeRaw`UPDATE "AiPlan" SET "quotaLedgered"=true WHERE id IN (SELECT id FROM "AiPlan" WHERE NOT "quotaLedgered" AND "createdAt"<${new Date(now.getTime() - 48 * 3600000)} ORDER BY "createdAt",id LIMIT 500)`;
        const expiredTurns =
          await tx.$executeRaw`UPDATE "AiTurn" SET "quotaLedgered"=true WHERE id IN (SELECT id FROM "AiTurn" WHERE NOT "quotaLedgered" AND "createdAt"<${new Date(now.getTime() - 48 * 3600000)} ORDER BY "createdAt",id LIMIT 500)`;
        return {
          ...result,
          more: result.more || expiredPlans === 500 || expiredTurns === 500,
        };
      },
      { timeout: 10000 },
    );
    if (!result.more) return;
  }
}

export function startQuotaWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await drainQuota();
    } catch {
      console.error(
        JSON.stringify({
          level: "error",
          code: "AI_LEDGER_RECONCILIATION_FAILED",
        }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  void tick();
}
