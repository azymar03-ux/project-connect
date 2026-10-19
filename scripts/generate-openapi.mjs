// Generate actual registered Nest route inventory without starting servers/workers.
import "reflect-metadata";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const main = readFileSync("apps/api/src/main.ts", "utf8");
const registered = main
  .match(/controllers:\s*\[([\s\S]*?)\]/)[1]
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const controllers = new Map();
for (const filename of readdirSync("artifacts/api/features").filter((f) =>
  f.endsWith(".js"),
)) {
  const module = require("../artifacts/api/features/" + filename);
  for (const [name, value] of Object.entries(module))
    if (registered.includes(name) && typeof value === "function")
      controllers.set(name, value);
}
const methods = [
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "all",
    "options",
    "head",
    "search",
  ],
  paths = {};
function addRoute(controller, name, method, path) {
  const url =
    ("/" + path)
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, "")
      .replace(/:([A-Za-z0-9_]+)/g, "{$1}") || "/";
  const parameters = [...url.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  const auth =
    !url.startsWith("/api/sitemaps") &&
    ![
      "/api/health",
      "/api/ready",
      "/api/discovery/projects",
      "/api/discovery/people",
      "/api/ai/status",
      "/api/assistant/status",
    ].includes(url);
  paths[url] ||= {};
  if (paths[url][method]) throw Error("DUPLICATE_ROUTE " + method + " " + url);
  paths[url][method] = {
    operationId: controller + "_" + name,
    tags: [controller],
    parameters,
    ...(auth ? { security: [{ sessionCookie: [] }] } : {}),
    "x-schema-coverage":
      "route inventory; payload schema unmodeled unless overridden",
    responses: {
      [method === "post" ? "201" : "200"]: {
        description:
          "Successful response; see docs/API.md for payload semantics",
      },
      400: { description: "Invalid input" },
      401: { description: "Session required or expired" },
      403: { description: "Forbidden" },
      429: { description: "Rate or budget limit" },
      503: { description: "Protection/provider temporarily unavailable" },
    },
  };
}
for (const name of registered) {
  if (name === "Api") continue;
  const C = controllers.get(name);
  if (!C) throw Error("REGISTERED_CONTROLLER_MISSING " + name);
  const prefix = Reflect.getMetadata("path", C) || "";
  for (const key of Object.getOwnPropertyNames(C.prototype)) {
    const fn = C.prototype[key];
    if (typeof fn !== "function") continue;
    const path = Reflect.getMetadata("path", fn),
      method = Reflect.getMetadata("method", fn);
    if (path === undefined || method === undefined) continue;
    for (const p of Array.isArray(path) ? path : [path])
      addRoute(name, key, methods[method], prefix + "/" + p);
  }
}
// Root Api class is intentionally not imported (main() starts listeners). Parse its route decorators only.
const source = main.slice(main.indexOf("class Api"), main.indexOf("@Module"));
for (const match of source.matchAll(
  /@(Get|Post|Put|Delete|Patch)\("([^"]*)"\)\s*(?:async\s+)?([A-Za-z0-9_]+)/g,
))
  addRoute("Api", match[3], match[1].toLowerCase(), "api/" + match[2]);
const jobSchema = {
  type: "object",
  required: ["id", "status", "expiresAt"],
  properties: {
    id: { type: "string" },
    status: {
      type: "string",
      enum: ["pending", "building", "ready", "failed", "expired"],
    },
    expiresAt: { type: "string", format: "date-time" },
    snapshotAt: { type: ["string", "null"], format: "date-time" },
    errorCode: { type: ["string", "null"] },
    artifactSize: { type: ["integer", "null"] },
    artifactSha256: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
  },
};
paths["/api/account/export/jobs"].get.responses["200"].content = {
  "application/json": {
    schema: {
      type: "array",
      items: { $ref: "#/components/schemas/ExportJob" },
    },
  },
};
paths["/api/account/export/jobs"].post.responses["201"].content = {
  "application/json": { schema: jobSchema },
};
paths["/api/account/export/jobs/{id}/download"].get.responses["200"].content = {
  "application/zip": { schema: { type: "string", format: "binary" } },
};
const spec = {
  openapi: "3.1.0",
  info: {
    title: "ProjectConnect API",
    version: "0.2.0",
    description:
      "Generated registered route inventory. Shared typed contracts currently cover portability/roadmap/sitemap; other payload schemas remain incomplete and this is NOT a fully typed client contract. Public/session optional behavior is described in API.md; conservative cookie security labels do not replace server authorization.",
  },
  servers: [{ url: "/" }],
  paths,
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "pc_session" },
    },
    schemas: {
      ExportJob: jobSchema,
      ErrorEnvelope: {
        type: "object",
        properties: {
          message: { type: "string" },
          code: { type: "string" },
          requestId: { type: "string" },
        },
      },
    },
  },
};
writeFileSync("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log(
  `Generated ${Object.keys(paths).length} paths / ${Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0)} operations; payload contract coverage remains partial.`,
);
require("../artifacts/api/core/security.js").db.$disconnect();
