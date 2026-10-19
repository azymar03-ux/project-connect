import type { Request, Response, NextFunction } from "express";
const bounds = [10, 50, 100, 250, 500, 1000, 5000];
type Counter = {
  count: number;
  serverErrors: number;
  clientErrors: number;
  durationMs: number;
  buckets: number[];
};
export class HttpTelemetry {
  private counters = new Map<string, Counter>();
  constructor(private capacity = 250) {}
  observe(route: string, status: number, duration: number) {
    const label =
      this.counters.has(route) || this.counters.size < this.capacity
        ? route
        : "overflow";
    let c = this.counters.get(label);
    if (!c) {
      c = {
        count: 0,
        serverErrors: 0,
        clientErrors: 0,
        durationMs: 0,
        buckets: bounds.map(() => 0),
      };
      this.counters.set(label, c);
    }
    c.count++;
    if (status >= 500) c.serverErrors++;
    else if (status >= 400) c.clientErrors++;
    c.durationMs += duration;
    bounds.forEach((bound, i) => {
      if (duration <= bound) c.buckets[i]++;
    });
  }
  snapshot() {
    return {
      startedAt: startedAt,
      scope: "process-local cumulative; reset on restart",
      routes: Array.from(this.counters, ([route, c]) => ({
        route,
        ...c,
        buckets: bounds.map((le, i) => ({ le, count: c.buckets[i] })),
      })),
    };
  }
}
const startedAt = new Date().toISOString();
export const telemetry = new HttpTelemetry();
export function measureHttp(req: Request, res: Response, next: NextFunction) {
  const start = performance.now();
  res.once("finish", () => {
    // Express route templates only; never URL/query/user/credential identifiers.
    const template =
      typeof req.route?.path === "string" ? req.route.path : "unmatched";
    telemetry.observe(
      req.method + " " + template,
      res.statusCode,
      Math.max(0, performance.now() - start),
    );
  });
  next();
}
export function operationAlerts(s: {
  pendingMail: number;
  failedMail: number;
  storageBacklog: number;
  failedStorage: number;
  activeAi: number;
  failedScans?: number;
  quarantinedObjects?: number;
  pendingScans?: number;
}) {
  const alerts: Array<{ code: string; severity: string; message: string }> = [];
  if (s.failedScans)
    alerts.push({
      code: "SCAN_FAILURES",
      severity: "critical",
      message:
        "Scan verification failed; inspect scanner availability and storage integrity.",
    });
  if (s.quarantinedObjects)
    alerts.push({
      code: "OBJECT_QUARANTINE",
      severity: "critical",
      message:
        "Quarantined object delivery is blocked; investigate without serving bytes.",
    });
  if ((s.pendingScans || 0) >= 100)
    alerts.push({
      code: "SCAN_BACKLOG",
      severity: "warning",
      message: "At least 100 objects awaiting security verification.",
    });
  if (s.failedMail)
    alerts.push({
      code: "MAIL_FAILED",
      severity: "critical",
      message: "Inspect failed mail deliveries and SMTP configuration.",
    });
  if (s.failedStorage)
    alerts.push({
      code: "STORAGE_RETRY_EXHAUSTION",
      severity: "critical",
      message: "Inspect object cleanup errors; do not delete queue records.",
    });
  if (s.pendingMail >= 100)
    alerts.push({
      code: "MAIL_BACKLOG",
      severity: "warning",
      message: "Mail backlog is at least 100 items.",
    });
  if (s.storageBacklog >= 100)
    alerts.push({
      code: "STORAGE_BACKLOG",
      severity: "warning",
      message: "Storage cleanup backlog is at least 100 items.",
    });
  if (s.activeAi >= 20)
    alerts.push({
      code: "AI_CONCURRENCY",
      severity: "warning",
      message: "Review active generations and provider quotas.",
    });
  return alerts;
}
