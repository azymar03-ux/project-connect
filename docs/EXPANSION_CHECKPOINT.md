# Images, account exports and quota ledger — 9 October 2026

## Decision
**78 passed · 0 failed · 0 skipped · 1.6 minutes. NOT READY FOR PRODUCTION LAUNCH.** The complete product contract remains active, not redefined as an MVP. This is a saved engineering checkpoint, not a finished or error-free launch claim.

## Completed in this continuation
### Profile photos and project covers
- Added upload/remove controls to the profile editor and owner project editor; avatars render throughout the main profile/people/owner/member views. Project discovery/details use uploaded covers. Concept illustrations remain available and selecting one retires the uploaded cover; unrelated settings edits preserve it.
- Uploads accept fully decoded PNG/JPEG only, at most5 MB/16 megapixels/8192px; animation/APNG/SVG rejected. Auto-orient, center crop, flatten, strip metadata/EXIF/GPS, encode only a JPEG derivative: avatar256×256, cover1600×900; derivative≤2 MB. At most4 concurrent decodes per API process; saturation429, processing timeout8s.
- No original filename/bytes/metadata stored. Random48hex object keys never returned to browsers; random32character image IDs identify authorized API reads. Same private local volume/S3 adapter as attachments, no public bucket or CDN cache.
- Image GET is private/no-store, inline image/jpeg/nosniff/same-origin CORP. Fetches bounded bytes and rechecks current session/image ownership/audience after object retrieval. Avatars hidden for suspended/pending identities and signed-in blocked peers. Cover audience follows project rules: archive/suspended owner only visible to co-members; pending owner hidden; blocked outsiders hidden. Logged-out viewers can see otherwise public images—blocking is not secrecy from logged-out users, and co-members are not removed by blocking.
- Auth guard runs before multipart processing. Production verified-email publication gate includes image uploads. Avatar writes use existing authenticated per-user write limits instead of exhausting credential/recovery IP quota; IP abuse preguard remains.
- Durable cleanup marker precedes object write; publish locks pending marker, terminal deleting claim rejects late publish. Replacement/removal/concept reset/account deletion/project deletion/activation reconciliation retire metadata and queue bytes transactionally. RESTRICT parent-image references protect against forgotten delete paths; worker checks both attachments and image references before deleting objects. Failure preserves one-hour remote-write grace. S3 late-write/real object lifecycle is not live-tested.

### Paginated private account export
- Compatibility `/api/account/export` remains a bounded summary and now links to the section/page alternative. Do not mistake its legacy bounds for complete export.
- `/api/account/export/sections` lists23 sections. `/page?section=...&limit=1..100&cursor=...&download=true` supports live keyset paging without a total-row cap, with explicit2 MB serialized-page ceiling (413: reduce page size).
- Covers profile, authored projects/resources/stores/activity, membership/applications, own sent direct/project messages, plans/private assistant conversations/turns, notifications, outgoing follows/blocks, file metadata, saves/votes/favorites/invitations/reports/connections. Received messages, peer blocks, credentials/sessions/OAuth/recovery secrets, quota identities and private storage keys excluded. Attachments/images are metadata only, not a full byte-inclusive portability bundle; assigned tasks, legal audit records and every possible data-subject artifact are not claimed.
- Cursor HMAC uses current opaque session secret, binds user + section + last key + one-hour expiry. Another session/user/section, tampering and expiry cannot authorize a page; every query remains independently owner-scoped. Final session recheck before returning. Cursors are not credentials and are usable only within the originating authenticated session.
- Browser downloads each page separately, shows completion/restart and lower page-size choices. No unbounded whole-account browser buffer. Retrying a failed page is supported; browser download confirmation isn't an exactly-once durable export job.
- **No cross-page snapshot:** ongoing insert/delete/edit can alter results. Restart to obtain a current copy; truly consistent asynchronous snapshot/byte-inclusive portability remains engineering work. Migrations add scoped keyset indexes.

### AI ledger reconciliation
- Removed request-time global recent-ledger-ID scan and large `NOT IN` query. New sources create ledger rows and `quotaLedgered=true` atomically.
- Migration019 marks already ledgered/expired source rows; partial indexes cover recent unledgered work. Dedicated30s worker commits batches≤500 per source, up to10 batches/tick, global advisory lock984513, lock timeout2s and transaction timeout10s. Old sources age out of the work queue without recreating expired identities. Maintenance retains existing48h identity-ledger expiry.
- Reservation uses indexed `EXISTS` and fails closed503 while any recent source remains unreconciled. Worker commits independently so a quota rejection cannot roll back reconciliation forever. Operator can run `drainQuota` before enabling live AI after upgrade. This is bounded reconciliation, not a preaggregated high-scale global budget counter.
- Account deletion materializes recent legacy usage under existing user/project then global lock before erasing/anonymizing identity. Conversation/project deletion materializes before detaching association. Deletion work≤1000/source; larger backlog503 retains all content and asks retry while worker makes progress. Legacy turn cost honors max(conservative14k,reserved,reported actual).
- Worker never takes user/project row locks or inserts FK-constrained ledger references after the global lock; prevents reversed user/global lock ordering with account deletion. Tests cover concurrent worker/deletion and project detach. Identity rows retain HMAC/counters, no prompt/content; email alias/Sybil resistance and dollar-priced/provider caps remain incomplete.

### Local HTTPS validation
- Added explicit-test-only loopback TLS proxy and Chromium smoke harness. Generated one-day self-signed cert/key in excluded `.arena`, stopped harness and erased both afterward.
- Real Chromium stores/sends Secure+HttpOnly+SameSite=Lax cookie, private authenticated fetch works; avatar upload/inline fetch/remove, paginated export download and logout/session revocation PASS against production API/build.
- **Scope:** browser uses `ignoreHTTPSErrors` for self-signed local TLS. This is not public trust/certificate renewal/Caddy/hosted deployment/Google OAuth/live email certification.

## Migrations and validation
-20 migrations001–020 deployed to current and fresh disposable database; checksums verified. Migration019 image references/ledger marker/partial indexes;020 scoped export indexes. Existing populated tables need maintenance/lock planning; indexes are not `CONCURRENTLY` built. Never schema-push/rebaseline production.
- Final78/78 suite includes10 new tests in `tests/expansion.spec.ts`, existing68 preserved; external HTTP fixtures enabled. New account/export controls scanned with axe: no serious/critical automated findings in tested state, not full WCAG certification.
- Clean `npm ci`, Prisma6.12 generate, Prettier/lint/strict types/API+Next16.4 production build PASS. `npm audit`0 known vulnerabilities; selected credential-pattern scan129 files clean;396 license records with2 metadata gaps. Not comprehensive security/legal audit.
- Fresh20/20 migration check PASS. Forced index-availability checks for partial quota and scoped Message/Project export paths PASS; tiny dataset/seqscan-off is not natural planner choice or production latency.
- Local recovery22 selected table counts match;1 actual attachment and1 avatar derivative sizes/SHA256 match isolated restored DB/copied local volume. Not restored app download/S3/off-site/PITR/RPO/RTO.
- Built web3002→production API3003 smoke PASS private reads/exact origin/cookies/neutral signup/CSP/verified publication.50 requests/concurrency10 all200, p50 **35ms**, p95 **59ms**. Sandbox smoke, not service SLO/load certification.
- Actual runtime Node20.20.2, PostgreSQL17.11, Redis8.0.2; Node22 recommended for deployment.
- Final evidence: `docs/evidence/tests-expansion-final78.log`, `format-check-expansion.log`, `lint-expansion.log`, `types-expansion.log`, `api-build-expansion.log`, `web-build-expansion.log`, `fresh-migrations-expansion.log`, `query-plans-expansion.log`, `recovery-expansion.log`, `production-smoke-expansion.log`, `https-browser-expansion.log`, `audit-expansion.log`, `release-check-expansion.log`.

## Corrections encountered, not hidden
Initial browser tests could not start because cache/runtime restore lacked Chromium; installed browser/dependencies. New UI tests found ambiguous file-region label, implicit select label text containing options and wrong Settings button name; corrected accessible labels/selectors. A timed-out fixture was removed with exact fixture-prefix guard. Expanded full-suite account-security429 exposed avatar routes sharing credential IP quota; separated only avatar route into authenticated write family, retained existing sensitive security limits. Test dynamic import wasn't transformed by Playwright CommonJS path; replaced with normal static source import. Failures rerun without weakening assertions; final78pass.

## Remaining engineering, not only owner credentials
- Persistent/offline chat or authorized realtime; oversized/deleted-boundary recovery, full accessibility/manual keyboard/screen-reader audit, recommendation interest/activity evaluation and typed API/OpenAPI.
- Auth/moderation/upstream concurrency and enumeration measurements/legacy-support workflow/security threat model; consistent asynchronous/byte-inclusive export; malware policy/untracked old-object reconciliation and meaningful large-dataset plans/load.
- Maps JS fixture/live attribution/contact/hours UX; GitHub quota/cache/background lifecycle/revocation; AI dollars/provider retention/backpressure/retrieval/citation evaluation. Existing adapter fixtures aren't live verification.
- Actual Docker/Caddy/hosted CI, trusted/public HTTPS and end-to-end activation/provider flows, deployed monitoring/tracing/alerts, encrypted off-site DB+files/S3 restored-service exercise, sustained load/independent security review.
- Owner-only domain/hosting/provider accounts/keys/billing/SMTP DNS/Google consent/GitHub grants/legal/support retention/staging+production authorization. None supplied or fabricated.

## Reproduction / services
Use README and INTEGRATIONS for development/provider API. All78 tests require `FIXTURE_API_URL=http://localhost:3004`; otherwise6 explicitly skip. Normal preview3000→API3001 left active; API non-watch, restart after edits. Provider3004 and production3002/3003/TLS3443 stopped after validation. Local production build targetsAPI3003; deploy rebuild `INTERNAL_API_URL=http://api:3001`. Test TLS proxy/certs/preload must never be deployed.
