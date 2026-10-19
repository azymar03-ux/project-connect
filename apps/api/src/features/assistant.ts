import { writeStream } from "../core/stream-write";
import { backfillQuota } from "../core/ai-ledger";
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  Body,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  db,
  uid,
  validate,
  socialTransaction,
  lockUsers,
  member,
} from "../core/security";
import { projectLock } from "../core/project-access";
import { assistantStream, ChatMessage } from "../core/assistant-provider";
import {
  reserveAssistant,
  finishAssistant,
  expireAssistant,
} from "../core/assistant-state";
const active = new Map<string, AbortController>();
@Controller("api/assistant")
export class AssistantController {
  @Get("status") status() {
    return {
      providerConfigured: Boolean(process.env.OPENAI_API_KEY),
      mode: process.env.OPENAI_API_KEY ? "llm" : "template",
      dailyLimit: Number(process.env.AI_DAILY_LIMIT || 20),
      reservedTokensPerTurn: 14000,
      privacy:
        "Conversations are private to their creator. Enabling the live provider sends selected messages to it; no workspace files or team chat are sent.",
    };
  }
  @Get("conversations") async list(@Req() req: Request) {
    const userId = await uid(req);
    await expireAssistant();
    const q = validate(
      z.object({
        cursor: z.string().max(50).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      req.query,
    );
    if (
      q.cursor &&
      !(await db.aiConversation.findFirst({ where: { id: q.cursor, userId } }))
    )
      throw new HttpException("Invalid conversation cursor.", 400);
    const rows = await db.aiConversation.findMany({
      where: { userId },
      take: q.limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
    };
  }
  @Post("conversations") async create(@Req() req: Request, @Body() b: unknown) {
    const userId = await uid(req),
      v = validate(
        z
          .object({
            title: z.string().trim().min(3).max(100),
            projectId: z.string().max(50).optional(),
          })
          .strict(),
        b,
      );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      if (v.projectId) await projectLock(tx, v.projectId, userId, false, true);
      if ((await tx.aiConversation.count({ where: { userId } })) >= 100)
        throw new HttpException(
          "Conversation quota reached. Delete older conversations.",
          409,
        );
      return tx.aiConversation.create({ data: { ...v, userId } });
    });
  }
  @Get("conversations/:id") async get(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    await expireAssistant();
    const c = await db.aiConversation.findFirst({
      where: { id, userId },
      include: {
        turns: {
          take: 100,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            prompt: true,
            content: true,
            status: true,
            source: true,
            actualTokens: true,
            createdAt: true,
          },
        },
      },
    });
    if (!c) throw new HttpException("Conversation not found.", 404);
    return c;
  }
  @Delete("conversations/:id") async remove(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    const ids = await socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      const c = await tx.aiConversation.findFirst({ where: { id, userId } });
      if (!c) throw new HttpException("Conversation not found.", 404);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(984513)::text`;
      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const fill = await backfillQuota(tx, now, userId, 1000);
      if (fill.more)
        throw new HttpException(
          "AI usage reconciliation in progress. Retry shortly.",
          503,
        );
      const turns = await tx.aiTurn.findMany({
        where: { conversationId: id },
        select: { id: true },
      });
      await tx.aiTurn.updateMany({
        where: { conversationId: id },
        data: {
          status: "deleted",
          prompt: "",
          content: "",
          conversationId: null,
        },
      });
      await tx.aiConversation.delete({ where: { id } });
      return turns.map((t) => t.id);
    });
    for (const tid of ids) active.get(tid)?.abort();
    return {
      ok: true,
      note: "Content deleted; daily usage reservations retained.",
    };
  }
  @Post("turns/:id/cancel") async cancel(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    const turn = await db.aiTurn.findFirst({ where: { id, userId } });
    if (!turn) throw new HttpException("Turn not found.", 404);
    await db.aiTurn.updateMany({
      where: { id, userId, status: { in: ["reserved", "streaming"] } },
      data: { status: "cancelled", content: "" },
    });
    active.get(id)?.abort();
    return { ok: true };
  }
  @Post("conversations/:id/messages") async send(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
    @Body() b: unknown,
  ) {
    const userId = await uid(req),
      v = validate(
        z
          .object({
            prompt: z
              .string()
              .trim()
              .min(3)
              .max(4000)
              .refine(
                (s) => Buffer.byteLength(s, "utf8") <= 6000,
                "Message is too large in UTF-8.",
              ),
            requestId: z.uuid(),
            providerConsent: z.boolean().default(false),
          })
          .strict(),
        b,
      );
    if (process.env.OPENAI_API_KEY && !v.providerConsent)
      throw new HttpException("Explicit provider consent is required.", 400);
    await expireAssistant();
    const { turn, duplicate } = await reserveAssistant(
      userId,
      id,
      v.requestId,
      v.prompt,
    );
    if (duplicate) {
      return res.status(200).json({
        duplicate: true,
        turn: {
          id: turn.id,
          status: turn.status,
          content: turn.content,
          source: turn.source,
        },
      });
    }
    const controller = new AbortController();
    active.set(turn.id, controller);
    const abort = () => controller.abort();
    res.on("close", abort);
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const emit = (event: string, data: unknown) =>
      writeStream(
        res,
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        controller.signal,
      );
    let content = "",
      actualTokens: number | undefined;
    const watchdog = setInterval(() => {
      void db.aiTurn
        .findUnique({ where: { id: turn.id }, select: { status: true } })
        .then((r) => {
          if (!r || !["reserved", "streaming"].includes(r.status))
            controller.abort();
        })
        .catch(() => controller.abort());
    }, 1000);
    watchdog.unref();
    const timer = setTimeout(() => controller.abort(), 50000);
    try {
      await emit("start", { turnId: turn.id, source: turn.source });
      const history = await db.aiTurn.findMany({
        where: {
          conversationId: id,
          status: "completed",
          source: turn.source,
          id: { not: turn.id },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 4,
      });
      const messages: ChatMessage[] = [];
      let historyBytes = 0;
      for (const t of history.reverse()) {
        const bytes = Buffer.byteLength(t.prompt + t.content, "utf8");
        if (historyBytes + bytes > 4000) continue;
        messages.push(
          { role: "user", content: t.prompt },
          { role: "assistant", content: t.content },
        );
        historyBytes += bytes;
      }
      messages.push({ role: "user", content: v.prompt });
      const started = await db.aiTurn.updateMany({
        where: { id: turn.id, status: "reserved" },
        data: { status: "streaming" },
      });
      if (!started.count) throw Error("CANCELLED");
      for await (const event of assistantStream(messages, controller.signal)) {
        if (controller.signal.aborted) throw Error("CANCELLED");
        if (event.delta) {
          content += event.delta;
          if (content.length > 24000) throw Error("OUTPUT_LIMIT");
          await emit("delta", { text: event.delta });
        }
        if (event.tokens !== undefined) actualTokens = event.tokens;
      }
      const done = await finishAssistant(
        turn.id,
        "completed",
        content,
        actualTokens,
      );
      if (!done.count) throw Error("CANCELLED");
      await emit("done", {
        turnId: turn.id,
        source: turn.source,
        actualTokens,
        linksVerified: false,
      });
    } catch {
      const cancelled = controller.signal.aborted;
      await finishAssistant(
        turn.id,
        cancelled ? "cancelled" : "failed",
        "",
      ).catch(() => {});
      await writeStream(
        res,
        `event: failure\ndata: ${JSON.stringify({
          message: cancelled
            ? "Generation cancelled or connection interrupted."
            : "Provider failed. No response was saved. Your usage reservation is retained.",
          status: cancelled ? "cancelled" : "failed",
        })}\n\n`,
        new AbortController().signal,
        1000,
      ).catch(() => {});
    } finally {
      clearInterval(watchdog);
      clearTimeout(timer);
      res.off("close", abort);
      active.delete(turn.id);
      res.end();
    }
  }
}
