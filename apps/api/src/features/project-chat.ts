import {
  Controller,
  Get,
  Patch,
  Param,
  Req,
  Body,
  HttpException,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { db, uid, validate, member } from "../core/security";
import { projectWrite } from "../core/project-access";
@Controller("api/workspaces")
export class ProjectChatController {
  @Get("unread") async unread(@Req() req: Request) {
    const userId = await uid(req);
    const rows = await db.$queryRaw<
      { projectId: string; unread: bigint }[]
    >`SELECT m."projectId",count(pm.id) AS unread FROM "Member" m LEFT JOIN "ProjectChatRead" r ON r."projectId"=m."projectId" AND r."userId"=m."userId" LEFT JOIN "ProjectMessage" pm ON pm."projectId"=m."projectId" AND pm."senderId"<>${userId} AND (r."throughAt" IS NULL OR (pm."createdAt",pm.id)>(r."throughAt",r."throughId")) WHERE m."userId"=${userId} GROUP BY m."projectId"`;
    return {
      items: rows.map((r) => ({
        projectId: r.projectId,
        unread: Number(r.unread),
      })),
    };
  }
  @Patch(":id/messages/read") async read(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      { throughId } = validate(
        z.object({ throughId: z.string().min(1).max(50) }).strict(),
        b,
      );
    return projectWrite(
      id,
      actor,
      false,
      async (tx) => {
        const through = await tx.projectMessage.findFirst({
          where: { id: throughId, projectId: id },
        });
        if (!through)
          throw new HttpException("Message boundary not found.", 404);
        const key = { projectId_userId: { projectId: id, userId: actor } },
          current = await tx.projectChatRead.findUnique({ where: key });
        if (
          current &&
          (current.throughAt > through.createdAt ||
            (current.throughAt.getTime() === through.createdAt.getTime() &&
              current.throughId >= through.id))
        )
          return { ok: true };
        await tx.projectChatRead.upsert({
          where: key,
          create: {
            projectId: id,
            userId: actor,
            throughAt: through.createdAt,
            throughId,
          },
          update: { throughAt: through.createdAt, throughId },
        });
        return { ok: true };
      },
      false,
    );
  }
}
