import { HttpException } from "@nestjs/common";
import Redis from "ioredis";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { optionalUid } from "./security";
const LUA = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}`;
export class SharedLimiter {
  readonly redis: Redis | null;
  private buckets = new Map<string, { n: number; expires: number }>();
  constructor(url?: string) {
    this.redis = url
      ? new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 3000,
        })
      : null;
    this.redis?.on("error", () => {});
  }
  async connect() {
    if (this.redis) {
      try {
        await this.redis.connect();
      } catch {
        // Fall back gracefully to in-memory limiter if Redis is offline
      }
    }
  }
  async hit(scope: string, limit: number, windowMs = 60000) {
    const key = "pc:limit:" + createHash("sha256").update(scope).digest("hex");
    let count: number, remainingMs: number;
    if (this.redis) {
      const r = (await this.redis.eval(LUA, 1, key, windowMs)) as number[];
      count = Number(r[0]);
      remainingMs = Number(r[1]);
    } else {
      const now = Date.now();
      for (const [k, v] of this.buckets)
        if (v.expires <= now) this.buckets.delete(k);
      const v = this.buckets.get(key) || { n: 0, expires: now + windowMs };
      v.n++;
      this.buckets.set(key, v);
      if (this.buckets.size > 20000)
        this.buckets.delete(this.buckets.keys().next().value!);
      count = v.n;
      remainingMs = v.expires - now;
    }
    return {
      allowed: count <= limit,
      retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }
  async close() {
    await this.redis?.quit();
  }
}
export function canonicalLimitPath(path: string) {
  try {
    return (
      decodeURIComponent(path)
        .toLowerCase()
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$/, "") || "/"
    );
  } catch {
    return null;
  }
}
export function rateMiddleware(limiter: SharedLimiter) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (["/api/ready", "/api/health"].includes(req.path)) return next();
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const path = canonicalLimitPath(req.path);
      const sensitive =
        (write &&
          (path === null ||
            (/^\/api\/(auth|account)(\/|$)/.test(path) &&
              path !== "/api/account/avatar"))) ||
        path === "/api/auth/google/start";
      if (write) {
        const guard = await limiter.hit("write-ip:" + ip, 300);
        if (!guard.allowed) {
          res.setHeader("Retry-After", guard.retryAfter);
          return res.status(429).json({
            message: "Too many requests. Try again later.",
            code: "RATE_LIMITED",
            requestId: res.getHeader("X-Request-Id"),
          });
        }
      }
      const actor = write && !sensitive ? (await optionalUid(req)) || ip : ip;
      const scope = sensitive
        ? "sensitive:" +
          (path?.startsWith("/api/account") ? "account" : "auth") +
          ":" +
          ip
        : write
          ? "write:" + actor
          : "read:" + ip;
      const r = await limiter.hit(scope, sensitive ? 30 : write ? 100 : 600);
      if (!r.allowed) {
        res.setHeader("Retry-After", r.retryAfter);
        return res.status(429).json({
          message: "Too many requests. Try again later.",
          code: "RATE_LIMITED",
          requestId: res.getHeader("X-Request-Id"),
        });
      }
      next();
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 403)
        return res.status(403).json({
          message: "Account access is suspended.",
          code: "ACCOUNT_SUSPENDED",
          requestId: res.getHeader("X-Request-Id"),
        });
      res.status(503).json({
        message: "Request protection is temporarily unavailable.",
        code: "RATE_LIMIT_UNAVAILABLE",
        requestId: res.getHeader("X-Request-Id"),
      });
    }
  };
}
