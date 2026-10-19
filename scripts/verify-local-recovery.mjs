// Local disposable fixture ensures recovery checks cover real file bytes, not an empty set.
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
try {
  process.loadEnvFile();
} catch {}
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || process.env.S3_BUCKET)
  throw Error("This recovery fixture is restricted to local DB/file storage.");
const db = new PrismaClient(),
  key = randomBytes(24).toString("hex"),
  root = resolve(process.env.LOCAL_FILE_DIR || ".private-files"),
  bytes = Buffer.from(
    "Disposable ProjectConnect recovery test bytes, not user content.",
  );
let user, project, image;
const imageKey = randomBytes(24).toString("hex");
try {
  user = await db.user.create({
    data: {
      name: "Local recovery fixture",
      email: "restore-" + randomBytes(12).toString("hex") + "@example.com",
      passwordHash: "no-login-fixture",
      initials: "RF",
      skills: [],
      interests: [],
    },
  });
  project = await db.project.create({
    data: {
      ownerId: user.id,
      title: "Local recovery fixture project",
      description: "Disposable private file recovery check",
      tags: [],
      requiredSkills: [],
      positions: [],
      category: "IoT",
      city: "Test",
    },
  });
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, key), bytes, { mode: 0o600 });
  await db.member.create({
    data: { projectId: project.id, userId: user.id, role: "Owner" },
  });
  const restoredFile = await db.projectFile.create({
    data: {
      projectId: project.id,
      uploaderId: user.id,
      storageKey: key,
      name: "recovery-fixture.txt",
      size: bytes.length,
      mime: "text/plain",
    },
  });
  const pixels = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#345678" },
  })
    .jpeg()
    .toBuffer();
  await writeFile(resolve(root, imageKey), pixels, { mode: 0o600 });
  image = await db.publicImage.create({
    data: {
      id: randomBytes(24).toString("base64url"),
      storageKey: imageKey,
      kind: "avatar",
      width: 256,
      height: 256,
      size: pixels.length,
    },
  });
  await db.storageScan.createMany({
    data: [
      {
        storageKey: key,
        size: bytes.length,
        status: "development-unscanned",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannedAt: new Date(),
      },
      {
        storageKey: imageKey,
        size: pixels.length,
        status: "development-unscanned",
        sha256: createHash("sha256").update(pixels).digest("hex"),
        scannedAt: new Date(),
      },
    ],
  });
  await db.user.update({
    where: { id: user.id },
    data: { avatarId: image.id },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  execFileSync("python", ["scripts/verify-local-restore.py"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PC_RESTORE_APP_FIXTURE: JSON.stringify({
        userId: user.id,
        token,
        filePath: `workspaces/${project.id}/files/${restoredFile.id}/download`,
        fileHash: createHash("sha256").update(bytes).digest("hex"),
        imagePath: `images/${image.id}`,
        imageHash: createHash("sha256").update(pixels).digest("hex"),
      }),
    },
  });
  console.log(
    "PASS non-empty attachment recovery fixture removed after validation",
  );
} finally {
  if (project) await db.project.deleteMany({ where: { id: project.id } });
  if (user) await db.user.deleteMany({ where: { id: user.id } });
  if (image) await db.publicImage.deleteMany({ where: { id: image.id } });
  await db.storageScan.deleteMany({
    where: { storageKey: { in: [imageKey, key] } },
  });
  await unlink(resolve(root, imageKey)).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  await unlink(resolve(root, key)).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  await db.$disconnect();
}
