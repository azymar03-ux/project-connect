import { resolve } from "node:path";
import { unlink } from "node:fs/promises";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
export const root = resolve(process.env.LOCAL_FILE_DIR || ".private-files");
export function client() {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
    ...(process.env.S3_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY || "",
          },
        }
      : {}),
  });
}
export async function removeObject(key: string) {
  if (process.env.S3_BUCKET)
    await client().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
  else
    await unlink(resolve(root, key)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
}
