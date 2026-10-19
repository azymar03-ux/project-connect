import type { PrismaClient, Prisma } from "@prisma/client";
export async function deliverOutbox(
  db: PrismaClient,
  send: (row: {
    id: string;
    recipient: string;
    subject: string;
    body: string;
  }) => Promise<void>,
  limit = 10,
  filter: Prisma.EmailOutboxWhereInput = {},
) {
  const now = new Date();
  await db.emailOutbox.updateMany({
    where: { ...filter, status: "Sending", nextAttemptAt: { lt: now } },
    data: { status: "Pending" },
  });
  await db.emailOutbox.updateMany({
    where: { ...filter, status: "Pending", attempts: { gte: 5 } },
    data: { status: "Failed", body: "" },
  });
  const rows = await db.emailOutbox.findMany({
    where: {
      ...filter,
      status: "Pending",
      nextAttemptAt: { lte: now },
      attempts: { lt: 5 },
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  let sent = 0;
  for (const row of rows) {
    const attempt = row.attempts + 1,
      claimed = await db.emailOutbox.updateMany({
        where: { id: row.id, status: "Pending", attempts: row.attempts },
        data: {
          status: "Sending",
          attempts: attempt,
          nextAttemptAt: new Date(Date.now() + 600000),
        },
      });
    if (!claimed.count) continue;
    if (
      !(await db.emailOutbox.findFirst({
        where: {
          id: row.id,
          status: "Sending",
          attempts: attempt,
          body: row.body,
        },
      }))
    )
      continue;
    try {
      await send(row);
      await db.emailOutbox.updateMany({
        where: { id: row.id, status: "Sending", attempts: attempt },
        data: { status: "Sent", sentAt: new Date(), body: "" },
      });
      sent++;
    } catch {
      await db.emailOutbox.updateMany({
        where: { id: row.id, status: "Sending", attempts: attempt },
        data: {
          status: attempt >= 5 ? "Failed" : "Pending",
          body: attempt >= 5 ? "" : row.body,
          nextAttemptAt: new Date(Date.now() + 60000 * 2 ** row.attempts),
        },
      });
    }
  }
  await db.emailOutbox.deleteMany({
    where: {
      ...filter,
      createdAt: { lt: new Date(Date.now() - 7 * 86400000) },
      status: { not: "Sending" },
    },
  });
  return sent;
}
