import { strict as assert } from "node:assert";
import { scanBytes } from "../apps/api/src/core/file-scanner";
import { createConnection } from "node:net";
import { db } from "../apps/api/src/core/security";
import { processStorageScan } from "../apps/api/src/core/storage-scan";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { root } from "../apps/api/src/core/storage";
import { resolve } from "node:path";
async function main() {
  assert(
    ["localhost", "127.0.0.1"].includes(
      new URL(process.env.DATABASE_URL || "").hostname,
    ) && !process.env.S3_BUCKET,
    "Local DB/files only",
  );
  const env = {
    ...process.env,
    CLAMD_HOST: "127.0.0.1",
    CLAMD_PORT: "3310",
    NODE_ENV: "production",
  };
  const version = await new Promise<string>((resolve, reject) => {
    const s = createConnection({ host: "127.0.0.1", port: 3310 });
    s.setTimeout(5000, () => {
      s.destroy();
      reject(Error("VERSION timeout"));
    });
    s.on("error", reject);
    s.on("connect", () => s.write("zVERSION\0"));
    s.on("data", (bytes) => {
      resolve(bytes.toString().replace(/\0/g, ""));
      s.destroy();
    });
  });
  assert(version.includes("ClamAV"));
  assert.equal(
    await scanBytes(
      Buffer.from("Benign ProjectConnect scanner verification fixture."),
      env,
    ),
    "clean",
  );
  const eicar = Buffer.from(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  );
  await assert.rejects(
    scanBytes(eicar, env),
    (e: any) => e.getStatus() === 400 && e.message.includes("malware"),
  );
  const keys = [
    randomBytes(24).toString("hex"),
    randomBytes(24).toString("hex"),
  ];
  const oldHost = process.env.CLAMD_HOST,
    oldPort = process.env.CLAMD_PORT;
  try {
    const pending = await db.storageScan.count({
      where: { status: { in: ["pending", "scanning", "error"] } },
    });
    assert.equal(
      pending,
      0,
      "Run in quiescent isolated local fixture DB with no existing scan work",
    );
    process.env.CLAMD_HOST = env.CLAMD_HOST;
    process.env.CLAMD_PORT = env.CLAMD_PORT;
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const [index, bytes] of [
      Buffer.from("Benign persisted legacy bytes"),
      eicar,
    ].entries()) {
      await writeFile(resolve(root, keys[index]), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      await db.storageScan.create({
        data: {
          storageKey: keys[index],
          size: bytes.length,
          dueAt: new Date(0),
        },
      });
      assert.equal(await processStorageScan(), true);
      const scan = await db.storageScan.findUniqueOrThrow({
        where: { storageKey: keys[index] },
      });
      assert.equal(scan.status, index ? "quarantined" : "clean");
      if (!index) assert.match(scan.sha256!, /^[a-f0-9]{64}$/);
      else assert.equal(scan.errorCode, "MALWARE_FOUND");
    }
  } finally {
    await db.storageScan.deleteMany({ where: { storageKey: { in: keys } } });
    for (const key of keys) await rm(resolve(root, key), { force: true });
    if (oldHost === undefined) delete process.env.CLAMD_HOST;
    else process.env.CLAMD_HOST = oldHost;
    if (oldPort === undefined) delete process.env.CLAMD_PORT;
    else process.env.CLAMD_PORT = oldPort;
    await db.$disconnect();
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      engine: version.trim(),
      cleanFixture: "accepted",
      persistentLegacyWorkflow:
        "benign clean+trusted digest / EICAR quarantined; disposable bytes/state removed",
      eicarStandardTestString: "rejected400",
      note: "Real local engine+downloaded signatures; not exhaustive malware certification. VERSION reports daemon database revision, not independently verified wall-clock freshness.",
    }),
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "FAILED");
  process.exitCode = 1;
});
