> Latest preview repair: exact sandbox origin, embedded-session cookie and image failure/retry states fixed. HTTPS-origin browser check +16 targeted tests PASS; full118suite not rerun. See docs/PREVIEW_FIX.md.

> **11 October frontend update:** taste-skill redesign applied;118/118regressionPASS. See [frontend refresh](docs/FRONTEND_TASTE_REFRESH.md). Full launch gates unchanged.

# ProjectConnect — saved engineering handoff
**10 October 2026 · 118 tests passed · 25 migrations · NOT READY FOR PRODUCTION LAUNCH**

The editable project and evidence are saved at `/home/user/projectconnect`. This continuation closes substantive legacy-file security and export-recovery gaps. **The full launch contract is not complete.** Remaining engineering is separate from your credentials and approvals.

## Delivered this continuation
- **Persistent scan/quarantine:** legacy files/images start unverified; original and normalized uploads scanned, verdict bound to SHA-256. Durable retry/lease/generation fencing; operator rescan CLI, no clean override. Integrity changes quarantine. Production never accepts development-unscanned status.
- **Delivery enforcement:** bounded exact-byte authorized file/image reads, digest/status/audience checks; S3 files proxy through API rather than stale signed redirect. File UI shows security status, refresh and unavailable downloads.
- **Safer exports:** retained safety dependencies, digest and expected pin count, scan FK; publication and download reject unverified/quarantined/missing dependencies. Midstream session/cancel/expiry/quarantine checks. Old incompatible exports expire on upgrade.
- **Crash cleanup:** private-volume scratch, exclusive no-overwrite local publication, conservative 24h recognized-directory scavenger; fresh/unknown/symlinks untouched.
- **Operations:** redacted aggregate scan/quarantine counts and monitor alert codes; no private file metadata exposed.
- **Real-engine test:** ClamAV accepted benign bytes and rejected EICAR; the persistent legacy worker also verified clean/digest and quarantine outcomes. Downloaded signatures verified. Installed1.4.3 is outdated vs recommended1.4.6; this is **not patched production compliance or exhaustive malware certification**.
- Prior identity/social/projects/tasks/chat/resources/GitHub/Maps/AI/portability/SEO retained and regression-tested.

## Fresh validation
| Check | Result |
|---|---|
| Rebuilt browser/API/provider suite | **118 passed,0failed,0skipped ·1.8m** |
| Format/lint/contracts/strict types/API+web builds | PASS |
| Migrations | **25fresh/checksums;20→25legacy data;22→25old export invalidation PASS** |
| Local real clamd benign/EICAR | PASS; engine1.4.3/daily28149, outdated warning documented |
| Encrypted local recovery | **43tables + restored API/session/file/avatar/private denial PASS** |
| Dependency audit | **0 known vulnerabilities** at execution |
| Selected source pattern scan | 177files clean; not comprehensive secret/security certification |
| Docker/live providers/S3/public deployment/off-site recovery | **Not executed** |

Details, exact logs and corrected failures: [STORAGE_QUARANTINE_CHECKPOINT.md](docs/STORAGE_QUARANTINE_CHECKPOINT.md), [VALIDATION_REPORT.md](docs/VALIDATION_REPORT.md). Prior local load/timing results were not rerun; do not infer production capacity.

## Still agent-owned — not transferred to you
Full typed DTO/client/OpenAPI payload and compatibility-list audits; patched/pinned scanner/freshness monitoring/adversarial corpus/production inventory throughput; real S3 immutable/range/late-PUT/pin/retirement tests; actual process-kill/large-export/multi-replica and representative load tests; high-sample abuse/enumeration, manual assistive-tech/independent security; model/citation/retention quality; executed Docker/hostedCI/Caddy/edge/external alerts/tracing/off-site restored-service RPO/RTO. [LAUNCH_STATUS.md](docs/LAUNCH_STATUS.md) tracks these gates.

## Your separate prerequisites
Hosting/domain/DNS/billing; production DB/storage/SMTP/OAuth/Maps/GitHub/AI/monitoring accounts and grants; approved model/price/legal/retention/licenses; publication authorization. [MANUAL_SETUP.md](docs/MANUAL_SETUP.md). No external deployment/purchase/publication or production seed performed.

## Run and saved deliverables
Use README: `npm ci`, configure isolated local `.env` including PUBLIC_APP_URL and exact APP_ORIGINS; `npm run db:generate`, `npm run db:migrate`, `npm run db:seed` **development only**. Start `npm run api` and `npm run dev` separately. Full118suite requires explicit provider fixtureAPI3004 from INTEGRATIONS.md. Backend non-watch; rebuild/restart after edits. Production proxy target `INTERNAL_API_URL=http://api:3001`. Rescan operations: [OPERATIONS.md](docs/OPERATIONS.md).
- Editable source: `/home/user/projectconnect`
- Main summary: `/home/user/ProjectConnect_LAUNCH_HANDOFF.md`
- Sanitized archive: `/home/user/ProjectConnect_release.tar.gz`
- Checksum: `/home/user/ProjectConnect_release.sha256`

Archive excludes actual environments, private bytes/scratch, dependencies/builds/raw logs. Raw evidence remains in editable docs/evidence. Normal local preview is not a public deployment; no autonomous engineering continues after this finite session.
