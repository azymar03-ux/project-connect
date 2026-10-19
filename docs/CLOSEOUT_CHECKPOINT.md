> Historical102-testcheckpoint. Superseded for current source by [PORTABILITY_STORAGE_COST_CHECKPOINT.md](PORTABILITY_STORAGE_COST_CHECKPOINT.md):112tests/22migrations/10October2026.

# ProjectConnect — reliability and operations checkpoint
9 October 2026 · **102 passed / 0 failed / 0 skipped** · **NOT READY FOR PRODUCTION LAUNCH**

This is the current engineering checkpoint. It supersedes historical counts and limitations in COMPLETION_CHECKPOINT.md and EXPANSION_CHECKPOINT.md. The full launch contract remains active; this document does not redefine unfinished scope as complete.

## Implemented and locally verified in this continuation

### Chat recovery and delivery
- DM and project conversations have session-bound, HMAC-signed timestamp/ID positions that survive deletion of the boundary row. Bounded forward catch-up does not silently discard a large gap. Expired positions explicitly reset to recent history; earlier unread history must be loaded before read-through acknowledgment.
- DM paging uses two ordered indexed directional reads and merges at most 202 rows, instead of an OR across both directions that could force a large sort. Each response is bounded; no 10,000-message catch-up cutoff.
- Shared in-flight request ownership prevents duplicate sends when switching away and back. Random request IDs are scoped to user + DM/project audience; same ID/different content conflicts require explicit text re-entry. Late completion cannot clear a different conversation.
- Only request ID/timestamp metadata is saved in sessionStorage, for at most 24 hours. **Private message text and hashes are not persisted.** After reload, the server is queried for committed status; already committed messages are not resent. Unknown delivery can be retried explicitly with the original text and same ID. Logout clears metadata. Discard is never treated as successful delivery.
- Read-through acknowledgment is post-render, visibility-aware, single-flight and bounded by timeout. Errors are visible with a retry control; reconnect retries. Completion is scoped to the current conversation. An already transmitted PATCH can still commit after client abort; it cannot be undone.
- Chat HTTP calls have a 15-second timeout. Delivery failures remain unconfirmed, not fabricated success. Polling (four seconds while visible, explicit reconnect) is the documented fallback; no push realtime or offline plaintext outbox is claimed.

### Maps, GitHub and AI engineering
- Maps loader callback/error/timeout cleanup, fresh retry, explicit opt-in, marker/listener disposal, separate attributed list and automated accessibility fixture coverage. Optional Places contact/hours fields default off behind a billing-sensitive setting. No Places response persistence/cache.
- Public GitHub metadata: bounded 200-entry in-memory cache, five-minute freshness, 15-minute idle eviction, single-flight reads, active scheduled refresh, shared Redis 50/hour upstream budget and bounded rate-limit cooldown. No private token is sent. Resource approval/URL/session are rechecked after fetch.
- Private GitHub installation tokens are repo/grant scoped, ephemeral, single-flight and invalidated on lifecycle changes; post-fetch membership/link revision/grant checks remain. Provider HTTP fixtures now also exercise public resource metadata and revoked approval.
- AI SSE backpressure settles on drain/timeout/abort with listener cleanup. Stalled upstream cancellation and oversized-body cancellation cannot hang the request waiting for the provider's cancel promise. Existing private conversation, quota ledger, consent, cancellation and roadmap fixtures are preserved. No model-authorized tools or fabricated verified citations.

### Recommendations and operations
- Explainable fit-v2 ranking adds explicit interests and visible recent public activity to skills/city, with capped contributions and SQL/JS parity tests. No private chat, online status or sensitive inferred traits. Signed actor/filter/profile-bound cursors fix the activity time window and expire in 30 minutes. See RECOMMENDATION_EVALUATION.md for exact semantics and unmeasured quality.
- Bounded process-local route telemetry and aggregate admin queue alerts; monitor CLI tested for healthy/alert/failure exit codes, redirect rejection, credential redaction and actual admin/nonadmin authorization. Systemd one-shot/timer templates are supplied, **not installed or externally alert-connected**.
- Deployment preflight fails closed, validates required production configuration without printing values, and checks Docker Compose when available. Disposable container CI workflow and isolated compose smoke are supplied; YAML parses, but **Docker and hosted CI were not executed here**.
- Stable 32+ character chat/export signing keys required in production; optional previous-key overlap supports rotation. Discovery uses the export key ring with a separate HMAC purpose. AI uses its separate stable quota identity key.
- Recovery now encrypts/decrypts a complete DB dump and referenced-file bundle, rejects a wrong password/corrupted dump, restores all 40 public tables, starts the restored compiled API and verifies session identity, attachment/avatar SHA-256 and anonymous private-file rejection. All test keys/dumps/certs/fixtures are erased. This is **local**, not an off-site/S3/PITR/RPO/RTO certification.

## Latest checks
- Full browser/API/provider suite: **102/102, 1.6 minutes**, using compiled API and built web; no skips.
- Format, lint, strict TypeScript, API build and production web builds: PASS.
- All 20 migrations on fresh disposable DB: PASS; installed checksums: PASS.
- Dependency audit: 0 known vulnerabilities at execution. Selected credential scan: 147 files clean. 396 license records; two missing lockfile labels are documented MIT installed notices, not unknown legal approval.
- Local natural-plan experiment: 10,000 messages per table, bounded 101 rows, indexed direction 1.235 ms; project forward 1.829 ms. Not endpoint sustained-load/SLO proof.
- Production built-proxy smoke: 50 requests, concurrency 10, all 200; p50 42 ms / p95 94 ms. Not a production capacity guarantee.
- Chromium self-signed HTTPS login/Secure cookie/private fetch/image/export/logout: PASS. Not public certificate trust or Caddy/provider validation.
- Exact commands/log names are in VALIDATION_REPORT.md.

## Corrections found and resolved
The directional DM merge initially lacked an explicit TypeScript type. Earlier compound shell commands continued after build/type errors; their final shell exit must not be read as a pass for every command. The final named checks above ran fail-fast and passed. A root typecheck was killed under memory pressure with multiple services running; stopping auxiliary services allowed the complete strict check to pass. Temporary worker failure logs during that pressure are not hidden; fresh subsequent validation services stopped without error logs.

The old query-plan script assumed the optimizer must select one specific valid index on tiny data. It now checks catalog validity and reports actual selection separately; the scaled natural-plan experiment remains independent. The first ranking regression expected no activity bonus, but project creation emits a public update. The expected fit-v2 score was corrected to 95 and an activity-reason assertion added, then the entire suite rerun. No required tests were skipped to make the result green.

## Still unfinished — not only owner credentials
1. Fully shared typed client/API schemas/OpenAPI; consistent asynchronous and byte-inclusive portability export; large sitemap partitioning and some compatibility-array limits.
2. Comprehensive assistive-technology/manual accessibility, statistical enumeration/abuse measurement and independent security review; exhaustive multi-replica authorization/revocation races.
3. Legacy untracked-object inventory/reconciliation and production malware/scanning workflow; larger-dataset recommendation/AI aggregation and sustained endpoint/load evaluation.
4. Price-denominated AI controls/model-quality and citation/retrieval evaluation beyond the deliberately no-tools/no-retrieval product, live private GitHub/Maps/OAuth/SMTP/AI/S3 verification and provider retention review.
5. Executed Docker/Caddy/hosted CI/staging, external monitoring/tracing/alert delivery, coordinated encrypted off-site DB+files restore/keys/RPO/RTO and production incident drills.

Owner-only prerequisite decisions remain in MANUAL_SETUP.md. The above unfinished engineering is not transferred to the owner by that list. No purchase, external deployment or public launch was authorized or performed.
