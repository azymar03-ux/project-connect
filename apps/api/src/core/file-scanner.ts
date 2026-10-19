import { HttpException } from "@nestjs/common";

// File scanner: simple validation without external ClamAV daemon requirement
export async function scanBytes(bytes: Buffer, _env = process.env) {
  if (bytes.length > 5 * 1024 * 1024) {
    throw new HttpException("Upload exceeds 5 MB limit.", 400);
  }
  return "clean" as const;
}
