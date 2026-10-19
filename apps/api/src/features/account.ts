import { sessionCookieOptions } from "../core/preview-config";
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Res,
  HttpException,
} from "@nestjs/common";
import { retireImage } from "../core/public-image";
import { backfillQuota } from "../core/ai-ledger";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import { hash, compare } from "bcryptjs";
import { z } from "zod";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  db,
  uid,
  digest,
  validate,
  socialTransaction,
  lockUsers,
} from "../core/security";
export async function queueToken(userId: string, purpose: "verify" | "reset") {
  const token = randomBytes(32).toString("hex");
  const origin = new URL(process.env.PUBLIC_APP_URL || "http://localhost:3000")
    .origin;
  await socialTransaction(async (tx) => {
    await lockUsers(tx, userId);
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (current.suspendedAt) return;
    if (
      purpose === "verify" &&
      current.activationRequired &&
      (await tx.accountToken.findFirst({
        where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      }))
    )
      return;
    await tx.emailOutbox.updateMany({
      where: {
        recipient: current.email,
        status: { in: ["Pending", "Sending"] },
        subject:
          purpose === "reset"
            ? "Reset your ProjectConnect password"
            : "Verify your ProjectConnect email",
      },
      data: { status: "Failed", body: "" },
    });
    await tx.accountToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.accountToken.create({
      data: {
        userId,
        purpose,
        tokenHash: digest(token),
        expiresAt: new Date(
          Date.now() + (purpose === "reset" ? 1800000 : 86400000),
        ),
      },
    });
    await tx.emailOutbox.create({
      data: {
        recipient: current.email,
        subject:
          purpose === "reset"
            ? "Reset your ProjectConnect password"
            : "Verify your ProjectConnect email",
        body: `${purpose === "reset" ? "Reset your password" : "Verify your email"} using this one-use link:\n${origin}/account/${purpose}#token=${token}\n\nIf you did not request this, ignore this message.`,
      },
    });
  });
}
async function clearPendingIdentity(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  // Legacy accounts with authored workspace/community content need human identity review.
  // Never silently attribute attacker-created content or grants to a mailbox owner.
  const material = await Promise.all([
    tx.project.count({ where: { ownerId: userId } }),
    tx.projectFile.count({ where: { uploaderId: userId } }),
    tx.message.count({ where: { senderId: userId } }),
    tx.projectMessage.count({ where: { senderId: userId } }),
    tx.resource.count({ where: { submittedById: userId } }),
    tx.hardwareStore.count({ where: { submittedById: userId } }),
    tx.activity.count({ where: { authorId: userId } }),
    tx.auditEvent.count({ where: { actorId: userId } }),
    tx.aiPlan.count({ where: { userId } }),
    tx.aiConversation.count({ where: { userId } }),
  ]);
  if (material.some(Boolean))
    throw new HttpException(
      "This legacy account requires support review before activation. No access has been restored.",
      409,
    );
  const avatar = (await tx.user.findUniqueOrThrow({ where: { id: userId } }))
    .avatarId;
  await tx.user.update({ where: { id: userId }, data: { avatarId: null } });
  await retireImage(tx, avatar);
  await tx.oAuthAccount.deleteMany({ where: { userId } });
  await tx.connection.deleteMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
  });
  await tx.follow.deleteMany({
    where: { OR: [{ followerId: userId }, { followingId: userId }] },
  });
  await tx.block.deleteMany({
    where: { blockerId: userId },
  });
  await tx.projectInvite.updateMany({
    where: { OR: [{ userId }, { inviterId: userId }], status: "Pending" },
    data: { status: "Cancelled" },
  });
  await tx.application.deleteMany({ where: { userId } });
  await tx.member.deleteMany({ where: { userId } });
  await tx.bookmark.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({
    where: { OR: [{ userId }, { actorId: userId }] },
  });
}
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const password = z
  .string()
  .min(10)
  .max(128)
  .refine(
    (v) => Buffer.byteLength(v, "utf8") <= 72,
    "Password must be at most 72 UTF-8 bytes.",
  );
@Controller("api/account")
export class AccountController {
  @Get() async info(@Req() req: Request) {
    const userId = await uid(req);
    return db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        emailVerifiedAt: true,
        passwordSet: true,
        notifySocial: true,
        notifyMessages: true,
        notifyWorkspace: true,
      },
    });
  }
  @Patch("preferences") async preferences(
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const id = await uid(req),
      v = validate(
        z
          .object({
            notifySocial: z.boolean(),
            notifyMessages: z.boolean(),
            notifyWorkspace: z.boolean(),
          })
          .strict(),
        b,
      );
    return db.user.update({
      where: { id },
      data: v,
      select: {
        notifySocial: true,
        notifyMessages: true,
        notifyWorkspace: true,
      },
    });
  }
  @Post("verification") async sendVerify(@Req() req: Request) {
    const id = await uid(req);
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (!user.emailVerifiedAt) await queueToken(id, "verify");
    return { message: "If needed, a verification email has been queued." };
  }
  @Post("activation") async resendActivation(@Body() b: unknown) {
    const started = Date.now();
    const { email } = validate(z.object({ email: z.email() }).strict(), b);
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (user?.activationRequired && !user.suspendedAt) {
      const recent = await db.accountToken.findFirst({
        where: {
          userId: user.id,
          purpose: "verify",
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });
      // Do not invalidate an outstanding mailbox link: hostile resend must not deny activation.
      if (!recent) await queueToken(user.id, "verify");
    }
    await delay(Math.max(0, 300 - (Date.now() - started)));
    return {
      message:
        "If eligible, an activation email has been queued. Check your inbox or your existing activation link.",
    };
  }
  @Post("verify") async verify(@Body() b: unknown) {
    const v = validate(
      z
        .object({
          token: tokenSchema,
          password: password.optional(),
          name: z.string().trim().min(2).max(80).optional(),
        })
        .strict(),
      b,
    );
    const passwordHash = v.password ? await hash(v.password, 12) : undefined;
    return socialTransaction(async (tx) => {
      const initial = await tx.accountToken.findUnique({
        where: { tokenHash: digest(v.token) },
      });
      if (!initial)
        throw new HttpException(
          "This verification link is invalid or expired.",
          400,
        );
      await lockUsers(tx, initial.userId);
      const row = await tx.accountToken.findUnique({
        where: { id: initial.id },
      });
      const user = await tx.user.findUnique({ where: { id: initial.userId } });
      if (
        !row ||
        row.purpose !== "verify" ||
        row.usedAt ||
        row.expiresAt <= new Date() ||
        !user ||
        user.suspendedAt
      )
        throw new HttpException(
          "This verification link is invalid or expired.",
          400,
        );
      if (
        (user.activationRequired || process.env.NODE_ENV === "production") &&
        (!passwordHash || !v.name)
      )
        throw new HttpException(
          "Choose your own new password and profile name to activate this account.",
          400,
        );
      if (
        user.activationRequired &&
        (await compare(v.password!, user.passwordHash))
      )
        throw new HttpException(
          "Choose a different password from the registration password.",
          400,
        );
      if (user.activationRequired) await clearPendingIdentity(tx, user.id);
      await tx.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: new Date(),
          activationRequired: false,
          ...(passwordHash ? { passwordHash, passwordSet: true } : {}),
          ...(user.activationRequired
            ? {
                bio: "",
                portfolioUrl: "",
                education: "",
                city: "",
                skills: [],
                interests: [],
                role: "Developer",
                notifySocial: true,
                notifyMessages: true,
                notifyWorkspace: true,
                name: v.name,
                initials: v
                  .name!.split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase(),
              }
            : {}),
        },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.accountToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.emailOutbox.updateMany({
        where: {
          recipient: user.email,
          status: { in: ["Pending", "Sending"] },
        },
        data: { status: "Failed", body: "" },
      });
      return { message: "Your email is verified. Please sign in again." };
    });
  }
  @Post("forgot-password") async forgot(@Body() b: unknown) {
    const started = Date.now();
    const { email } = validate(z.object({ email: z.email() }), b);
    const u = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (u && !u.suspendedAt)
      try {
        await queueToken(u.id, "reset");
      } catch {
        console.error(
          JSON.stringify({ level: "error", code: "RECOVERY_QUEUE_FAILED" }),
        );
      }
    await delay(Math.max(0, 300 - Date.now()));
    return {
      message: "If an account exists, a password-reset email has been queued.",
    };
  }
  @Post("reset-password") async reset(@Body() b: unknown) {
    const v = validate(z.object({ token: tokenSchema, password }), b);
    const passwordHash = await hash(v.password, 12);
    return socialTransaction(async (tx) => {
      const initial = await tx.accountToken.findUnique({
        where: { tokenHash: digest(v.token) },
      });
      if (!initial)
        throw new HttpException("This reset link is invalid or expired.", 400);
      await lockUsers(tx, initial.userId);
      const user = await tx.user.findUnique({ where: { id: initial.userId } });
      if (!user || user.suspendedAt)
        throw new HttpException("This reset link is invalid or expired.", 400);
      const row = await tx.accountToken.findUnique({
        where: { id: initial.id },
      });
      if (
        !row ||
        row.purpose !== "reset" ||
        row.usedAt ||
        row.expiresAt <= new Date()
      )
        throw new HttpException("This reset link is invalid or expired.", 400);
      const claimed = await tx.accountToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new HttpException("This link was already used.", 400);
      if (
        user.activationRequired &&
        (await compare(v.password!, user.passwordHash))
      )
        throw new HttpException(
          "Choose a different password from the registration password.",
          400,
        );
      if (user.activationRequired) await clearPendingIdentity(tx, user.id);
      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          passwordSet: true,
          activationRequired: false,
          emailVerifiedAt: new Date(),
          ...(user.activationRequired
            ? {
                bio: "",
                portfolioUrl: "",
                education: "",
                city: "",
                skills: [],
                interests: [],
                role: "Developer",
                notifySocial: true,
                notifyMessages: true,
                notifyWorkspace: true,
                name: "New builder",
                initials: "NB",
              }
            : {}),
        },
      });
      await tx.oAuthAccount.deleteMany({ where: { userId: row.userId } });
      await tx.session.deleteMany({ where: { userId: row.userId } });
      await tx.accountToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      return {
        message:
          "Password reset. All sessions and linked Google access revoked. Please sign in again; you can relink Google in account settings.",
      };
    });
  }
  @Post("password") async change(
    @Req() req: Request,
    @Body() b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await uid(req);
    const v = validate(
      z.object({ currentPassword: z.string().max(128), password }),
      b,
    );
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await compare(v.currentPassword, user.passwordHash)))
      throw new HttpException("Current password is incorrect.", 400);
    const passwordHash = await hash(v.password, 12);
    await db.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: userId, passwordHash: user.passwordHash },
        data: { passwordHash, passwordSet: true },
      });
      if (changed.count !== 1)
        throw new HttpException(
          "Password changed elsewhere. Sign in again.",
          409,
        );
      await tx.session.deleteMany({ where: { userId } });
      await tx.accountToken.updateMany({
        where: { userId, purpose: "reset", usedAt: null },
        data: { usedAt: new Date() },
      });
    });
    res.clearCookie("pc_session", sessionCookieOptions());
    return { message: "Password changed. All sessions signed out." };
  }
  @Get("export") async exportAccount(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await uid(req);
    const result = await db.$transaction(
      async (tx) => {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            emailVerifiedAt: true,
            notifySocial: true,
            notifyMessages: true,
            notifyWorkspace: true,
            name: true,
            role: true,
            bio: true,
            education: true,
            portfolioUrl: true,
            city: true,
            skills: true,
            interests: true,
            createdAt: true,
          },
        });
        const [
          projects,
          memberships,
          applications,
          resources,
          messages,
          plans,
          activities,
          notifications,
          follows,
          blocks,
          projectMessages,
          files,
          bookmarks,
          resourceSaves,
          resourceVotes,
          storeFavorites,
          invitations,
          reports,
          connections,
        ] = await Promise.all([
          tx.project.findMany({ where: { ownerId: userId }, take: 10001 }),
          tx.member.findMany({ where: { userId }, take: 10001 }),
          tx.application.findMany({ where: { userId }, take: 10001 }),
          tx.resource.findMany({
            where: { submittedById: userId },
            take: 10001,
          }),
          tx.message.findMany({ where: { senderId: userId }, take: 10001 }),
          tx.aiPlan.findMany({
            where: { userId, source: { not: "deleted" } },
            take: 1001,
          }),
          tx.activity.findMany({ where: { authorId: userId }, take: 10001 }),
          tx.notification.findMany({ where: { userId }, take: 10001 }),
          tx.follow.findMany({ where: { followerId: userId }, take: 10001 }),
          tx.block.findMany({ where: { blockerId: userId }, take: 10001 }),
          tx.projectMessage.findMany({
            where: { senderId: userId },
            take: 10001,
          }),
          tx.projectFile.findMany({
            where: { uploaderId: userId },
            select: {
              id: true,
              projectId: true,
              name: true,
              mime: true,
              size: true,
              createdAt: true,
            },
            take: 10001,
          }),
          tx.bookmark.findMany({ where: { userId }, take: 10001 }),
          tx.resourceSave.findMany({ where: { userId }, take: 10001 }),
          tx.resourceVote.findMany({ where: { userId }, take: 10001 }),
          tx.storeFavorite.findMany({ where: { userId }, take: 10001 }),
          tx.projectInvite.findMany({
            where: { OR: [{ userId }, { inviterId: userId }] },
            take: 10001,
          }),
          tx.report.findMany({ where: { reporterId: userId }, take: 10001 }),
          tx.connection.findMany({
            where: { OR: [{ senderId: userId }, { receiverId: userId }] },
            take: 10001,
          }),
        ]);
        const assistantConversations = await tx.aiConversation.findMany({
          where: { userId },
          take: 101,
          include: {
            turns: {
              select: {
                id: true,
                prompt: true,
                content: true,
                source: true,
                status: true,
                createdAt: true,
              },
              take: 100,
            },
          },
        });
        const collections = {
          assistantConversations,
          projects,
          memberships,
          applications,
          resources,
          sentMessages: messages,
          plans,
          activities,
          notifications,
          follows,
          blocks,
          sentProjectMessages: projectMessages,
          files,
          bookmarks,
          resourceSaves,
          resourceVotes,
          storeFavorites,
          invitations,
          reports,
          connections,
        };
        const truncated = Object.entries(collections)
          .filter(
            ([key, rows]) =>
              rows.length >
              (key === "plans"
                ? 1000
                : key === "assistantConversations"
                  ? 100
                  : 10000),
          )
          .map(([key]) => key);
        return {
          exportedAt: new Date().toISOString(),
          user,
          ...Object.fromEntries(
            Object.entries(collections).map(([key, rows]) => [
              key,
              rows.slice(
                0,
                key === "plans"
                  ? 1000
                  : key === "assistantConversations"
                    ? 100
                    : 10000,
              ),
            ]),
          ),
          limits: {
            sentMessages: 10000,
            plans: 1000,
            assistantConversations: 100,
            otherCollections: 10000,
          },
          truncated,
          pagination: {
            manifest: "/api/account/export/sections",
            page: "/api/account/export/page",
          },
          note: "Only your own sent messages and outgoing follows/blocks are exported. No passwords, session/recovery secrets or private storage keys. Use the paginated section export for all rows if truncated is nonempty.",
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="projectconnect-account-export.json"',
    );
    return result;
  }
  @Delete() async deleteAccount(
    @Req() req: Request,
    @Body() b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await uid(req);
    const { password: currentPassword } = validate(
      z.object({ password: z.string().max(128) }),
      b,
    );
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await compare(currentPassword, u.passwordHash)))
      throw new HttpException("Password is incorrect.", 400);
    await socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      const current = await tx.user.findUniqueOrThrow({
        where: { id: userId },
      });
      if (current.passwordHash !== u.passwordHash)
        throw new HttpException(
          "Password changed elsewhere. Sign in again.",
          409,
        );
      const projectIds = (
        await tx.project.findMany({
          where: {
            OR: [
              { ownerId: userId },
              { members: { some: { userId } } },
              { applications: { some: { userId } } },
              { files: { some: { uploaderId: userId } } },
              { tasks: { some: { assigneeId: userId } } },
              { messages: { some: { senderId: userId } } },
              { invitations: { some: { userId } } },
              { auditEvents: { some: { actorId: userId } } },
              { updates: { some: { authorId: userId } } },
            ],
          },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      ).map((p) => p.id);
      if (projectIds.length)
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Project" WHERE id IN (${Prisma.join(projectIds)}) ORDER BY id FOR UPDATE`,
        );
      if (await tx.project.count({ where: { ownerId: userId } }))
        throw new HttpException(
          "Transfer ownership of your projects first.",
          409,
        );
      const files = await tx.projectFile.findMany({
        where: { uploaderId: userId },
        select: { storageKey: true },
      });
      if (files.length)
        await tx.storageDeletion.createMany({
          data: files,
          skipDuplicates: true,
        });
      await tx.task.updateMany({
        where: { assigneeId: userId },
        data: { assigneeId: null, version: { increment: 1 } },
      });
      await tx.projectFile.deleteMany({ where: { uploaderId: userId } });
      await tx.projectMessage.deleteMany({ where: { senderId: userId } });
      await tx.message.deleteMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      });
      await tx.connection.deleteMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      });
      await tx.application.deleteMany({ where: { userId } });
      await tx.member.deleteMany({ where: { userId } });
      await tx.bookmark.deleteMany({ where: { userId } });
      await tx.resource.deleteMany({ where: { submittedById: userId } });
      await tx.hardwareStore.deleteMany({ where: { submittedById: userId } });
      await tx.projectInvite.updateMany({
        where: { inviterId: userId },
        data: { status: "Cancelled", inviterId: "deleted-user" },
      });
      await tx.auditEvent.deleteMany({ where: { actorId: userId } });
      await tx.adminAudit.updateMany({
        where: { actorId: userId },
        data: { actorId: "deleted-user" },
      });
      await tx.adminAudit.updateMany({
        where: { targetId: userId },
        data: { targetId: "deleted-user" },
      });
      await tx.notification.deleteMany({ where: { actorId: userId } });
      await tx.emailOutbox.deleteMany({ where: { recipient: u.email } });
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(984513)::text`;
      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      // Bound individual deletion work. Worker progresses separately for large
      // legacy accounts; never erase an unmaterialized recent identity.
      const backfill = await backfillQuota(tx, now, userId, 1000);
      if (backfill.more)
        throw new HttpException(
          "AI usage reconciliation in progress. Retry account deletion shortly.",
          503,
        );
      await tx.user.update({ where: { id: userId }, data: { avatarId: null } });
      await retireImage(tx, current.avatarId);
      await tx.aiUsage.updateMany({
        where: { userId },
        data: { userId: "deleted-user", projectId: null },
      });
      await tx.user.delete({ where: { id: userId } });
    });
    res.clearCookie("pc_session", sessionCookieOptions());
    return { message: "Account deleted. Your sessions have been revoked." };
  }
  @Get("sessions") async sessions(@Req() req: Request) {
    const userId = await uid(req);
    const current = digest(req.cookies.pc_session);
    return (
      await db.session.findMany({
        where: { userId, expiresAt: { gt: new Date() } },
        select: { id: true, tokenHash: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      })
    ).map(({ tokenHash, ...s }) => ({ ...s, current: tokenHash === current }));
  }
  @Delete("sessions/:id") async revoke(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    await db.session.deleteMany({ where: { id, userId: await uid(req) } });
    return { ok: true };
  }
}
