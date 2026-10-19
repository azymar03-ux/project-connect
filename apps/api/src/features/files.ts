import { scanBytes } from "../core/file-scanner";
import {
  scanStoredBytes,
  verifiedStoredBytes,
  requireStoredScan,
} from "../core/storage-scan";
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
  HttpException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { projectWrite } from "../core/project-access";
import { db, uid, member, serializable } from "../core/security";
import { root, client, removeObject } from "../core/storage";
export { removeObject } from "../core/storage";
async function validFile(file: Express.Multer.File) {
  const ext = file.originalname.split(".").pop()?.toLowerCase();
  if (file.size > 5 * 1024 * 1024)
    throw new HttpException("File must be at most 5 MB.", 400);
  const b = file.buffer;
  if (
    (ext === "png" &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (["jpg", "jpeg"].includes(ext || "") &&
      b.length > 3 &&
      b[0] === 255 &&
      b[1] === 216 &&
      b[2] === 255)
  ) {
    try {
      const image = sharp(b, { limitInputPixels: 16000000, failOn: "warning" });
      const meta = await image.metadata();
      if (
        !meta.width ||
        !meta.height ||
        meta.width > 8192 ||
        meta.height > 8192 ||
        (meta.pages || 1) > 1
      )
        throw Error();
      file.buffer = await (
        ext === "png" ? image.png() : image.jpeg()
      ).toBuffer();
      file.size = file.buffer.length;
      if (file.size > 5 * 1024 * 1024) throw Error();
      return ext === "png" ? "image/png" : "image/jpeg";
    } catch {
      throw new HttpException(
        "Invalid, oversized or animated image. Upload a valid PNG/JPEG under 16 megapixels.",
        400,
      );
    }
  }
  if (
    ["txt", "md", "csv", "json", "py", "ts", "js", "ino", "log"].includes(
      ext || "",
    )
  ) {
    if (b.includes(0) || b.toString("utf8").includes("\uFFFD"))
      throw new HttpException("Text uploads must be valid UTF-8.", 400);
    return "text/plain";
  }
  throw new HttpException(
    "Allowed: plain-text/code, CSV, JSON, PNG or JPEG. Executable, SVG, HTML and archive uploads are not allowed.",
    400,
  );
}
@Controller("api/workspaces/:id/files")
export class FilesController {
  @Get() async list(@Param("id") projectId: string, @Req() req: Request) {
    await member(projectId, await uid(req));
    const rows = await db.projectFile.findMany({
      where: { projectId },
      select: {
        id: true,
        storageKey: true,
        name: true,
        mime: true,
        size: true,
        uploaderId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(({ storageKey, ...r }) => ({
      ...r,
      scanStatus: "clean",
    }));
  }
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  async upload(
    @Param("id") projectId: string,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const uploaderId = await uid(req);
    await member(projectId, uploaderId);
    if (!file) throw new HttpException("Select a file.", 400);
    await scanBytes(file.buffer);
    const mime = await validFile(file),
      name = file.originalname.replace(/[\r\n"\\/<>]/g, "_").slice(0, 120),
      storageKey = randomBytes(24).toString("hex");
    const scan = await scanStoredBytes(file.buffer);
    await db.storageDeletion.create({
      data: { storageKey, dueAt: new Date(Date.now() + 3600000) },
    });
    try {
      if (process.env.S3_BUCKET)
        await client().send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: storageKey,
            Body: file.buffer,
            ContentType: "application/octet-stream",
            IfNoneMatch: "*",
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      else {
        if (
          process.env.NODE_ENV === "production" &&
          !process.env.LOCAL_FILE_DIR
        )
          throw new HttpException("Production storage is not configured.", 503);
        await mkdir(root, { recursive: true, mode: 0o700 });
        await writeFile(resolve(root, storageKey), file.buffer, {
          mode: 0o600,
          flag: "wx",
        });
      }
      return await projectWrite(projectId, uploaderId, false, async (tx) => {
        const marker = await tx.$queryRaw<
          { state: string }[]
        >`SELECT state FROM "StorageDeletion" WHERE "storageKey"=${storageKey} FOR UPDATE`;
        if (marker[0]?.state !== "pending")
          throw new HttpException(
            "Upload expired during cleanup. Re-upload the file.",
            409,
          );
        const totals = await tx.projectFile.aggregate({
          where: { projectId },
          _sum: { size: true },
          _count: true,
        });
        if (
          totals._count >= 100 ||
          (totals._sum.size || 0) + file.size > 50 * 1024 * 1024
        )
          throw new HttpException(
            "Workspace file quota reached (100 files / 50 MB).",
            409,
          );
        const row = await tx.projectFile.create({
          data: {
            projectId,
            uploaderId,
            name,
            mime,
            size: file.size,
            storageKey,
          },
        });
        await tx.storageScan.create({
          data: { storageKey, size: file.size, ...scan },
        });
        await tx.storageDeletion.delete({ where: { storageKey } });
        await tx.auditEvent.create({
          data: {
            projectId,
            actorId: uploaderId,
            action: "file.uploaded",
            payload: { fileId: row.id, name, size: file.size },
          },
        });
        return { id: row.id, name, mime, size: file.size };
      });
    } catch (e) {
      await db.storageDeletion.upsert({
        where: { storageKey },
        create: { storageKey, dueAt: new Date(Date.now() + 3600000) },
        update: { dueAt: new Date(Date.now() + 3600000) },
      });
      throw e;
    }
  }
  @Get(":fileId/download") async download(
    @Param("id") projectId: string,
    @Param("fileId") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await member(projectId, await uid(req));
    const f = await db.projectFile.findUnique({ where: { id } });
    if (!f || f.projectId !== projectId)
      throw new HttpException("File not found.", 404);
    const disposition = `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.name)}`;
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const bytes = await verifiedStoredBytes(f.storageKey, f.size);
    // Never hand out a signed URL that outlives membership or quarantine changes.
    await member(projectId, await uid(req));
    if (
      !(await db.projectFile.count({
        where: { id, projectId, storageKey: f.storageKey },
      }))
    )
      throw new HttpException("File not found.", 404);
    try {
      await requireStoredScan(f.storageKey);
    } catch {
      throw new HttpException("File security state changed.", 503);
    }
    res.setHeader("Content-Disposition", disposition);
    res.setHeader("Content-Type", "application/octet-stream");
    return res.send(bytes);
  }
  @Delete(":fileId") async remove(
    @Param("id") projectId: string,
    @Param("fileId") id: string,
    @Req() req: Request,
  ) {
    const actor = await uid(req);
    return projectWrite(projectId, actor, false, async (tx, { project: p }) => {
      const f = await tx.projectFile.findUnique({ where: { id } });
      if (!f || f.projectId !== projectId)
        throw new HttpException("File not found.", 404);
      if (f.uploaderId !== actor && p.ownerId !== actor)
        throw new HttpException(
          "Only the uploader or owner can delete this file.",
          403,
        );
      await tx.storageDeletion.upsert({
        where: { storageKey: f.storageKey },
        create: { storageKey: f.storageKey },
        update: {},
      });
      await tx.projectFile.delete({ where: { id } });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorId: actor,
          action: "file.deleted",
          payload: { fileId: id },
        },
      });
      return { ok: true };
    });
  }
}
