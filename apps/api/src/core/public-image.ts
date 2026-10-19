import { scanStoredBytes } from "./storage-scan";
import { scanBytes } from "./file-scanner";
import { HttpException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, open } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { Prisma } from "@prisma/client";
import { db } from "./security";
import { root, client } from "./storage";
export const IMAGE_LIMIT = 2 * 1024 * 1024;
let decoding = 0;
export async function prepareImage(
  file: Express.Multer.File,
  kind: "avatar" | "cover",
) {
  if (!file || !file.buffer || file.size > 5 * 1024 * 1024)
    throw new HttpException("Choose a PNG/JPEG image under 5 MB.", 400);
  await scanBytes(file.buffer);
  const b = file.buffer;
  const png = b
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (!png && !jpg)
    throw new HttpException("Only decoded PNG/JPEG images are allowed.", 400);
  if (png) {
    // APNG can otherwise be decoded as its first static frame by some libvips builds.
    for (let offset = 8; offset + 12 <= b.length;) {
      const length = b.readUInt32BE(offset);
      if (length > b.length - offset - 12)
        throw new HttpException("Invalid PNG image.", 400);
      if (b.toString("ascii", offset + 4, offset + 8) === "acTL")
        throw new HttpException("Animated images are not allowed.", 400);
      offset += length + 12;
    }
  }
  if (decoding >= 4)
    throw new HttpException("Image processing is busy. Retry shortly.", 429);
  decoding++;
  try {
    const image = sharp(b, {
      limitInputPixels: 16000000,
      failOn: "warning",
    }).timeout({ seconds: 8 });
    const meta = await image.metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 8192 ||
      meta.height > 8192 ||
      (meta.pages || 1) > 1
    )
      throw Error();
    const width = kind === "avatar" ? 256 : 1600,
      height = kind === "avatar" ? 256 : 900;
    // Auto-orient, strip metadata/GPS, flatten transparency, store only a bounded derivative.
    const buffer = await image
      .rotate()
      .resize(width, height, { fit: "cover", position: "centre" })
      .flatten({ background: "#101827" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (buffer.length > IMAGE_LIMIT) throw Error();
    return { buffer, width, height, scan: await scanStoredBytes(buffer) };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new HttpException(
      "Invalid, animated or oversized image. Use a PNG/JPEG under 16 megapixels.",
      400,
    );
  } finally {
    decoding--;
  }
}
export async function stageImage(buffer: Buffer) {
  const storageKey = randomBytes(24).toString("hex");
  await db.storageDeletion.create({
    data: { storageKey, dueAt: new Date(Date.now() + 3600000) },
  });
  try {
    if (process.env.S3_BUCKET)
      await client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: storageKey,
          Body: buffer,
          ContentType: "image/jpeg",
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    else {
      if (process.env.NODE_ENV === "production" && !process.env.LOCAL_FILE_DIR)
        throw new HttpException("Production storage is not configured.", 503);
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writeFile(resolve(root, storageKey), buffer, {
        mode: 0o600,
        flag: "wx",
      });
    }
    return storageKey;
  } catch (e) {
    await abandonImage(storageKey);
    throw e;
  }
}
export async function abandonImage(storageKey: string) {
  // A timed-out remote PUT may complete late. Preserve a grace window for cleanup.
  await db.storageDeletion.upsert({
    where: { storageKey },
    create: { storageKey, dueAt: new Date(Date.now() + 3600000) },
    update: { dueAt: new Date(Date.now() + 3600000) },
  });
}
export async function claimImage(
  tx: Prisma.TransactionClient,
  storageKey: string,
  kind: string,
  image: {
    width: number;
    height: number;
    buffer: Buffer;
    scan: Awaited<ReturnType<typeof scanStoredBytes>>;
  },
) {
  const rows = await tx.$queryRaw<
    { state: string }[]
  >`SELECT state FROM "StorageDeletion" WHERE "storageKey"=${storageKey} FOR UPDATE`;
  if (rows[0]?.state !== "pending")
    throw new HttpException(
      "Upload expired during cleanup. Re-upload the image.",
      409,
    );
  const row = await tx.publicImage.create({
    data: {
      id: randomBytes(24).toString("base64url"),
      storageKey,
      kind,
      width: image.width,
      height: image.height,
      size: image.buffer.length,
    },
  });
  await tx.storageScan.create({
    data: { storageKey, size: image.buffer.length, ...image.scan },
  });
  await tx.storageDeletion.delete({ where: { storageKey } });
  return row.id;
}
export async function retireImage(
  tx: Prisma.TransactionClient,
  id: string | null,
) {
  if (!id) return;
  const row = await tx.publicImage.findUnique({ where: { id } });
  if (!row) return;
  await tx.storageDeletion.upsert({
    where: { storageKey: row.storageKey },
    create: { storageKey: row.storageKey },
    update: {},
  });
  // Parent pointer must be nulled/replaced first. RESTRICT protects against forgotten paths.
  await tx.publicImage.delete({ where: { id } });
}
export async function readImage(storageKey: string, expectedSize: number) {
  if (
    !/^[a-f0-9]{48}$/.test(storageKey) ||
    expectedSize < 1 ||
    expectedSize > IMAGE_LIMIT
  )
    throw new HttpException("Image unavailable.", 404);
  let buffer: Buffer;
  if (process.env.S3_BUCKET) {
    const response = await client().send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storageKey,
        Range: `bytes=0-${IMAGE_LIMIT}`,
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
    if (!response.Body) throw new HttpException("Image unavailable.", 404);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of response.Body as AsyncIterable<Uint8Array>) {
      size += part.length;
      if (size > IMAGE_LIMIT) {
        (response.Body as any).destroy?.();
        throw new HttpException("Image unavailable.", 404);
      }
      chunks.push(Buffer.from(part));
    }
    buffer = Buffer.concat(chunks);
  } else {
    const file = await open(resolve(root, storageKey), "r");
    try {
      if ((await file.stat()).size !== expectedSize)
        throw new HttpException("Image unavailable.", 404);
      buffer = Buffer.alloc(expectedSize);
      const { bytesRead } = await file.read(buffer, 0, expectedSize, 0);
      if (bytesRead !== expectedSize)
        throw new HttpException("Image unavailable.", 404);
    } finally {
      await file.close();
    }
  }
  if (buffer.length !== expectedSize || buffer.length > IMAGE_LIMIT)
    throw new HttpException("Image unavailable.", 404);
  return buffer;
}
