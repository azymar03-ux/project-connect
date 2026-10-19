> **Current source:**118tests/25migrations. [STORAGE_QUARANTINE_CHECKPOINT.md](STORAGE_QUARANTINE_CHECKPOINT.md) supersedes dated historical counts/semantics below. NOT READY FOR PRODUCTION LAUNCH.

> **10 October 2026 current addendum:**112tests/22migrations. [PORTABILITY_STORAGE_COST_CHECKPOINT.md](PORTABILITY_STORAGE_COST_CHECKPOINT.md) supersedes historical102/20 counts and export/storage/cost/sitemap gaps below. Full launch remains NOT READY.

# Architecture — 9 October 2026

> **Current: 102 tests passed, no failures/skips; 20 migrations.** [CLOSEOUT_CHECKPOINT.md](CLOSEOUT_CHECKPOINT.md) and [VALIDATION_REPORT.md](VALIDATION_REPORT.md) supersede historical limitations below. NOT READY FOR PRODUCTION LAUNCH.

Next.js App Router/React/strict TypeScript; NestJS controllers; PostgreSQL17/Prisma; ioredis shared limits. Public navy/cyan/purple maker UI, original SVG concept covers. Feature controllers cover account/OAuth/discovery/social/workspace/team/invitations/files/resources/GitHub/stores/AI/moderation. Legacy auth and some project APIs remain in main.ts; full typed client/OpenAPI modularization is incomplete.

Twenty ordered forward migrations001–020 cover baseline, accounts/social/feed moderation, task labels/versions/lifecycle, durable storage queue, OAuth identities/state and preferences. Never re-baseline existing production databases or use schema push for deployment.

## Identity/permissions
Opaque32-byte session cookie, hashed DB state, expiry8h, revocable. Google OIDC adapter has fixed HTTPS destinations, PKCE/nonce/state/JWKS validation and explicit current-session account linking. Provider-only accounts have an unknown random password with passwordSet=false; recovery establishes password before unlink. Public profiles/project owners/members serialize through PUBLIC_USER. Production verified-publication middleware defaults on.

Ordered User NO KEY UPDATE locks precede Project FOR UPDATE. Shared read-committed project writes query authorization/capacity/assignees after lock wait, avoiding mixed snapshot anomalies. Serializability helper remains for token/AI quota transactions. Task version prevents stale editing/order; owner transfer/removal audit rows. Not every possible transaction race has been exhaustively covered.

## Discovery/routes
Parameterized PostgreSQL CTE ranks explainable skills/interests/city/visible public activity fit and performs bounded keyset paging; escaped ILIKE search; explicit filters and actor/filter-bound cursor. Client debounce/generation guards prevent stale list replacement. Shareable `/projects/[id]` and `/people/[id]`; no-cookie server metadata requests cannot expose archived/private project names. Public-only sitemap bounded1000 projects and robots excludes API/account. Large-data index/sitemap partition/evaluation work remains.

## Storage/queues
Private random local keys or S3-compatible adapter, attachment-only downloads; decode/re-encode image safety and UTF-8 text validation. StorageDeletion pending marker precedes object write, locked during publish; cleanup atomically claims terminal deleting state via SKIP LOCKED. Project/account/file deletion removes metadata and enqueues key in same transaction. Worker retries crashes/failures with bounded backoff. API process runs worker30s; this is not antivirus or a full object-store disaster recovery solution.

Transactional private email outbox, one-use fragments in email links, SMTP worker15s, five attempts and seven-day outbox retention; at-least-once send may duplicate after worker crash. Live SMTP concurrency/delivery/alert tests remain.

## Social/AI/integrations
Follow/block/connect/message ordered-pair locks, activity author quotas, public feed moderation and recipient notifications. Preferences suppress new alert categories. Direct chat keyset latest-history/read-through, client merge/generation/visibility guards; project chat documented polling fallback. No push realtime/project unread semantics yet.

LLM adapter produces schema-validated bounded roadmap JSON and no tool calls; no-key templates explicitly labeled. Daily quota reservations count deleted content tombstones; import locks project and rejects archived/deleted plans. Streaming/conversation/cancel UX unfinished. GitHub metadata destination fixed api.github.com, bounded body/cache/timeouts; no full GitHub App/webhooks. Community hardware database/relative plot is not Google Maps; live Maps/Places unfinished.

## Operations
Same-origin relative browser API; dev binds0.0.0.0 with exact preview host allowlist; production exact origins/secure cookies/private compose/edge trust. Next rewrites are build-sensitive: rebuild with correct INTERNAL_API_URL for target. Local production smoke built with API3003; deployed Docker uses api:3001. Non-root Docker scaffold, migrations job/health checks/Redis persistence, not yet container/HTTPS/CI-tested. Technical license inventory includes LGPL/MPL; legal approval pending.


## Integration extension
Migrations013–015 addAiConversation/AiTurn,ProjectChatRead,GithubLink/GithubDelivery,AdminAudit,UsersuspendedAt,AiUsageledger and orderedlookupindexes. Assistantcontroller separatesboundedproviderSSE,eventparser,transactionalbudget/state;quota locks serialize across replicas,contentprivate,deletiontombstones plus short-livedidentityledger. Placesadapter explicitsearch/no contentcache;optionalbrowserSDKclearlypublickey. GitHubAppprovider scopedreadtokens,rawbodyHMACwebhook,minimalaudit. Adminusercontroller/sessionlocks+maintenance;outboxcore injectable send function for local retryfixtures. `docs/INTEGRATIONS.md` is preciseAPI/semanticsreference.
Tests/provider-fixture.cjs isexplicitNODE_ENV=test-onlypreload blocking unexpected outboundfetch;RSA Googleidentity/HTTPcallback,AIstreamcancel,Githubwebhooks,Placessearch testedthrough actual NestHTTP endpoints. Not an application startup dependency or live-providerproof. CIstartsfixtureAPI; hostedCIunexecuted.
LegacyglobalAIbackfill/queryplan,sharedDTO/OpenAPI,backgroundintegrationrefresh,offline/send-idempotency/pushrealtime,tracing andlargeexportremainunfinished. Publicmembershiphelpersindependentlyloadboundedpages upto1000;notinfinite-scaledclient.

## Current image/export/ledger architecture
Migrations019–020 addPublicImage withuniqueUseravatar/ProjectcoverRESTRICTpointers,sourcequotaLedgeredpartialindexes and scoped exportindexes. Imagecore ownsbounded decode/derivative/stage/claim/retire/read;controller enforces user/projectauthorization andaudience recheck,workerreferencecheckextends attachments. Profile/projectuploadcomponent and per-sectionexportcomponent integrated,not separate mock screens.
Exportcontroller constant23-sectionregistry,signedsessioncursor keysetread,last-sessioncheck,row/serialized-sizebounds. Newaccountsummarylinksavailablepager. Notcross-pageSnapshot orbyteportabilityjob.
Ledgerworker commitsboundedpartial-indexbatches independently,reservationindexedEXISTSfailclosed,deletionmaterializesbeforeidentity/associationerasure,expiredsourcesdrainwithoutledgerrecreation. Globalbudgets stillaggregate24hrecords under advisorylock,notcheapmaterializedcounters atproduction-scale. Current chat alreadyhasunread/idempotency/catchup and assistant/GitHub fullHTTPfixtures;older architecture paragraphs describingtheseasabsent arehistorical,supersededbyINTEGRATIONS/COMPLETION/EXPANSIONcheckpoints.

## Current reliability components
`core/recommendations.ts` defines fit-v2 SQL/JS arithmetic; fixed-time signed discovery cursors do not promise a snapshot. `core/chat-position.ts` provides deletion-independent session-bound positions; `useChatDelivery` owns bounded metadata-only retry state and shared in-flight requests; `useChatReadAck` owns visible/error/retry/read-through state after rendering. DM paging merges two bounded directional index reads.
`core/github-metadata.ts` is public-only bounded cache/singleflight/shared upstream budget/background refresh; `github-token-cache.ts` is separately private and grant/revocation scoped. `stream-write.ts` bounds client backpressure; `event-stream.ts` settles cancellation without waiting for hung upstream cancellation.
`core/telemetry.ts` stores bounded aggregate route-template counters in one process; no distributed tracing guarantee. `scripts/check-operations.mjs` is a tested read-only monitor, with uninstalled systemd templates. `deploy/compose.ci.yml` and container workflow are disposable smoke scaffolds, not executed deployment proof.

## Storage safety dependencies — 10 October 2026
StorageScan keyed independently by immutable object key (size/status/trusted SHA-256/scannedAt/attempts/dueAt/lease/generation/error). No filename/user body logging. Legacy files/images migrated pending, final stored upload bytes scanned. Network scans outside DB transactions; claim SKIPLOCKED and commit generation+DBclocklease fenced. Export pins carry trusted digest+FK and snapshot expected count; ready pins retained as delivery dependencies until expiry/cancel. Artifact publication scan SHARE locks prevent concurrent verdict mutation during commit. Deletion retains build bytes only, preserving post-snapshot retirement semantics; scan row deletion restricted while ready pin references it.

File/image reads use exact bounded private object reader and digest/status/audience checks; S3 attachment API proxy replaces redirect. Local export scratch on same private-volume filesystem, exclusive link publication, aged24h recognized scratch scavenger. Admin monitor redacted aggregates. Real engine local EICAR verified; outdated package warning means patched/pinned deployment/freshness controls remain. See STORAGE_QUARANTINE_CHECKPOINT.md for118tests/25migrations/43table recovery and unresolved scale/provider gates.
