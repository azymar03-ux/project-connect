import { sessionCookieOptions } from "./core/preview-config";
import { startStorageScanWorker } from "./core/storage-scan";
import { SitemapsController } from "./features/sitemaps";
import { ExportJobsController } from "./features/export-jobs";
import { startExportWorker } from "./core/export-job";
import { startGithubMetadataWorker } from "./core/github-metadata";
import { validateCursorKeys } from "./core/cursor-keys";
import { measureHttp } from "./core/telemetry";
import "reflect-metadata";
import {
  chatPosition,
  parsePosition,
  positionFilter,
} from "./core/chat-position";
import { startQuotaWorker } from "./core/ai-ledger";
import { ImagesController } from "./features/images";
import { ExportController } from "./features/export";
import { validateRuntimeConfig } from "./core/runtime-config";
import { ProjectChatController } from "./features/project-chat";
import { AdminUsersController } from "./features/admin-users";
import { startMaintenance } from "./core/maintenance";
import { GithubWorkspaceController } from "./features/github-workspace";
import { PlacesController } from "./features/places";
import { AssistantController } from "./features/assistant";
import { OAuthController } from "./features/oauth";
import { DiscoveryController } from "./features/discovery";
import { publicProject } from "./core/public-project";
import { SocialController, alert } from "./features/social";
import { trustedProxies } from "./core/proxy";
import { SharedLimiter, rateMiddleware } from "./core/rate-limit";
import { FilesController } from "./features/files";
import { InvitationController } from "./features/invitations";
import { GithubController } from "./features/github";
import { StoresController } from "./features/stores";
import { AiController } from "./features/ai";
import { ModerationController, isBlockedBetween } from "./features/moderation";
import { TeamController } from "./features/team";
import { AccountController, queueToken } from "./features/account";
import { startStorageWorker } from "./core/storage-cleanup";
import { startMailWorker } from "./core/mail";
import { ResourcesController } from "./features/resources";
import { WorkspaceController } from "./features/workspace";
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  Res,
  Module,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { ApiErrors } from "./core/errors";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { compare, hash } from "bcryptjs";

import cookieParser from "cookie-parser";
import { z } from "zod";
import type { Request, Response } from "express";
try {
  process.loadEnvFile();
} catch {}
import {
  db,
  publicUser,
  uid,
  optionalUid,
  session,
  validate,
  digest,
  canonical,
  lockUsers,
  socialTransaction,
  blockedIn,
  serializable,
  allowedOrigins,
  PUBLIC_USER,
} from "./core/security";
const profile = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.string().max(80),
  bio: z.string().max(500),
  city: z.string().max(100),
  skills: z.array(z.string().max(40)).max(20),
  interests: z.array(z.string().max(40)).max(20),
  education: z.string().trim().max(250).optional(),
  portfolioUrl: z
    .union([
      z.literal(""),
      z
        .url()
        .max(500)
        .refine((v) => {
          const u = new URL(v);
          return u.protocol === "https:" && !u.username && !u.password;
        }, "Use an HTTPS portfolio link."),
    ])
    .optional(),
});
@Controller("api")
class Api {
  @Get("health") health() {
    return { status: "ok", release: "launch-foundations" };
  }
  @Get("ready") async ready() {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", database: "connected" };
  }
  @Post("auth/login") async login(
    @Body() b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = validate(
      z.object({ email: z.email(), password: z.string().min(1).max(128) }),
      b,
    );
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    const valid = await compare(
      password,
      user?.passwordHash ||
        "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5T6mOCayQPl23Rc.2ZBP4G.mSuUzKxK",
    );
    if (!user || !valid || !user.passwordSet || user.activationRequired)
      throw new HttpException("Incorrect email or password.", 401);
    if (user.suspendedAt)
      throw new HttpException(
        "Account access is suspended. Contact support.",
        403,
      );
    await session(res, user.id, {
      kind: "password",
      expectedHash: user.passwordHash,
    });
    return publicUser(user);
  }
  @Post("auth/register") async register(
    @Body() b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const started = Date.now();
    const v = validate(
      z.object({
        name: z.string().trim().min(2).max(80),
        email: z.email(),
        password: z
          .string()
          .min(10)
          .max(128)
          .refine(
            (v) => Buffer.byteLength(v, "utf8") <= 72,
            "Password must be at most 72 UTF-8 bytes.",
          ),
      }),
      b,
    );
    const privateRegistration =
      process.env.NODE_ENV === "production" ||
      process.env.PRIVATE_REGISTRATION === "true";
    const passwordHash = await hash(v.password, 12);
    if (privateRegistration) {
      const existing = await db.user.findUnique({
        where: { email: v.email.toLowerCase() },
      });
      if (!existing) {
        try {
          const created = await db.user.create({
            data: {
              email: v.email.toLowerCase(),
              name: "Pending account",
              activationRequired: true,
              passwordSet: false,
              passwordHash,
              initials: v.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")
                .toUpperCase(),
              skills: [],
              interests: [],
            },
          });
          try {
            await queueToken(created.id, "verify");
          } catch {
            console.error(
              JSON.stringify({
                level: "error",
                code: "REGISTRATION_QUEUE_FAILED",
              }),
            );
          }
        } catch (e) {
          if (!(e instanceof Error && "code" in e && e.code === "P2002"))
            throw e;
        }
      }
      await delay(Math.max(0, 900 - (Date.now() - started)));
      return {
        message:
          "If eligible, a verification email has been queued. Set a fresh password from the email link, then sign in.",
      };
    }
    if (await db.user.findUnique({ where: { email: v.email.toLowerCase() } }))
      throw new HttpException("This email is already registered.", 409);
    const user = await db.user.create({
      data: {
        email: v.email.toLowerCase(),
        name: v.name,
        passwordHash,
        initials: v.name
          .split(" ")
          .map((x) => x[0])
          .slice(0, 2)
          .join("")
          .toUpperCase(),
        skills: [],
        interests: [],
      },
    });
    await queueToken(user.id, "verify");
    await session(res, user.id, {
      kind: "password",
      expectedHash: user.passwordHash,
    });
    return publicUser(user);
  }
  @Post("auth/logout") async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.pc_session;
    if (typeof token === "string")
      await db.session.deleteMany({ where: { tokenHash: digest(token) } });
    res.clearCookie("pc_session", sessionCookieOptions());
    return { ok: true };
  }
  @Post("auth/logout-all") async logoutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await db.session.deleteMany({ where: { userId: await uid(req) } });
    res.clearCookie("pc_session", sessionCookieOptions());
    return { ok: true };
  }
  @Get("me") async me(@Req() req: Request) {
    const u = await db.user.findUniqueOrThrow({
      where: { id: await uid(req) },
    });
    return { ...publicUser(u), isAdmin: u.isAdmin };
  }
  @Patch("me") async update(@Req() req: Request, @Body() b: unknown) {
    const v = validate(profile, b);
    return publicUser(
      await db.user.update({ where: { id: await uid(req) }, data: v }),
    );
  }
  @Get("projects") async projects(@Req() req: Request) {
    return (await new DiscoveryController().list(req, "projects", 50)).items;
  }
  @Post("projects") async create(@Req() req: Request, @Body() b: unknown) {
    const id = await uid(req);
    const v = validate(
      z.object({
        title: z.string().trim().min(5).max(100),
        description: z.string().trim().min(20).max(5000),
        category: z.enum([
          "Robotics",
          "IoT",
          "AI & ML",
          "Web development",
          "Design",
        ]),
        tags: z.array(z.string().max(40)).min(1).max(10),
        requiredSkills: z.array(z.string().max(40)).min(1).max(10),
        positions: z.array(z.string().max(80)).min(1).max(10),
        city: z.string().max(100),
        remote: z.boolean(),
        teamSize: z.number().int().min(2).max(30),
      }),
      b,
    );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, id);
      if ((await tx.project.count({ where: { ownerId: id } })) >= 100)
        throw new HttpException(
          "Owned project quota reached (100). Archive or delete old projects first.",
          409,
        );
      const p = await tx.project.create({
        data: {
          ...v,
          ownerId: id,
          image:
            "/images/" +
            (v.category === "AI & ML"
              ? "agriculture"
              : v.category === "Robotics"
                ? "drone"
                : "energy") +
            ".svg",
          members: { create: { userId: id, role: "Owner" } },
        },
      });
      if (
        (await tx.activity.count({
          where: {
            authorId: id,
            createdAt: { gt: new Date(Date.now() - 3600000) },
          },
        })) < 10
      )
        await tx.activity.create({
          data: {
            projectId: p.id,
            authorId: id,
            content:
              "Started a new project: " +
              p.title +
              ". " +
              p.description.slice(0, 600),
          },
        });
      return p;
    });
  }
  @Post("projects/:id/bookmark") async bookmark(
    @Param("id") projectId: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      const p = await tx.project.findUnique({ where: { id: projectId } });
      if (!p) throw new HttpException("Project not found.", 404);
      if (await blockedIn(tx, userId, p.ownerId))
        throw new HttpException("Project unavailable.", 404);
      const key = { userId_projectId: { userId, projectId } },
        old = await tx.bookmark.findUnique({ where: key });
      if (old) await tx.bookmark.delete({ where: key });
      else await tx.bookmark.create({ data: { userId, projectId } });
      return { bookmarked: !old };
    });
  }
  @Get("projects/:id") async project(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const p = await publicProject(id, await optionalUid(req));
    if (!p) throw new HttpException("Project not found.", 404);
    return p;
  }
  @Post("projects/:id/apply") async apply(
    @Param("id") projectId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const userId = await uid(req),
      { message } = validate(
        z.object({ message: z.string().trim().min(10).max(1000) }),
        b,
      );
    const initial = await db.project.findUnique({ where: { id: projectId } });
    if (!initial) throw new HttpException("Project not found.", 404);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, userId, initial.ownerId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      const p = await tx.project.findUnique({ where: { id: projectId } });
      if (!p) throw new HttpException("Project not found.", 404);
      if (p.ownerId !== initial.ownerId)
        throw new HttpException(
          "Ownership changed. Retry your application.",
          409,
        );
      if (["Completed", "Archived"].includes(p.status))
        throw new HttpException(
          "This project is not accepting applications.",
          409,
        );
      if (await blockedIn(tx, userId, p.ownerId))
        throw new HttpException("You cannot join this project.", 403);
      if (
        await tx.member.findUnique({
          where: { projectId_userId: { projectId, userId } },
        })
      )
        throw new HttpException("You are already part of this team.", 409);
      const current = await tx.application.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });
      if (current?.status === "Pending") return current;
      if ((await tx.member.count({ where: { projectId } })) >= p.teamSize)
        throw new HttpException("This team is full.", 409);
      const row = await tx.application.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { projectId, userId, message },
        update: { message, status: "Pending", createdAt: new Date() },
      });
      const me = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await alert(
        tx,
        p.ownerId,
        userId,
        "application",
        me.name + " applied to " + p.title,
        projectId,
      );
      return row;
    });
  }
  @Delete("projects/:id/application") async cancelApplication(
    @Param("id") projectId: string,
    @Req() req: Request,
  ) {
    const userId = await uid(req);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      const a = await tx.application.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });
      if (!a) throw new HttpException("Application not found.", 404);
      if (a.status === "Cancelled") return a;
      if (a.status !== "Pending")
        throw new HttpException(
          "Only pending applications can be cancelled.",
          409,
        );
      return tx.application.update({
        where: { id: a.id },
        data: { status: "Cancelled" },
      });
    });
  }
  @Get("applications") async applications(@Req() req: Request) {
    const id = await uid(req);
    const q = validate(
      z.object({
        paged: z.enum(["true"]).optional(),
        cursor: z.string().max(100).optional(),
      }),
      req.query,
    );
    const rows = await db.application.findMany({
      where: { project: { ownerId: id } },
      take: q.paged ? 51 : 100,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        user: {
          select: { name: true, initials: true, color: true, skills: true },
        },
        project: { select: { title: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return q.paged
      ? {
          items: rows.slice(0, 50),
          nextCursor: rows.length > 50 ? rows[49].id : null,
        }
      : rows;
  }
  @Patch("applications/:id") async review(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      { status } = validate(
        z.object({ status: z.enum(["Accepted", "Rejected"]) }),
        b,
      ),
      initial = await db.application.findUnique({ where: { id } });
    if (!initial) throw new HttpException("Application not found.", 404);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, actor, initial.userId);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${initial.projectId} FOR UPDATE`;
      const p = await tx.project.findUnique({
        where: { id: initial.projectId },
      });
      if (!p || p.ownerId !== actor)
        throw new HttpException("Owner permission required.", 403);
      const app = await tx.application.findUnique({ where: { id } });
      if (!app) throw new HttpException("Application not found.", 404);
      if (app.status === status) return app;
      if (app.status !== "Pending")
        throw new HttpException(
          "This application has already been reviewed.",
          409,
        );
      if (status === "Accepted") {
        if (["Archived", "Completed"].includes(p.status))
          throw new HttpException("Project is not accepting members.", 409);
        if (await blockedIn(tx, actor, app.userId))
          throw new HttpException("You cannot accept this person.", 403);
        const existing = await tx.member.findUnique({
          where: { projectId_userId: { projectId: p.id, userId: app.userId } },
        });
        if (!existing) {
          if (
            (await tx.member.count({ where: { projectId: p.id } })) >=
            p.teamSize
          )
            throw new HttpException("This team is full.", 409);
          await tx.member.create({
            data: { projectId: p.id, userId: app.userId },
          });
        }
      }
      const result = await tx.application.update({
        where: { id },
        data: { status },
      });
      await tx.auditEvent.create({
        data: {
          projectId: p.id,
          actorId: actor,
          action: "application.reviewed",
          payload: { applicationId: id, status },
        },
      });
      await alert(
        tx,
        app.userId,
        actor,
        "application-reviewed",
        p.title + ": application " + status.toLowerCase(),
        p.id,
      );
      return result;
    });
  }
  @Get("people") async people(@Req() req: Request) {
    return (await new DiscoveryController().list(req, "people", 50)).items;
  }
  @Post("connections/:id") async connect(
    @Param("id") receiverId: string,
    @Req() req: Request,
  ) {
    const senderId = await uid(req);
    if (senderId === receiverId)
      throw new HttpException("You cannot connect to yourself.", 400);
    const pair = canonical(senderId, receiverId);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, senderId, receiverId);
      if (!(await tx.user.findUnique({ where: { id: receiverId } })))
        throw new HttpException("Person not found.", 404);
      if (await blockedIn(tx, senderId, receiverId))
        throw new HttpException("You cannot connect with this person.", 403);
      const row = await tx.connection.findUnique({
        where: { userLowId_userHighId: pair },
      });
      if (row) return row;
      const created = await tx.connection.create({
        data: { senderId, receiverId, ...pair },
      });
      const me = await tx.user.findUniqueOrThrow({ where: { id: senderId } });
      await alert(
        tx,
        receiverId,
        senderId,
        "connection",
        me.name + " wants to connect",
      );
      return created;
    });
  }
  @Patch("connections/:id") async accept(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const u = await uid(req);
    const row = await db.connection.findUnique({ where: { id } });
    if (!row || row.receiverId !== u)
      throw new HttpException(
        "Only the recipient can accept this request.",
        403,
      );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, row.senderId, row.receiverId);
      const c = await tx.connection.findUnique({ where: { id } });
      if (!c || (await blockedIn(tx, row.senderId, u)))
        throw new HttpException("Connection unavailable.", 403);
      if (c.status === "Accepted") return c;
      if (c.status !== "Pending")
        throw new HttpException("This request is not pending.", 409);
      const result = await tx.connection.update({
        where: { id },
        data: { status: "Accepted" },
      });
      const me = await tx.user.findUniqueOrThrow({ where: { id: u } });
      await alert(
        tx,
        c.senderId,
        u,
        "connection-accepted",
        me.name + " accepted your connection",
      );
      return result;
    });
  }
  @Get("messages/:id") async messages(
    @Param("id") other: string,
    @Req() req: Request,
  ) {
    const id = await uid(req);
    if (
      (await isBlockedBetween(id, other)) ||
      !(await db.connection.findFirst({
        where: {
          status: "Accepted",
          OR: [
            { senderId: id, receiverId: other },
            { senderId: other, receiverId: id },
          ],
        },
      }))
    )
      throw new HttpException("Connection required.", 403);
    const q = validate(
      z.object({
        requestId: z.uuid().optional(),
        cursor: z.string().max(1000).optional(),
        after: z.string().max(1000).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      req.query,
    );
    const pair = {
      OR: [
        { senderId: id, receiverId: other },
        { senderId: other, receiverId: id },
      ],
    };
    if (q.cursor && q.after)
      throw new HttpException("Use cursor or after, not both.", 400);
    if (q.requestId) {
      if (q.after || q.cursor)
        throw new HttpException("Use requestId without pagination.", 400);
      const row = await db.message.findUnique({
        where: {
          senderId_receiverId_requestId: {
            senderId: id,
            receiverId: other,
            requestId: q.requestId,
          },
        },
        select: { id: true },
      });
      await uid(req);
      if (
        (await isBlockedBetween(id, other)) ||
        !(await db.connection.findFirst({
          where: {
            status: "Accepted",
            OR: [
              { senderId: id, receiverId: other },
              { senderId: other, receiverId: id },
            ],
          },
        }))
      )
        throw new HttpException("Conversation unavailable.", 403);
      return {
        status: row ? "committed" : "not_found",
        messageId: row?.id || null,
      };
    }
    const boundary = q.cursor || q.after;
    const scope = `dm:${id}:${other}`;
    let position: { id: string; createdAt: Date } | null | undefined;
    if (boundary) {
      if (boundary.startsWith("p1."))
        position = parsePosition(boundary, scope, req);
      else {
        position = await db.message.findFirst({
          where: { id: boundary, ...pair },
          select: { id: true, createdAt: true },
        });
        if (!position)
          throw new HttpException(
            {
              message: "Message boundary was removed. Reload recent history.",
              code: "CHAT_POSITION_EXPIRED",
            },
            409,
          );
      }
    }
    // Fetch each direction through its ordered composite index, then merge at
    // most 202 rows. An OR across both directions can force a whole-pair sort.
    const branches = await Promise.all(
      [
        { senderId: id, receiverId: other },
        { senderId: other, receiverId: id },
      ].map((direction) =>
        db.message.findMany({
          where: {
            AND: [
              direction,
              ...(position ? [positionFilter(position, !!q.after)] : []),
            ],
          },
          orderBy: [
            { createdAt: q.after ? "asc" : "desc" },
            { id: q.after ? "asc" : "desc" },
          ],
          take: q.limit + 1,
        }),
      ),
    );
    const rows = branches
      .flat()
      .sort(
        (a, b) =>
          (a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) * (q.after ? 1 : -1),
      )
      .slice(0, q.limit + 1);
    const visible = rows.slice(0, q.limit),
      items = q.after ? visible : visible.reverse();
    const oldest = items[0];
    const hasOlderUnread =
      !!oldest &&
      !q.after &&
      !!(await db.message.findFirst({
        where: {
          AND: [
            { senderId: other, receiverId: id, readAt: null },
            positionFilter(oldest, false),
          ],
        },
        select: { id: true },
      }));
    await uid(req);
    if (
      (await isBlockedBetween(id, other)) ||
      !(await db.connection.findFirst({
        where: {
          status: "Accepted",
          OR: [
            { senderId: id, receiverId: other },
            { senderId: other, receiverId: id },
          ],
        },
      }))
    )
      throw new HttpException("You cannot message this person.", 403);
    return {
      items,
      hasOlderUnread,
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      nextPosition:
        rows.length > q.limit
          ? chatPosition(rows[q.limit - 1], scope, req)
          : null,
      afterPosition: chatPosition(items.at(-1), scope, req),
    };
  }
  @Post("messages/:id") async send(
    @Param("id") receiverId: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const senderId = await uid(req);
    const { content, requestId } = validate(
      z
        .object({
          content: z.string().trim().min(1).max(2000),
          requestId: z.uuid().optional(),
        })
        .strict(),
      b,
    );
    return socialTransaction(async (tx) => {
      await lockUsers(tx, senderId, receiverId);
      if (await blockedIn(tx, senderId, receiverId))
        throw new HttpException("You cannot message this person.", 403);
      if (
        !(await tx.connection.findFirst({
          where: {
            status: "Accepted",
            OR: [
              { senderId, receiverId },
              { senderId: receiverId, receiverId: senderId },
            ],
          },
        }))
      )
        throw new HttpException(
          "Connect with this person before messaging.",
          403,
        );
      const users = await tx.user.findMany({
        where: { id: { in: [senderId, receiverId] } },
        select: { suspendedAt: true, activationRequired: true },
      });
      if (
        users.length !== 2 ||
        users.some((u) => u.suspendedAt || u.activationRequired)
      )
        throw new HttpException("Account unavailable.", 403);
      if (requestId) {
        const existing = await tx.message.findUnique({
          where: {
            senderId_receiverId_requestId: { senderId, receiverId, requestId },
          },
        });
        if (existing) {
          if (existing.content !== content)
            throw new HttpException(
              "Request ID reused with different content.",
              409,
            );
          return existing;
        }
      }
      const latest = await tx.message.aggregate({
        where: {
          OR: [
            { senderId, receiverId },
            { senderId: receiverId, receiverId: senderId },
          ],
        },
        _max: { createdAt: true },
      });
      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const row = await tx.message.create({
        data: {
          senderId,
          receiverId,
          content,
          requestId,
          createdAt: new Date(
            Math.max(
              now.getTime(),
              (latest._max.createdAt?.getTime() || 0) + 1,
            ),
          ),
        },
      });
      const me = await tx.user.findUniqueOrThrow({ where: { id: senderId } });
      if (
        !(await tx.notification.findFirst({
          where: {
            userId: receiverId,
            actorId: senderId,
            kind: "message",
            readAt: null,
          },
        }))
      )
        await alert(
          tx,
          receiverId,
          senderId,
          "message",
          "New message from " + me.name,
        );
      return row;
    });
  }
}
@Module({
  controllers: [
    Api,
    SitemapsController,
    ImagesController,
    ExportController,
    ExportJobsController,
    ProjectChatController,
    AdminUsersController,
    GithubWorkspaceController,
    PlacesController,
    AssistantController,
    OAuthController,
    DiscoveryController,
    ResourcesController,
    WorkspaceController,
    AccountController,
    StoresController,
    AiController,
    ModerationController,
    TeamController,
    GithubController,
    FilesController,
    InvitationController,
    SocialController,
  ],
})
class AppModule {}
async function main() {
  validateRuntimeConfig();
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    rawBody: true,
  });
  app.enableShutdownHooks();
  app.use(cookieParser());
  app.useGlobalFilters(new ApiErrors());
  const origins = allowedOrigins();
  const limiter = new SharedLimiter(process.env.REDIS_URL);
  await limiter.connect();
  app
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", trustedProxies(process.env.TRUSTED_PROXY_CIDRS));
  app.use(measureHttp);
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (!origins.has(new URL(origin).origin))
            return res.status(403).json({
              message: "Invalid request origin.",
              code: "ORIGIN_FORBIDDEN",
              requestId,
            });
        } catch {
          return res
            .status(403)
            .json({ message: "Invalid origin.", requestId });
        }
      } else if (
        ["cross-site", "same-site"].includes(
          String(req.headers["sec-fetch-site"]),
        )
      )
        return res
          .status(403)
          .json({ message: "Cross-origin requests are forbidden.", requestId });
    }
    next();
  });
  app.use(rateMiddleware(limiter));
  app.use(async (req: Request, res: Response, next: () => void) => {
    const requireVerification =
      process.env.REQUIRE_VERIFIED_EMAIL === "true" ||
      (process.env.NODE_ENV === "production" &&
        process.env.REQUIRE_VERIFIED_EMAIL !== "false");
    const guarded =
      req.method === "POST" &&
      /^\/api\/(projects(?:\/[^/]+\/apply)?|resources|stores|follows\/[^/]+|connections\/[^/]+|ai\/plan|assistant\/conversations\/[^/]+\/messages|places\/search|account\/avatar|workspaces\/[^/]+\/(updates|cover))\/?$/.test(
        req.path,
      );
    if (requireVerification && guarded) {
      try {
        const id = await uid(req);
        const u = await db.user.findUnique({
          where: { id },
          select: { emailVerifiedAt: true },
        });
        if (!u?.emailVerifiedAt)
          return res.status(403).json({
            message:
              "Verify your email in Settings before publishing or sending requests.",
            code: "EMAIL_VERIFICATION_REQUIRED",
            requestId: res.getHeader("X-Request-Id"),
          });
      } catch {
        return res.status(401).json({
          message: "Sign in to continue.",
          code: "AUTH_REQUIRED",
          requestId: res.getHeader("X-Request-Id"),
        });
      }
    }
    next();
  });
  validateCursorKeys();
  await app.listen(Number(process.env.API_PORT || 3001), "0.0.0.0");
  startMailWorker();
  startMaintenance();
}
main();
