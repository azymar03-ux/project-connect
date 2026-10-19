// Read-only preflight: validates configuration and Docker availability; never deploys.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
const path = process.env.DEPLOY_ENV_FILE || ".env.production";
if (!existsSync(path)) {
  console.error(
    "BLOCKED: production environment file is absent; no secrets were read or printed.",
  );
  process.exit(2);
}
const env = { ...process.env, ...parseEnv(readFileSync(path, "utf8")) };
const issues = [];
for (const key of [
  "DATABASE_URL",
  "PUBLIC_APP_URL",
  "APP_ORIGINS",
  "POSTGRES_PASSWORD",
  "APP_DOMAIN",
  "CHAT_POSITION_SECRET",
  "EXPORT_CURSOR_SECRET",
  "SMTP_URL",
  "MAIL_FROM",
  "CLAMD_HOST",
])
  if (!env[key]) issues.push("Missing " + key);
for (const key of ["CHAT_POSITION_SECRET", "EXPORT_CURSOR_SECRET"])
  if ((env[key] || "").length < 32) issues.push("Weak " + key);
try {
  const origin = new URL(env.PUBLIC_APP_URL);
  if (
    origin.origin !== env.PUBLIC_APP_URL ||
    origin.hostname !== env.APP_DOMAIN ||
    !(env.APP_ORIGINS || "").split(",").includes(origin.origin)
  )
    issues.push("Domain, canonical URL and exact APP_ORIGINS must agree");
  if (origin.protocol !== "https:")
    issues.push("PUBLIC_APP_URL must use HTTPS");
} catch {
  issues.push("Invalid PUBLIC_APP_URL");
}
if (env.PRIVATE_REGISTRATION === "false")
  issues.push("Registration privacy cannot be disabled");
if (env.OPENAI_API_KEY && (env.AI_QUOTA_SECRET || "").length < 32)
  issues.push("Live AI requires stable AI_QUOTA_SECRET");
if (env.OPENAI_API_KEY) {
  if (!env.OPENAI_MODEL || env.AI_PRICING_MODEL !== env.OPENAI_MODEL)
    issues.push("Live AI requires matching approved pricing model");
  for (const k of [
    "AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION",
    "AI_USER_DAILY_MICROUSD_BUDGET",
    "AI_PROJECT_DAILY_MICROUSD_BUDGET",
    "AI_GLOBAL_DAILY_MICROUSD_BUDGET",
  ])
    if (!/^\d+$/.test(env[k] || "") || Number(env[k]) < 1)
      issues.push("Missing/invalid live AI integer cost setting " + k);
}
if (env.REQUIRE_VERIFIED_EMAIL === "false")
  issues.push("Verified publishing must remain enabled for this launch gate");
if (env.GOOGLE_PLACES_ENABLED === "true" && !env.GOOGLE_PLACES_API_KEY)
  issues.push("Places enabled without server key");
if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET))
  issues.push("Google OAuth needs both client credentials");
const docker = spawnSync(
  "docker",
  ["version", "--format", "{{.Server.Version}}"],
  { encoding: "utf8", timeout: 15000 },
);
if (docker.error || docker.status !== 0)
  issues.push("Docker daemon not available; container validation unexecuted");
else {
  const check = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      path,
      "-f",
      "deploy/compose.yml",
      "config",
      "--quiet",
    ],
    { env, encoding: "utf8", timeout: 15000 },
  );
  if (check.status !== 0)
    issues.push(
      "Compose configuration rejected; inspect privately (resolved secrets are not logged)",
    );
}
console.log(
  JSON.stringify({
    ready: !issues.length,
    issues,
    scope:
      "configuration only; no containers started, credentials contacted, migrations or deployment performed",
  }),
);
if (issues.length) process.exitCode = 2;
