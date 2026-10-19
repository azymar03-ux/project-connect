# ProjectConnect — Tech Stack and What Each Piece Is *Used For*

> Companion to `BEGINNER_FLOWCHART.md`. Every version below was read from
> `package.json`, `docker-compose.yml`, `Dockerfile`, `deploy/` and the source
> itself — not from memory. (Audited 12 Oct 2026.)

```
┌─────────────────────────────────────────────────────────────────┐
│  User's browser                                                 │
│  React 19 UI · lucide icons · hand-written CSS (no framework)  │
├─────────────────────────────────────────────────────────────────┤
│  Next.js 16 server (:3000)                                      │
│  renders pages · rewrites /api/* to the API · CSP headers      │
├─────────────────────────────────────────────────────────────────┤
│  NestJS 11 API on Express (:3001)                               │
│  zod validation · bcrypt · cookie sessions · all business rules │
├──────────────────────────┬──────────────────────────────────────┤
│ Prisma 6 → PostgreSQL 17 │ Redis 7 (rate limits) · mail queue   │
│ 42 models / 43 tables    │ ClamAV (scan) · S3-compatible storage│
└──────────────────────────┴──────────────────────────────────────┘
        Docker Compose · Caddy HTTPS · systemd monitoring timer
```

## 1 · Languages & runtime

| Tech | Version used | What it does here |
|---|---|---|
| **TypeScript** | 5.9.3 | One language everywhere — web, API, tests, Prisma client. Whole repo passes `tsc --noEmit`. |
| **Node.js** | 22 in the Docker image (`node:22-bookworm-slim`); dev sandbox runs 20 | Runs the API, the build pipeline and the scripts. |
| **tsx** | 4.23.15 | Runs TypeScript directly for dev (`npm run api`) and scripts (`db:seed`, `storage:rescan`). |

## 2 · Front end (`apps/web`)

| Tech | Version | Use |
|---|---|---|
| **Next.js** | 16.4.0 | Server-renders the app shell; its `rewrites()` proxies `/api/:path*` to `INTERNAL_API_URL`, so the browser only ever talks to one origin (that's what lets cookies work same-site). Also serves CSP headers. |
| **React** | 19.3 | UI components — `page.tsx` plus the shared components (`ImageUpload`, `PreviewImage`, `Workspace`, `AiAssistant`, …). |
| **CSS (hand-written)** | globals.css + design-refresh.css | Styling, layout and the taste-skill redesign. **No Tailwind / no component library** — deliberate: fewer build layers, full control of contrast/accessibility. |
| **@fontsource-variable/manrope** | 5.3.0 | Self-hosted variable font (works offline, no Google-fonts fetch at page load). |
| **lucide-react** | 1.53 | Tiny SVG icons (sparkles, x, check…). |

## 3 · Back end (`apps/api`)

| Tech | Version | Use |
|---|---|---|
| **NestJS** (`@nestjs/core`,`common`,`platform-express`) | 11.2.7 | Structure for the API: controllers per feature (`main.ts`, `features/*.ts`), dependency injection, exception layer for clean 4xx messages. |
| **Express** (via platform-express) | 5 | HTTP layer underneath; cookie reading, static image streaming, SSE (event-stream). |
| **zod** | 4.6.5 | Validates **every** request body (register, apply, message, upload JSON…) before touching the DB; also types the DTOs. |
| **bcryptjs** | 3.0.3 | Password hashing for accounts and the seeded demo user. Never stored in plain text. |
| **cookie-parser** | 1.4.7 | Reads `pc_session` (login) and `pc_oauth` (state/nonce/PKCE binding) cookies. |

## 4 · Data layer

| Tech | Version | Use |
|---|---|---|
| **Prisma** | 6.12 | Single source of truth for the schema (`prisma/schema.prisma`, **42 models / 43 tables**), type-safe queries, 25 versioned migrations applied with `prisma migrate deploy`. |
| **PostgreSQL** | 17-alpine (Docker) | All persistent data: users, projects, applications, messages, sessions, notifications, files, scans, audit. |
| **Redis** | 7-alpine (`ioredis` 6.0 via `REDIS_URL`) | Rate limiting / abuse counters (e.g. login attempts) so a flood can't hammer Postgres. |
| **fflate** | 0.8.3 | Streams zip archives for the account-data export jobs — no heavyweight dependency. |

## 5 · Security pieces

| Mechanism | Where | Use |
|---|---|---|
| Session cookies | `core/security.ts`, `core/preview-config.ts` | HttpOnly, path=/, Secure in prod, SameSite=Lax (None+Partitioned only for the sandbox preview); hashed tokens in DB, revocable per device. |
| Exact-origin CSRF check | `core/security.ts` | Every write must come from an allow-listed origin → the 403 `ORIGIN_FORBIDDEN` guard. |
| CSP & headers | `apps/web/next.config.ts`, `deploy/Caddyfile` | `frame-ancestors`, `nosniff`, HSTS, `X-Frame-Options DENY`, referrer policy. |
| **jose** (JWT/JWKS) | `core/oidc.ts` | Verifies Google's ID tokens with remote JWKS; OAuth uses state + nonce + **PKCE**. |
| Rate limiting | `core/rate-limit.ts` + Redis | Per-IP buckets on auth and write routes. |
| Input validation | zod everywhere | Unknown fields (like `role`, `status`) can never be forged through DTOs. |

## 6 · Files & external services

| Tech | Use |
|---|---|
| **ClamAV** (own client, no npm dep) | `core/file-scanner.ts` speaks the raw `INSTREAM` socket protocol — every upload scanned before it becomes durable. |
| **sharp** 0.35 | Decodes/inspects real image bytes (dimensions, format) server-side in `files.ts` / `public-image.ts`. |
| **@aws-sdk/client-s3 + s3-request-presigner** | Durable object storage + short signed URLs for exports (`core/object-io.ts`). |
| **nodemailer** 10 | SMTP transport only — mail is queued durably in the DB (`EmailOutbox` table) and a claim-then-send worker (`core/mail.ts` + `core/outbox.ts`) delivers it, so a crash can't lose a message. |
| **Google OAuth** | Sign in with Google (`features/oauth.ts`). |
| **Google Places (Text Search)** | “People/projects nearby” via server-side key in `features/places.ts`, post-filtered by distance, attribution assets included. |
| **OpenAI-compatible endpoint** | AI assistant (`core/assistant-provider.ts`, default model `gpt-4o-mini`) behind daily token budgets (`core/ai-budget.ts`, `ai-ledger.ts`). |

## 7 · Shipping & ops

| Tool | Use |
|---|---|
| **Docker Compose** (`deploy/compose.yml`, root `docker-compose.yml`) | Same stack for local dev (postgres+redis) and production (api, web, db, redis, clamav…). Healthchecks on pg/redis. |
| **Dockerfile** | Single image, node:22-bookworm-slim: `npm ci` → `db:generate` + `build:api` + `next build` → runs as the `node` user, ports 3000/3001. |
| **Compose services** (`deploy/compose.yml`) | `postgres`, `redis` (appendonly), `clamav` + one-shot `clamav_signatures`, a one-shot **`migrate`** (`npm run db:migrate`) that gates startup, then `api`, `web`, and `proxy` (Caddy). |
| **Caddy** | Automatic HTTPS, forwards `/api/*` to the API with rate-limit-safe `X-Forwarded-For`, sets security headers. |
| **systemd** (`deploy/projectconnect-monitor.*`) | Periodic ops monitor (quarantine/export/storage alarms). |
| **Backups** | There is **no `backup` npm script** — `docs/OPERATIONS.md` prescribes encrypted `pg_dump` + object-store sync, and the repo proves the *restore* side works via `scripts/verify-local-recovery.mjs` / `verify-local-restore.py` (dump → encrypt → restore into a separate DB → compare → serve). A scheduled off-site backup is still an operator task to provision. |
| **npm scripts** | Everything above is driven by `package.json` (see scripts list). |

## 8 · Quality tooling (devDependencies)

| Tool | Use |
|---|---|
| **Playwright test** 1.64 | The entire suite — **118 tests** covering API behaviour end-to-end plus browser tests (auth flows, uploads, storage/quarantine). No Jest/Vitest. |
| **@axe-core/playwright** | Automated accessibility scans of key pages in-suite. |
| **ESLint** 10 + typescript-eslint 8.71 + react-hooks | Static error catching (`npm run lint`). |
| **Prettier** 3.9.9 | Formatting consistency (`format:check`). |
| **tsc --noEmit** | Whole-repo typecheck. |
| Custom verifiers in `scripts/` | `verify-production-smoke.mjs`, `verify-migration-upgrade.py`, `verify-local-recovery.mjs`, `verify-clamd-local.ts`, contract sync, release packager with checksum. |

## Honest notes (beginners should know these)

- **`jsonwebtoken` 9.0.3 is in `dependencies` but no app code imports it** — `core/oidc.ts` uses `jose` instead. Candidate for removal (unused-dependency audit).
- No CSS framework and no clamd npm wrapper are *deliberate*: fewer third-party layers on the two most security-sensitive paths (styling & malware scanning).
- Testing the whole product with one runner (Playwright) is unusual but keeps API + browser + a11y checks in a single 1.8-minute suite.
- Redis currently does rate limiting only; the mail queue is DB-backed, so a Redis outage degrades limits, not mail.

## Where to look for each claim

`package.json` (versions) · `docker-compose.yml`, `deploy/` (services, Caddy, systemd) · `prisma/schema.prisma` (42 models) · `apps/api/src/core/security.ts` (sessions/CSRF) · `apps/api/src/core/preview-config.ts` (sandbox cookie mode) · `apps/web/next.config.ts` (proxy + CSP) · `.env.example` (full env list: `DATABASE_URL`, `REDIS_URL`, `APP_ORIGINS`, `PUBLIC_APP_URL`, `SMTP_*`, `GOOGLE_*`, `OPENAI_*`, `CLAMD_PORT`, `AI_*` budgets…).
