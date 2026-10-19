import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  HttpException,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { alert } from "./social";
import { projectWrite } from "../core/project-access";
import {
  db,
  uid,
  validate,
  owner,
  socialTransaction,
  lockUsers,
  blockedIn,
  PUBLIC_USER,
} from "../core/security";
@Controller("api")
export class InvitationController {
  @Get("invitations") async mine(@Req() req: Request) {
    return db.projectInvite.findMany({
      where: {
        userId: await uid(req),
        status: "Pending",
        expiresAt: { gt: new Date() },
      },
      include: {
        project: { select: { id: true, title: true, description: true } },
      },
      take: 50,
    });
  }
  @Get("workspaces/:id/invitations") async sent(
    @Param("id") projectId: string,
    @Req() req: Request,
  ) {
    await owner(projectId, await uid(req));
    return db.projectInvite.findMany({
      where: { projectId, status: "Pending", expiresAt: { gt: new Date() } },
      include: { user: { select: PUBLIC_USER } },
      take: 50,
    });
  }
  @Post("workspaces/:id/invitations") async invite(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const inviterId = await uid(req),
      { userId } = validate(z.object({ userId: z.string().min(1).max(40) }), b);
    return projectWrite(
      projectId,
      inviterId,
      true,
      async (tx, { project: p }) => {
        if (p.status === "Completed")
          throw new HttpException("Project is not accepting members.", 409);
        if (await blockedIn(tx, inviterId, userId))
          throw new HttpException("Cannot invite this user.", 403);
        if (
          await tx.member.findUnique({
            where: { projectId_userId: { projectId, userId } },
          })
        )
          throw new HttpException("This person is already a member.", 409);
        const previous = await tx.projectInvite.findUnique({
          where: { projectId_userId: { projectId, userId } },
        });
        if (previous?.status === "Pending" && previous.expiresAt > new Date())
          return previous;
        if (
          (await tx.projectInvite.count({
            where: {
              projectId,
              status: "Pending",
              expiresAt: { gt: new Date() },
            },
          })) >= 100
        )
          throw new HttpException("Pending invitation limit reached.", 409);
        const row = await tx.projectInvite.upsert({
          where: { projectId_userId: { projectId, userId } },
          create: {
            projectId,
            userId,
            inviterId,
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
          update: {
            inviterId,
            status: "Pending",
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
        await alert(
          tx,
          userId,
          inviterId,
          "invitation",
          "You are invited to " + p.title,
          projectId,
        );
        return row;
      },
      true,
      [userId],
    );
  }
  @Patch("workspaces/:id/invitations/:inviteId/cancel") async cancel(
    @Param("id") projectId: string,
    @Param("inviteId") id: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(
      projectId,
      actor,
      true,
      async (tx) => {
        await tx.projectInvite.updateMany({
          where: { id, projectId, status: "Pending" },
          data: { status: "Cancelled" },
        });
        return { ok: true };
      },
      false,
    );
  }
  @Patch("invitations/:id") async respond(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req),
      { status } = validate(
        z.object({ status: z.enum(["Accepted", "Declined"]) }),
        b,
      ),
      inv = await db.projectInvite.findUnique({
        where: { id },
        include: { project: { select: { ownerId: true } } },
      });
    if (!inv || inv.userId !== userId)
      throw new HttpException("Invitation not found.", 404);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, userId, inv.project.ownerId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${inv.projectId} FOR UPDATE`;
      const current = await tx.projectInvite.findUnique({ where: { id } });
      if (!current || current.userId !== userId)
        throw new HttpException("Invitation not found.", 404);
      if (current.status === status) return current;
      if (current.status !== "Pending" || current.expiresAt <= new Date())
        throw new HttpException("Invitation expired or already answered.", 409);
      const p = await tx.project.findUniqueOrThrow({
        where: { id: inv.projectId },
      });
      if (p.ownerId !== inv.project.ownerId)
        throw new HttpException("Ownership changed. Retry your response.", 409);
      if (status === "Accepted") {
        if (["Archived", "Completed"].includes(p.status))
          throw new HttpException("Project is not accepting members.", 409);
        if (await blockedIn(tx, p.ownerId, userId))
          throw new HttpException("You cannot join this project.", 403);
        if (
          !(await tx.member.findUnique({
            where: { projectId_userId: { projectId: p.id, userId } },
          }))
        ) {
          if (
            (await tx.member.count({ where: { projectId: p.id } })) >=
            p.teamSize
          )
            throw new HttpException("Team is full.", 409);
          await tx.member.create({ data: { projectId: p.id, userId } });
        }
        await tx.auditEvent.create({
          data: {
            projectId: p.id,
            actorId: userId,
            action: "invite.accepted",
            payload: {},
          },
        });
      }
      const row = await tx.projectInvite.update({
        where: { id },
        data: { status },
      });
      const me = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await alert(
        tx,
        p.ownerId,
        userId,
        "invite-response",
        me.name + " " + status.toLowerCase() + " the invitation to " + p.title,
        p.id,
      );
      return row;
    });
  }
}
