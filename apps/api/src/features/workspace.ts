import {
  chatPosition,
  parsePosition,
  positionFilter,
} from "../core/chat-position";
import { backfillQuota } from "../core/ai-ledger";
import { retireImage } from "../core/public-image";
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
import type { Prisma } from "@prisma/client";
import { alert } from "./social";
import { db, uid, validate, PUBLIC_USER, member } from "../core/security";
import { projectWrite } from "../core/project-access";
const labels = z
  .array(z.string().trim().min(1).max(30))
  .max(10)
  .refine(
    (v) => new Set(v.map((s) => s.toLowerCase())).size === v.length,
    "Labels must be unique.",
  );
const taskInput = z
  .object({
    title: z.string().trim().min(3).max(150),
    description: z.string().max(3000).default(""),
    status: z.enum(["Todo", "In progress", "Done"]).default("Todo"),
    assigneeId: z.string().max(50).nullable().optional(),
    dueDate: z.iso.datetime().nullable().optional(),
    labels: labels.default([]),
    position: z.number().int().min(0).max(100000).optional(),
  })
  .strict();
async function assignee(
  tx: Prisma.TransactionClient,
  projectId: string,
  id: string | null | undefined,
) {
  if (
    id &&
    !(await tx.member.findUnique({
      where: { projectId_userId: { projectId, userId: id } },
    }))
  )
    throw new HttpException("Assignee must be a project member.", 400);
}
const projectInput = z
  .object({
    title: z.string().trim().min(5).max(100).optional(),
    description: z.string().trim().min(20).max(5000).optional(),
    status: z.enum(["Idea", "In progress", "Completed", "Archived"]).optional(),
    category: z
      .enum(["Robotics", "IoT", "AI & ML", "Web development", "Design"])
      .optional(),
    tags: z.array(z.string().trim().min(1).max(40)).min(1).max(10).optional(),
    requiredSkills: z
      .array(z.string().trim().min(1).max(40))
      .min(1)
      .max(10)
      .optional(),
    positions: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(10)
      .optional(),
    city: z.string().trim().max(100).optional(),
    remote: z.boolean().optional(),
    teamSize: z.number().int().min(2).max(30).optional(),
    image: z
      .enum([
        "/images/drone.svg",
        "/images/agriculture.svg",
        "/images/energy.svg",
      ])
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Specify a change.");
@Controller("api/workspaces")
export class WorkspaceController {
  @Get(":id") async get(@Param("id") id: string, @Req() req: Request) {
    await member(id, await uid(req));
    return db.project.findUniqueOrThrow({
      where: { id },
      include: {
        members: { include: { user: { select: PUBLIC_USER } } },
        tasks: { orderBy: [{ position: "asc" }, { id: "asc" }], take: 200 },
        milestones: { take: 100, orderBy: [{ dueDate: "asc" }, { id: "asc" }] },
        resources: {
          where: { resource: { approved: true } },
          include: { resource: true },
        },
        auditEvents: { take: 50, orderBy: { createdAt: "desc" } },
      },
    });
  }
  @Post(":id/tasks") async create(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req),
      v = validate(taskInput, b);
    return projectWrite(projectId, userId, false, async (tx) => {
      await assignee(tx, projectId, v.assigneeId);
      if ((await tx.task.count({ where: { projectId } })) >= 200)
        throw new HttpException("Task limit reached for this workspace.", 409);
      const max = await tx.task.aggregate({
        where: { projectId },
        _max: { position: true },
      });
      const task = await tx.task.create({
        data: {
          ...v,
          position: v.position ?? (max._max.position ?? -1) + 1,
          projectId,
        },
      });
      if (v.assigneeId)
        await alert(
          tx,
          v.assigneeId,
          userId,
          "task",
          "You were assigned: " + task.title,
          projectId,
        );
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: "task.created",
          payload: { taskId: task.id, title: task.title },
        },
      });
      return task;
    });
  }
  @Patch(":id/tasks/reorder") async reorder(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      { items } = validate(
        z
          .object({
            items: z
              .array(
                z.object({
                  id: z.string().min(1).max(50),
                  version: z.number().int().positive(),
                }),
              )
              .min(1)
              .max(200),
          })
          .strict(),
        b,
      );
    if (new Set(items.map((t) => t.id)).size !== items.length)
      throw new HttpException("Duplicate task in order.", 400);
    return projectWrite(projectId, actor, false, async (tx) => {
      const rows = await tx.task.findMany({ where: { projectId } });
      if (
        rows.length !== items.length ||
        items.some((t) => !rows.some((r) => r.id === t.id))
      )
        throw new HttpException(
          "Order must include every current task exactly once.",
          409,
        );
      if (
        items.some(
          (t) => rows.find((r) => r.id === t.id)!.version !== t.version,
        )
      )
        throw new HttpException(
          "Tasks changed. Reload before reordering.",
          409,
        );
      for (const [position, t] of items.entries())
        await tx.task.update({
          where: { id: t.id },
          data: { position, version: { increment: 1 } },
        });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "tasks.reordered",
          payload: { ids: items.map((t) => t.id) },
        },
      });
      return { ok: true };
    });
  }
  @Patch(":id/tasks/:taskId") async edit(
    @Param("id") projectId: string,
    @Param("taskId") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req),
      v = validate(
        taskInput
          .partial()
          .extend({ version: z.number().int().positive().optional() })
          .refine(
            (v) => Object.keys(v).some((k) => k !== "version"),
            "Specify a task change.",
          ),
        b,
      );
    return projectWrite(projectId, userId, false, async (tx) => {
      const t = await tx.task.findUnique({ where: { id } });
      if (!t || t.projectId !== projectId)
        throw new HttpException("Task not found.", 404);
      if (v.version !== undefined && t.version !== v.version)
        throw new HttpException("Task changed. Reload before editing.", 409);
      await assignee(tx, projectId, v.assigneeId);
      const { version, ...changes } = v;
      const updated = await tx.task.update({
        where: { id },
        data: { ...changes, version: { increment: 1 } },
      });
      if (v.assigneeId && v.assigneeId !== t.assigneeId)
        await alert(
          tx,
          v.assigneeId,
          userId,
          "task",
          "You were assigned: " + updated.title,
          projectId,
        );
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: "task.updated",
          payload: { taskId: id, changes },
        },
      });
      return updated;
    });
  }
  @Delete(":id/tasks/:taskId") async remove(
    @Param("id") projectId: string,
    @Param("taskId") id: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(projectId, actor, true, async (tx) => {
      if (!(await tx.task.deleteMany({ where: { id, projectId } })).count)
        throw new HttpException("Task not found.", 404);
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "task.deleted",
          payload: { taskId: id },
        },
      });
      return { ok: true };
    });
  }
  @Post(":id/milestones") async milestone(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      v = validate(
        z.object({
          title: z.string().trim().min(3).max(150),
          dueDate: z.iso.datetime().nullable().optional(),
        }),
        b,
      );
    return projectWrite(projectId, actor, true, async (tx) => {
      if ((await tx.milestone.count({ where: { projectId } })) >= 100)
        throw new HttpException("Milestone limit reached.", 409);
      const row = await tx.milestone.create({ data: { ...v, projectId } });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "milestone.created",
          payload: { milestoneId: row.id },
        },
      });
      return row;
    });
  }
  @Patch(":id/milestones/:milestoneId") async complete(
    @Param("id") projectId: string,
    @Param("milestoneId") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      v = validate(
        z
          .object({
            completed: z.boolean().optional(),
            title: z.string().trim().min(3).max(150).optional(),
            dueDate: z.iso.datetime().nullable().optional(),
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0, "Specify a change."),
        b,
      );
    return projectWrite(projectId, actor, true, async (tx) => {
      const row = await tx.milestone.findUnique({ where: { id } });
      if (!row || row.projectId !== projectId)
        throw new HttpException("Milestone not found.", 404);
      const updated = await tx.milestone.update({ where: { id }, data: v });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "milestone.updated",
          payload: { milestoneId: id, changes: v },
        },
      });
      return updated;
    });
  }
  @Delete(":id/milestones/:milestoneId") async deleteMilestone(
    @Param("id") projectId: string,
    @Param("milestoneId") id: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(projectId, actor, true, async (tx) => {
      if (!(await tx.milestone.deleteMany({ where: { id, projectId } })).count)
        throw new HttpException("Milestone not found.", 404);
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "milestone.deleted",
          payload: { milestoneId: id },
        },
      });
      return { ok: true };
    });
  }
  @Get(":id/messages") async messages(
    @Param("id") projectId: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    await member(projectId, actor);
    const q = validate(
      z.object({
        requestId: z.uuid().optional(),
        cursor: z.string().max(1000).optional(),
        after: z.string().max(1000).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      req.query,
    );
    if (q.cursor && q.after)
      throw new HttpException("Use cursor or after, not both.", 400);
    if (q.requestId) {
      if (q.after || q.cursor)
        throw new HttpException("Use requestId without pagination.", 400);
      const row = await db.projectMessage.findUnique({
        where: {
          projectId_senderId_requestId: {
            projectId,
            senderId: actor,
            requestId: q.requestId,
          },
        },
        select: { id: true },
      });
      await uid(req);
      await member(projectId, actor);
      return {
        status: row ? "committed" : "not_found",
        messageId: row?.id || null,
      };
    }
    const boundary = q.cursor || q.after,
      scope = `project:${actor}:${projectId}`;
    let position;
    if (boundary) {
      if (boundary.startsWith("p1."))
        position = parsePosition(boundary, scope, req);
      else {
        position = await db.projectMessage.findFirst({
          where: { id: boundary, projectId },
          select: { id: true, createdAt: true },
        });
        if (!position)
          throw new HttpException(
            {
              message: "Message boundary was removed. Reload recent history.",
              code: "CHAT_POSITION_EXPIRED",
            },
            409,
          );
      }
    }
    const rows = await db.projectMessage.findMany({
      where: {
        AND: [
          { projectId },
          ...(position ? [positionFilter(position, !!q.after)] : []),
        ],
      },
      take: q.limit + 1,
      orderBy: [
        { createdAt: q.after ? "asc" : "desc" },
        { id: q.after ? "asc" : "desc" },
      ],
      include: { sender: { select: PUBLIC_USER } },
    });
    const visible = rows.slice(0, q.limit),
      items = q.after ? visible : visible.reverse();
    const oldest = items[0],
      read = await db.projectChatRead.findUnique({
        where: { projectId_userId: { projectId, userId: actor } },
      });
    const hasOlderUnread =
      !!oldest &&
      !q.after &&
      !!(await db.projectMessage.findFirst({
        where: {
          AND: [
            { projectId, senderId: { not: actor } },
            positionFilter(oldest, false),
            ...(read
              ? [
                  positionFilter(
                    { id: read.throughId, createdAt: read.throughAt },
                    true,
                  ),
                ]
              : []),
          ],
        },
        select: { id: true },
      }));
    await uid(req);
    await member(projectId, actor);
    return {
      items,
      hasOlderUnread,
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      nextPosition:
        rows.length > q.limit
          ? chatPosition(rows[q.limit - 1], scope, req)
          : null,
      afterPosition: chatPosition(items.at(-1), scope, req),
    };
  }
  @Post(":id/messages") async send(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const senderId = await uid(req),
      { content, requestId } = validate(
        z
          .object({
            content: z.string().trim().min(1).max(2000),
            requestId: z.uuid().optional(),
          })
          .strict(),
        b,
      );
    return projectWrite(projectId, senderId, false, async (tx) => {
      if (requestId) {
        const existing = await tx.projectMessage.findUnique({
          where: {
            projectId_senderId_requestId: { projectId, senderId, requestId },
          },
        });
        if (existing) {
          if (existing.content !== content)
            throw new HttpException(
              "Request ID reused with different content.",
              409,
            );
          return existing;
        }
      }
      const latest = await tx.projectMessage.aggregate({
        where: { projectId },
        _max: { createdAt: true },
      });
      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      return tx.projectMessage.create({
        data: {
          projectId,
          senderId,
          content,
          requestId,
          createdAt: new Date(
            Math.max(
              now.getTime(),
              (latest._max.createdAt?.getTime() || 0) + 1,
            ),
          ),
        },
      });
    });
  }
  @Patch(":id/project") async editProject(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      v = validate(projectInput, b);
    return projectWrite(
      id,
      actor,
      true,
      async (tx, { project: p }) => {
        if (
          v.teamSize !== undefined &&
          v.teamSize < (await tx.member.count({ where: { projectId: id } }))
        )
          throw new HttpException(
            "Capacity cannot be less than current membership.",
            409,
          );
        if (v.status === "Archived" && p.status !== "Archived") {
          await tx.application.updateMany({
            where: { projectId: id, status: "Pending" },
            data: { status: "Cancelled" },
          });
          await tx.projectInvite.updateMany({
            where: { projectId: id, status: "Pending" },
            data: { status: "Cancelled" },
          });
        }
        const row = await tx.project.update({
          where: { id },
          data: { ...v, ...(v.image ? { coverImageId: null } : {}) },
        });
        if (v.image) await retireImage(tx, p.coverImageId);
        await tx.auditEvent.create({
          data: {
            projectId: id,
            actorId: actor,
            action: "project.updated",
            payload: { changes: v },
          },
        });
        return row;
      },
      false,
    );
  }
  @Delete(":id/project") async deleteProject(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      { confirmTitle } = validate(
        z.object({ confirmTitle: z.string().max(100) }).strict(),
        b,
      );
    return projectWrite(
      id,
      actor,
      true,
      async (tx, { project: p }) => {
        if (p.status !== "Archived")
          throw new HttpException(
            "Archive the project before deleting it.",
            409,
          );
        if (confirmTitle !== p.title)
          throw new HttpException("Confirmation title does not match.", 400);
        await tx.project.update({
          where: { id },
          data: { coverImageId: null },
        });
        await retireImage(tx, p.coverImageId);
        const files = await tx.projectFile.findMany({
          where: { projectId: id },
          select: { storageKey: true },
        });
        if (files.length)
          await tx.storageDeletion.createMany({
            data: files,
            skipDuplicates: true,
          });
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(984513)::text`;
        const [{ now }] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp() AS now`;
        const fill = await backfillQuota(tx, now, undefined, 1000, id);
        if (fill.more)
          throw new HttpException(
            "AI usage reconciliation in progress. Retry project deletion shortly.",
            503,
          );
        await tx.aiConversation.updateMany({
          where: { projectId: id },
          data: { projectId: null },
        });
        await tx.aiUsage.updateMany({
          where: { projectId: id },
          data: { projectId: null },
        });
        await tx.aiPlan.updateMany({
          where: { projectId: id },
          data: { projectId: null },
        });
        await tx.notification.deleteMany({ where: { projectId: id } });
        await tx.report.deleteMany({
          where: {
            OR: [
              { targetType: "project", targetId: id },
              {
                targetType: "activity",
                targetId: {
                  in: (
                    await tx.activity.findMany({
                      where: { projectId: id },
                      select: { id: true },
                    })
                  ).map((a) => a.id),
                },
              },
            ],
          },
        });
        await tx.project.delete({ where: { id } });
        return { ok: true };
      },
      false,
    );
  }
}
