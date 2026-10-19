import { allowedScanStatus, verifiedStoredBytes } from "../core/storage-scan";
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  HttpException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import {
  db,
  uid,
  optionalUid,
  socialTransaction,
  lockUsers,
  blockedIn,
} from "../core/security";
import { projectWrite } from "../core/project-access";
import {
  prepareImage,
  stageImage,
  claimImage,
  retireImage,
  abandonImage,
} from "../core/public-image";
class ImageAuth implements CanActivate {
  async canActivate(context: ExecutionContext) {
    await uid(context.switchToHttp().getRequest());
    return true;
  }
}
const upload = FileInterceptor("file", {
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
});
@Controller("api")
export class ImagesController {
  @Post("account/avatar")
  @UseGuards(ImageAuth)
  @UseInterceptors(upload)
  async avatar(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
    const actor = await uid(req),
      image = await prepareImage(file, "avatar"),
      key = await stageImage(image.buffer);
    try {
      return await socialTransaction(async (tx) => {
        await lockUsers(tx, actor);
        const user = await tx.user.findUniqueOrThrow({ where: { id: actor } });
        if (user.suspendedAt || user.activationRequired)
          throw new HttpException("Account unavailable.", 403);
        const avatarId = await claimImage(tx, key, "avatar", image);
        await tx.user.update({ where: { id: actor }, data: { avatarId } });
        await retireImage(tx, user.avatarId);
        return { avatarId, url: `/api/images/${avatarId}` };
      });
    } catch (e) {
      await abandonImage(key);
      throw e;
    }
  }
  @Delete("account/avatar") async removeAvatar(@Req() req: Request) {
    const actor = await uid(req);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, actor);
      const user = await tx.user.findUniqueOrThrow({ where: { id: actor } });
      await tx.user.update({ where: { id: actor }, data: { avatarId: null } });
      await retireImage(tx, user.avatarId);
      return { ok: true, avatarId: null };
    });
  }
  @Post("workspaces/:id/cover")
  @UseGuards(ImageAuth)
  @UseInterceptors(upload)
  async cover(
    @Param("id") id: string,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const actor = await uid(req);
    await projectWrite(id, actor, true, async () => undefined);
    const image = await prepareImage(file, "cover"),
      key = await stageImage(image.buffer);
    try {
      return await projectWrite(id, actor, true, async (tx, { project }) => {
        const coverImageId = await claimImage(tx, key, "cover", image);
        await tx.project.update({ where: { id }, data: { coverImageId } });
        await retireImage(tx, project.coverImageId);
        await tx.auditEvent.create({
          data: {
            projectId: id,
            actorId: actor,
            action: "project.cover.updated",
            payload: {},
          },
        });
        return { coverImageId, url: `/api/images/${coverImageId}` };
      });
    } catch (e) {
      await abandonImage(key);
      throw e;
    }
  }
  @Delete("workspaces/:id/cover") async removeCover(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(id, actor, true, async (tx, { project }) => {
      await tx.project.update({ where: { id }, data: { coverImageId: null } });
      await retireImage(tx, project.coverImageId);
      await tx.auditEvent.create({
        data: {
          projectId: id,
          actorId: actor,
          action: "project.cover.removed",
          payload: {},
        },
      });
      return { ok: true };
    });
  }
  async visible(id: string, req: Request) {
    const viewer = await optionalUid(req);
    return db.$transaction(async (tx) => {
      const row = await tx.publicImage.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, suspendedAt: true, activationRequired: true },
          },
          project: {
            select: {
              id: true,
              ownerId: true,
              status: true,
              owner: {
                select: { suspendedAt: true, activationRequired: true },
              },
            },
          },
        },
      });
      if (!row) return null;
      if (row.user) {
        if (row.user.suspendedAt || row.user.activationRequired) return null;
        if (
          viewer &&
          viewer !== row.user.id &&
          (await blockedIn(tx, viewer, row.user.id))
        )
          return null;
      } else if (row.project) {
        const p = row.project;
        if (p.owner.activationRequired) return null;
        const member = viewer
          ? await tx.member.findUnique({
              where: { projectId_userId: { projectId: p.id, userId: viewer } },
              select: { id: true },
            })
          : null;
        if (
          !member &&
          (p.status === "Archived" ||
            p.owner.suspendedAt ||
            (viewer && (await blockedIn(tx, viewer, p.ownerId))))
        )
          return null;
      } else return null;
      return row;
    });
  }
  @Get("images/:id") async image(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    if (!/^[A-Za-z0-9_-]{32}$/.test(id))
      throw new HttpException("Image not found.", 404);
    const row = await this.visible(id, req);
    if (!row) throw new HttpException("Image not found.", 404);
    let buffer: Buffer;
    try {
      buffer = await verifiedStoredBytes(row.storageKey, row.size);
    } catch {
      throw new HttpException("Image not found.", 404);
    }
    // Recheck revocation/replacement after object retrieval. No public CDN cache.
    if (!(await this.visible(id, req)))
      throw new HttpException("Image not found.", 404);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="projectconnect-image.jpg"',
    );
    return res.send(buffer);
  }
}
