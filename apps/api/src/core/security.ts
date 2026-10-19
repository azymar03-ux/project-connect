import { sandboxPreviewOrigin, sessionCookieOptions } from "./preview-config";
import { HttpException } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
try {
  process.loadEnvFile();
} catch {}
export const db = new PrismaClient();
export const PUBLIC_USER = {
  id: true,
  name: true,
  role: true,
  bio: true,
  education: true,
  portfolioUrl: true,
  city: true,
  skills: true,
  interests: true,
  initials: true,
  color: true,
  avatarId: true,
  createdAt: true,
} as const;
export function publicUser(u: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(PUBLIC_USER).map((k) => [k, u[k]]));
}
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const p = schema.safeParse(input);
  if (!p.success)
    throw new HttpException(
      {
        message: p.error.issues.map((x) => x.message).join("; "),
        code: "VALIDATION_ERROR",
      },
      400,
    );
  return p.data;
}
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function uid(req: Request) {
  const token = req.cookies?.pc_session;
  if (typeof token !== "string" || token.length !== 64)
    throw new HttpException("Please sign in to continue.", 401);
  const session = await db.session.findUnique({
    where: { tokenHash: digest(token) },
    include: {
      user: { select: { suspendedAt: true, activationRequired: true } },
    },
  });
  if (!session || session.expiresAt <= new Date())
    throw new HttpException("Your session expired. Please sign in.", 401);
  if (session.user.activationRequired)
    throw new HttpException("Activate your account using the email link.", 401);
  if (session.user.suspendedAt)
    throw new HttpException(
      "Account access is suspended. Contact support.",
      403,
    );
  return session.userId;
}
export async function optionalUid(req: Request) {
  try {
    return await uid(req);
  } catch (e) {
    if (e instanceof HttpException && e.getStatus() === 401) return undefined;
    throw e;
  }
}
export async function session(
  res: Response,
  id: string,
  proof:
    | { kind: "password"; expectedHash: string }
    | { kind: "oauth"; provider: string; subject: string; linkId: string },
) {
  const token = randomBytes(32).toString("hex");
  await socialTransaction(async (tx) => {
    await lockUsers(tx, id);
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        suspendedAt: true,
        activationRequired: true,
        passwordHash: true,
      },
    });
    if (
      !user ||
      user.suspendedAt ||
      user.activationRequired ||
      (proof.kind === "password" && user.passwordHash !== proof.expectedHash)
    )
      throw new HttpException("Account unavailable.", 403);
    if (proof.kind === "oauth") {
      const link = await tx.oAuthAccount.findUnique({
        where: { id: proof.linkId },
      });
      if (
        !link ||
        link.userId !== id ||
        link.provider !== proof.provider ||
        link.subject !== proof.subject
      )
        throw new HttpException(
          "Provider link changed. Please sign in again.",
          401,
        );
    }
    await tx.session.create({
      data: {
        userId: id,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 28800000),
      },
    });
  });
  res.cookie("pc_session", token, {
    ...sessionCookieOptions(),
    maxAge: 28800000,
    path: "/",
  });
}
export function parsePage(req: Request) {
  return validate(
    z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: z.string().max(100).optional(),
    }),
    req.query,
  );
}
export async function member(projectId: string, userId: string) {
  const m = await db.member.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (!m) throw new HttpException("Project membership is required.", 403);
  return m;
}
export async function owner(projectId: string, userId: string) {
  const p = await db.project.findUnique({ where: { id: projectId } });
  if (!p) throw new HttpException("Project not found.", 404);
  if (p.ownerId !== userId)
    throw new HttpException("Only the project owner can do this.", 403);
  return p;
}
export async function serializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  retryUnique = false,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2034" || (retryUnique && e.code === "P2002")) &&
        attempt < 3
      )
        continue;
      throw e;
    }
  }
  throw new HttpException("Concurrent update. Please try again.", 409);
}
export function canonical(a: string, b: string) {
  const [userLowId, userHighId] = [a, b].sort();
  return { userLowId, userHighId };
}
export function allowedOrigins() {
  const raw = process.env.APP_ORIGINS;
  if (!raw)
    throw new Error("APP_ORIGINS must contain exact allowed browser origins");
  const origins = new Set(raw.split(",").map((x) => new URL(x.trim()).origin));
  const preview = sandboxPreviewOrigin();
  if (preview) origins.add(preview);
  return origins;
}
// Social writers serialize on ordered user rows. READ COMMITTED ensures queries
// after a lock wait observe the winner's committed block/connection changes.
export async function lockUsers(
  tx: Prisma.TransactionClient,
  ...ids: (string | undefined)[]
) {
  const users = [
    ...new Set(ids.filter((id): id is string => Boolean(id))),
  ].sort();
  if (users.length) {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(users)}) ORDER BY id FOR NO KEY UPDATE`,
    );
    if (rows.length !== users.length)
      throw new HttpException("Account unavailable.", 404);
  }
}
export async function socialTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2034" ||
          (e.code === "P2010" &&
            ["40P01", "40001"].includes(String(e.meta?.code)))) &&
        attempt < 3
      )
        continue;
      throw e;
    }
  }
  throw new HttpException("Concurrent update. Please try again.", 409);
}
export async function blockedIn(
  tx: Prisma.TransactionClient,
  a: string,
  b: string,
) {
  return Boolean(
    await tx.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    }),
  );
}
