import { reservationMicroUsd } from "./ai-price";
import { HttpException } from "@nestjs/common";
import { db, socialTransaction, lockUsers } from "./security";
import { reserveBudget, TURN_RESERVATION } from "./ai-budget";
import { projectLock } from "./project-access";
export async function reserveAssistant(
  userId: string,
  conversationId: string,
  requestId: string,
  prompt: string,
) {
  return socialTransaction(async (tx) => {
    await lockUsers(tx, userId);
    const c = await tx.aiConversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!c) throw new HttpException("Conversation not found.", 404);
    if (c.projectId) await projectLock(tx, c.projectId, userId, false, true);
    const existing = await tx.aiTurn.findUnique({
      where: { userId_requestId: { userId, requestId } },
    });
    if (existing) {
      if (
        existing.conversationId !== conversationId ||
        existing.prompt !== prompt
      )
        throw new HttpException(
          "Request ID already used for a different message.",
          409,
        );
      return { turn: existing, duplicate: true };
    }
    if (
      await tx.aiTurn.count({
        where: {
          userId,
          status: { in: ["reserved", "streaming"] },
          leaseExpiresAt: { gt: new Date() },
        },
      })
    )
      throw new HttpException(
        "A response is already generating. Cancel it before sending another.",
        409,
      );
    const budget = await reserveBudget(tx, userId, c.projectId);
    if ((await tx.aiTurn.count({ where: { conversationId } })) >= 100)
      throw new HttpException(
        "Conversation message limit reached. Start another conversation.",
        409,
      );
    const turn = await tx.aiTurn.create({
      data: {
        userId,
        quotaLedgered: true,
        reservedTokens: TURN_RESERVATION,
        conversationId,
        requestId,
        prompt,
        leaseExpiresAt: new Date(Date.now() + 60000),
        source: process.env.OPENAI_API_KEY ? "llm" : "template",
      },
    });
    await tx.aiUsage.create({ data: { id: turn.id, ...budget } });
    await tx.aiConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return { turn, duplicate: false };
  });
}
export async function finishAssistant(
  id: string,
  status: string,
  content: string,
  actualTokens?: number,
) {
  if (actualTokens !== undefined && actualTokens > TURN_RESERVATION) {
    await socialTransaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(984513)::text`;
      await tx.aiUsage.updateMany({
        where: { id },
        data: {
          reservedTokens: actualTokens,
          reservedMicroUsd: reservationMicroUsd(actualTokens),
        },
      });
    });
    console.error(
      JSON.stringify({
        level: "error",
        code: "AI_USAGE_EXCEEDED_RESERVATION",
        actualTokens,
      }),
    );
  }
  return db.aiTurn.updateMany({
    where: {
      id,
      status:
        status === "completed"
          ? "streaming"
          : { in: ["reserved", "streaming"] },
    },
    data: { status, content, actualTokens, leaseExpiresAt: new Date() },
  });
}
export async function expireAssistant() {
  return db.aiTurn.updateMany({
    where: {
      status: { in: ["reserved", "streaming"] },
      leaseExpiresAt: { lt: new Date() },
    },
    data: { status: "interrupted", content: "", leaseExpiresAt: new Date() },
  });
}
