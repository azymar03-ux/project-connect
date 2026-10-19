import { Controller, Get, Req, HttpException } from "@nestjs/common";
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cursorKeys } from "../core/cursor-keys";
import { db, optionalUid, validate, PUBLIC_USER } from "../core/security";
import { hiddenUsers } from "./social";
import { projectInclude, serializeProject } from "../core/public-project";
import {
  matchSql,
  matchReasons,
  recommendationVersion,
} from "../core/recommendations";
const query = z.object({
  q: z.string().trim().max(120).default(""),
  category: z
    .enum([
      "All projects",
      "Robotics",
      "IoT",
      "AI & ML",
      "Web development",
      "Design",
    ])
    .default("All projects"),
  remote: z.enum(["true", "false"]).default("false"),
  scope: z.enum(["all", "mine", "saved", "connections"]).default("all"),
  sort: z.enum(["recommended", "newest", "oldest"]).default("recommended"),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  cursor: z.string().max(1000).optional(),
});
const cursorSchema = z.object({
  id: z.string().min(1).max(50),
  date: z.iso.datetime(),
  score: z.number().min(0).max(100),
  binding: z.string(),
  asOf: z.iso.datetime(),
});
function like(s: string) {
  return "%" + s.replace(/[\\%_]/g, "\\$&") + "%";
}
@Controller("api/discovery")
export class DiscoveryController {
  @Get("projects") async projects(@Req() req: Request) {
    return this.list(req, "projects");
  }
  @Get("people") async people(@Req() req: Request) {
    return this.list(req, "people");
  }
  async list(req: Request, kind: "projects" | "people", legacyLimit?: number) {
    const userId = await optionalUid(req),
      me = userId ? await db.user.findUnique({ where: { id: userId } }) : null,
      q = validate(query, {
        ...req.query,
        ...(legacyLimit ? { limit: legacyLimit } : {}),
      });
    if (q.scope !== "all" && !me)
      throw new HttpException("Sign in for your personal collection.", 401);
    if (
      (kind === "projects" && q.scope === "connections") ||
      (kind === "people" && ["mine", "saved"].includes(q.scope))
    )
      throw new HttpException("Invalid discovery scope.", 400);
    const blocked = userId ? (await hiddenUsers(userId)).sort() : [];
    const binding = createHash("sha256")
      .update(
        JSON.stringify({
          kind,
          ...q,
          cursor: undefined,
          limit: undefined,
          userId,
          version: recommendationVersion,
          interests: me?.interests,
          skills: me?.skills,
          city: me?.city,
          blocked,
        }),
      )
      .digest("hex");
    let cursor: z.infer<typeof cursorSchema> | undefined;
    let asOf = new Date();
    if (q.cursor) {
      try {
        const [payload, signature, extra] = q.cursor.split(".");
        const actual = Buffer.from(signature || "", "base64url");
        if (
          extra ||
          !cursorKeys("EXPORT_CURSOR_SECRET").some((key) => {
            const expected = createHmac("sha256", key)
              .update("discovery:" + payload)
              .digest();
            return (
              actual.length === expected.length &&
              timingSafeEqual(actual, expected)
            );
          })
        )
          throw Error();
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(payload, "base64url").toString()),
        );
        asOf = new Date(cursor.asOf);
        if (
          cursor.binding !== binding ||
          asOf.getTime() > Date.now() ||
          Date.now() - asOf.getTime() > 30 * 60000
        )
          throw Error();
      } catch {
        throw new HttpException(
          "Invalid cursor for these filters. Restart the search.",
          400,
        );
      }
    }
    const active =
      kind === "projects"
        ? Prisma.sql`p.status<>'Archived' AND EXISTS(SELECT 1 FROM "Activity" a JOIN "User" au ON au.id=a."authorId" WHERE a."projectId"=p.id AND a."hiddenAt" IS NULL AND a."createdAt">${asOf}::timestamptz-INTERVAL '30 days' AND a."createdAt"<=${asOf} AND au."suspendedAt" IS NULL AND au."activationRequired"=false AND au.id<>ALL(${blocked}::text[]))`
        : Prisma.sql`EXISTS(SELECT 1 FROM "Activity" a JOIN "Project" ap ON ap.id=a."projectId" JOIN "User" ou ON ou.id=ap."ownerId" WHERE a."authorId"=p.id AND a."hiddenAt" IS NULL AND a."createdAt">${asOf}::timestamptz-INTERVAL '30 days' AND a."createdAt"<=${asOf} AND ap.status<>'Archived' AND ou."suspendedAt" IS NULL AND ou."activationRequired"=false AND ou.id<>ALL(${blocked}::text[]))`;
    const score = matchSql(kind, me, active);
    const rank = me ? score : Prisma.sql`0`;
    const search = q.q
      ? kind === "projects"
        ? Prisma.sql`AND (p.title ILIKE ${like(q.q)} OR p.description ILIKE ${like(q.q)} OR EXISTS(SELECT 1 FROM unnest(p.tags||p."requiredSkills") s WHERE s ILIKE ${like(q.q)}))`
        : Prisma.sql`AND (p.name ILIKE ${like(q.q)} OR p.role ILIKE ${like(q.q)} OR p.city ILIKE ${like(q.q)} OR EXISTS(SELECT 1 FROM unnest(p.skills||p.interests) s WHERE s ILIKE ${like(q.q)}))`
      : Prisma.empty;
    const conditions =
      kind === "projects"
        ? Prisma.sql`${q.scope === "mine" ? Prisma.sql`true` : Prisma.sql`p.status<>'Archived' AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=p."ownerId" AND (u."suspendedAt" IS NOT NULL OR u."activationRequired"=true))`} AND p."ownerId"<>ALL(${blocked}::text[]) ${q.category !== "All projects" ? Prisma.sql`AND p.category=${q.category}` : Prisma.empty} ${q.remote === "true" ? Prisma.sql`AND p.remote=true` : Prisma.empty} ${q.scope === "mine" ? Prisma.sql`AND EXISTS(SELECT 1 FROM "Member" m WHERE m."projectId"=p.id AND m."userId"=${userId})` : q.scope === "saved" ? Prisma.sql`AND EXISTS(SELECT 1 FROM "Bookmark" b WHERE b."projectId"=p.id AND b."userId"=${userId})` : Prisma.empty}`
        : Prisma.sql`p."suspendedAt" IS NULL AND p."activationRequired"=false AND p.id<>${userId || ""} AND p.id<>ALL(${blocked}::text[]) ${q.scope === "connections" ? Prisma.sql`AND EXISTS(SELECT 1 FROM "Connection" c WHERE c.status='Accepted' AND (c."senderId"=${userId} AND c."receiverId"=p.id OR c."receiverId"=${userId} AND c."senderId"=p.id))` : Prisma.empty}`;
    const direction = q.sort === "oldest" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    let after = Prisma.empty;
    if (cursor) {
      const date = new Date(cursor.date);
      after =
        q.sort === "recommended"
          ? Prisma.sql`WHERE (score,"createdAt",id)<(${cursor.score},${date},${cursor.id})`
          : q.sort === "oldest"
            ? Prisma.sql`WHERE ("createdAt",id)>(${date},${cursor.id})`
            : Prisma.sql`WHERE ("createdAt",id)<(${date},${cursor.id})`;
    }
    const table =
      kind === "projects" ? Prisma.sql`"Project"` : Prisma.sql`"User"`;
    const ids = await db.$queryRaw<
      { id: string; createdAt: Date; score: Prisma.Decimal; active: boolean }[]
    >(
      Prisma.sql`WITH ranked AS (SELECT p.id,p."createdAt",${active} AS active,${rank} AS score FROM ${table} p WHERE p."createdAt"<=${asOf} AND ${conditions} ${search}) SELECT * FROM ranked ${after} ORDER BY ${q.sort === "recommended" ? Prisma.sql`score DESC,` : Prisma.empty}"createdAt" ${direction},id ${direction} LIMIT ${q.limit + 1}`,
    );
    const visible = ids.slice(0, q.limit),
      rows =
        kind === "projects"
          ? await db.project.findMany({
              where: { id: { in: visible.map((r) => r.id) } },
              include: projectInclude(userId),
            })
          : await db.user.findMany({
              where: { id: { in: visible.map((r) => r.id) } },
              select: PUBLIC_USER,
            });
    const map = new Map(rows.map((r) => [r.id, r]));
    const connections =
        kind === "people" && userId
          ? await db.connection.findMany({
              where: {
                OR: [
                  {
                    senderId: userId,
                    receiverId: { in: visible.map((r) => r.id) },
                  },
                  {
                    receiverId: userId,
                    senderId: { in: visible.map((r) => r.id) },
                  },
                ],
              },
            })
          : [],
      follows =
        kind === "people" && userId
          ? await db.follow.findMany({
              where: {
                followerId: userId,
                followingId: { in: visible.map((r) => r.id) },
              },
            })
          : [];
    const items = visible
      .filter((r) => map.has(r.id))
      .map((r) => {
        const value = map.get(r.id)!;
        return kind === "projects"
          ? {
              ...serializeProject(value, me),
              match: me ? Number(r.score) : null,
              matchReasons: matchReasons(
                me,
                (value as any).requiredSkills,
                [...(value as any).tags, (value as any).category],
                (value as any).city,
                r.active,
              ),
            }
          : {
              ...value,
              match: me ? Number(r.score) : null,
              matchReasons: matchReasons(
                me,
                (value as any).skills,
                (value as any).interests,
                (value as any).city,
                r.active,
              ),
              following: follows.some((f) => f.followingId === r.id),
              connection:
                connections.find(
                  (c) => c.senderId === r.id || c.receiverId === r.id,
                ) || null,
            };
      });
    const last = visible.at(-1);
    const encode = (value: unknown) => {
      const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
      return (
        payload +
        "." +
        createHmac("sha256", cursorKeys("EXPORT_CURSOR_SECRET")[0])
          .update("discovery:" + payload)
          .digest("base64url")
      );
    };
    return {
      items,
      ranking: {
        version: recommendationVersion,
        asOf: asOf.toISOString(),
        semantics:
          "Live visibility and profile edits; not a snapshot. Refresh to update ranking; cursors expire after 30 minutes.",
      },
      nextCursor:
        ids.length > q.limit && last
          ? encode({
              id: last.id,
              date: last.createdAt.toISOString(),
              score: Number(last.score),
              binding,
              asOf: asOf.toISOString(),
            })
          : null,
    };
  }
}
