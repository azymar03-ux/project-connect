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
import { projectWrite } from "../core/project-access";
import {
  db,
  uid,
  optionalUid,
  validate,
  PUBLIC_USER,
  member,
} from "../core/security";
const urlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.hostname !== "localhost" &&
      !/^\d+\./.test(u.hostname) &&
      !u.hostname.includes(":")
    );
  }, "Use a public HTTPS URL without embedded credentials.");
const resourceInput = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(15).max(2000),
  url: urlSchema,
  type: z.enum([
    "GitHub",
    "Documentation",
    "API",
    "Library",
    "Tutorial",
    "Dataset",
    "Tool",
  ]),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
});
@Controller("api/resources")
export class ResourcesController {
  @Get() async list(@Req() req: Request) {
    const id = await optionalUid(req);
    const q = validate(
      z.object({
        search: z.string().max(150).default(""),
        type: z.string().max(40).optional(),
        saved: z.enum(["true", "false"]).optional(),
        limit: z.coerce.number().int().min(1).max(60).default(30),
        cursor: z.string().max(100).optional(),
      }),
      req.query,
    );
    const where = {
      approved: true,
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: "insensitive" as const } },
              {
                description: {
                  contains: q.search,
                  mode: "insensitive" as const,
                },
              },
              { tags: { has: q.search } },
            ],
          }
        : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.saved === "true"
        ? { saves: { some: { userId: id || "none" } } }
        : {}),
    };
    const rows = await db.resource.findMany({
      where,
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        submittedBy: { select: PUBLIC_USER },
        _count: { select: { votes: true, projectLinks: true } },
        votes: { where: { userId: id || "none" }, select: { userId: true } },
        saves: { where: { userId: id || "none" }, select: { userId: true } },
      },
    });
    const more = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map(({ votes, saves, ...r }) => ({
      ...r,
      voted: votes.length > 0,
      saved: saves.length > 0,
    }));
    return { items, nextCursor: more ? items.at(-1)?.id : null };
  }
  @Post() async create(@Req() req: Request, @Body() b: unknown) {
    const submittedById = await uid(req);
    return db.resource.create({
      data: { ...validate(resourceInput, b), submittedById },
    });
  }
  @Patch(":id") async edit(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const u = await uid(req);
    const r = await db.resource.findUnique({ where: { id } });
    if (!r) throw new HttpException("Resource not found.", 404);
    if (r.submittedById !== u)
      throw new HttpException(
        "Only the submitter can edit this resource.",
        403,
      );
    return db.resource.update({
      where: { id },
      data: validate(resourceInput, b),
    });
  }
  @Delete(":id") async remove(@Param("id") id: string, @Req() req: Request) {
    const u = await uid(req);
    const r = await db.resource.findUnique({ where: { id } });
    if (!r || r.submittedById !== u)
      throw new HttpException("Not authorized.", 403);
    await db.resource.delete({ where: { id } });
    return { ok: true };
  }
  @Post(":id/vote") async vote(
    @Param("id") resourceId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req);
    const { enabled } = validate(z.object({ enabled: z.boolean() }), b);
    if (enabled)
      await db.resourceVote.upsert({
        where: { userId_resourceId: { userId, resourceId } },
        update: {},
        create: { userId, resourceId },
      });
    else await db.resourceVote.deleteMany({ where: { userId, resourceId } });
    return { voted: enabled };
  }
  @Post(":id/save") async save(
    @Param("id") resourceId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req);
    const { enabled } = validate(z.object({ enabled: z.boolean() }), b);
    if (enabled)
      await db.resourceSave.upsert({
        where: { userId_resourceId: { userId, resourceId } },
        update: {},
        create: { userId, resourceId },
      });
    else await db.resourceSave.deleteMany({ where: { userId, resourceId } });
    return { saved: enabled };
  }
  @Post(":id/projects/:projectId") async attach(
    @Param("id") resourceId: string,
    @Param("projectId") projectId: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(projectId, actor, false, async (tx) => {
      const r = await tx.resource.findUnique({ where: { id: resourceId } });
      if (!r || !r.approved)
        throw new HttpException("Resource not found.", 404);
      return tx.projectResource.upsert({
        where: { projectId_resourceId: { projectId, resourceId } },
        update: {},
        create: { projectId, resourceId },
      });
    });
  }
  @Delete(":id/projects/:projectId") async detach(
    @Param("id") resourceId: string,
    @Param("projectId") projectId: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(projectId, actor, false, async (tx) => {
      await tx.projectResource.deleteMany({ where: { projectId, resourceId } });
      return { ok: true };
    });
  }
}
