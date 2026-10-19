import { reservationMicroUsd } from "./ai-price";
import { quotaIdentity } from "./ai-ledger";
import { HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
export const TURN_RESERVATION = 14000;
export async function reserveBudget(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId?: string | null,
) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, suspendedAt: true },
  });
  if (user.suspendedAt) throw new HttpException("Account unavailable.", 403);
  const identityHash = quotaIdentity(user.email);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(984513)::text`;
  const [{ now }] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  const cost = reservationMicroUsd(TURN_RESERVATION);
  const since = new Date(now.getTime() - 86400000);
  // Fail closed if any recent source lacks a durable ledger. A bounded worker
  // commits the transition independently, including when a quota rejects us.
  const [{ pending }] = await tx.$queryRaw<
    { pending: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM "AiPlan" WHERE NOT "quotaLedgered" AND "createdAt">=${since}) OR EXISTS(SELECT 1 FROM "AiTurn" WHERE NOT "quotaLedgered" AND "createdAt">=${since}) AS pending`;
  if (pending)
    throw new HttpException(
      "AI usage reconciliation in progress. Retry shortly.",
      503,
    );
  const ledger = await tx.aiUsage.aggregate({
    where: { OR: [{ identityHash }, { userId }], createdAt: { gte: since } },
    _sum: { units: true, reservedTokens: true, reservedMicroUsd: true },
  });
  if (
    cost &&
    (await pricedUsage(
      tx,
      Prisma.sql`("identityHash"=${identityHash} OR "userId"=${userId}) AND "createdAt">=${since}`,
    )) +
      cost >
      BigInt(process.env.AI_USER_DAILY_MICROUSD_BUDGET || "1000000")
  )
    throw new HttpException("Daily AI cost budget reached.", 429);
  if (
    (ledger._sum.units || 0) >= Number(process.env.AI_DAILY_LIMIT || 20) ||
    (ledger._sum.reservedTokens || 0) + TURN_RESERVATION >
      Number(process.env.AI_DAILY_TOKEN_BUDGET || 140000)
  )
    throw new HttpException(
      "Daily AI budget reached. Try again tomorrow.",
      429,
    );
  const global = await tx.aiUsage.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { reservedTokens: true, reservedMicroUsd: true },
  });
  if (
    cost &&
    (await pricedUsage(tx, Prisma.sql`"createdAt">=${since}`)) + cost >
      BigInt(process.env.AI_GLOBAL_DAILY_MICROUSD_BUDGET || "10000000")
  )
    throw new HttpException("Service AI cost budget reached.", 429);
  if (
    (global._sum.reservedTokens || 0) + TURN_RESERVATION >
    Number(process.env.AI_GLOBAL_DAILY_TOKEN_BUDGET || 1400000)
  )
    throw new HttpException("Service AI budget reached.", 429);
  if (projectId) {
    const usage = await tx.aiUsage.aggregate({
      where: { projectId, createdAt: { gte: since } },
      _sum: { reservedTokens: true, reservedMicroUsd: true },
    });
    if (
      cost &&
      (await pricedUsage(
        tx,
        Prisma.sql`"projectId"=${projectId} AND "createdAt">=${since}`,
      )) +
        cost >
        BigInt(process.env.AI_PROJECT_DAILY_MICROUSD_BUDGET || "2000000")
    )
      throw new HttpException("Project AI cost budget reached.", 429);
    if (
      (usage._sum.reservedTokens || 0) + TURN_RESERVATION >
      Number(process.env.AI_PROJECT_DAILY_TOKEN_BUDGET || 280000)
    )
      throw new HttpException("Project AI budget reached.", 429);
  }
  return {
    identityHash,
    userId,
    createdAt: now,
    projectId: projectId || null,
    reservedTokens: TURN_RESERVATION,
    reservedMicroUsd: cost,
  };
}

async function pricedUsage(tx: Prisma.TransactionClient, scope: Prisma.Sql) {
  // Sum each row's conservative price, not max(sum(old), sum(new)), which
  // would undercount mixed old-price + unpriced legacy rows.
  const rate = BigInt(
    process.env.AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION || "10000000",
  );
  const [row] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`
    SELECT coalesce(sum(greatest("reservedMicroUsd",ceil("reservedTokens"::numeric*${rate}::numeric/1000000))),0)::bigint AS total
    FROM "AiUsage" WHERE ${scope}`);
  return row.total;
}
