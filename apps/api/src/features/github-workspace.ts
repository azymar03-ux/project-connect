import { githubTokens } from "../core/github-token-cache";
import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  Req,
  HttpException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, uid, validate, member, socialTransaction } from "../core/security";
import { projectWrite } from "../core/project-access";
import { githubRepo } from "../core/github-url";
import {
  installationToken,
  githubRequest,
  verifyGithubSignature,
} from "../core/github-app";
@Controller("api")
export class GithubWorkspaceController {
  @Get("github/status") status() {
    return {
      appConfigured: Boolean(
        process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY,
      ),
      webhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
      permissions:
        "Read-only contents,metadata,issues,pull requests; no code writes. Private repository access requires an owner-approved installation allowlist.",
    };
  }
  @Get("workspaces/:id/github") async get(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    await member(id, await uid(req));
    const row = await db.githubLink.findUnique({ where: { projectId: id } });
    return row
      ? {
          owner: row.owner,
          repo: row.repo,
          privateIntegration: Boolean(row.installationId),
          lastDeliveryAt: row.lastDeliveryAt,
        }
      : { linked: false };
  }
  @Put("workspaces/:id/github") async link(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    const actor = await uid(req),
      v = validate(
        z
          .object({
            url: z.url().max(500),
            installationId: z
              .string()
              .regex(/^\d{1,20}$/)
              .optional(),
          })
          .strict(),
        b,
      ),
      repo = githubRepo(v.url);
    const grants = (process.env.GITHUB_INSTALLATION_GRANTS || "")
      .split(",")
      .filter(Boolean);
    if (v.installationId && !grants.includes(id + ":" + v.installationId))
      throw new HttpException(
        "Installation is not approved for this service.",
        403,
      );
    await member(id, actor);
    try {
      const token = v.installationId
        ? await installationToken(v.installationId, { repository: repo.repo })
        : undefined;
      await githubRequest(`/repos/${repo.owner}/${repo.repo}`, token);
    } catch {
      throw new HttpException(
        "Repository unavailable or installation not configured.",
        502,
      );
    }
    return projectWrite(id, actor, true, async (tx) => {
      await tx.githubLink.upsert({
        where: { projectId: id },
        create: { projectId: id, ...repo, installationId: v.installationId },
        update: {
          ...repo,
          installationId: v.installationId || null,
          revision: randomUUID(),
        },
      });
      await tx.auditEvent.create({
        data: {
          projectId: id,
          actorId: actor,
          action: "github.linked",
          payload: repo,
        },
      });
      return { ...repo, privateIntegration: Boolean(v.installationId) };
    });
  }
  @Delete("workspaces/:id/github") async unlink(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(
      id,
      actor,
      true,
      async (tx) => {
        await tx.githubLink.deleteMany({ where: { projectId: id } });
        await tx.auditEvent.create({
          data: {
            projectId: id,
            actorId: actor,
            action: "github.unlinked",
            payload: {},
          },
        });
        return { ok: true };
      },
      false,
    );
  }
  @Get("workspaces/:id/github/activity") async activity(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    await member(id, actor);
    const link = await db.githubLink.findUnique({ where: { projectId: id } });
    if (!link) throw new HttpException("Link a repository first.", 404);
    if (
      link.installationId &&
      !(process.env.GITHUB_INSTALLATION_GRANTS || "")
        .split(",")
        .includes(id + ":" + link.installationId)
    )
      throw new HttpException("Installation grant was revoked.", 403);
    let result;
    try {
      const token = link.installationId
          ? await installationToken(link.installationId, {
              repository: link.repo,
            })
          : undefined,
        path = `/repos/${link.owner}/${link.repo}`;
      const [commits, pulls, issues] = await Promise.all(
        ["commits", "pulls", "issues"].map((p) =>
          githubRequest(path + "/" + p + "?per_page=10", token),
        ),
      );
      const safeUrl = (u: unknown) =>
        typeof u === "string" &&
        u.startsWith(`https://github.com/${link.owner}/${link.repo}/`)
          ? u
          : null;
      result = {
        commits: commits.map((c: any) => ({
          id: String(c.sha),
          title: String(c.commit?.message || "").slice(0, 500),
          url: safeUrl(c.html_url),
        })),
        pulls: pulls.map((p: any) => ({
          id: p.number,
          title: String(p.title).slice(0, 500),
          state: p.state,
          url: safeUrl(p.html_url),
        })),
        issues: issues
          .filter((i: any) => !i.pull_request)
          .map((i: any) => ({
            id: i.number,
            title: String(i.title).slice(0, 500),
            state: i.state,
            url: safeUrl(i.html_url),
          })),
        note: "Fetched read-only from GitHub; no source content or tokens are persisted.",
      };
    } catch (e: any) {
      if (e.message === "GITHUB_RATE_LIMITED")
        throw new HttpException(
          {
            message: "GitHub quota exhausted. Retry later.",
            code: "GITHUB_RATE_LIMITED",
          },
          503,
        );
      throw new HttpException("GitHub unavailable or rate limited.", 502);
    }
    await uid(req);
    await member(id, actor);
    const current = await db.githubLink.findUnique({
      where: { projectId: id },
    });
    if (
      !current ||
      current.owner !== link.owner ||
      current.repo !== link.repo ||
      current.installationId !== link.installationId ||
      current.revision !== link.revision
    )
      throw new HttpException(
        "Repository link changed during request. Retry.",
        409,
      );
    if (
      link.installationId &&
      !(process.env.GITHUB_INSTALLATION_GRANTS || "")
        .split(",")
        .includes(id + ":" + link.installationId)
    )
      throw new HttpException("Installation grant was revoked.", 403);
    return result;
  }
  @Post("github/webhook") async webhook(@Req() req: RawBodyRequest<Request>) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret)
      throw new HttpException("GitHub webhook is not configured.", 503);
    if (
      !req.rawBody ||
      !verifyGithubSignature(
        req.rawBody,
        req.get("x-hub-signature-256"),
        secret,
      )
    )
      throw new HttpException("Invalid webhook signature.", 401);
    const event = req.get("x-github-event"),
      delivery = req.get("x-github-delivery");
    if (
      !delivery ||
      !/^[\w-]{10,100}$/.test(delivery) ||
      !event ||
      ![
        "push",
        "pull_request",
        "issues",
        "ping",
        "installation",
        "installation_repositories",
      ].includes(event)
    )
      throw new HttpException("Unsupported webhook envelope.", 400);
    const body = validate(
      z
        .object({
          repository: z
            .object({
              full_name: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/),
            })
            .optional(),
          action: z.string().max(100).optional(),
          repositories_removed: z
            .array(
              z.object({
                full_name: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/),
              }),
            )
            .max(1000)
            .optional(),
          installation: z
            .object({ id: z.number().int().positive() })
            .optional(),
        })
        .passthrough(),
      req.body,
    );
    const applied = await socialTransaction(async (tx) => {
      if (
        !(
          await tx.githubDelivery.createMany({
            data: [{ id: delivery, event }],
            skipDuplicates: true,
          })
        ).count
      )
        return false;
      if (
        body.installation &&
        event === "installation" &&
        ["deleted", "suspend"].includes(body.action || "")
      )
        await tx.githubLink.deleteMany({
          where: { installationId: String(body.installation.id) },
        });
      if (
        body.installation &&
        event === "installation_repositories" &&
        body.repositories_removed
      )
        for (const r of body.repositories_removed) {
          const [owner, repo] = r.full_name.split("/");
          await tx.githubLink.deleteMany({
            where: {
              installationId: String(body.installation.id),
              owner,
              repo,
            },
          });
        }
      if (body.repository) {
        const [owner, repo] = body.repository.full_name.split("/");
        const links = await tx.githubLink.findMany({
          where: {
            owner,
            repo,
            ...(body.installation
              ? { installationId: String(body.installation.id) }
              : { installationId: null }),
          },
          take: 100,
        });
        for (const link of links) {
          await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${link.projectId} FOR UPDATE`;
          await tx.githubLink.updateMany({
            where: { projectId: link.projectId },
            data: { lastDeliveryAt: new Date() },
          });
          await tx.auditEvent.create({
            data: {
              projectId: link.projectId,
              actorId: "github-app",
              action: "github." + event,
              payload: { deliveryId: delivery },
            },
          });
        }
      }
      return true;
    });
    if (applied && body.installation)
      githubTokens.invalidate(String(body.installation.id));
    return { ok: true, duplicate: !applied };
  }
}
