# ProjectConnect — The Complete Owner / Company Guide
### What running this website means for you: setup, administration, operations, money, risk, and the honest launch state.

---

## 0 · Your two roles, separated on purpose
- **Owner/company (you):** buys hosting, holds credentials, approves legal & AI spend, authorises publication. Most of §1–§3 is yours.
- **Admin operator (staff):** runs `AdminPanel` on the site — moderation queue, suspensions, telemetry. That part is software you already have; nobody needs a terminal for day-to-day community care.
The engineering deliberately cannot fake your half: no deployment, purchase, DNS, or policy approval exists until you do it.

## 1 · Before users arrive (one-time setup — `docs/MANUAL_SETUP.md` has exact steps)
1. **Hosting + domain + DNS** — a Linux host (or two containers) with TLS. Deploy stack: `deploy/compose.yml` = postgres 17, redis 7, clamav + signature updater, one-shot `migrate`, `api` (:3001), `web` (:3000), **Caddy** (`deploy/Caddyfile`) for automatic HTTPS, HSTS and `/api` proxying with rate-limit-safe client IPs.
2. **Environment** (from `.env.example`): `DATABASE_URL`, `REDIS_URL`, exact `APP_ORIGINS=https://yourdomain`, `PUBLIC_APP_URL`, `SMTP_URL`+`MAIL_FROM`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_PLACES_*`, `OPENAI_API_KEY`+`OPENAI_MODEL`+price/budget keys, `CLAMD_PORT`. Secrets stay in the host secret store — never in git or the release archive.
3. **Google Cloud:** consent screen + authorised redirect URIs (`https://yourdomain/api/auth/google/callback`); enable Places API with **billing alerts and caps**; keep the server key restricted to Places and never ship it to browsers.
4. **Email provider:** verify your sending domain (SPF/DKIM). Activation and reset mail are business-critical; the DB outbox retries so provider blips don't lose mail.
5. **Object storage (optional but recommended):** S3-compatible bucket + credentials for durable files/exports; short signed URLs only; private volume otherwise.
6. **AI budget governance:** you pick the approved model, **unit price (per-million tokens)** and daily ceilings (`AI_*` keys). The ledger enforces integer micro-USD per user/project/global day — the platform will not overspend your chosen numbers, but it can't approve them for you.
7. **GitHub App / OAuth** (only if you want richer repo previews): register app, webhook secret server-side.
8. **Legal:** privacy policy / ToS / retention drafts exist in-repo marked *draft* — get counsel approval before launch.

## 2 · Launch gates you are responsible for (and the honest current state)
- The codebase stands at **NOT READY FOR PRODUCTION LAUNCH** (`docs/LAUNCH_STATUS.md`): 118 automated tests green, migrations/restore/scanner drills locally verified, full feature set implemented — **but** the remaining engineering (patched scanner deployment, live-S3 semantics, representative load & multi-replica proofs, independent security review) and **all** external executions (real Docker host, hosted CI, edge, alert delivery, off-site RPO/RTO) stay open.
- Do not read the local demo, the preview URL, or an archive as a deployment. Launch = your authorization **plus** the production-mode smoke test passing behind Caddy with real providers.
- What we never do for you: create accounts, spend money, register domains/keys, or approve policies. The agent-side list in LAUNCH_STATUS tells you what's left before that gate.

## 3 · Day-to-day operations (what your staff actually touches)
| Need | Tool | How |
|---|---|---|
| Moderate reports, take down content, suspend/restore users | **AdminPanel view** on-site | Least-privilege: admin role checked per mutation; every action audit-logged with reason |
| Watch the system | `npm run monitor` + systemd templates (`deploy/projectconnect-monitor.*`) | Alerts on queue depth, scan backlog, quarantine count, export failures, disk — aggregates only, no private metadata |
| Health check / uptime probe | `GET /api/health`, `GET /api/ready` | ready verifies DB+Redis actually answer |
| Storage duty | `scripts/storage-rescan.ts` (dry-run by default), `scripts/storage-inventory.ts` | Re-scan on demand; orphans aged & quarantined through the same safe pipeline |
| Malware engine freshness | `clamav` service signature updater (compose) | Keep the updater container; treat "engine outdated" warnings as alerts, not noise |
| Backups | **Procedure** in `docs/OPERATIONS.md`: encrypted `pg_dump` + object-store sync, scheduled (cron/systemd timer) | The repo guarantees the *restore* side is proven: `scripts/verify-local-recovery.mjs` / `verify-local-restore.py` do dump→encrypt→restore into a fresh DB→compare all 43 tables→serve restored API. Schedule it off-site yourself |
| Incident response | `docs/SECURITY.md` + threat model | Rotate: session signing key ⇒ global logout; SMTP/OAuth/AI keys instantly; revoke a user's sessions from AdminPanel; quarantine hides bytes without deleting evidence |
| User data requests (export/delete) | Automated in-app (§7 of USER_GUIDE) | Exports survive restarts; deletion honours legal-hold/scan-dependency pins — that's compliance, not a bug |

## 4 · What the platform enforces so you don't have to babysit
- **Security on every write:** exact-origin CSRF, HttpOnly cookie sessions, rate limits via Redis, CSP + HSTS + nosniff headers, zod schema validation, parameterised Prisma queries, DTO serializers (passwords/tokens can't leak, even nested).
- **Upload safety:** client check → server magic-byte + real-dimension verification → ClamAV scan queue → sha256 + durable rename that can never overwrite → audience-checked serving → quarantine path with evidence preserved. Users see honest “scanning/failed/retry” states.
- **Fair-play rules as data, not UI:** project capacity, one-accept-per-application, connection uniqueness, blocked-user messaging denial, one owner per project — all DB-constrained + transaction-tested.
- **Cost ceilings:** AI daily budgets per user/project/global; Places per-user/day query caps; export jobs capped (3/user/day, size + object limits) — billing surprises are structurally limited.
- **Abuse surface shrinking by default:** enumeration-neutral auth errors, signed short-lived pagination cursors, one-use expiring tokens, no executable content served on your origin, SSRF-blocked server fetches.

## 5 · Money and meters you should watch (weekly, 10 minutes)
1. **AI spend** — ledger rows are priced at the unit price *you* approved; alert if ceilings are hit routinely (feature-market signal, or budget too tight).
2. **Places API** — billing dashboard vs your caps; disable browser Maps display entirely if you never enable it (the current design needs no public Maps JS key).
3. **SMTP** — bounce/complaint rates; the outbox retries, mailbox providers punish volume spikes.
4. **Object storage + DB size** — `storage:inventory` dry-run reports; growth should track users, not incidents.
5. **Uptime/monitor alerts** — if the systemd monitor emails nothing for weeks, test its alert path once a quarter.

## 6 · Upgrade & change discipline (for whoever maintains the code)
- Migrations are forward-only, numbered, checksum-tested **and** upgrade-tested from older releases (`verify-migration-upgrade.py` pattern). Run the `migrate` one-shot before `api` starts (compose enforces).
- Backend builds before restart (`npm run build:api` → `npm run start:api`); the web needs `INTERNAL_API_URL` at **build time**.
- Release flow: `npm run release` → sanitized archive + sha256 (root `ProjectConnect_release.*` mirrors the workspace) → deploy from the same commit you tested; never seed production (`db:seed` is dev-guarded).
- `docs/VALIDATION_REPORT.md` is the source of truth for “what was actually run”; treat any claim not in it as unverified, including claims from this guide.

## 7 · Where every answer lives
| Question | File |
|---|---|
| What did we build & why | `docs/MASTER_PROMPT.md` |
| Which tech, which versions | `docs/TECH_STACK.md` |
| How each flow moves through the system | `docs/BEGINNER_FLOWCHART.md` (+ `.html`) |
| What users can do | `docs/USER_GUIDE.md` |
| This file (owner ops) | `docs/OWNER_GUIDE.md` |
| Exact setup you must do manually | `docs/MANUAL_SETUP.md` |
| Runbook: backup/rescan/monitor details | `docs/OPERATIONS.md` |
| Security model & response | `docs/SECURITY.md`, `docs/THREAT_MODEL.md` |
| Integration contracts (Google/GitHub/AI/S3) | `docs/INTEGRATIONS.md`, `docs/API.md`, `docs/openapi.json` |
| Current honest status + remaining gates | `docs/LAUNCH_STATUS.md`, `docs/VALIDATION_REPORT.md` |
| The human entry point | `LAUNCH_HANDOFF.md` (repo root) |
