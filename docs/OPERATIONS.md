> **Current source:**118tests/25migrations. [STORAGE_QUARANTINE_CHECKPOINT.md](STORAGE_QUARANTINE_CHECKPOINT.md) supersedes dated historical counts/semantics below. NOT READY FOR PRODUCTION LAUNCH.

> **10 October 2026 current addendum:**112tests/22migrations. [PORTABILITY_STORAGE_COST_CHECKPOINT.md](PORTABILITY_STORAGE_COST_CHECKPOINT.md) supersedes historical102/20 counts and export/storage/cost/sitemap gaps below. Full launch remains NOT READY.

# Operations — 9 October 2026
**102 tests passed; NOT READY FOR PRODUCTION LAUNCH.** Local evidence is in VALIDATION_REPORT.md. Runbooks and workflows are not evidence that a deployment occurred.

## Development / test reproduction
Node22 recommended; PostgreSQL17/Redis; isolated development DB only. `npm ci`, configure `.env` from `.env.example`, `npm run db:generate && npm run db:migrate`; seed only development. Run `npm run api` and `npm run dev` separately. API is non-watch; restart after edits. Use exact APP_ORIGINS and browser-relative `/api`.

All102 tests require the dedicated provider API from INTEGRATIONS.md and `FIXTURE_API_URL=http://localhost:3004 npm test`. Provider preload is explicitly test-gated and must never be deployed. The full final suite was run against compiled API/built web. Static build cache is environment-sensitive; rebuild when changing INTERNAL_API_URL.

## Deployment preflight and container workflow
`node scripts/check-deployment.mjs` reads `.env.production` (override DEPLOY_ENV_FILE) without printing values, validates canonical HTTPS/domain/origin, SMTP and stable cursor keys, optional provider key combinations, privacy defaults, Docker availability and Compose syntax. Exit2 means BLOCKED; no containers, migrations or external deployment are started. This sandbox has no Docker daemon/configured production environment.

`deploy/compose.yml`: non-root web/API, private DB/Redis, migrations-before-API, persistent private files, Caddy TLS and exact trusted edge IP. Configure POSTGRES_PASSWORD,DATABASE_URL using postgres host,PUBLIC_APP_URL,APP_ORIGINS,APP_DOMAIN,SMTP_URL,MAIL_FROM,CHAT_POSITION_SECRET,EXPORT_CURSOR_SECRET and optional providers securely. Review EDGE_SUBNET/EDGE_PROXY_IP collision and trust only actual proxy IP. Never seed production. Versioned migrations001–020 only; large populated indexes need an approved maintenance/lock plan.

On an **authorized staging** host, validate config then use `docker compose --env-file .env.production -f deploy/compose.yml up --build -d`. Production builds target INTERNAL_API_URL=http://api:3001. No actual launch authorization is inferred from this command.

`.github/workflows/container.yml` and `deploy/compose.ci.yml` define a separate disposable smoke: ephemeral keys, fresh DB/migrations, built production app, readiness/public/private401/non-root checks and always-cleanup. No production credentials/domain/seed needed. YAML syntax checked here; Docker and hosted workflow not executed.

## Secret rotation
Generate independent stable server-only CHAT_POSITION_SECRET and EXPORT_CURSOR_SECRET>=32 random characters in a secret manager; share current key across replicas. Set previous value in corresponding `_PREVIOUS` during a <=24h rolling overlap, then remove. This preserves old signed chat/export/discovery cursors while issuing new signatures. Do not reuse provider secrets. Expired/tampered cursors trigger explicit restart rather than granting access.

AI_QUOTA_SECRET is separate and stable; changing it without ledger migration/grace changes quota identities. Live AI production fails startup without it. Review provider hard caps and retention before enabling; token reservations are not dollar guarantees.

## Health, metrics and monitoring
`/api/health` liveness; `/api/ready` DB plus configured Redis; Redis protection fails closed503. `GET /api/admin/operations` returns count-only queue health/alerts and bounded per-process route-template counters/latency buckets; reset on restart, not distributed tracing.

Monitor: `MONITOR_BASE_URL=https://your-origin MONITOR_SESSION=<secret> node scripts/check-operations.mjs`. Store these through a secret manager, not shell history or source. HTTPS required except localhost HTTP; rejects credentials/query in URL and redirects; validates fixed alert codes/numeric counts; never prints cookie/private fields. Exit0=healthy,2=queue alert,1=request/configuration/auth failure. Authentication expires: an operator-owned admin session must be renewed; renewal failure itself alerts. This is not a long-lived machine service credential.

Systemd templates: `deploy/projectconnect-monitor.{service,timer}`. On the authorized host create dedicated OS account `projectconnect-monitor`, install repository at `/opt/projectconnect`, provide `/etc/projectconnect/monitor.env` readable only by root/service account, install unit files, configure your alert system/journal forwarding or OnFailure unit, then enable timer. The service is read-only/no-new-privileges; check paths/runtime before installing. **Templates were not installed here.** CLI has mock exit/redaction/redirect tests and real admin/nonadmin endpoint tests. Trigger a known fixture alert in isolated staging and verify operator receipt before launch. External provider selection/credentials and alert delivery remain unexecuted.

Monitor redacted error codes: RATE_LIMIT_UNAVAILABLE,INTERNAL_ERROR,MAIL_WORKER_FAILURE,STORAGE_CLEANUP_FAILURE,MAINTENANCE_FAILURE,AI_LEDGER_RECONCILIATION_FAILED,AI_USAGE_EXCEEDED_RESERVATION,REGISTRATION_QUEUE_FAILED,RECOVERY_QUEUE_FAILED. Do not log bodies/cookies/prompts/OAuth queries/DB URLs. See THREAT_MODEL.md.

## Queues and retention
SMTP claims every15s, bounded retries/leases/backoff, body erased on success/exhaustion,7daycleanup. At-least-once can duplicate after crash; old links may be invalid by delivery. Storage every30s uses terminal deleting/pending markers and one-hour upload grace; durable retry, object references checked before deletion. Never delete queue entries to hide errors or make the object bucket public.

AI reconciliation every30s: partial-index batches<=500/source,10iterations/tick, global advisory lock, short transaction bounds. Reservations/deletions503 fail closed while recent backlog remains. Do not erase ledger or rotate key to bypass. Maintenance10min prunes expired sessions/OAuth/action tokens,48hquota identities,30dayGitHubreceipts,90dayreadnotifications. Owner must approve retention policy.

Public GitHub:200-entry process cache,5minfreshness,15minidleeviction,singleflight,shared50/hourupstreambudget,active refresh/minute,cooldown<=1h. Private installation-token cache is separate/revocation scoped. Maps results never enter this cache.

## Backup and restored-service check
`node scripts/verify-local-recovery.mjs` requires local DB/files, pg_dump/pg_restore/psql, local sudo-as-postgres, Python supporting tarfile data filter, GnuPG and compiled API. It creates disposable attachment/avatar/session fixtures; quiesce source mutations/workers where practical. No source restore/overwrite is performed.

It dumps DB, AES256 encrypts/decrypts with an ephemeral test passphrase, rejects wrong key/corruption, restores transactionally into unique DB, compares all40publictablecounts, encrypts/decrypts/extracts referenced file bundle, starts compiled API3005 using restored DB/files, verifies session/private attachment/avatar bytes and anonymous401, then removes fixtures/scratch data. Errors fail rather than claiming success. Current local run PASS. This is not an operational off-site backup command or a production key-management policy.

Production plan still requires coordinated write/snapshot boundaries, encrypted off-site DB+files/S3 versions, key escrow/rotation/access audit, retention/legal approval, periodic restore onto independent host, measured RPO/RTO and recovery ownership. Counts on a changing source can differ; repeat only after investigating/quiescing. Never restore over production without explicit authorization. Antivirus and legacy untracked-object inventory are not solved by backup tests.

## Local production / HTTPS validation
Build API then `INTERNAL_API_URL=http://127.0.0.1:3003 npm run build`. Start compiled API3003 with NODE_ENV=production, exact origins http://localhost:3002 and https://localhost:3443, stable random test cursor keys and private file directory. Start built Next on3002. `node scripts/verify-production-smoke.mjs` checks proxy/private/origin/cookie/CSP/publication and50requestburst.

Generate short-lived self-signed localhostSAN key/cert in excluded `.arena/local-test.{key,crt}` (key0600); run `PC_LOCAL_HTTPS_TEST=true node scripts/local-https-proxy.mjs`, then `node scripts/verify-https-browser.mjs`. Actual browser Secure-cookie/image/export/logout PASS with ignoreHTTPSErrors; not public trust/Caddy/provider certification. Stop auxiliaries and erase key/cert afterward. Rebuild normal preview to port3001, deployment to api:3001.

## Release
`npm run release` packages an explicit source allowlist; no actual environments, private files, dependencies/builds/caches/test reports/raw logs. Verify archive contents and SHA256. Do not deploy fixture preloads or TLS scripts as production startup. Keep source/tests for reproducibility but never expose them as public server routes. No background engineering continues after the turn.

## Portability/storage/AI additions (10 October)
- `npm run storage:inventory` is dry-run. Review counts/unknown keys first. `npm run storage:inventory -- --apply` queues only recognized random keys older48h plus1hgrace; never directly deletes. Needs local read or S3 ListBucket permissions. Unknown legacy formats require a separately reviewed reconciliation plan, not automatic deletion.
- Production uploads require `CLAMD_HOST`/`CLAMD_PORT`; absent/bad/infected/timeout scanner returns error, no object publication. clamd is unauthenticated: private network only, never expose3310 publicly. Compose supplies scanner/signature volume/health prerequisite but was not executed. Monitor freshclam signature freshness, resource limits and startup delay before enabling uploads. Legacy objects were not retroactively certified clean: implement/review rescan/quarantine gate before importing old content.
- Export worker ticks10s, database-wide lease180s, build120s/DB60s limits; pending/building/ready/failed/expired state, attempts fence stale builders. Pins/cleanup prevent removed uploads disappearing from a committed snapshot. ZIP24hexobject key, byte digest,24hTTL and requesting-session binding. Failed artifacts retain cleanup marker. Expired quota tombstones preserved for24h. Process-crash scratch dirs `.export-tmp-*` must be identified on the private volume and removed only after confirming no live builders; automatic crash scratch scavenging remains engineering follow-up. Source archive excludes them.
- Before production live AI set matching `OPENAI_MODEL`/`AI_PRICING_MODEL`, explicit integer `AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION`, user/project/global microUSD budgets and stable identity secret. Example ceiling10,000,000 is$10/million, not live vendor price. Review billing input/output/reasoning/cache rates; pricing ceiling must cover all. Token-based maximum input/output guards and durable rolling24hledger remain; cancelled/failed/unknown calls aren't refunded. Conservative per-row repricing protects old records/price changes; repeated overruns mean disable provider and investigate.

## Current storage scan/quarantine workflow — 10 October 2026
See STORAGE_QUARANTINE_CHECKPOINT.md (118tests/25migrations). Before enabling production downloads, deploy migrations, start a **patched private scanner with fresh verified signatures**, then inspect `npm run storage:rescan`. No public clamd port: protocol has no authentication. Installed local1.4.3 is outdated vs recommended1.4.6; local EICAR PASS does not approve that engine for production. Compose stable tag remains unpinned/unexecuted. Confirm image digest/CVE patch/support/signature timestamps; test update failures and recovery before launch.

`CLAMD_HOST=<private-host> CLAMD_PORT=3310 npm run storage:rescan -- --apply --run` explicitly queues pending/error/failed/development rows and processes at most1000 in this CLI invocation. API worker10s/tick one object,30s DB lease,10s socket/wall cap, five unavailable attempts then failed. Dry-run is read-only. Apply invalidates delivery while rechecking. `--include-clean` opts in currently clean objects; `--include-quarantined` retries quarantined objects but **never overrides infection or prior digest**. No user/admin HTTP clean override. Large inventories require batching/capacity plan and maintenance/alerts; don't run blanket clean rescan casually on a live service.

Quarantine keeps immutable bytes private for authorized operator investigation; never download/execute suspected content on app origin, expose clamd or manually set database clean. Changed trusted digest cannot be promoted; delete and re-upload normal validated bytes. Authorized file uploader/owner can delete; retired image replacement/deletion uses durable cleanup. Retention/legal policy is owner-approved, not invented here. Admin operations expose only aggregate scan failures/pending/quarantine; monitor recognizes SCAN_FAILURES/OBJECT_QUARANTINE/SCAN_BACKLOG. External alert delivery/freshness monitoring remains a gate.

Migrations23–25 queue legacy objects and expire all incompatible old export jobs. Artifact cleanup markers expedited; user requests a new export after scans. Ready export safety pins retain scan state, not source bytes after build; expiry/cancel releases them. ZIP download later quarantine/missingpin/status/session blocks or interrupts within periodic3s check—not recall of bytes already delivered.

Export scratch lives beneath LOCAL_FILE_DIR/private root, mode0700; recognized `.export-tmp-XXXXXX` directories older than24h scavenged (also legacy CWD roots), symlinks/unknown/fresh left alone.10kentry cap per invocation can starve late entries in huge flat roots; operator inventory/partitioning required. Local publish exclusive hard-link requires same filesystem; implemented scratch placement ensures this. S3 publish remains conditional PUT, never public bucket. Keep all storage roots server-owned/private. Actual kill/restart/high-volume/S3 testing remains.

Resource reproduction: full downloaded ClamAV signatures consume ~1GB; run builds, scanner checks and browser tests serially in2GB sandbox. `scripts/verify-clamd-local.ts` expects local private daemon127.0.0.1:3310; real benign/EICAR verification only. Packages/signatures/dependencies do not persist in source snapshots; recreate from approved supported tooling. Do not publish `.arena/clamav`, actual signatures or private bytes.
