# ProjectConnect — Launch, Deploy & Hosting Playbook
### Step-by-step ways to launch, and the recommended deployment method. Commands match this repo (compose v2, `deploy/`).

---

## A · The launch path — six phases, no skipping

**Phase 0 · Code-ready (agent territory).** All gates in `docs/LAUNCH_STATUS.md` close: suite green, builds pass, security items verified. *Current honest state: 118/118 locally, but several production-proof gates (live S3, patched scanner deployment, load, off-site RPO/RTO, hosted CI) are still open → **not launch-ready yet**.*

**Phase 1 · Owner prerequisites (only you).** Domain + DNS, host/billing, SMTP domain verification, Google OAuth consent + Places enablement, LLM key + approved price, S3 bucket, policy approval. `docs/MANUAL_SETUP.md` is the checklist.

**Phase 2 · Staging dress rehearsal.** Deploy the *identical* production stack to a staging host (`staging.yourdomain`). Run `node scripts/verify-production-smoke.mjs` against it, execute one full **backup→encrypted restore drill** (the 43-table drill is already automated: `scripts/verify-local-recovery.mjs`), run migrations on a copy of real-shaped data. Nothing counts as rehearsed unless restore was executed.

**Phase 3 · Closed beta (product supports this natively).** In production the app **forces registration privacy** (`PRIVATE_REGISTRATION` cannot be off in prod): signups become “Pending account” with email-activated onboarding — the codebase *already* implements invite-style gating. Seed 50–200 real builders via club partners; watch `/api/ready`, admin telemetry, moderation queue. Exit criteria: 2 weeks, ≥35% of accounts complete a profile, zero unresolved Sev-1.

**Phase 4 · Graduated launch.** Open signups per city/cohort (e.g., 3 universities at a time) so rate limits, Places quotas, and AI budgets scale predictably. Keep the waitlist as a throttle valve.

**Phase 5 · General availability + ritual.** Weekly: check monitor alerts, signature freshness, backup success log. Monthly: restore drill for real, patch images (`npm audit`, ClamAV `stable` tag, Prisma patch bumps with tests). Quarterly: security review against `docs/THREAT_MODEL.md`.

## B · Best deployment & hosting method (recommended = “Boring Strong”)

**Recommended: one small VPS + Docker Compose + Caddy.** `deploy/compose.yml` already defines postgres 17, redis 7 (AOF on), `clamav/clamav:stable` + a one-shot signature service, a **one-shot `migrate`** that runs before the apps (migrations-before-rollout is enforced), `api`, `web`, and Caddy bound to 80/443 only; app services stay on a private network. This is genuinely the right size for ≤ ~10–20k MAU.

| Host type | When |
|---|---|
| **VPS** (Hetzner/DO/Lightsail, 4 vCPU / 8 GB ≈ $25–65/mo) | Default. All-in, full control, cheap. |
| **Managed PaaS** (Fly.io/Railway/Render) for web+api, managed Postgres, self-run worker for scans/queue | When you don't want to own OS patches. Cost 2–3×. |
| **Kubernetes** | >50k MAU or multi-service teams. Not now. |

**Splits worth doing from day 1 even on a VPS:** managed/replicated Postgres or **WAL-G backups to S3** (DB is the business), object storage for files (already supported), external uptime probe (health checks exist).

**Honest anti-recommendations:** don't deploy straight onto a raw cloud VM without compose (drift, “secrets in home bash”), don't use Firebase/Supabase auth as a bolt-on (sessions/CSRF design already exists and is tested), don't add CDN in front of HTML before CSP is verified end-to-end (it will break `frame-ancestors`/OAuth callbacks — add CDN for `/_next/static/*` assets only, later).

### Step-by-step deploy (first time, VPS)
1. Provision Ubuntu 24.04 LTS, 4 vCPU/8 GB, in the region near your users. `adduser deploy`, key-only SSH, `ufw allow 22,80,443`, enable `unattended-upgrades`.
2. Install Docker Engine + compose plugin. Install `restic` (or `rclone`) for off-site backups.
3. DNS: `app.yourdomain → A record`, `www` redirect. Caddy (`{$APP_DOMAIN}` in `deploy/Caddyfile`) gets TLS automatically on first request — HSTS, nosniff, `X-Frame-Options DENY`, `/api` reverse-proxy to `api:3001` with client-IP pinning already configured.
4. Put the real `.env` in `/etc/projectconnect/.env` (600 perms). Required: `POSTGRES_PASSWORD`, `DATABASE_URL`, `APP_ORIGINS=https://app.yourdomain`, `PUBLIC_APP_URL` same, `REDIS_URL`, SMTP, Google OAuth + `GOOGLE_PLACES_*`, OpenAI key/model/price/budgets, `CLAMD_HOST/PORT`, backup/S3 vars.
5. Build the app image from the repo's Dockerfile (node:22, single image, `npm ci` → `db:generate` → `build:api` → `next build` with `INTERNAL_API_URL=http://api:3001`). In compose, point `api`/`web` at this image.
6. `docker compose -f deploy/compose.yml up -d` → one-shot `clamav_signatures` → `migrate` (25 migrations) → postgres/redis/api/web/caddy.
7. `curl https://app.yourdomain/api/ready` green; run `node scripts/verify-production-smoke.mjs`; run the login/register/payment-free smoke list.
8. Enable the monitor: copy `deploy/projectconnect-monitor.{service,timer}` (systemd), start the timer — queue/quarantine/export alarms arrive without reading logs.
9. Backups: nightly `pg_dump | encrypt → S3/off-site` + file-store sync (documented procedure in `docs/OPERATIONS.md`; restore side is what the repo's drill proves). Restore is the thing you schedule and *test*, not the dump.
10. Email reputation: DMARC/SPF/DKIM on your domain before beta invites — activation mail that lands in spam kills launch metrics.
11. Freeze a release tag; deploys from then on = `git pull` → `docker compose build api web` → `compose up -d` (the `migrate` one-shot runs first by `depends_on`). Zero-downtime is not required at this scale; a 20-second blip at 3 a.m. is the honest trade.

### Scaling ladder (when, and only when)
1k MAU: nothing changes → 5k: move Postgres to managed/read-replica-ready, add S3 for files (flag already exists) → 20k: split api onto a second VPS behind Caddy; sessions are DB-backed and rate limits Redis-backed, so **no sticky sessions needed** → 50k+: queue workers and scans on their own box; only then consider k8s.

### Rollback rule
Migrations are forward-only, so rollback = redeploy **previous image** (schema stays compatible because changes are expand-then-contract; the repo's upgrade tests 20→25 and 22→25 prove the pattern). Keep the last 3 images tagged.

## C · Go/No-Go gate — all must be true before public launch
☐ LAUNCH_STATUS gates closed or explicitly accepted as risk (with sign-off) ☐ staging smoke passed ☐ restore drill executed on staging ☐ email domain verified + deliverability checked ☐ legal docs approved ☐ owner approved AI price/ceiling + Places budget ☐ monitoring timer active + one test alert delivered ☐ backup cron ran once off-site ☐ rollback rehearsed once. **Anything unchecked = not launch-ready — no exceptions for deadlines.**
