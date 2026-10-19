import { sitemapPartitionSchema } from "../contracts";
import { Controller, Get, Req, HttpException } from "@nestjs/common";
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { db, validate } from "../core/security";
function table(k: "projects" | "people") {
  return k === "projects" ? Prisma.sql`"Project"` : Prisma.sql`"User"`;
}
function visible(k: "projects" | "people") {
  return k === "projects"
    ? Prisma.sql`p.status<>'Archived' AND EXISTS(SELECT 1 FROM "User" u WHERE u.id=p."ownerId" AND u."suspendedAt" IS NULL AND u."activationRequired"=false)`
    : Prisma.sql`p."suspendedAt" IS NULL AND p."activationRequired"=false`;
}
@Controller("api/sitemaps")
export class SitemapsController {
  @Get("partitions") async partitions() {
    const result: {
      kind: "projects" | "people";
      first: string;
      last: string;
    }[] = [];
    for (const k of ["projects", "people"] as const) {
      const rows = await db.$queryRaw<
        { first: string; last: string }[]
      >(Prisma.sql`
        WITH ranked AS (SELECT p.id,(row_number() OVER (ORDER BY p.id)-1)/10000 AS part FROM ${table(k)} p WHERE ${visible(k)})
        SELECT min(id) AS first,max(id) AS last FROM ranked GROUP BY part ORDER BY part LIMIT 50001`);
      if (result.length + rows.length > 50000)
        throw new HttpException(
          "Sitemap index exceeds supported partition count.",
          503,
        );
      result.push(...rows.map((row) => ({ kind: k, ...row })));
    }
    return result;
  }
  @Get("entries") async entries(@Req() req: Request) {
    const q = validate(sitemapPartitionSchema, req.query);
    if (q.first > q.last)
      throw new HttpException("Invalid sitemap range.", 400);
    const rows = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT p.id FROM ${table(q.kind)} p WHERE p.id>=${q.first} AND p.id<=${q.last} AND ${visible(q.kind)} ORDER BY p.id LIMIT 45001`,
    );
    if (rows.length > 45000)
      throw new HttpException(
        "Sitemap range grew too large. Refresh the index.",
        503,
      );
    return { kind: q.kind, items: rows };
  }
}
