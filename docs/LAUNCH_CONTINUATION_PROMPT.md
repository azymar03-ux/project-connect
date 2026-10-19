# ProjectConnect — autonomous launch-completion prompt

> Current checkpoint:118tests/25migrations. See STORAGE_QUARANTINE_CHECKPOINT.md; full contract below remains active.


Paste this prompt into the coding agent with access to this workspace. This supersedes the MVP-only stop instruction in the original master prompt.

## Objective
Continue the existing ProjectConnect repository at `/home/user/projectconnect` until all automatable work required for a launch candidate is implemented, integrated, tested, and documented. Build the full product, not another MVP or a visual-only prototype. Deliver all final artifacts to the workspace. Execute the work, not just a plan. Do not restart or discard working functionality.

The reference is `/home/user/uploads/image-1.png`; original product specification is `/home/user/ProjectConnect_Master_Prompt.md`. Inspect actual code, database, test reports, and current `docs/LAUNCH_STATUS.md` before deciding what is implemented. Trust test evidence over prose. You may be resumed in a later agent session; maintain a checkpoint after each coherent change.

## Operating contract
1. Work autonomously on all reversible local engineering decisions. Do not request permission between phases. Ask only for decisions genuinely necessary to proceed, unavailable credentials, destructive actions against real data, expenditure, or external publication. Work around missing credentials by implementing adapters and testing with isolated test doubles, then continue other work.
2. Do not promise error-free software. Aim for zero **known failing required checks**, fix root causes, and explicitly document residual risks and untested assumptions. A feature is not complete because its button exists or its endpoint returns canned data.
3. Never hide errors, weaken assertions, skip tests to manufacture a green result, catch exceptions silently, or use fake successes. Never say production-launched until an authorized deployment and production smoke checks actually succeeded.
4. Keep actual command outputs, timestamps, test totals, and limitations in `docs/VALIDATION_REPORT.md`. Mark tasks `implemented + verified`, `implemented + unverified`, `not implemented`, or `manual prerequisite blocked`; avoid misleading broad completion percentages.
5. Use finite, observable steps. Continue until the current tool/turn budget is reached or all gates pass. If execution limits prevent completion, save a precise checkpoint, runnable commands, unresolved failures, and ordered remaining work. Do not imply background work continues after the session unless a tracked process actually does.
6. No production secrets in files, source, browser bundles, screenshots, logs, or Git. Use `.env.example` and ignore actual `.env*` except examples. Never print real credentials. Public demo credentials are development-only. Seed data must never be inserted automatically into production.
7. Preserve the navy/cyan/purple ProjectConnect design, with responsive desktop navigation and accessible mobile navigation. Finish functionality before decorative enhancements.

## Architecture and engineering
- Next.js App Router + strict TypeScript frontend; NestJS modular backend; PostgreSQL + Prisma; Redis where shared limits/queues/cache are needed. Inspect locked package versions rather than assuming latest is safe. Keep supported, audited dependencies. Do not force advisory fixes without checking compatibility.
- Split API into tested modules with shared validation/types. Split UI into reusable components and feature routes. Single-origin browser API access through a reverse proxy; never call sandbox localhost from the user's browser. Dev services bind 0.0.0.0 and allow only configured preview origins.
- Versioned forward migrations, indexes, DB constraints, deterministic development seeds, explicit rollback/restore procedures. Avoid schema push as a production migration strategy. Test upgrade from current data as well as clean install.
- Cursor pagination, stable ordering, server search/filtering, sane request/body limits, transactions and retry handling for concurrent writes. No unbounded lists or cache growth.
- Consistent error envelopes, safe Prisma-error mapping, trace IDs, structured redacted logs, readiness and liveness checks. Authorization on every object read/write, not just UI buttons.

## Full product scope and acceptance criteria

### A. Identity, accounts, and privacy
- Email registration/login/logout; password hashing; email verification; forgot/reset password; one-use expiring hashed tokens; no account enumeration; delivery/retry queue and templates.
- Google OAuth with server-side token exchange, state/PKCE protections as applicable, registered redirect URIs, careful account linking; working credential-missing states, not fake sign-in.
- Revocable sessions, CSRF protections, exact origin allowlist, secure httpOnly cookies, session listing/logout-all, password-change revocation. Rate-limit auth and sensitive actions across instances.
- Onboarding with role, skills, interests, education, city/optional geolocation, portfolio URLs and avatar. Public serializers expose only explicitly public fields. Email, password hashes, session/token internals never appear in public nested payloads.
- Account export/deletion, notification preferences, consent and privacy controls. Legal documents must be clearly marked draft until owner/legal review; do not invent legal approval.

### B. Social network and discovery
- Public profiles and showcases; follow/unfollow; connection request/accept/reject/cancel/block; reciprocal request normalization and uniqueness under concurrency.
- Activity feed, notifications, search and recommended people with explainable match scores. Report/block abuse, moderation queue and admin permissions. New accounts must see real useful empty states.
- Profile/project SEO, shareable stable URLs, metadata and sitemap with privacy respected.

### C. Projects and collaboration workspace
- Create/edit/archive/delete project; image handling; skills/tags/open positions, location/remote, team capacity and status. Search/filter/sort on server with pagination.
- Apply/cancel/reapply rules, owner review, atomic capacity enforcement, owner/member permissions, invitations, role changes/removal/leave, owner transfer, audit events. Repeat acceptance must be idempotent.
- Workspace overview, Kanban tasks with drag/drop and keyboard alternative, status/order/assignee/due dates/labels, milestones and progress calculated from persisted tasks.
- Private files via S3-compatible signed URLs, size/type validation, project authorization, malicious content handling, upload/download/delete, orphan cleanup and storage quotas. Never serve executable user HTML on the application origin.
- Project chat and connected-user direct messaging; authenticated realtime channels or documented polling fallback, pagination, unread state, reconnect handling, blocking enforcement. Prevent IDOR on every channel and attachment.
- GitHub integration with appropriately scoped tokens and safe webhook signature verification; secrets isolated on server.

### D. Resource Hub
- Real persisted resources: repositories, documentation, APIs, libraries, tutorials, datasets and tools. Create/edit/moderate/search/filter/paginate, bookmarks/upvotes, attach/detach to projects with membership checks.
- GitHub metadata adapter, background updates, quota/backoff/cache. Validate external URLs. Do not server-fetch arbitrary submitted URLs without SSRF controls (private IPs, redirects, DNS rebinding, protocol restriction, timeouts/size limits).
- If credentials are absent, local curated data remains useful and integrations show truthful configuration status.

### E. Hardware discovery
- Store records, categories, map/list switch, permission-aware location/radius search, distance, hours/timezone, phone, directions, favorites, community submissions/verification/reporting.
- Google Maps browser display may require a **restricted browser key**; Google Places/server API keys remain server-side. Browser restrictions: exact deployed domains and required Maps API only. Server keys: restricted API and applicable source restrictions. Never claim all map keys can be hidden when the Maps JS display key is inherently public.
- Follow Google Maps/Places licensing, attribution and caching rules; do not set arbitrary cache TTLs or retain restricted Places content indefinitely. Query and quota controls on backend. Avoid inventing store stock, opening hours or verified merchants.
- Implement graceful no-key/no-location states. Test distance calculations against known points, not fabricated live search results.

### F. AI project assistant and recommendations
- Provider interface + real server-side LLM adapter, explicit enablement, per-user/project quotas and cost protection, rate limits, streaming/error/cancel handling, persisted conversations with privacy controls.
- Project ideas/roadmaps/technologies/debugging and resource suggestions. Structured schema validation; render safely; citations/links verified or identified as unverified, no fabricated GitHub projects or shops.
- Roadmap-to-task confirmation, membership authorization and duplicate prevention. External retrieved content is untrusted; prevent prompt injection from authorizing tools, publishing data, or accessing secrets.
- Drone/electrical guidance includes appropriate safety limitations; no claim of certified engineering advice.
- Explainable skill/interest/location/activity scoring, tested range/weights/cold-starts; embeddings only if justified and consent/privacy are handled. Do not call a percentage scientifically calibrated unless evaluated.

### G. Product polish and operations
- Landing, auth, onboarding, home, projects/details/workspace, profiles/people, resources, nearby, AI, notifications/settings/admin. Complete loading, error, offline and empty states; responsive 320px+; WCAG AA checks, focus trap/restore for dialogs, escape dismissal, visible focus, reduced-motion, contrast, accessible Kanban.
- Remove unlicensed sample stock thumbnails; replace with owned or documented licensed assets. Do not misrepresent an illustration as an actual project's photo.
- Dockerfiles, compose with health checks/private network, web/API production builds/start scripts, deploy manifests for a documented target, secrets configuration, non-root containers, CI/CD, migrations before rollout, backups and tested restore.
- HTTPS, secure headers/CSP appropriate to Maps/OAuth, trusted-proxy configuration, exact origins, SSRF/XSS/SQL injection/file safety and error redaction. No broad wildcard origin loopholes.
- Monitoring/tracing, error reporting, alert recommendations, readiness check dependencies, retention/cleanup, performance budgets/load tests. Admin UI with least privilege, moderation, metrics and audit log.

## Required validation gates (run, record and fix)
1. Clean dependency installation from lockfile, schema generate, clean migration, seeded development start.
2. Lint, strict typecheck, production frontend **and backend** build.
3. Unit tests for validation, matching, geospatial distance, session/token logic, permissions and rate limits.
4. API integration tests with isolated test database: public privacy recursively, auth/session revocation, forbidden origin, member/owner/admin boundaries, invalid IDs/payloads, pagination, concurrent requests/capacity and duplicate acceptance.
5. Browser tests desktop/mobile: registration/verification/recovery (test mailbox), login/logout; edit profile; create/edit/apply/accept project; connection and message; tasks/files/milestones; resources; notifications; settings; integration credential-missing states. Tests isolate and clean their own data; do not require a magic seed count or mutate shared demo accounts permanently.
6. Adversarial tests: IDOR, CSRF, blocked user messaging, malicious URLs/uploads, XSS strings, rate limits, stale sessions, quota abuse, unauthorized realtime subscriptions.
7. Accessibility automated scan plus keyboard smoke checks. No serious/critical unreviewed findings. No mobile horizontal overflow.
8. Dependency audit, secret scan and license inventory. Findings triaged with actual scope/risk; do not equate a dev-only advisory to zero production risk or silently suppress it.
9. Production-mode smoke test through reverse proxy, health/readiness, logs, backup/restore exercise, bounded load test and performance measurements.
10. Third-party tests isolated locally; live external smoke tests only when actual credentials are configured and user authorization is clear. Mark live tests blocked otherwise.

## Manual work only (do everything else)
Create `docs/MANUAL_SETUP.md` listing exact steps, environment variables, redirect URLs, permissions, billing/quotas, verification commands, and why each needs the owner. Likely manual items: hosting/domain/DNS, Google OAuth consent/app registration, Google Maps billing/restricted keys, LLM key/budget, transactional email domain/provider verification, S3 bucket/credentials, GitHub App/OAuth registration, monitoring accounts, approved legal policies, licensing and launch authorization. Never manufacture these accounts, IDs, approvals, or secrets. Test adapters against local fixtures while proceeding with other engineering.

## Final workspace deliverables
- Complete editable repository, lockfile, versioned migrations, deploy configs, tests and CI workflow.
- `docs/LAUNCH_CONTINUATION_PROMPT.md` (this contract).
- `docs/LAUNCH_STATUS.md`: evidence-based scope matrix and precise next checkpoint.
- `docs/VALIDATION_REPORT.md`: actual commands/results, known failures, omitted checks, environment.
- `docs/MANUAL_SETUP.md`: owner-only prerequisite checklist with no secrets.
- `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/SECURITY.md`, `docs/OPERATIONS.md`.
- Updated README, `.env.example`, sanitized release archive excluding dependencies/builds/caches/secrets and test personal data.
- Main summary `LAUNCH_HANDOFF.md`: what is working, how to run/deploy, launch gate decision, manual steps, remaining engineering if any. Present this file when finishing. If any required gate fails or feature is unfinished, say **NOT READY FOR PRODUCTION LAUNCH** and explain. Only say **LAUNCH CANDIDATE** when automatable gates truly pass; production launch still needs owner setup/authorization.

## Start now
Inspect the repository and current state. Fix exposure and integrity risks first: public-user privacy, strict credentialed request origins, revocable sessions, atomic project-capacity enforcement and connection uniqueness. Preserve a working preview. Add complete integrated features incrementally, with tests after each module. Execute all phases without the original Phase-1-only pause. Save a truthful checkpoint rather than claiming completion if the run ends early.

## Latest execution checkpoint — 9 October 2026
**102/102 tests passed,0failed,0skipped,1.6m**, with compiled API and built web plus dedicated provider HTTP fixtures. Read CLOSEOUT_CHECKPOINT.md, LAUNCH_STATUS.md and VALIDATION_REPORT.md before changing anything. Historical68/78/89/96/101counts are superseded.20migrations fresh-tested/checksums pass; strict types/lint/format/API+web builds pass; audit0known;147-file selected secret scan clean.

Completed: signed deletion-independent bounded chat paging/gap recovery,metadata-only24h retry/reload reconciliation/sharedinflight/switch/logout isolation,visible timeout/read retries;MapsSDK cleanup/timeout/retry/disposal+optionalcontactfields;publicGithubboundedcache/refresh/sharedquota/privateTokenrevocation;AIbackpressure/stalledcancellation;fit-v2interest/publicactivityranking+signed30mincursors/evaluation;admintelemetry/monitorCLI+systemdtemplates/failcloseddeploymentpreflight/disposablecontainerworkflow. Current encryption recovery validates all40tables,decryptedDB+filebundle,wrongkey/corruption rejection,restoredcompiledAPIsession/file/imagehash/private401. Productionlocal50requests all200,p5042ms/p9594ms;selfsignedChromiumHTTPSPASS. Not liveproviders,offsiteS3,realDocker/hostedCI/publicTLS/loadcertification.

Do not repeat completed work or claim all nonmanualengineering is finished. Remaining in LAUNCH_STATUS:sharedDTO/OpenAPI;coherentbyteinclusiveasyncportability;legacyobjectinventory/scanningworkflow;statisticalenum/abuse/manualassistivetech/independentsecurity;largerscaleAI/ranking/load;pricedAI/model/citationevaluation;executedDocker/hostedCI/edge/monitoringalertdelivery/tracing/offsiteRPO/RTO. Owner-onlydomain/accounts/credentials/billing/legal/approvalremainseparate.

Run normal API/web per README;backendnonwatch,rebuild/restartafteredits. Fullsuite requires test-onlyproviderAPI3004 per INTEGRATIONS. Productionbuild INTERNAL_API_URL=http://api:3001. No testpreload/TLSproxy/certs/secrets/privatefilesinrelease. No deploymentauthorized. Finalsavedhandoff/archivecurrent;notproductionready;noengineeringrunsinthebackgroundafterturnend.

## Latest continuation — 10 October 2026
Rebuilt112/112PASS0fail0skip2.0m;22fresh/checksums+20→22upgrade;42tableencryptedDB+filesrestoredAPIvalidationPASS;format/lint/contracts/types/builds/audit0PASS. Added coherent durable snapshotZIP+immutablebytepins/session/expiry/cancel/3perday/256MiB64MiB10kobjects/timeguards;storageinventorydryrun+agedrecognizedorphansqueue;clamdINSTREAMfailclosedproductionadapter(privateComposeunexecuted);integerpricedAIperrowsum/mixedlegacy+modelapprovalrequirements;sitemapindex/rangepartitions;sharedZodportability/roadmap/sitemapandgeneratedAPIcopy/driftcheck;OpenAPI111paths137operationspartialpayloads. Local10kSQLcost6.095ms/ranking59.523ms;30s120HTTP200p9556.39ms;smalltimingsampleNOTcertification. Read PORTABILITY_STORAGE_COST_CHECKPOINT, updated LAUNCH_STATUS/VALIDATION_REPORT and root handoff. Remaining fullDTO/payloadmigration,legacyrescanquarantine/realengine,largeexportcrashscratch/S3testing,representativeload/multireplicaraces/statisticalabuse/manuala11y/independentsecurity/modelquality,realDockerhostedCIedgealertdelivery/offsiteRPO/RTO. Do not claim owner credentials are the only gap. No external deployment authorized.


## Latest storage continuation — 10 October 2026
118/118PASS0fail0skip1.8m;25freshchecksums/20→25legacyAI+files/imagespending/22→25oldexportexpiry;43tableencryptedDB+filesrestoredAPIvalidationPASS;format/lint/contracts/types/builds/audit0PASS. PersistentStorageScan/sha256/legacyqueue/quarantine/rescan/generationDBclockleasefencing;scanoriginal+storedbytes;boundedprivateattachmentproxy(noS3signedredirect)/publicimageaudience/digestdeliverygates;retainedZIPsafetypins+expectedcount/FK/3sstatus+session+quarantinechecks;exclusivefilesystempublication/aged24hscratchscavenger;adminredactedscanalerts. RealClamAV1.4.3/daily28149clean+EICARPASS, but freshclamwarnsoutdatedvs1.4.6:patchedpin/freshnessmonitoring/adversarialcorpusremain. Read STORAGE_QUARANTINE_CHECKPOINT.md and currentstatus/validation/handoff. RemainingfullDTO/payload/compatibilitymigration;liveS3+actualkill+largevolume/multireplica;representativeload/abuse/manuala11y/independentreview;modelquality/retention;actualDocker/hostedCIedgealertdelivery/offsiteRPO/RTO. Ownercredentialsnotonlygap. No deploymentauthorized;builds/realengine/fullbrowsermustbeserialon2GBsandbox. NormalAPI/webpreviewonly;notautonomousbackgroundengineering.
