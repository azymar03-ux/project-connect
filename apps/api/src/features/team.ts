import {
  Controller,
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
  uid,
  validate,
  owner,
  socialTransaction,
  lockUsers,
} from "../core/security";
@Controller("api/workspaces/:id/team")
export class TeamController {
  @Patch(":userId") async role(
    @Param("id") projectId: string,
    @Param("userId") userId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req);
    await owner(projectId, actor);
    const { role } = validate(
      z.object({ role: z.enum(["Member", "Maintainer"]) }),
      b,
    );
    if (userId === actor)
      throw new HttpException(
        "Use ownership transfer to change your own role.",
        400,
      );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, actor, userId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      if (
        (await tx.project.findUniqueOrThrow({ where: { id: projectId } }))
          .ownerId !== actor
      )
        throw new HttpException("Owner permission required.", 403);
      const m = await tx.member.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });
      if (!m) throw new HttpException("Member not found.", 404);
      const updated = await tx.member.update({
        where: { id: m.id },
        data: { role },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "member.role",
          payload: { userId, role },
        },
      });
      return updated;
    });
  }
  @Delete(":userId") async remove(
    @Param("id") projectId: string,
    @Param("userId") userId: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    const p = await owner(projectId, actor);
    if (userId === p.ownerId)
      throw new HttpException(
        "The owner cannot be removed. Transfer ownership first.",
        400,
      );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, actor, userId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      if (
        (await tx.project.findUniqueOrThrow({ where: { id: projectId } }))
          .ownerId !== actor
      )
        throw new HttpException("Owner permission required.", 403);
      const r = await tx.member.deleteMany({ where: { projectId, userId } });
      if (!r.count) throw new HttpException("Member not found.", 404);
      await tx.task.updateMany({
        where: { projectId, assigneeId: userId },
        data: { assigneeId: null, version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "member.removed",
          payload: { userId },
        },
      });
      return { ok: true };
    });
  }
  @Post("leave") async leave(
    @Param("id") projectId: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      const p = await tx.project.findUnique({ where: { id: projectId } });
      if (!p) throw new HttpException("Project not found.", 404);
      if (p.ownerId === userId)
        throw new HttpException(
          "Owners must transfer ownership before leaving.",
          400,
        );
      const r = await tx.member.deleteMany({ where: { projectId, userId } });
      if (!r.count)
        throw new HttpException("You are not a member of this project.", 404);
      await tx.task.updateMany({
        where: { projectId, assigneeId: userId },
        data: { assigneeId: null, version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: "member.left",
          payload: {},
        },
      });
      return { ok: true };
    });
  }
  @Post("transfer") async transfer(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req);
    await owner(projectId, actor);
    const { userId } = validate(
      z.object({ userId: z.string().min(1).max(40) }),
      b,
    );
    if (userId === actor)
      throw new HttpException("You already own this project.", 400);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, actor, userId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      if (
        (await tx.project.findUniqueOrThrow({ where: { id: projectId } }))
          .ownerId !== actor
      )
        throw new HttpException("Owner permission required.", 403);
      const target = await tx.member.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });
      if (!target)
        throw new HttpException("New owner must already be a member.", 400);
      await tx.project.update({
        where: { id: projectId },
        data: { ownerId: userId },
      });
      await tx.member.update({
        where: { id: target.id },
        data: { role: "Owner" },
      });
      await tx.member.updateMany({
        where: { projectId, userId: actor },
        data: { role: "Maintainer" },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "ownership.transferred",
          payload: { userId },
        },
      });
      return { ok: true };
    });
  }
}
