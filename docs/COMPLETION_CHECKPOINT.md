# Activation, delivery and review checkpoint — 9 October 2026

> Historical68-test checkpoint. Current78-test/20-migration evidence and superseding image/export/ledger/HTTPS semantics: [EXPANSION_CHECKPOINT.md](EXPANSION_CHECKPOINT.md).

## Result
**68 tests passed, 0 failed, 0 skipped (1.5 minutes). NOT READY FOR PRODUCTION LAUNCH.** This continues the full-product contract; it does not redefine the product as an MVP or equate passing local tests with launch completion.

## Implemented this pass
### Account activation and recovery
- Production/private signup creates a disabled pending identity (`activationRequired=true`, `passwordSet=false`) and no session. Login and existing session resolution reject pending identities; public discovery/profiles exclude them. Signup remains neutral for new/existing email. The registration hash cannot authenticate and must be replaced; mailbox activation rejects reuse of the registration password.
- Mailbox activation requires a one-use verification token, chosen profile name and fresh password, then revokes sessions and all outstanding action tokens. Pending identity fields/grants are cleared; incoming safety blocks are preserved. Legacy accounts with authored content/audit/AI history remain quarantined for support review instead of assigning potentially hostile content to the mailbox owner.
- Password recovery is another mailbox-ownership path. It rejects suspended identities, requires a fresh password for pending identities, revokes all sessions and **all Google links**, and invalidates all outstanding action tokens. The response explains that Google can be relinked in settings.
- Login session creation checks the compared credential under the user lock. Google session creation checks the exact persisted provider-link ID under that lock; unlink/relink cannot reuse an obsolete proof.
- `/account/activate` requests an activation link using a neutral reply. Existing unexpired pending activation tokens are not invalidated by a resend (checked under the user lock). Mail delivery failure/retry observability and statistical timing resistance still require review.
- Migrations016–018 quarantine preexisting unverified identities, revoke sessions/tokens/provider links and clear pending profile fields. **An upgrade needs an owner-reviewed maintenance/support plan.** Do not run demo seeding in production. Legacy authored accounts require support verification and explicit content/grant reconciliation; no automated support bypass is supplied.

### Chat
- Direct and workspace message POST accept an optional UUID `requestId`. Unique keys bind it to sender + thread. Retrying the same payload returns the same row; different content with the same ID returns409. Current block/membership/archive/suspension authorization runs before replay.
- API writes are serialized by existing user/project locks; message timestamps advance monotonically within each thread using DB time and the latest stored timestamp. This avoids backwards transaction timestamps leaving forward-cursor gaps.
- GET supports `after=<message-id>` ascending catch-up, exclusive with backward `cursor`. Each cursor is scoped to its thread. UI catches up in100-message pages, retains loaded history, and acknowledges only the retrieved boundary. Test covers125 unseen messages.
- UI keeps one in-memory request ID for uncertain delivery, disables repeated sends and offers Retry/Discard. Browser test simulates a successful server write followed by lost response; retry creates one message, not two.
- **Limits:** no push realtime, no encrypted persistent offline outbox; leaving/reloading a conversation discards pending retry state. Catch-up is capped at100 pages/10,000 messages and asks to reopen on oversized/deleted-boundary backlog. Polling is not a guarantee of durable offline delivery.

### Milestones, review and GitHub
- Owners can edit milestone title/due date/completion and delete milestones; archive/member restrictions and audit records enforced. Create-date and edit/delete controls added.
- Reports/stores/applications support opt-in paginated envelopes (`paged=true`); legacy callers retain bounded arrays. Admin users/audit/reports/stores and owner join-request UIs have load-more controls. API tests verify second pages without overlap; full manual concurrent-update/a11y review remains.
- GitHub activity rechecks active session, membership, repository-link revision and installation grant after upstream fetch. Each relink changes revision. This closes the known long-upstream stale-audience path; no shared background cache or comprehensive cross-replica authorization proof is claimed.

## Validation and corrections
- Clean dependency restoration:343 added/344 audited;0 known advisories. Prisma6.12;18 migrations applied to current and empty disposable DB. Migration checksums match local applied history.
- Node20.20.2 in this restored sandbox (Node22 recommended for deployment), PostgreSQL17.11, Redis8.0.2. Both API and Next16.4 builds, formatting, lint and strict type checks pass.
- Six additional tests in `tests/completion.spec.ts` cover activation/safety blocks, idempotent delivery/125-message gap, milestone permissions/audit, review pagination, and browser lost-response retry. Existing verify tests now assert revoked sessions/fresh credentials; assertions were updated to the stronger contract, not removed to suppress failures.
- An initial browser verification test failed because the new required name/password fields were not filled. Fixed fixture and verified real submission. Initial production smoke pointed at the wrong API due to using `API_URL` rather than build-time `INTERNAL_API_URL`; rebuilt correctly, then all smoke checks passed. Temporary type errors and a development seed edit were corrected before final checks.
- Final production-mode built web3002→API3003 smoke: Secure/HttpOnly/SameSite cookie headers, exact origins, private no-store reads, neutral signup, CSP, verified publication PASS.50 discovery requests/concurrency10: all200; p50 **38ms**, p95 **63ms**. Local HTTP/manual-cookie check only, not browser HTTPS or production load certification.
- Local recovery:21 selected table counts and a nonempty referenced attachment size/SHA256 match restored DB/copied volume. Scratch data removed. No production/S3/off-site/RPO/RTO claim.
- Selected credential-pattern scan:117 files clean;396 dependency-license records,2 metadata gaps already documented. Not a full secret or license audit.
- No residual fixture accounts or pending storage deletions after final validation. Normal preview3000→API3001 left running; auxiliary test/production processes stopped.

## Remaining engineering (not just manual credentials)
1. Systematic auth/session/moderation concurrency audit, enumeration timing measurements, legacy-identity support workflow, scalable account export, AI legacy-ledger backfill/deletion coverage and query optimization.
2. Durable offline chat/realtime design; deletion-boundary/oversized-history recovery; pagination race/a11y polishing; avatar/project-photo upload UX; shared API schemas/OpenAPI and recommendation evaluation.
3. GitHub cost/cache/refresh and live revocation, actual Maps JS fixtures/live attribution/contact/hours UX, AI stream/backpressure/provider accounting/retrieval/citation review.
4. Docker/Caddy/hosted CI execution, true browser HTTPS flows, telemetry/alerts, encrypted off-site DB+files/S3 application restore, sustained load and independent security review.
5. Owner-only SMTP/provider keys, billing/consent/legal approvals, domain/hosting and authorized staging/production deployment. None supplied or executed here.

## Reproduction
See README and OPERATIONS. Run all68 tests with the test-only provider API and `FIXTURE_API_URL=http://localhost:3004`; without it,6 tests explicitly skip (5 provider HTTP +1 private activation). The preload rejects use outside test mode. Raw final evidence is `docs/evidence/*-completion*.log`. Do not ship the local3003-targeted build: deployment rebuilds with `INTERNAL_API_URL=http://api:3001`.
