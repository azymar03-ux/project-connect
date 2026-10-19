import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const roots = ["apps", "prisma", "tests", "scripts", "deploy", ".github"],
  files = [];
async function walk(dir) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (
      ["node_modules", ".next", "artifacts", "test-results", "public"].includes(
        d.name,
      )
    )
      continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walk(p);
    else if (/\.(ts|tsx|js|cjs|mjs|json|yml|yaml|sql|py)$/.test(p))
      files.push(p);
  }
}
for (const r of roots) await walk(r);
const signatures = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{30,}\b/,
];
let found = [];
for (const p of files) {
  const text = await readFile(p, "utf8");
  for (const pattern of signatures)
    if (pattern.test(text)) found.push({ file: p, signature: pattern.source });
}
if (found.length) {
  console.error("Possible credential patterns: " + JSON.stringify(found));
  process.exitCode = 1;
} else
  console.log(
    `PASS source secret-pattern scan: ${files.length} files, no private-key/cloud/GitHub/OpenAI credential signatures. Not a comprehensive secret detector.`,
  );
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const rows = [];
for (const [name, pkg] of Object.entries(lock.packages)) {
  if (!name || !name.startsWith("node_modules/")) continue;
  rows.push({
    name: name.split("node_modules/").at(-1),
    version: pkg.version,
    license: pkg.license || "UNKNOWN",
    dev: Boolean(pkg.dev),
    optional: Boolean(pkg.optional),
  });
}
await writeFile(
  "docs/evidence/licenses-current.json",
  JSON.stringify(rows, null, 2),
);
const unknown = rows.filter((r) => r.license === "UNKNOWN");
console.log(
  "License inventory: " +
    rows.length +
    " locked packages; " +
    unknown.length +
    " missing package metadata. Owner legal review still required.",
);
