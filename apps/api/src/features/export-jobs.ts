import { exportPinsVerified } from "../core/storage-scan";
import { exportJobSchema, exportQueuedSchema } from "../contracts";
import { z } from "zod";
import {
  Controller,
  Get,
  Post,
  Delete,
  Req,
  Res,
  Param,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  db,
  uid,
  digest,
  lockUsers,
  socialTransaction,
} from "../core/security";
import { validExportSession } from "../core/export-job";
import { safeKey } from "../core/object-io";
import { client } from "../core/storage";
@Controller("api/account/export/jobs")
export class ExportJobsController {
  @Post() async create(@Req() req: Request) {
    const userId = await uid(req),
      sessionHash = digest(req.cookies.pc_session);
    const row = await socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      if (!(await validExportSession(userId, sessionHash, tx)))
        throw new HttpException("Session unavailable.", 401);
      if (
        await tx.accountExportJob.count({
          where: {
            userId,
            status: { in: ["pending", "building"] },
            expiresAt: { gt: new Date() },
          },
        })
      )
        throw new HttpException(
          "An export is already queued. Check its status.",
          409,
        );
      if (
        (await tx.accountExportJob.count({
          where: { userId, createdAt: { gt: new Date(Date.now() - 86400000) } },
        })) >= 3
      )
        throw new HttpException("Daily export limit reached.", 429);
      if (
        (await tx.accountExportJob.count({
          where: {
            status: { in: ["pending", "building"] },
            expiresAt: { gt: new Date() },
          },
        })) >= 1000
      )
        throw new HttpException("Export queue is busy. Retry later.", 503);
      return tx.accountExportJob.create({
        data: {
          userId,
          sessionHash,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    });
    return exportQueuedSchema.parse({
      id: row.id,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
    });
  }
  @Get() async list(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await uid(req);
    res.setHeader("Cache-Control", "private, no-store");
    const rows = await db.accountExportJob.findMany({
      where: {
        userId,
        sessionHash: digest(req.cookies.pc_session),
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        status: true,
        errorCode: true,
        snapshotAt: true,
        artifactSize: true,
        artifactSha256: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return z.array(exportJobSchema).parse(JSON.parse(JSON.stringify(rows)));
  }
  @Delete(":id") async remove(@Param("id") id: string, @Req() req: Request) {
    const userId = await uid(req);
    await db.$transaction(async (tx) => {
      const job = await tx.accountExportJob.findFirst({
        where: { id, userId, sessionHash: digest(req.cookies.pc_session) },
      });
      if (!job) throw new HttpException("Export not found.", 404);
      await tx.accountExportJob.update({
        where: { id },
        data: { status: "expired", expiresAt: new Date(), leaseUntil: null },
      });
      await tx.accountExportPin.deleteMany({ where: { jobId: id } });
      if (job.artifactKey)
        await tx.storageDeletion.upsert({
          where: { storageKey: job.artifactKey },
          create: { storageKey: job.artifactKey },
          update: { dueAt: new Date() },
        });
    });
    return { ok: true };
  }
  @Get(":id/download") async download(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = await uid(req),
      sessionHash = digest(req.cookies.pc_session);
    const job = await db.accountExportJob.findFirst({
      where: {
        id,
        userId,
        sessionHash,
        status: "ready",
        expiresAt: { gt: new Date() },
      },
    });
    if (
      !job?.artifactKey ||
      !job.artifactSize ||
      !(await exportPinsVerified(job.id))
    )
      throw new HttpException(
        "Export is unavailable. Refresh its status.",
        404,
      );
    const marker = await db.storageDeletion.findUnique({
      where: { storageKey: job.artifactKey },
    });
    if (marker?.state === "deleting")
      throw new HttpException("Export expired.", 404);
    let stream: any;
    if (process.env.S3_BUCKET) {
      const result = await client().send(
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: job.artifactKey,
        }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      if (!result.Body || result.ContentLength !== job.artifactSize)
        throw new HttpException("Export storage unavailable.", 503);
      stream = result.Body;
    } else {
      const f = await open(safeKey(job.artifactKey), "r");
      if ((await f.stat()).size !== job.artifactSize) {
        await f.close();
        throw new HttpException("Export storage unavailable.", 503);
      }
      stream = f.createReadStream();
    }
    if (
      !(await validExportSession(userId, sessionHash)) ||
      !(await exportPinsVerified(job.id)) ||
      !(await db.accountExportJob.count({
        where: { id, status: "ready", expiresAt: { gt: new Date() } },
      }))
    ) {
      stream.destroy?.();
      throw new HttpException("Export session expired.", 401);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", job.artifactSize);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="projectconnect-portability.zip"',
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    const timer = setInterval(() => {
      void Promise.all([
        validExportSession(userId, sessionHash),
        exportPinsVerified(job.id),
        db.accountExportJob.count({
          where: { id, status: "ready", expiresAt: { gt: new Date() } },
        }),
      ])
        .then(([sessionOk, pinsOk, jobOk]) => {
          if (!sessionOk || !pinsOk || !jobOk) stream.destroy();
        })
        .catch(() => stream.destroy());
    }, 3000);
    const timeout = setTimeout(() => stream.destroy(), 120000);
    try {
      await pipeline(stream, res);
    } catch {
      if (!res.destroyed) res.destroy();
    } finally {
      clearInterval(timer);
      clearTimeout(timeout);
    }
  }
}
