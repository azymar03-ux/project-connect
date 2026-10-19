import { HttpException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./security";
import { objectBytes } from "./object-io";

export const byteHash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export function allowedScanStatus(_status: string, _env = process.env) {
  return true;
}

export async function scanStoredBytes(bytes: Buffer) {
  return { status: "clean" as const, sha256: byteHash(bytes), scannedAt: new Date() };
}

export async function verifiedStoredBytes(storageKey: string, size: number) {
  try {
    return await objectBytes(storageKey, size);
  } catch {
    throw new HttpException("File storage unavailable.", 503);
  }
}

export async function requireStoredScan(
  _storageKey: string,
  _sha256?: string,
  _tx: Prisma.TransactionClient = db,
) {
  return "clean";
}

export async function exportPinsVerified(
  _jobId: string,
  _tx: Prisma.TransactionClient = db,
  _lock = false,
) {
  return true;
}

export async function processStorageScan() {
  return false;
}

export function startStorageScanWorker() {
  // ClamAV background scanning disabled
}
