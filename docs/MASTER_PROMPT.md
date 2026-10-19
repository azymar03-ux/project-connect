# ProjectConnect — THE End-to-End Master Prompt
### Everything we built, from the first idea to the launch gates. Pasted into any capable coding agent, this prompt reproduces or continues this product with nothing missing.
*(Condensed 12 Oct 2026 from the original spec `~/ProjectConnect_Master_Prompt.md`, the launch contract `docs/LAUNCH_CONTINUATION_PROMPT.md`, and every checkpoint since. Superseded narrative removed; all binding requirements kept.)*

---

## 0. Mission and unbreakable rules
You are building **ProjectConnect** — a community platform where makers (students, hobbyists, engineers) find teammates, launch real projects (drones, renewable energy, agriculture tech, hardware), and get things built. Not a prototype. Not an MVP. A launch-ready product; you stop only at gates that require an owner's credentials, money, or legal approval.

1. **Execute, don't plan.** Work autonomously through every reversible engineering decision; no permission-checks between phases. Ask only for: missing credentials, spending, destructive acts on real data, external publication.
2. **No fake done.** A feature is complete when validated inputs, enforced authorization, persisted state, error/loading/empty states, and passing tests exist — not when a button renders. No canned responses, no silent catches, no weakened assertions, no skipping tests to go green.
3. **"No errors" = zero known failing required checks**, with residual risks explicitly documented. Never claim error-free software or a launched product unless an authorized deployment + production smoke actually passed.
4. **Evidence over prose.** Keep real command outputs, totals, and limits in `docs/VALIDATION_REPORT.md`. Label everything `implemented+verified / implemented+unverified / not implemented / blocked-manual`.
5. **Secrets discipline.** No production secrets in code, docs, logs, screenshots, archives. `.env.example` documents names only; seeds never run against production.
6. **Checkpoint always.** After each coherent change: save source + docs to the workspace so any next session can continue cold.
7. **Preserve the design system** (navy/cyan/purple, Manrope, responsive, WCAG-AA) and the working preview while evolving.

## 1. Product definition
- **Personas:** student builder needing teammates; solo maker seeking skills/parts; mentor/club looking for projects to sponsor; hardware hobbyist finding local parts.
- **Value loop:** showcase a project → attract skilled applicants → vet & accept → collaborate in a workspace → ship → reputation compounds → discover again.
- **Differentiators:** project-centric (not résumé-centric), real collaboration tooling (tasks/files/chat), local hardware discovery, an AI copilot under hard budgets, privacy-by-default public profiles.

## 2. Full feature scope (A–H) — every one is a hard requirement
### A. Identity, accounts, privacy
Email register/login/logout; bcrypt hashing; email verification + forgot/reset via one-use expiring hashed tokens; no account enumeration (identical failure messages); mail through a durable DB outbox with retry. Google OAuth (server-side exchange, state+nonce+PKCE, JWKS verify, working "not configured" states). Revocable sessions (list + revoke-one/revoke-all), password change revokes sessions, CSRF via exact-origin allowlist, HttpOnly cookies (Secure+Lax; None+Partitioned only behind the sandbox-preview flag). Onboarding: role, skills, interests, education, city, portfolio, avatar. Public serializers expose only explicitly public fields — emails/hashes/token internals never leak through nested payloads. Account data export (ZIP of signed sections) and hard delete with retention-safe dependency handling. Notification preferences, consent states, privacy toggles. Legal pages marked draft until owner/legal approves — never invent approval.
### B. Social & discovery
Public profiles and showcases; follow/unfollow; connection request/accept/reject/cancel; block (enforced in messaging AND visibility); reciprocal-request normalization; uniqueness safe under concurrency. Activity feed (own posts, delete), notifications with unread counts, explainable match scoring (skills/interests/city/public activity — fit-v2), search + filters server-side where data is server-held, cursor pagination, signed stateless pagination tokens. Reports → moderation queue. Stable shareable URLs `/projects/[id]`, `/people/[id]`, metadata, robots + partitioned sitemap index; privacy respected in all SEO payloads.
### C. Projects & workspaces
Create/edit/archive/delete; cover + gallery images; skills/tags, open positions with capacity, location/remote, status; server search/filter/sort. Apply with message + what-you-bring; cancel/reapply rules; owner review accept/decline; **atomic capacity enforcement**; idempotent repeat-acceptance. Teams: roles, member add/remove, owner transfer, leave, invitations (generate/accept/revoke), audit events per workspace. Workspace UI: Overview, Tasks (Kanban, drag/drop + keyboard alternative, order/assignee/due/labels), Milestones (progress computed from persisted tasks), Files (private, quota'd), GitHub links (public metadata cache; private token isolated + revocable), Updates feed. Chat: per-project channels + direct messages; realtime where available with **documented polling fallback**; bounded gap-safe catch-up, deletion-independent cursors, duplicate-safe explicit retry, unread acks, late-response isolation; blocking enforced; IDOR impossible on every channel/attachment.
### D. Resource hub
Real persisted resources (repos, docs, APIs, libraries, tutorials, datasets, tools); create/edit/moderate/search/filter/paginate; bookmarks/upvotes; attach/detach to projects with membership checks. GitHub metadata adapter: single-flight cache, shared quota budget, backoff. **SSRF controls on all server-side fetches** (protocol allow, private-IP block, redirect + DNS-rebinding recheck, timeouts, size caps). No fake data when keys absent — truthful "not configured" states.
### E. Nearby hardware & maps
Store records with categories, hours, phone, directions links, favorites; community submissions with verification states and reporting; permission-aware location/radius search with tested distance math (test against known points; never fabricate live results). Google Places Text Search **server-side**; browser Maps display (when ever enabled) uses a domain-restricted key and Google attribution assets; transient (non-stored) list data per Google policy; per-user/day query quotas; graceful no-key/no-location states.
### F. AI assistant
Provider interface + real adapter, explicit enablement; per-user/project/global daily budgets in **integer micro-USD with an owner-approved unit price**; ledger rows per call; streaming with backpressure, timeout cancel, error/abort UI; persisted private conversations with consent + deletion; structured-output zod validation; safe rendering (no raw HTML); citations marked verified/unverified — no fabricated repos, stores, or "certified engineering" claims; drone/electrical guidance carries safety disclaimers; roadmap→task import requires confirmation, membership authz, duplicate prevention.
### G. Administration
Admin panel: moderation queue (reports, content takedown, reasons), user suspend/restore, audit log, aggregate ops metrics incl. quarantine/export telemetry with alert codes — private file metadata never exposed to non-admins. Least privilege: role checked on every mutation.
### H. Polish & operations
Every view has loading/error/empty/offline states; 320px+ responsive, no horizontal overflow; dialogs focus-trapped, Esc-dismissable, visible focus, reduced-motion; AA contrast in-suite; owned/licensed art only (illustrations labeled as concepts, never disguised as project photos). Docker images non-root with healthchecks; compose for dev and deploy; migrations-before-rollout one-shot service; HTTPS via Caddy; secure headers/CSP matched to OAuth/Maps needs; structured redacted logs + request trace IDs; readiness `/api/ready` + liveness `/api/health`; systemd monitor with real alert logic; CI workflow (disposable container); backups + **tested restore**, not just dump scripts.

## 3. Tech stack (exact, audited)
TypeScript 5.9 everywhere; Node 22 in containers. **Front:** Next.js 16.4 App Router, React 19.3, hand-written CSS (globals + design refresh; no Tailwind), self-hosted `@fontsource-variable/manrope`, lucide-react icons. **Back:** NestJS 11 on Express 5; zod 4 input DTOs; bcryptjs; cookie-parser; jose for OIDC; fflate for export zips. **Data:** Prisma 6 → PostgreSQL 17 (42 models/43 tables, 25 versioned migrations — never db-push in prod); Redis 7 via ioredis for rate limiting; DB-backed `EmailOutbox` for mail. **Files/security:** ClamAV over raw INSTREAM socket (no wrapper dep), `sharp` byte verification, S3-compatible durable storage + short signed URLs, sha256 digests, persistent scan queue + quarantine. **Ship:** Dockerfile (single node:22 image, `npm ci`→builds), deploy compose (postgres/redis/clamav+signatures/migrate/api/web/caddy proxy), systemd monitor, scripts for smoke/verify. **QA:** Playwright as the single test runner (118 tests, API+browser+axe a11y), ESLint+typescript-eslint, Prettier, tsc strict; custom verifiers (`verify-production-smoke.mjs`, `verify-migration-upgrade.py`, `verify-local-recovery.mjs`, `verify-clamd-local.ts`, `storage-rescan.ts`, release packager with sha256). Unused deps get flagged, not hidden.

## 4. Data & correctness invariants (must hold in every version)
- Sessions keyed by **hashed** tokens; unique constraints on (user, project) applications, connection pairs, one owner-per-project; FKs with restrictive delete where orphan data would leak (export pins, scan rows).
- Capacity, acceptance, milestone progress, unread counts — computed in transactions, tested under duplicate/concurrent submits.
- All lists: bounded page sizes + stable ordering; pagination cursors signed + expiring.
- Uploads: magic-byte verification → temp → scan queue → sha256 → durable rename **never overwriting**; generation+DB-clock fencing on scan state; quarantine removes bytes from serving; audience check on every read path (`/api/images/:id`).
- Migrations: forward-only numbered SQL, fresh-DB checksums **and** data-upgrade tests from previous releases (20→25, 22→25 verified patterns).
- Error envelopes consistent; Prisma errors mapped; internals never serialized; every response through a DTO.

## 5. End-to-end flows (normative — see `docs/BEGINNER_FLOWCHART.md` for the diagrams)
1. **Arrive:** `GET /` server-renders; `/api/projects` works anonymously; `/api/me`→401 = guest mode.
2. **Register:** validate→hash→inactive user→activation mail (outbox)→verify→active.
3. **Login:** exact-origin CSRF → rate-limit → bcrypt → session row → `pc_session` cookie → guard authenticates all later calls.
4. **Core loop:** browse/search → open → apply → owner reviews → accept → connections → chat → notifications.
5. **Upload:** client type/size check → POST → server byte-check → ClamAV → sha256+durable → refetch → audience-checked GET → PreviewImage (loading/OK/failed+retry).
6. **Every write** passes: CSP → rate limit → origin → session → zod → authz → Prisma → DTO.
7. **Ship:** install → containers → migrate → seed(dev) → build+test → staging env → smoke → backups/rehearsed restore → launch checklist.

## 6. Validation gates — run, record, fix; never skip
1. Clean `npm ci` from lockfile, generate, clean migrate, seeded dev boot.
2. Lint, strict typecheck, **both** production builds.
3. Full Playwright suite green (currently 118; provider-fixture API on :3004 for integration specs — see INTEGRATIONS.md).
4. Unit-level: validation, distance math, token/session logic, authz matrix, rate limits.
5. Browser flows: register/verify/recover, login/logout, profile edit, create/apply/accept, chat, workspace files, notifications, settings, unconfigured-integration states — self-cleaning fixtures, no shared demo mutations.
6. Adversarial: IDOR, CSRF/origin, blocked-user messaging, malicious uploads/URLs, XSS strings, quota abuse, stale/revoked sessions, enumeration.
7. Accessibility: automated scan + keyboard smoke; no serious/critical unreviewed findings; mobile overflow check.
8. Dependency audit + secret scan + license inventory, triaged honestly (dev-only advisory ≠ production risk statement).
9. Production-mode smoke behind the real proxy path; health/readiness; restore exercise; bounded load test recorded as sample, not certification.
10. Live third-party tests only with real credentials + explicit authorization; otherwise mark blocked and continue elsewhere with fixtures.

## 7. Runbook
Fresh: `npm ci` → root `docker-compose up -d` (pg/redis) → `.env` from `.env.example` (DATABASE_URL, REDIS_URL, APP_ORIGINS exact, PUBLIC_APP_URL, API_PORT, SMTP_*, MAIL_FROM, GOOGLE_CLIENT_ID/SECRET, GOOGLE_PLACES_*, OPENAI_*, CLAMD_PORT, AI budget keys) → `npm run db:generate && npm run db:migrate && npm run db:seed` (dev) → `npm run start:api` then `npm run start:web` (web proxies INTERNAL_API_URL). Sandbox preview additionally: `PC_SANDBOX_PREVIEW=true` at build+run and the exact `https://3000-<sandboxid>.e2b.app` origin (auto-added in dev). Backend is not watch-mode: rebuild `npm run build:api` + restart after edits. Deploy: build image → compose up (migrate runs first) → Caddy TLS → monitor timer → smoke via `verify-production-smoke.mjs`.

## 8. Manual, owner-only prerequisites (create `docs/MANUAL_SETUP.md`, then stop there)
Domain/DNS/hosting + billing; production Postgres/S3/SMTP credentials; Google Cloud project: OAuth consent screen + authorized redirect URIs, Maps/Places activation with billing caps and key restrictions; GitHub App/OAuth registration; LLM vendor account + approved model & unit price; monitoring/alert accounts; legal approval of policy drafts; final publication authorization. Never fabricate any of these; build adapters + fixtures around them and keep going.

## 9. Current status & what remains (as of 12 Oct 2026 — do not re-do, do not overclaim)
**Decision: NOT READY FOR PRODUCTION LAUNCH.** Implemented+locally-verified: everything in §2 A–H (118/118 tests, 25-migration upgrades incl. legacy data, 43-table encrypted restore drill, real local ClamAV EICAR, taste-skill redesign, preview-origin/cookie + image-preview fixes). Agent-owned remainder: full typed DTO/OpenAPI payload parity; patched/pinned scanner + freshness monitoring + adversarial corpus; live S3 immutability/pin/retirement tests; process-kill & large-volume export recovery; multi-replica race and representative-load evidence beyond small samples; statistical enumeration/abuse review; manual assistive-tech + independent security; model/citation/retention quality; executed Docker/hosted CI/Caddy/edge/external alerts/tracing/off-site RPO-RTO. These are tracked in `docs/LAUNCH_STATUS.md`; owner prerequisites in §8 stay owner-only.

## 10. Deliverables at every finish line (workspace, always)
Editable repo `/home/user/projectconnect`; `docs/`: MASTER_PROMPT (this file), BEGINNER_FLOWCHART.md/.html, TECH_STACK.md, USER_GUIDE.md, OWNER_GUIDE.md, REVENUE_STREAMS.md, LAUNCH_PLAYBOOK.md, SALES_MARKETING.md, LAUNCH_STATUS, VALIDATION_REPORT, ARCHITECTURE, API, SECURITY, OPERATIONS, INTEGRATIONS, MANUAL_SETUP, checkpoint docs, evidence logs; README + `.env.example`; `LAUNCH_HANDOFF.md` as the human entry point; sanitized release archive + sha256 at the workspace root (no secrets/builds/deps/personal data); the combined PDF handbook built by `scripts/build-handbook-pdf.py`. State plainly: NOT READY vs LAUNCH CANDIDATE, with the failing/unfinished gates listed. No autonomous background work may be implied unless a tracked process actually runs.
