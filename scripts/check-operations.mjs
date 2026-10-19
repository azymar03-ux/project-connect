// One-shot authenticated monitor suitable for an operator-owned scheduler.
// Never emits cookie, URL query, private row data, or provider credentials.
const base = process.env.MONITOR_BASE_URL,
  token = process.env.MONITOR_SESSION;
if (!base || !token)
  throw Error("Set MONITOR_BASE_URL and MONITOR_SESSION securely.");
const url = new URL(base);
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  )
)
  throw Error("Remote monitoring requires HTTPS");
if (url.username || url.password || url.search || url.hash)
  throw Error("Monitor URL must not contain credentials or query");
try {
  const ready = await fetch(new URL("/api/ready", url), {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!ready.ok) throw Error("READINESS_FAILED");
  const r = await fetch(new URL("/api/admin/operations", url), {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { Cookie: "pc_session=" + token },
  });
  if (!r.ok)
    throw Error(
      r.status === 401 || r.status === 403
        ? "MONITOR_SESSION_REQUIRES_RENEWAL"
        : "OPERATIONS_FAILED",
    );
  const b = await r.json();
  const codes = new Set([
    "MAIL_FAILED",
    "STORAGE_RETRY_EXHAUSTION",
    "MAIL_BACKLOG",
    "STORAGE_BACKLOG",
    "AI_CONCURRENCY",
    "SCAN_FAILURES",
    "OBJECT_QUARANTINE",
    "SCAN_BACKLOG",
  ]);
  if (
    !Array.isArray(b.alerts) ||
    b.alerts.length > 20 ||
    b.alerts.some(
      (a) =>
        !codes.has(a.code) || !["warning", "critical"].includes(a.severity),
    ) ||
    [
      "pendingMail",
      "failedMail",
      "storageBacklog",
      "failedStorage",
      "activeAi",
    ].some((k) => !Number.isSafeInteger(b[k]) || b[k] < 0)
  )
    throw Error("INVALID_OPERATIONS_RESPONSE");
  if (
    ["failedScans", "quarantinedObjects", "pendingScans"].some(
      (k) => b[k] !== undefined && (!Number.isSafeInteger(b[k]) || b[k] < 0),
    )
  )
    throw Error("INVALID_OPERATIONS_RESPONSE");
  console.log(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      healthy: !b.alerts.length,
      alerts: b.alerts.map((a) => ({ code: a.code, severity: a.severity })),
      queues: {
        pendingMail: b.pendingMail,
        failedMail: b.failedMail,
        storageBacklog: b.storageBacklog,
        failedStorage: b.failedStorage,
        activeAi: b.activeAi,
        failedScans: b.failedScans,
        quarantinedObjects: b.quarantinedObjects,
        pendingScans: b.pendingScans,
      },
    }),
  );
  if (b.alerts.length) process.exitCode = 2;
} catch (e) {
  console.error(
    JSON.stringify({
      healthy: false,
      code: [
        "READINESS_FAILED",
        "MONITOR_SESSION_REQUIRES_RENEWAL",
        "OPERATIONS_FAILED",
        "INVALID_OPERATIONS_RESPONSE",
      ].includes(e.message)
        ? e.message
        : "MONITOR_CONNECTION_FAILED",
    }),
  );
  process.exitCode = 1;
}
