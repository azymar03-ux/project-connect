// Local-only validation harness, NOT a production edge server.
// Generate short-lived self-signed .arena cert/key; never package either.
import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";
if (
  process.env.PC_LOCAL_HTTPS_TEST !== "true" ||
  process.env.NODE_ENV === "production"
)
  throw Error("Explicit local test mode required");
const server = https.createServer(
  {
    key: readFileSync(".arena/local-test.key"),
    cert: readFileSync(".arena/local-test.crt"),
  },
  (req, res) => {
    const api = req.url?.startsWith("/api/");
    const headers = { ...req.headers };
    delete headers["x-forwarded-for"];
    delete headers["x-forwarded-host"];
    delete headers["x-forwarded-proto"];
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: api ? 3003 : 3002,
        path: req.url,
        method: req.method,
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "Content-Type": "application/json" });
      res.end('{"message":"Local proxy unavailable"}');
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  },
);
server.listen(3443, "127.0.0.1", () =>
  console.log(
    "Local-only HTTPS validation listener on 3443; self-signed certificate; not deployment.",
  ),
);
