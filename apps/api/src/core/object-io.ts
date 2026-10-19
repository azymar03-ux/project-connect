import { open, mkdir, link, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { root, client } from "./storage";
export function safeKey(key: string) {
  if (!/^[a-f0-9]{48}$/.test(key)) throw Error("INVALID_OBJECT_KEY");
  return resolve(root, key);
}
export async function objectBytes(key: string, size: number) {
  if (!Number.isInteger(size) || size < 0 || size > 6 * 1024 * 1024)
    throw Error("INVALID_OBJECT_SIZE");
  safeKey(key);
  if (process.env.S3_BUCKET) {
    const result = await client().send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Range: `bytes=0-${size}`,
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
    if (!result.Body) throw Error("OBJECT_MISSING");
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const part of result.Body as AsyncIterable<Uint8Array>) {
      length += part.length;
      if (length > size) {
        (result.Body as any).destroy?.();
        throw Error("OBJECT_SIZE_CHANGED");
      }
      chunks.push(Buffer.from(part));
    }
    if (length !== size) throw Error("OBJECT_SIZE_CHANGED");
    return Buffer.concat(chunks);
  }
  const file = await open(safeKey(key), "r");
  try {
    if ((await file.stat()).size !== size) throw Error("OBJECT_SIZE_CHANGED");
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const r = await file.read(bytes, offset, size - offset, offset);
      if (!r.bytesRead) throw Error("OBJECT_SIZE_CHANGED");
      offset += r.bytesRead;
    }
    return bytes;
  } finally {
    await file.close();
  }
}
export async function publishObject(key: string, path: string, size: number) {
  safeKey(key);
  if (process.env.S3_BUCKET) {
    const body = createReadStream(path);
    try {
      await client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: "application/octet-stream",
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    } finally {
      body.destroy();
    }
  } else {
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Both paths are on the private-storage filesystem. Link fails rather than overwriting.
    await link(path, safeKey(key));
    await unlink(path);
  }
}
