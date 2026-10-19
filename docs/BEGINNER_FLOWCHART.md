# ProjectConnect — End-to-End Flow, for a Beginner Developer

> Every box below is a real step in *this* codebase, with the file to open.
> Read top to bottom. Jargon is explained in the glossary at the end.

---

## 0. The big picture

```mermaid
flowchart LR
  B["Browser<br/>(what the user sees)"] --> W["Next.js web app :3000<br/>apps/web — renders the UI"]
  W -- "fetch('/api/...')" --> P["Proxy rewrite<br/>next.config.ts"]
  P --> A["NestJS API :3001<br/>apps/api — all the rules"]
  A --> Q["Prisma ORM<br/>prisma/schema.prisma — the database shape"]
  Q --> DB[("PostgreSQL<br/>every row of data")]
  A --> R[("Redis<br/>rate limiting")]
  A --> M["Mail queue + SMTP<br/>activation &amp; notification emails"]
  A --> S["ClamAV<br/>virus scan for uploads"]
  A --> G["Google<br/>OAuth login + Places 'nearby'"]
```

**One sentence:** the browser never talks to the database. It talks to Next.js,
Next.js forwards `/api/*` to NestJS, NestJS checks rules, then Prisma reads/writes Postgres.

---

## 1. A visitor arrives (no login yet)

```mermaid
flowchart TD
  A["GET /  — page.tsx renders on the server"] --> B["Browser runs 2 background calls"]
  B --> C["GET /api/projects<br/>public list — always works"]
  B --> D["GET /api/me<br/>no cookie yet → 401"]
  D --> E["That 401 is NORMAL.<br/>UI shows guest mode + Sign in button"]
  C --> F["Project cards render with illustrations"]
```

File: `apps/web/app/page.tsx` (the whole home UI), `apps/api/src/main.ts` (`@Get("projects")`, `@Get("me")`).

---

## 2. Creating an account

```mermaid
flowchart TD
  A["User fills Register form"] --> B["POST /api/auth/register"]
  B --> C["zod validates name/email/password shape"]
  C --> D["bcrypt hashes the password<br/>(we never store plain text)"]
  D --> E["User row created — status INACTIVE"]
  E --> F["Token queued → activation email via SMTP"]
  F --> G["User clicks link → account activated"]
  G --> H["Redirect to Sign in"]
```

Dev data only: `prisma/seed.ts` creates sample profiles for manual sign-in while developing; seeding is blocked in production.

Files: `apps/api/src/main.ts` (register/login), `apps/api/src/core/security.ts` (validation + session helpers), `apps/api/src/core/mail.ts` (queue), `prisma/seed.ts`.

---

## 3. Login → session cookie (the heart of the app)

```mermaid
flowchart TD
  A["POST /api/auth/login"] --> B{"Origin header allowed?<br/>exact match to APP_ORIGINS<br/>(+ sandbox preview origin in dev)"}
  B -- no --> X["403 ORIGIN_FORBIDDEN<br/>(this is what broke the preview — CSRF guard)"]
  B -- yes --> C["Rate limit check (Redis)"]
  C --> D["Find user, bcrypt.compare(password)"]
  D -- wrong --> E["Generic 401 — same message for<br/>bad email or bad password"]
  D -- good --> F["Create session row (hashed token)"]
  F --> G["Set-Cookie pc_session<br/>HttpOnly, path=/,<br/>Secure in prod · Lax normally<br/>(None+Partitioned only for the sandbox preview)"]
  G --> H["Every later request carries the cookie<br/>→ guard loads your user → /api/me works"]
```

Files: `apps/api/src/core/security.ts` (origins, cookie options), `apps/api/src/core/preview-config.ts` (sandbox-only cookie mode), `apps/api/src/core/rate-limit.ts`.

Google login: `apps/api/src/features/oauth.ts` — `/api/auth/google/start` → Google → `/api/auth/google/callback` → find-or-create user → same cookie.

---

## 4. The core product loop

```mermaid
flowchart TD
  A["Browse / search / filter cards<br/>(categories, skills — client-side in page.tsx)"] --> B["Open a project → GET /api/projects/:id"]
  B --> C["Apply → POST /api/projects/:id/apply<br/>message + what you bring"]
  C --> D["Owner sees it in Applications<br/>GET /api/applications"]
  D --> E{"Accept or decline?"}
  E -- accept --> F["PATCH /api/applications/:id<br/>both become connections"]
  F --> G["Chat opens<br/>GET + POST /api/messages/:id"]
  G --> H["Notifications, bookmarks, feed,<br/>invitations, team, workspace..."]
  E -- decline --> I["Applicant notified politely"]
```

Files: `apps/api/src/main.ts` (projects/applications/messages), `apps/api/src/features/social.ts`, `Invitations.tsx`, `apps/web/app/components/Workspace.tsx`.

---

## 5. Uploading an image (avatar or project photo) — why it can look "broken"

```mermaid
flowchart TD
  A["Pick file in ImageUpload.tsx"] --> B["Client checks type + size"]
  B --> C["POST the image JSON to the API"]
  C --> D["Server re-checks magic bytes<br/>(real PNG/JPEG, not renamed junk)"]
  D --> E["Saved to temp → scanned by ClamAV"]
  E -- infected --> X["400 — rejected, never served"]
  E -- clean --> F["Moved to durable storage + sha256 recorded"]
  F --> G["DB links it (avatarId / project imageId)<br/>response: { imageUrl: /api/images/ID }"]
  G --> H["onChanged() refetches → server URL stored in state"]
  H --> I["PreviewImage shows it:<br/>loading / OK / failed+Retry<br/>(scan pending or quarantined = clean message,<br/>not a broken icon)"]
  I --> J["GET /api/images/:id<br/>serves only to the allowed audience"]
```

Files: `apps/web/app/components/ImageUpload.tsx`, `apps/web/app/components/PreviewImage.tsx`, `apps/api/src/features/images.ts`, `apps/api/src/core/file-scanner.ts`, `apps/api/src/core/storage-scan.ts`.

Key idea for beginners: **the thumbnail you pick is not stored.** What you see after saving comes back from the server — so if the server can't reach you (blocked cookie, wrong origin, scan pending), the right behavior is a visible failure + retry, which is exactly what PreviewImage does.

---

## 6. Extras (same pattern as above: UI → /api route → guard → Prisma)

| Feature | Front end | Back end |
|---|---|---|
| Find people nearby | `NearbyHardware.tsx`, `GoogleStoreSearch.tsx` | `features/places.ts` + `core/places.ts` (server key, distance filter, attribution) |
| AI assistant | `AiAssistant.tsx` | `features/assistant.ts`, `core/ai-budget.ts` + `core/ai-ledger.ts` (per-user daily budget) |
| Moderation (admin) | `AdminPanel.tsx` | `features/moderation.ts` |
| Export my data / delete account | `AccountExport.tsx` | `features/export.ts`, `features/account.ts` (`@Get("export")`, `@Delete()`) |
| Account settings, sessions | `apps/web/app/account` | `features/account.ts` (`@Get("sessions")`, `@Post("reset-password")`…) |

---

## 7. Every request passes the same gauntlet

```mermaid
flowchart LR
  A["Request"] --> B["CSP + headers<br/>next.config.ts"] --> C["Rate limit<br/>core/rate-limit.ts"] --> D["Exact-origin CSRF check<br/>core/security.ts"] --> E["Session cookie → user"] --> F["zod input validation"] --> G["Handler + access rules"] --> H["Prisma (parameterized SQL)"] --> I["DTO response —<br/>never returns password/token fields"]
```

---

## 8. Running & shipping it yourself

```mermaid
flowchart TD
  A["git clone + npm install"] --> B["Docker: postgres + redis<br/>docker-compose.yml"]
  B --> C["npx prisma migrate dev<br/>(builds the 43 tables)"]
  C --> D["npm run db:seed<br/>(dev only — sample data)"]
  D --> E["Terminal 1: npm run start:api :3001<br/>Terminal 2: npm run dev :3000"]
  E --> F["npm test · npm run build · lint"]
  F --> G["Staging host: env vars →<br/>DATABASE_URL, APP_ORIGINS, SMTP, GOOGLE_*, CLAMD, AI keys"]
  G --> H["Migrate + smoke tests<br/>(scripts/verify-production-smoke.mjs)"]
  H --> I["Backups per docs/OPERATIONS.md<br/>(encrypted pg_dump + object store)<br/>restore rehearsed by verify-local-recovery.mjs;<br/>schedule off-site cron"]
  I --> J["Launch checklist in LAUNCH_HANDOFF.md<br/>domain · HTTPS · CSP · monitoring"]
```

---

## Glossary (5 words that unlock the rest)

- **API** — the back-end program that owns all the rules; here it's NestJS on port 3001.
- **Session cookie** — a small signed note your browser keeps after login, proving who you are on every request.
- **ORM / Prisma** — typesafe database access; no hand-written SQL strings; `schema.prisma` is the single source of truth.
- **Migration** — a numbered, replayable file that changes the database shape (add a column, add a table).
- **CSRF / origin check** — the server refuses writes that didn't come from an approved site origin; this is why preview domains must be allow-listed exactly.

## Where things live

| You want to change… | Open |
|---|---|
| Home UI, cards, modals | `apps/web/app/page.tsx` |
| Shared components (upload, chat, admin…) | `apps/web/app/components/` |
| Look & feel | `apps/web/app/globals.css` + `design-refresh.css` |
| Auth, projects, apply, chat routes | `apps/api/src/main.ts` |
| Accounts, images, places, AI, export | `apps/api/src/features/*.ts` |
| Security (cookies, origins, validation) | `apps/api/src/core/security.ts` |
| Database shape | `prisma/schema.prisma` + `prisma/migrations/` |
| Demo/seed data | `prisma/seed.ts` |
