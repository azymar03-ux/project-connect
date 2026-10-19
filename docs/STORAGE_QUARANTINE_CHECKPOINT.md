# Storage quarantine and recovery checkpoint
10 October 2026 · **118 passed / 0 failed / 0 skipped · 25 migrations**

## Launch decision: NOT READY FOR PRODUCTION LAUNCH
This checkpoint supersedes PORTABILITY_STORAGE_COST_CHECKPOINT.md for current source. The full autonomous launch contract remains active. No production publication, expenditure or credentials were used. The engineering work below is complete to its stated local test scope—not the full product launch contract.

## Implemented and locally verified
- **Persistent scan state:** StorageScan records are keyed by immutable private object key, independent of live file/image metadata. Migration queues legacy files and images as pending with no trusted digest; it never declares old bytes clean. States: pending, scanning, clean, development-unscanned, error, failed, quarantined. DB constraints bound size and digest format. Production never permits development-unscanned bytes; its worker rescans them with the configured private engine.
- **Upload provenance and integrity:** scan original attachment/avatar/cover bytes before decoding; scan final stored bytes again after normalization. SHA-256 binds the stored bytes to the verdict. Production upload fails closed without scanner. Non-production unscanned status is explicit, not antivirus protection.
- **Quarantine/rescan:** durable claim with PostgreSQL SKIP LOCKED, 30s lease, monotonically increasing generation fencing, database-clock commit check, retry backoff and terminal failure after five unavailable attempts. Malware and changed digest quarantine; delayed old worker cannot overwrite a newer verdict. Operator CLI dry-runs by default; explicit apply/retry does not erase the prior trusted digest or manually mark clean. Clean/quarantined rescan is opt-in. Changed bytes cannot be promoted by simply rescanning: preserve for investigation, delete/re-upload through the normal guarded pipeline.
- **Delivery enforcement:** project-file and image responses use exact-size, bounded object reads and verify digest/status. File routes recheck session/membership/live metadata after retrieval; public image audience rechecked. S3 attachments now proxy through the same authorized API instead of issuing a 60-second signed redirect that could outlive quarantine/revocation. Pending/error/failed/quarantine bytes are blocked; member file list exposes status but no storage key. UI shows verification/quarantine and refresh control, with unavailable download disabled. Delete remains available to authorized uploader/owner.
- **Export safety dependencies:** snapshot records each byte object's trusted digest and expected pin count; refuse unverified content. Ready jobs retain pins until expiry/cancellation, with FK restricting deletion of associated scan state. Pins remain safety dependencies but do not retain retired source bytes after build. ZIP publication locks scan rows and rechecks verdicts/digests/count. Download checks them initially, after storage retrieval and every 3 seconds alongside session, job status and expiry. Later quarantine/pin loss invalidates a ready ZIP. Already downloaded bytes cannot be recalled; streamed delivery checks are periodic, not instantaneous linearizable revocation.
- **Upgrade safety:** old ready/building exports lack retained trustworthy scan dependencies. Migrations expire them and schedule their artifacts for cleanup; users request a new snapshot after scan verification. Never allow an empty NOT EXISTS result to bypass missing pins/count.
- **Crash scratch cleanup:** private export scratch now lives on the configured private-storage filesystem; local artifact publication uses exclusive hard link, never overwriting a colliding key. Worker scavenges recognized scratch directories older than 24h from current and legacy roots. Fresh directories, unknown names and symlinks are untouched. 10k entries inspected per invocation; heavily populated flat roots may need an operator sweep/partitioning to avoid starvation. Age-based fixture is not an actual killed-at-every-instruction process test.
- **Operations:** admin aggregate counts for pending scans, scan errors/failures and quarantined objects, plus corresponding monitor alert codes. No bytes, names, hashes, object keys or private identities emitted. Worker logs use redacted failure codes. Alert delivery remains unexecuted externally.

## Executed checks
| Check | Actual result / evidence in docs/evidence |
|---|---|
| Full rebuilt browser/API/provider fixtures | **118 PASS / 0 failed / 0 skipped / 1.8m**, tests-continuation3-validated.log |
| New security regression coverage | Six additional tests: legacy/failed/clean/mutation, malware/fencing, ready ZIP revocation/missing pins, unsafe snapshot/public image, scratch/collision, operations privacy |
| Real local clamd adapter | **PASS** benign accepted and EICAR standard test string rejected400; persistent legacy worker also marked benign clean+trusted digest and EICAR quarantined, fixtures removed; engine `ClamAV 1.4.3/28149/Sat Oct 10 06:24:04 2026`, clamd-real-continuation3-validated.log |
| Signature download | Freshclam downloaded and tested daily28149/main63/bytecode339, freshclam-continuation3.log |
| Fresh/upgrade migrations | **25 checksums PASS; 20→25 legacy AI + file/image pending; 22→25 old export invalidation/cleanup PASS**, migration-upgrade-continuation3.log |
| Encrypted local recovery | **43 public tables** including scan state; restored API readiness/session/file/avatar digest/private anonymous denial PASS, recovery-continuation3.log |
| API/web build, strict types | api-build-continuation3-validated.log, web-build-continuation3-validated.log, types-continuation3-validated.log PASS |
| Format/lint/contracts | format-continuation3-validated.log, lint-continuation3-validated.log, contracts-continuation3.log PASS |
| Dependencies/source | audit-continuation3.log:0 known; source-continuation3.log:177 selected-pattern files clean, 397 locked packages / 2 missing license metadata |
| Rescan CLI dry-run | rescan-dryrun-continuation3.log: no changes; CLI apply/runtime remains separately bounded, not real production inventory |
| OpenAPI | openapi-continuation3.log:111 paths / 137 operations, payload schemas partial |

## Failures corrected, not hidden
1. Installed clamd is in /usr/sbin, not shell PATH; restarted with absolute path.
2. Running the full signature-loaded engine (~1GB) with a TypeScript compiler exhausted ~2GB sandbox memory. Interrupted compiler was not counted as passing; killed resource-heavy processes, built serially, then ran engine validation separately. Do not run clamd alongside builds/full browser suite in this sandbox.
3. Two new TS CLI scripts initially used top-level await incompatible with this CommonJS tsx layout; wrapped in async main and reran the real-engine verification successfully.
4. First focused suite:14PASS/1failure because standalone web lacked PUBLIC_APP_URL; sitemap correctly returned503. Restarted with explicit local canonical URL, then full suites117PASS and final118PASS. No assertions weakened/skipped.
5. A migration-check script quoting SyntaxError was corrected before execution; fresh/20→25/22→25 checks then passed and scratch databases removed.

## Remaining engineering (not owner-only tasks)
Complete shared DTO/client/payload-OpenAPI and compatibility-list audits. Real S3/S3-compatible immutable/range/late-PUT/retirement/pin behavior and deployment network security; actual process-kill and representative large-export/crash/multi-replica load tests. High-sample enumeration/abuse, manual assistive-tech and independent security review. Model/citation/safety/retention evaluation. Executed Docker/hosted CI/Caddy/edge, external alert delivery/tracing/off-site restored-service RPO/RTO. Real scanner effectiveness under adversarial corpus, regular signature freshness monitoring/failure drills, supported patched image pinning, production inventory throughput/operational retention remain launch gates.

Freshclam explicitly warned that installed **1.4.3 is outdated (recommended1.4.6)**. This records real-engine/EICAR evidence, not acceptable patched production release assurance. Compose still uses mutable stable tag and has not been executed. Do not claim malware certification, scanner patch compliance, exhaustive race safety, WCAG certification, off-site recovery or production capacity.

Owner-only hosting/domain/secrets/provider accounts/billing/legal/model-price approval and publication authorization remain separate. No autonomous engineering continues after this finite session; local preview services are not engineering workers.
