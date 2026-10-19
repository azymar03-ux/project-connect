> **Current source:**118tests/25migrations. [STORAGE_QUARANTINE_CHECKPOINT.md](STORAGE_QUARANTINE_CHECKPOINT.md) supersedes dated historical counts/semantics below. NOT READY FOR PRODUCTION LAUNCH.

> **10 October 2026 current addendum:**112tests/22migrations. [PORTABILITY_STORAGE_COST_CHECKPOINT.md](PORTABILITY_STORAGE_COST_CHECKPOINT.md) supersedes historical102/20 counts and export/storage/cost/sitemap gaps below. Full launch remains NOT READY.

# API reference — 9 October 2026

> **Current: 102 tests passed, no failures/skips; 20 migrations.** [CLOSEOUT_CHECKPOINT.md](CLOSEOUT_CHECKPOINT.md) and [VALIDATION_REPORT.md](VALIDATION_REPORT.md) supersede historical limitations below. NOT READY FOR PRODUCTION LAUNCH.


Browser uses same-origin `/api`. Private endpoints require HttpOnly `pc_session`. Errors contain `message`, `code`, `requestId`;429 includes Retry-After, configured Redis outage503. Page shapes are `{items,nextCursor}` unless explicitly compatibility arrays.

## Identity/account
- `POST auth/register|login|logout|logout-all`; `GET/PATCH me` allowlisted user profile.
- `GET account`; `POST account/verification|verify|forgot-password|reset-password|password`.
- `GET account/sessions`, `DELETE account/sessions/:id`; `GET account/export`, `DELETE account {password}`.
- `PATCH account/preferences {notifySocial,notifyMessages,notifyWorkspace}` exact boolean fields.
- `GET auth/google/status` configuration boolean; `GET auth/google/start` Google redirect; `GET auth/google/callback` consumes cookie-bound one-use state and validates identity.
- `POST auth/google/link` signed-in + exact origin returns `{url}`; `GET auth/google/account {linked}`; `DELETE auth/google/account`, requires verified recovery email + set password. Existing email accounts must sign in then explicitly link. All missing-credential cases fail truthfully.

## Discovery/projects
- `GET discovery/projects|people?q&limit=12&cursor&sort=recommended|newest|oldest` limit1–50.
- Projects: `category=All projects|Robotics|IoT|AI & ML|Web development|Design`, `remote=true|false`, `scope=all|mine|saved`. `mine` includes archived membership projects; public/saved collections exclude archived. People: `scope=all|connections`.
- Discovery cursors are HMAC-signed payloads bound to viewer, filters, algorithm version, skills/interests/city and blocked peers. Fixed activity window and 30-minute expiry; malformed, tampered or changed-profile/filter cursor400. `matchReasons` explains skills/interests/city/visible public activity; not a success probability. Response includes ranking version/time and live-pagination disclaimer.
- Legacy `GET projects|people` returns first50 compatibility items; use discovery endpoints for full paging.
- `POST projects` validated title/description/category/tags/skills/positions/city/remote/teamSize; owner quota100.
- `GET projects/:id` public allowlisted detail; archived detail members only. Blocked nonmember signed-in peers404.
- `POST projects/:id/bookmark` transaction-safe toggle; `POST projects/:id/apply {message}`. Repeated Pending apply returns existing row without duplicate alert. Completed/Archived/full/member/blocked denied. Cancel/rejected/previously accepted nonmembers may reapply.
- `DELETE projects/:id/application` pending cancellation (repeat Cancelled idempotent).
- `GET applications` bounded100 owner review items; `PATCH applications/:id {status:Accepted|Rejected}`, owner rechecked after lock, capacity enforced, same outcome idempotent.

## Workspace
- `GET workspaces/:id`: members/public user fields/tasks/milestones/approved resources/recent audit. Member required.
- `POST workspaces/:id/tasks` title/description/status/assigneeId/dueDate/labels/optional position. Quota200; assignee must be member.
- `PATCH workspaces/:id/tasks/:taskId` partial fields + optional expected `version`; stale409; writes increment version. `DELETE` owner only.
- `PATCH workspaces/:id/tasks/reorder {items:[{id,version},...]}` every current task exactly once, quota200, no duplicates; stale/missing set409. Persists dense positions and increments versions.
- `POST workspaces/:id/milestones` owner title/dueDate, quota100; `PATCH :milestoneId {completed}`.
- `GET workspaces/:id/messages?limit&cursor` latest page chronological; cursor scoped to project; `POST {content}` member.
- `PATCH workspaces/:id/project` owner settings/title/description/category/tags/requiredSkills/positions/city/remote/teamSize/status/original-cover path. Capacity cannot shrink below members. Archive cancels pending applications/invites; restore using status.
- `DELETE workspaces/:id/project {confirmTitle}` owner, must be Archived and exact title. Related workspace data removed; files queued durably; plan references cleared.
- Archived collaborative writes denied409, downloads/reads remain; owner settings/restoration/deletion and security-related leave/removal remain possible.
- `PATCH/DELETE workspaces/:id/team/:userId`; `POST team/leave|transfer`; owner role/removal/transfer rules.
- `GET invitations`, `GET/POST workspaces/:id/invitations`, `PATCH workspaces/:id/invitations/:inviteId/cancel`, `PATCH invitations/:id {status:Accepted|Declined}`. Acceptance locks capacity and rechecks block/owner/status.

## Files
`GET/POST workspaces/:id/files` multipart field `file`; no public storage keys.5MB per file,100 files/50MB per project. UTF-8 text/code, PNG/JPEG decode/re-encode16MP/8192px bounds. `GET files/:id/download` authenticated attachment; S3 redirect60s. `DELETE files/:id` uploader/current owner, read-only archive enforcement, durable deletion retry queue.

## Social/chat/notifications
- `GET profiles/:id` public allowlist/showcase/counts; `POST follows/:id {enabled}` duplicate-safe intent.
- `POST connections/:userId`, `PATCH connections/:requestId`, `DELETE connections/:requestId`.
- `GET feed?scope=community|following&limit&cursor`; `POST workspaces/:id/updates {content}`, member quota10/hour; `DELETE feed/:id` author.
- `GET notifications?limit&cursor`, `PATCH notifications/:id|read-all`, `GET unread {notifications,messages}`.
- `GET messages/:id?limit=50&cursor`, `POST messages/:id {content}`, connection/block authorization.
- `PATCH messages/:id/read {throughId}` fetched conversation boundary; later arrivals remain unread. Polling4s only visible/open direct chat; no push realtime.

## Resources/hardware/AI/admin
- `GET/POST resources`, `PATCH/DELETE resources/:id`; `POST :id/save|vote {enabled}`; `POST/DELETE :id/projects/:projectId`; `POST :id/github-metadata` constrained fixed GitHub destination.
- `GET/POST stores`, `POST :id/favorite`, admin `GET stores/pending`, `PATCH stores/:id/review`.
- `GET ai/status|plans`, `POST ai/plan {prompt,projectId?,providerConsent}`, `POST ai/plans/:id/tasks {projectId}` duplicate-safe import; `DELETE ai/plans/:id` content tombstone retains daily quota count. Roadmap endpoint not streamed; separate assistant SSE is below.
- `GET blocks`, `POST/DELETE blocks/:userId`; `POST reports`; admin `GET admin/reports|overview`, `PATCH admin/reports/:id`. Account suspension/audit endpoints implemented below.

Initial budgets: read600/IP/min, writes100/user/min, IP write preguard300/min, sensitive auth/account30/IP/family/min (Google start included). Production verified-publication gate returns403 `EMAIL_VERIFICATION_REQUIRED`. These are defaults, not production-tuned SLOs. More exhaustive OpenAPI/shared client types and owner-review pagination remain engineering work.


## New integrated endpoints
- `GET assistant/status`; `GET assistant/conversations?cursor&limit`, `POST {title,projectId?}`; `GET/DELETE assistant/conversations/:id`, owner-private100conversations/100turns.
- `POST assistant/conversations/:id/messages {prompt,requestId:UUID,providerConsent}` SSE start/delta/done/failure; duplicateID returnsJSON existingturn; conflict409; budget429; consent400. `POST assistant/turns/:id/cancel` private owner. See INTEGRATIONS for exact streaming limits/retention/privacy.
- `GET places/status` server flags+public restrictedbrowserkey; `POST places/search {lat,lng,radiusKm?,query?}` verified/authenticated/explcitaction,20results/boundedfieldmask/no-cache/attributions. No-key503,budget429,upstream502.
- `GET github/status`; `GET/PUT/DELETE workspaces/:id/github {url,installationId?}` ownerlinks,memberreads,unlinked{linked:false}; `GET workspaces/:id/github/activity`. Privateinstallation requires project:installation grant;read-only/no storedtoken/source. `POST github/webhook` rawHMAC-SHA256,dedupdeliveryID,minimal audit; no browser auth substitute for signature.
- `GET workspaces/unread {items:[{projectId,unread}]}` membership-scoped; `PATCH workspaces/:id/messages/read {throughId}` scoped monotonicboundary,includingarchivedread.
- `GET admin/users?q&cursor {items,nextCursor}` name only,noemail; `PATCH admin/users/:id {suspended,reason}` adminrequiresreason10–500chars,self/adminprotected. `GET admin/audit?cursor`, `GET admin/operations` countqueues. Allprivate/no-store/adminchecked.
- Production signup acknowledgeseligibleverification/noautomatic session/noemailenum409; development still auto-signs-in for onboarding. Recovery/sendoutboxtestedlocally,notlive.

Scopes/limits/error states and localHTTPfixture startup: **INTEGRATIONS.md**. More exhaustive OpenAPI/shared types are not yet implemented.

## Activation/delivery/review additions
- POST `account/activation` `{email}`: neutral activation-link request. POST `account/verify` `{token,password,name}`: pending accounts require fresh password/name; revokes sessions/tokens. Reset revokes linked Google access too.
- POST `messages/:id` and `workspaces/:id/messages`: `{content,requestId?:UUID}`; retry same payload returns same row, mismatched replay409.
- GET same message paths: `after` ascending catch-up or `cursor` backward history, never both; scoped cursor, default50/max100.
- PATCH `workspaces/:id/milestones/:milestoneId`: optional title/dueDate(nullable)/completed, at least one change. DELETE same path owner-only; active workspace required; audit records.
- GET `applications`, `admin/reports`, `stores/pending`: `paged=true&cursor=…` returns `{items,nextCursor}`,50 per page. Legacy no-paged calls retain bounded arrays.

## Image and section-export extension (current)
- `POST/DELETE /api/account/avatar`: authenticated own profile photo; multipart `file`PNG/JPEG only; production upload needs verified email. Returns imageID+relativeURL, never private key.
- `POST/DELETE /api/workspaces/:id/cover`: active project owner only; same multipart contract. Concept-image PATCH retires existing upload; unrelated project settings preserve it.
- `GET /api/images/:imageId`: audience-aware inline derivative, private/no-store. No CDN/public object URL. Blocked outsiders/pending/suspended/archive rules described in EXPANSION_CHECKPOINT.
- `GET /api/account/export/sections`: authenticated23section manifest. `GET /api/account/export/page?section=<manifest-name>&limit=1..100&cursor=<nextCursor>&download=true`:items,nextCursor,snapshot:false; signed originating-session cursor expires1h. Max2MBpage413asks smallerlimit. No total-row cap,no cross-page snapshot,no attachment bytes; own sent messages/outgoing relationships only.
- `/api/account/export` remains bounded summary and returns pagination endpoint references. New full-section paging should be used when summary truncated.
- AI reservation503`reconciliation in progress` means fail-closed partial-index worker backlog; do not bypass budget. Worker30s/bounded batches; large legacy deletion503 retries after worker progress. See INTEGRATIONS.

## Current reliability/operations API notes
- DM/project message pages return signed `afterPosition`/`nextPosition`, `hasOlderUnread`, bounded items and legacy compatibility cursors. Signed positions survive boundary deletion, are session/audience bound and expire in 24h. `CHAT_POSITION_EXPIRED` returns structured409 for explicit recent-history reset, not silent arbitrary history truncation.
- Message GET with scoped `requestId` returns only committed/not_found and message ID, not another user's plaintext. Send request IDs are per user/conversation; conflicting content409. Recheck authorization on every request.
- `GET admin/operations` is admin-only and includes count-only queue alerts and process-local route-template HTTP telemetry. No external tracing collector is configured.
- `POST resources/:id/github-metadata` uses bounded public cache/refresh/upstream quota and rechecks approval/URL/session. Private GitHub credentials are never sent by this endpoint.
- Stable `CHAT_POSITION_SECRET` and `EXPORT_CURSOR_SECRET` required>=32characters in production; optional `_PREVIOUS` rotation keys. Discovery uses a distinct HMAC purpose with the export key ring. Full generated OpenAPI/shared client schemas remain unfinished.

## Portability and sitemap additions (10 October)
`POST /api/account/export/jobs` queues one snapshot ZIP (3/day,1active/account); `GET` lists requesting-session jobs; `GET /:id/download` streams ready ZIP; `DELETE /:id` cancels/deletes (quota tombstone kept for24h). Settings includes request/status/download/cancel. Shared wire schemas in `apps/web/shared/api-contract.ts`, generated API copy, `npm run contracts:check`. `docs/openapi.json` is generated registered-route inventory with only partial payload coverage; generate after API build using `node scripts/generate-openapi.mjs`.
`GET /api/sitemaps/partitions`, `/entries?kind=projects|people&first=...&last=...` supply bounded public ID ranges; `/sitemap.xml` is now an index and `/sitemaps/<range>.xml` returns a partition. Unsupported growth fails503, not silent omission. Public visibility rechecked;5minuteXMLcache is not instantaneous revocation.

## Current storage delivery change — 10 October 2026
File list adds `scanStatus` (pending/scanning/clean/development-unscanned/error/failed/quarantined), never private storage key. Pending/unverified/error/failed/quarantine file download503; public images not visible until permitted state (404). Production never permits development-unscanned. Successful file responses now return API-proxied attachment bytes for **both local and S3**; no stale60s S3 signed redirect. Exact bounded size/SHA-256/status verified, session/membership/live metadata rechecked. Upload scans original and normalized bytes; scanner unavailable503, malware400.

Account-export jobs keep digested safety dependencies and expected count; unverified attachment/image aborts build with EXPORT_OBJECT_UNVERIFIED. Old incompatible jobs expired on upgrade. Later quarantine or missing dependency prevents ready ZIP download404, active delivery periodically rechecks3s with session/job expiry/cancel. Pins omitted from owner export/public payload. Scan/rescan is operator CLI only; no bypass HTTP endpoint. Admin operations adds aggregate pendingScans/failedScans/quarantinedObjects and SCAN_BACKLOG/SCAN_FAILURES/OBJECT_QUARANTINE alerts. Full payload/client contracts remain partial.
