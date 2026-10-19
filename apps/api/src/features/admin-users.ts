import { telemetry, operationAlerts } from "../core/telemetry";
import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Req,
  HttpException,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import {
  db,
  uid,
  validate,
  lockUsers,
  socialTransaction,
} from "../core/security";
@Controller("api/admin")
export class AdminUsersController {
  @Get("users") async list(@Req() req: Request) {
    const actor = await uid(req);
    if (!(await db.user.findUniqueOrThrow({ where: { id: actor } })).isAdmin)
      throw new HttpException("Administrator required.", 403);
    const q = validate(
      z.object({
        q: z.string().trim().max(100).default(""),
        cursor: z.string().max(50).optional(),
      }),
      req.query,
    );
    const rows = await db.user.findMany({
      where: { name: { contains: q.q, mode: "insensitive" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 31,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        isAdmin: true,
        suspendedAt: true,
        createdAt: true,
      },
    });
    return {
      items: rows.slice(0, 30),
      nextCursor: rows.length > 30 ? rows[29].id : null,
    };
  }
  @Patch("users/:id") async suspension(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      v = validate(
        z
          .object({
            suspended: z.boolean(),
            reason: z.string().trim().min(10).max(500),
          })
          .strict(),
        b,
      );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, actor, id);
      const admin = await tx.user.findUniqueOrThrow({ where: { id: actor } }),
        target = await tx.user.findUniqueOrThrow({ where: { id } });
      if (!admin.isAdmin || admin.suspendedAt)
        throw new HttpException("Administrator required.", 403);
      if (id === actor || target.isAdmin)
        throw new HttpException(
          "Admin/self suspension requires an owner-operated procedure.",
          409,
        );
      await tx.user.update({
        where: { id },
        data: { suspendedAt: v.suspended ? new Date() : null },
      });
      if (v.suspended) {
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.aiTurn.updateMany({
          where: { userId: id, status: { in: ["reserved", "streaming"] } },
          data: { status: "cancelled", content: "" },
        });
      }
      await tx.adminAudit.create({
        data: {
          actorId: actor,
          action: v.suspended ? "user.suspended" : "user.restored",
          targetId: id,
          payload: { reason: v.reason },
        },
      });
      return { ok: true };
    });
  }
  @Get("audit") async audit(@Req() req: Request) {
    const actor = await uid(req);
    if (!(await db.user.findUniqueOrThrow({ where: { id: actor } })).isAdmin)
      throw new HttpException("Administrator required.", 403);
    const q = validate(
      z.object({ cursor: z.string().max(50).optional() }),
      req.query,
    );
    const rows = await db.adminAudit.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, 50),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }
  @Get("operations") async operations(@Req() req: Request) {
    const actor = await uid(req);
    if (!(await db.user.findUniqueOrThrow({ where: { id: actor } })).isAdmin)
      throw new HttpException("Administrator required.", 403);
    const [pendingMail, failedMail, storageBacklog, failedStorage, activeAi] =
      await Promise.all([
        db.emailOutbox.count({
          where: { status: { in: ["Pending", "Sending"] } },
        }),
        db.emailOutbox.count({ where: { status: "Failed" } }),
        db.storageDeletion.count(),
        db.storageDeletion.count({ where: { attempts: { gte: 5 } } }),
        db.aiTurn.count({
          where: { status: { in: ["reserved", "streaming"] } },
        }),
      ]);
    const [failedScans, quarantinedObjects, pendingScans] = await Promise.all([
      db.storageScan.count({ where: { status: { in: ["error", "failed"] } } }),
      db.storageScan.count({ where: { status: "quarantined" } }),
      db.storageScan.count({
        where: {
          status: { in: ["pending", "scanning", "development-unscanned"] },
        },
      }),
    ]);
    const queues = {
      failedScans,
      quarantinedObjects,
      pendingScans,
      pendingMail,
      failedMail,
      storageBacklog,
      failedStorage,
      activeAi,
    };
    return {
      ...queues,
      alerts: operationAlerts(queues),
      http: telemetry.snapshot(),
    };
  }
}
