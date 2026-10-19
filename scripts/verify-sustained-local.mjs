import { performance } from "node:perf_hooks";
const origin = process.env.LOAD_ORIGIN || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Local load only");
const endpoints = [
    "/api/discovery/projects?limit=12&sort=newest",
    "/api/discovery/people?limit=12&sort=newest",
    "/api/resources",
    "/api/stores",
  ],
  samples = [],
  statuses = {};
for (let second = 0; second < 30; second++) {
  const start = performance.now();
  await Promise.all(
    Array.from({ length: 4 }, async (_, i) => {
      const at = performance.now(),
        r = await fetch(origin + endpoints[(second + i) % endpoints.length], {
          signal: AbortSignal.timeout(10000),
        });
      await r.arrayBuffer();
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      samples.push(performance.now() - at);
    }),
  );
  await new Promise((r) =>
    setTimeout(r, Math.max(0, 1000 - (performance.now() - start))),
  );
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    durationSeconds: 30,
    requests: samples.length,
    targetRps: 4,
    statuses,
    p50Ms: samples[Math.floor(samples.length * 0.5)],
    p95Ms: samples[Math.floor(samples.length * 0.95)],
    p99Ms: samples[Math.floor(samples.length * 0.99)],
    scope:
      "local built web to API on 2GB sandbox; no production capacity claim",
  }),
);
if (Object.keys(statuses).some((k) => k !== "200")) process.exitCode = 1;
