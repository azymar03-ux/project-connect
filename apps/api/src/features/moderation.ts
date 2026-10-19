import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpException,
} from "@nestjs/common";
import { z } from "zod";
import type { Request } from "express";
import {
  db,
  uid,
  validate,
  PUBLIC_USER,
  lockUsers,
  socialTransaction,
} from "../core/security";
import { requireAdmin } from "./stores";
export async function isBlockedBetween(a: string, b: string) {
  return Boolean(
    await db.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    }),
  );
}
@Controller("api")
export class ModerationController {
  @Get("blocks") async blocks(@Req() req: Request) {
    const blockerId = await uid(req);
    return db.block.findMany({
      where: { blockerId },
      include: { blocked: { select: PUBLIC_USER } },
    });
  }
  @Post("blocks/:id") async block(
    @Param("id") blockedId: string,
    @Req() req: Request,
  ) {
    const blockerId = await uid(req);
    if (blockerId === blockedId)
      throw new HttpException("You cannot block yourself.", 400);
    if (!(await db.user.findUnique({ where: { id: blockedId } })))
      throw new HttpException("Person not found.", 404);
    await socialTransaction(async (tx) => {
      await lockUsers(tx, blockerId, blockedId);
      await tx.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      });
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        update: {},
        create: { blockerId, blockedId },
      });
      await tx.connection.deleteMany({
        where: {
          OR: [
            { senderId: blockerId, receiverId: blockedId },
            { senderId: blockedId, receiverId: blockerId },
          ],
        },
      });
    });
    return { blocked: true };
  }
  @Delete("blocks/:id") async unblock(
    @Param("id") blockedId: string,
    @Req() req: Request,
  ) {
    const blockerId = await uid(req);
    await socialTransaction(async (tx) => {
      await lockUsers(tx, blockerId, blockedId);
      await tx.block.deleteMany({ where: { blockerId, blockedId } });
    });
    return { blocked: false };
  }
  @Post("reports") async report(@Req() req: Request, @Body() b: unknown) {
    const reporterId = await uid(req);
    const v = validate(
      z.object({
        targetType: z.enum([
          "user",
          "project",
          "resource",
          "store",
          "activity",
        ]),
        targetId: z.string().min(1).max(40),
        reason: z.string().trim().min(10).max(1000),
      }),
      b,
    );
    const exists =
      v.targetType === "user"
        ? await db.user.findUnique({ where: { id: v.targetId } })
        : v.targetType === "project"
          ? await db.project.findUnique({ where: { id: v.targetId } })
          : v.targetType === "resource"
            ? await db.resource.findUnique({ where: { id: v.targetId } })
            : v.targetType === "store"
              ? await db.hardwareStore.findUnique({ where: { id: v.targetId } })
              : await db.activity.findUnique({ where: { id: v.targetId } });
    if (!exists) throw new HttpException("Reported item not found.", 404);
    await db.report.upsert({
      where: {
        reporterId_targetType_targetId: {
          reporterId,
          targetType: v.targetType,
          targetId: v.targetId,
        },
      },
      update: { reason: v.reason, status: "Pending" },
      create: { ...v, reporterId },
    });
    return { message: "Thanks. A moderator will review this report." };
  }
  @Get("admin/reports") async reports(@Req() req: Request) {
    await requireAdmin(req);
    const q = validate(
      z.object({
        paged: z.enum(["true"]).optional(),
        cursor: z.string().max(100).optional(),
      }),
      req.query,
    );
    const rows = await db.report.findMany({
      where: { status: "Pending" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: q.paged ? 51 : 100,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { reporter: { select: PUBLIC_USER } },
    });
    return q.paged
      ? {
          items: rows.slice(0, 50),
          nextCursor: rows.length > 50 ? rows[49].id : null,
        }
      : rows;
  }
  @Patch("admin/reports/:id") async resolve(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req);
    await requireAdmin(req);
    const { status, hideTarget } = validate(
      z.object({
        status: z.enum(["Resolved", "Dismissed"]),
        hideTarget: z.boolean().default(false),
      }),
      b,
    );
    const r = await db.report.findUnique({ where: { id } });
    if (!r) throw new HttpException("Report not found.", 404);
    return db.$transaction(async (tx) => {
      if (hideTarget && status === "Resolved") {
        if (r.targetType === "user")
          throw new HttpException(
            "Use Account moderation to suspend a user with an explicit reason.",
            400,
          );
        if (r.targetType === "activity")
          await tx.activity.updateMany({
            where: { id: r.targetId },
            data: { hiddenAt: new Date() },
          });
        if (r.targetType === "resource")
          await tx.resource.updateMany({
            where: { id: r.targetId },
            data: { approved: false },
          });
        if (r.targetType === "store")
          await tx.hardwareStore.updateMany({
            where: { id: r.targetId },
            data: { status: "Rejected" },
          });
        if (r.targetType === "project")
          await tx.project.updateMany({
            where: { id: r.targetId },
            data: { status: "Archived" },
          });
      }
      await tx.report.updateMany({
        where: {
          targetType: r.targetType,
          targetId: r.targetId,
          status: "Pending",
        },
        data: { status, resolvedAt: new Date() },
      });
      await tx.adminAudit.create({
        data: {
          actorId: actor,
          action: "report." + status.toLowerCase(),
          targetId: r.targetId,
          payload: { reportId: id, targetType: r.targetType, hideTarget },
        },
      });
      return { ok: true };
    });
  }
  @Get("admin/overview") async overview(@Req() req: Request) {
    await requireAdmin(req);
    const [users, projects, pendingReports, pendingStores, resources] =
      await Promise.all([
        db.user.count(),
        db.project.count(),
        db.report.count({ where: { status: "Pending" } }),
        db.hardwareStore.count({ where: { status: "Pending" } }),
        db.resource.count({ where: { approved: true } }),
      ]);
    return { users, projects, pendingReports, pendingStores, resources };
  }
}
