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
import { z } from "zod";
import type { Request } from "express";
import { db, uid, optionalUid, validate } from "../core/security";
import { distanceKm, boundingBox } from "../core/geo";
export const STORE_CATEGORIES = [
  "Drone",
  "ECE",
  "Sensors",
  "Motors",
  "Robotics",
  "3D Printing",
  "PCB",
] as const;
const storeInput = z.object({
  name: z.string().trim().min(3).max(120),
  address: z.string().trim().min(5).max(250),
  city: z.string().trim().min(2).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[0-9+()\-\s]*$/, "Use digits and phone symbols only.")
    .default(""),
  hours: z.string().trim().max(120).default(""),
  description: z.string().trim().max(600).default(""),
  categories: z.array(z.enum(STORE_CATEGORIES)).min(1).max(7),
});
export async function requireAdmin(req: Request) {
  const id = await uid(req);
  const u = await db.user.findUniqueOrThrow({ where: { id } });
  if (!u.isAdmin)
    throw new HttpException("Administrator access required.", 403);
  return id;
}
@Controller("api/stores")
export class StoresController {
  @Get() async list(@Req() req: Request) {
    const userId = await optionalUid(req);
    const q = validate(
      z.object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        radiusKm: z.coerce.number().min(1).max(100).default(25),
        category: z.enum(STORE_CATEGORIES).optional(),
        search: z.string().trim().max(100).default(""),
        favorites: z.enum(["true", "false"]).optional(),
      }),
      req.query,
    );
    if ((q.lat === undefined) !== (q.lng === undefined))
      throw new HttpException("Provide both latitude and longitude.", 400);
    const box =
      q.lat !== undefined && q.lng !== undefined
        ? boundingBox(q.lat, q.lng, q.radiusKm)
        : null;
    const rows = await db.hardwareStore.findMany({
      where: {
        status: "Approved",
        ...(q.category ? { categories: { has: q.category } } : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: "insensitive" } },
                { description: { contains: q.search, mode: "insensitive" } },
                { city: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(box
          ? {
              lat: { gte: box.minLat, lte: box.maxLat },
              lng: { gte: box.minLng, lte: box.maxLng },
            }
          : {}),
        ...(q.favorites === "true"
          ? { favorites: { some: { userId: userId || "none" } } }
          : {}),
      },
      take: 200,
      include: {
        favorites: {
          where: { userId: userId || "none" },
          select: { userId: true },
        },
      },
    });
    const items = rows
      .map(({ favorites, submittedById, ...s }) => ({
        ...s,
        favorite: favorites.length > 0,
        distanceKm:
          q.lat !== undefined && q.lng !== undefined
            ? Math.round(distanceKm(q.lat, q.lng, s.lat, s.lng) * 10) / 10
            : null,
      }))
      .filter((s) => s.distanceKm === null || s.distanceKm <= q.radiusKm)
      .sort(
        (a, b) =>
          (a.distanceKm ?? 0) - (b.distanceKm ?? 0) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 60);
    return { items, categories: STORE_CATEGORIES };
  }
  @Post() async submit(@Req() req: Request, @Body() b: unknown) {
    const submittedById = await uid(req);
    if (
      (await db.hardwareStore.count({
        where: { submittedById, status: "Pending" },
      })) >= 5
    )
      throw new HttpException(
        "You have too many listings awaiting review.",
        429,
      );
    const s = await db.hardwareStore.create({
      data: { ...validate(storeInput, b), submittedById, status: "Pending" },
    });
    return {
      id: s.id,
      status: s.status,
      message: "Thanks! The listing will appear after moderator review.",
    };
  }
  @Post(":id/favorite") async favorite(
    @Param("id") storeId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req);
    const { enabled } = validate(z.object({ enabled: z.boolean() }), b);
    const s = await db.hardwareStore.findUnique({ where: { id: storeId } });
    if (!s || s.status !== "Approved")
      throw new HttpException("Store not found.", 404);
    if (enabled)
      await db.storeFavorite.upsert({
        where: { userId_storeId: { userId, storeId } },
        update: {},
        create: { userId, storeId },
      });
    else await db.storeFavorite.deleteMany({ where: { userId, storeId } });
    return { favorite: enabled };
  }
  @Get("pending") async pending(@Req() req: Request) {
    await requireAdmin(req);
    const q = validate(
      z.object({
        paged: z.enum(["true"]).optional(),
        cursor: z.string().max(100).optional(),
      }),
      req.query,
    );
    const rows = await db.hardwareStore.findMany({
      where: { status: "Pending" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: q.paged ? 51 : 100,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return q.paged
      ? {
          items: rows.slice(0, 50),
          nextCursor: rows.length > 50 ? rows[49].id : null,
        }
      : rows;
  }
  @Patch(":id/review") async review(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req);
    await requireAdmin(req);
    const { status } = validate(
      z.object({ status: z.enum(["Approved", "Rejected"]) }),
      b,
    );
    const s = await db.hardwareStore.findUnique({ where: { id } });
    if (!s) throw new HttpException("Store not found.", 404);
    return db.$transaction(async (tx) => {
      const row = await tx.hardwareStore.update({
        where: { id },
        data: { status },
      });
      await tx.adminAudit.create({
        data: {
          actorId: actor,
          action: "store." + status.toLowerCase(),
          targetId: id,
          payload: {},
        },
      });
      return row;
    });
  }
}
