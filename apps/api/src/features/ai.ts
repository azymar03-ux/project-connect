import { roadmapRequestSchema } from "../contracts";
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  HttpException,
} from "@nestjs/common";
import { z } from "zod";
import type { Request } from "express";
import { reserveBudget } from "../core/ai-budget";
import { projectLock } from "../core/project-access";
import { projectWrite } from "../core/project-access";
import { db, uid, validate, member, socialTransaction } from "../core/security";
import { templatePlan, llmPlan, planSchema } from "./planner";
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 20);
@Controller("api/ai")
export class AiController {
  @Get("status") status() {
    return {
      llmConfigured: Boolean(process.env.OPENAI_API_KEY),
      dailyLimit: DAILY_LIMIT,
    };
  }
  @Get("plans") async plans(@Req() req: Request) {
    const userId = await uid(req);
    return db.aiPlan.findMany({
      where: { userId, source: { notIn: ["pending", "deleted"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }
  @Delete("plans/:id") async remove(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    if (
      !(
        await db.aiPlan.updateMany({
          where: { id, userId },
          data: { source: "deleted", prompt: "", plan: {} },
        })
      ).count
    )
      throw new HttpException("Plan not found.", 404);
    return { ok: true };
  }
  @Post("plan") async plan(@Req() req: Request, @Body() b: unknown) {
    const userId = await uid(req);
    const { prompt, projectId, providerConsent } = validate(
      roadmapRequestSchema,
      b,
    );
    if (process.env.OPENAI_API_KEY && !providerConsent)
      throw new HttpException("Explicit provider consent is required.", 400);
    if (projectId) await member(projectId, userId);
    const reserved = await socialTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (projectId) await projectLock(tx, projectId, userId, false, true);
      const budget = await reserveBudget(tx, userId, projectId);
      const plan = await tx.aiPlan.create({
        data: {
          userId,
          projectId,
          prompt,
          source: "pending",
          plan: {},
          quotaLedgered: true,
        },
      });
      await tx.aiUsage.create({ data: { id: plan.id, ...budget } });
      return plan;
    });
    let plan = templatePlan(prompt),
      source = "template";
    try {
      const l = await llmPlan(prompt);
      if (l) {
        plan = l;
        source = "llm";
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          level: "warn",
          code: "LLM_FALLBACK",
          errorType: e instanceof Error ? e.message.slice(0, 40) : "unknown",
        }),
      );
    }
    const resources = await db.resource.findMany({
      where: { approved: true, tags: { hasSome: plan.resourceTags } },
      take: 5,
      select: { id: true, title: true, url: true, type: true },
    });
    const updated = await db.aiPlan.updateMany({
      where: { id: reserved.id, source: "pending" },
      data: { source, plan: { ...plan, resources } },
    });
    if (!updated.count)
      throw new HttpException(
        "Plan was deleted or account changed while generating.",
        409,
      );
    const saved = await db.aiPlan.findUniqueOrThrow({
      where: { id: reserved.id },
    });
    return saved;
  }
  @Post("plans/:id/tasks") async toTasks(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req);
    const { projectId } = validate(
      z.object({ projectId: z.string().max(40) }),
      b,
    );
    await member(projectId, userId);
    const p = await db.aiPlan.findUnique({ where: { id } });
    if (!p || p.userId !== userId || ["pending", "deleted"].includes(p.source))
      throw new HttpException("Plan not found.", 404);
    const plan = planSchema.parse(p.plan);
    return projectWrite(projectId, userId, false, async (tx) => {
      if (
        !(await tx.member.findUnique({
          where: { projectId_userId: { projectId, userId } },
        }))
      )
        throw new HttpException("Project membership is required.", 403);
      const existing = new Set(
        (
          await tx.task.findMany({
            where: { projectId },
            select: { title: true },
          })
        ).map((t) => t.title),
      );
      const count = await tx.task.count({ where: { projectId } });
      const fresh = plan.steps.filter((s) => !existing.has(s.title));
      if (count + fresh.length > 200)
        throw new HttpException(
          "This would exceed the workspace task limit.",
          409,
        );
      for (const [i, s] of fresh.entries())
        await tx.task.create({
          data: {
            projectId,
            title: s.title,
            description: s.detail,
            position: count + i,
          },
        });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: "roadmap.imported",
          payload: { planId: id, created: fresh.length },
        },
      });
      return {
        created: fresh.length,
        skipped: plan.steps.length - fresh.length,
      };
    });
  }
}
