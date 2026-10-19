import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Req,
  Param,
  Body,
  HttpException,
} from "@nestjs/common";
import { z } from "zod";
import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import {
  db,
  uid,
  optionalUid,
  validate,
  PUBLIC_USER,
  serializable,
  lockUsers,
  socialTransaction,
} from "../core/security";
export async function hiddenUsers(userId: string) {
  return (
    await db.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    })
  ).map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));
}
export async function alert(
  tx: Prisma.TransactionClient,
  userId: string,
  actorId: string,
  kind: string,
  title: string,
  projectId?: string,
) {
  if (userId === actorId) return;
  const preferences = await tx.user.findUnique({
    where: { id: userId },
    select: { notifySocial: true, notifyMessages: true, notifyWorkspace: true },
  });
  if (!preferences) return;
  const enabled =
    kind === "message"
      ? preferences.notifyMessages
      : ["follow", "connection", "connection-accepted"].includes(kind)
        ? preferences.notifySocial
        : preferences.notifyWorkspace;
  if (!enabled) return;
  await tx.notification.create({
    data: { userId, actorId, kind, title: title.slice(0, 250), projectId },
  });
}
const page = z.object({
  cursor: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
@Controller("api")
export class SocialController {
  @Post("follows/:id") async follow(
    @Param("id") followingId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const followerId = await uid(req);
    const { enabled } = validate(z.object({ enabled: z.boolean() }), b);
    if (followingId === followerId)
      throw new HttpException("You cannot follow yourself.", 400);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, followerId, followingId);
      if (!(await tx.user.findUnique({ where: { id: followingId } })))
        throw new HttpException("Profile not found.", 404);
      if (
        await tx.block.findFirst({
          where: {
            OR: [
              { blockerId: followerId, blockedId: followingId },
              { blockerId: followingId, blockedId: followerId },
            ],
          },
        })
      )
        throw new HttpException("Cannot follow this profile.", 403);
      if (enabled) {
        if (
          !(await tx.follow.findUnique({
            where: { followerId_followingId: { followerId, followingId } },
          }))
        ) {
          await tx.follow.create({ data: { followerId, followingId } });
          const me = await tx.user.findUniqueOrThrow({
            where: { id: followerId },
          });
          await alert(
            tx,
            followingId,
            followerId,
            "follow",
            me.name + " started following you",
          );
        }
      } else await tx.follow.deleteMany({ where: { followerId, followingId } });
      return { following: enabled };
    });
  }
  @Get("profiles/:id") async profile(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const me = await optionalUid(req);
    if (me && (await hiddenUsers(me)).includes(id))
      throw new HttpException("Profile not available.", 404);
    const u = await db.user.findFirst({
      where: { id, suspendedAt: null, activationRequired: false },
      select: PUBLIC_USER,
    });
    if (!u) throw new HttpException("Profile not found.", 404);
    const [followers, following, projects] = await Promise.all([
      db.follow.count({ where: { followingId: id } }),
      db.follow.count({ where: { followerId: id } }),
      db.project.findMany({
        where: { ownerId: id, status: { not: "Archived" } },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          image: true,
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
    ]);
    return { ...u, followers, following, projects };
  }
  @Get("feed") async feed(@Req() req: Request) {
    const userId = await uid(req);
    const q = validate(
      page.extend({
        scope: z.enum(["community", "following"]).default("community"),
      }),
      req.query,
    );
    const blocked = await hiddenUsers(userId);
    const followed =
      q.scope === "following"
        ? (
            await db.follow.findMany({
              where: { followerId: userId },
              select: { followingId: true },
            })
          ).map((f) => f.followingId)
        : null;
    const rows = await db.activity.findMany({
      where: {
        hiddenAt: null,
        author: { suspendedAt: null, activationRequired: false },
        authorId: {
          notIn: blocked,
          ...(followed ? { in: [userId, ...followed] } : {}),
        },
        project: {
          status: { not: "Archived" },
          ownerId: { notIn: blocked },
          owner: { suspendedAt: null, activationRequired: false },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        author: { select: PUBLIC_USER },
        project: { select: { id: true, title: true, category: true } },
      },
    });
    return {
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
    };
  }
  @Post("workspaces/:id/updates") async update(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const authorId = await uid(req);
    const { content } = validate(
      z.object({ content: z.string().trim().min(5).max(1500) }),
      b,
    );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, authorId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      if (
        !(await tx.member.findUnique({
          where: { projectId_userId: { projectId, userId: authorId } },
        }))
      )
        throw new HttpException("Project membership required.", 403);
      const p = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      if (p.status === "Archived")
        throw new HttpException("Archived projects cannot post updates.", 409);
      if (
        (await tx.activity.count({
          where: {
            authorId,
            createdAt: { gt: new Date(Date.now() - 3600000) },
          },
        })) >= 10
      )
        throw new HttpException("Update limit reached. Please try later.", 429);
      const row = await tx.activity.create({
        data: { authorId, projectId, content },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: authorId,
          action: "update.published",
          payload: { updateId: row.id },
        },
      });
      return row;
    });
  }
  @Delete("feed/:id") async remove(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const authorId = await uid(req);
    const r = await db.activity.deleteMany({ where: { id, authorId } });
    if (!r.count) throw new HttpException("Update not found.", 404);
    return { ok: true };
  }
  @Get("notifications") async notifications(@Req() req: Request) {
    const userId = await uid(req);
    const q = validate(page, req.query);
    const blocked = await hiddenUsers(userId);
    const rows = await db.notification.findMany({
      where: {
        userId,
        OR: [{ actorId: null }, { actorId: { notIn: blocked } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
    };
  }
  @Get("unread") async unread(@Req() req: Request) {
    const userId = await uid(req),
      blocked = await hiddenUsers(userId);
    const [notifications, messages] = await Promise.all([
      db.notification.count({
        where: {
          userId,
          readAt: null,
          OR: [{ actorId: null }, { actorId: { notIn: blocked } }],
        },
      }),
      db.message.count({
        where: {
          receiverId: userId,
          readAt: null,
          senderId: { notIn: blocked },
        },
      }),
    ]);
    return { notifications, messages };
  }
  @Patch("notifications/read-all") async readAll(@Req() req: Request) {
    await db.notification.updateMany({
      where: { userId: await uid(req), readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
  @Patch("notifications/:id") async read(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const r = await db.notification.updateMany({
      where: { id, userId: await uid(req) },
      data: { readAt: new Date() },
    });
    if (!r.count) throw new HttpException("Notification not found.", 404);
    return { ok: true };
  }
  @Patch("messages/:id/read") async readMessages(
    @Param("id") senderId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const receiverId = await uid(req);
    const { throughId } = validate(
      z.object({ throughId: z.string().min(1).max(50) }),
      b,
    );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, senderId, receiverId);
      if (
        (await tx.block.findFirst({
          where: {
            OR: [
              { blockerId: senderId, blockedId: receiverId },
              { blockerId: receiverId, blockedId: senderId },
            ],
          },
        })) ||
        !(await tx.connection.findFirst({
          where: {
            status: "Accepted",
            OR: [
              { senderId, receiverId },
              { senderId: receiverId, receiverId: senderId },
            ],
          },
        }))
      )
        throw new HttpException("Conversation unavailable.", 403);
      const through = await tx.message.findFirst({
        where: {
          id: throughId,
          OR: [
            { senderId, receiverId },
            { senderId: receiverId, receiverId: senderId },
          ],
        },
      });
      if (!through) throw new HttpException("Message not found.", 404);
      await tx.message.updateMany({
        where: {
          senderId,
          receiverId,
          readAt: null,
          OR: [
            { createdAt: { lt: through.createdAt } },
            { createdAt: through.createdAt, id: { lte: through.id } },
          ],
        },
        data: { readAt: new Date() },
      });
      if (
        !(await tx.message.count({
          where: { senderId, receiverId, readAt: null },
        }))
      )
        await tx.notification.updateMany({
          where: {
            userId: receiverId,
            actorId: senderId,
            kind: "message",
            readAt: null,
          },
          data: { readAt: new Date() },
        });
      return { ok: true };
    });
  }
  @Delete("connections/:id") async dismiss(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    const row = await db.connection.findUnique({ where: { id } });
    if (!row || ![row.senderId, row.receiverId].includes(userId))
      throw new HttpException("Request not found.", 404);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, row.senderId, row.receiverId);
      await tx.connection.deleteMany({ where: { id } });
      return { ok: true };
    });
  }
}
