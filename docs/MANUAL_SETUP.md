> **Current source:**118tests/25migrations. [STORAGE_QUARANTINE_CHECKPOINT.md](STORAGE_QUARANTINE_CHECKPOINT.md) supersedes dated historical counts/semantics below. NOT READY FOR PRODUCTION LAUNCH.

# Owner-only setup prerequisites
These do not replace unfinished engineering documented in LAUNCH_STATUS.md.

| Item | Owner action | Future configuration / check |
|---|---|---|
| Hosting & domain | Choose host/region and authorize billing; register domain and DNS/TLS | DATABASE_URL; exact APP_ORIGINS; production proxy and readiness checks |
| Email | Choose provider; verify sending domain with SPF/DKIM/DMARC | SMTP/provider credentials via secrets store; verification/recovery delivery smoke test |
| Google OAuth | Register consent/app and approve scopes | GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET; exact redirect PUBLIC_APP_URL/api/auth/google/callback |
| Maps | Enable billing; restrict Maps JS browser key to deployed domains, Places server key to needed APIs | Provider-specific keys; quota and licensing review; actual map/store smoke test |
| AI | Select model/provider and approve cost caps | Server-side provider key; quota/cancellation test |
| Storage | Create private S3-compatible bucket, lifecycle/access policy | S3 credentials/endpoints; signed URL isolation test |
| GitHub | Register integration app and webhook permissions | Read-only App credentials, project-scoped grants and live signature/revocation tests |
| Monitoring | Choose error/uptime providers | Redacted DSN/credentials; trigger test alert |
| Legal & assets | Review privacy/terms/retention and image licenses | Owner/legal approval required, never claimed automatically |
| Public launch | Approve deployment once engineering and security gates pass | No current authorization to purchase or publish |

Never paste real secrets into documentation, chat, source control or browser code. Missing credentials should not stop unrelated engineering. The implemented Google callback is `/api/auth/google/callback`; configure the exact deployed HTTPS URI.

### Implemented email configuration
Set `PUBLIC_APP_URL=https://your-exact-domain` (no trailing path), `SMTP_URL` using a provider connection string in the secrets store, and `MAIL_FROM` with verified sender identity. Restart API. Links target `/account/verify#token=…` and `/account/reset#token=…` (fragments are not sent to server access logs). Do not log email bodies or put the private outbox on a public endpoint. Current worker polls every 15 seconds with up to five delivery attempts; verify delivery and failure handling in staging before launch.

## Newly wired integrations
- AI: set OPENAI_API_KEY, optional OPENAI_MODEL, AI_DAILY_LIMIT. Without key planner uses explicitly labeled templates. Live calls still need staging validation.
- Public GitHub metadata never uses private credentials. Workspace GitHub App/webhook adapter is implemented; configure scoped grants below.
- Files: private LOCAL_FILE_DIR mount, or S3_BUCKET/S3_REGION/S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY. Signed downloads expire in 60 seconds. Live S3 path not tested yet.
- Admin role must be granted to an owner-approved account by a trusted database operator. No self-service admin signup. Do not promote the public demo account.
- Community relative plot stays separate; Places attributed transient search + optional Maps JS display are implemented, but live keys/SDK rendering/policy compliance must be validated before enabling.
- Email links now use #token fragments (not query strings) to avoid server access-log leakage. PUBLIC_APP_URL must be configured to the real origin.

Redis shared limits now required for production; exact Caddy proxy address configured in compose. Set deployment network overrides if needed, review private Redis authentication/transport, and execute staging validation. Manual keys are not the only remaining work; see current LAUNCH_STATUS for engineering gates.


## Google sign-in setup (implemented adapter; live test remains)
1. Register an OAuth2 web application and consent screen with owner-approved branding/privacy links and scopes `openid email profile`.
2. Set authorized redirect URI to **`https://your-exact-domain/api/auth/google/callback`**; development may use `http://localhost:3000/api/auth/google/callback`. PUBLIC_APP_URL must match exactly; production requires HTTPS.
3. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the API secret store. Never include secret in browser build or documentation. Restart API and verify `/api/auth/google/status` returns configured:true.
4. Test new Google identity, logout/relogin, provider denial, expired/replayed state and signed-in explicit linking. Existing same-email accounts are deliberately **not** automatically merged; sign in by email then Settings → Link Google.
5. Google-only accounts must establish password using email recovery and verified address before unlink. Live SMTP recovery is therefore a necessary owner prerequisite.
6. Live OAuth callback/end-to-end provider verification is not satisfied by the local signed-token protocol fixtures. Do not publish until the live HTTPS flow passes.

## Launch policy approvals
Approve verified-email publication policy (default on in production), retention periods/export support, storage scanning threat model, AI provider privacy/cost caps, merchant data and dependency notice obligations. LICENSE_INVENTORY.md identifies LGPL/MPL dependencies; preserve license notices and obtain legal review. These approvals are owner work, but the unfinished integrations/security/operational engineering in LAUNCH_STATUS is still agent work.


## Google Maps/Places — implemented, owner live-validation required
1. Create separate keys: `GOOGLE_MAPS_BROWSER_KEY` restricted to exact deployed HTTPS referrers and Maps JavaScript API; browser key is inherently public. `GOOGLE_PLACES_API_KEY` server-only, Places API restricted and applicable source/IP restrictions. Enable appropriate APIs and billing; configure provider-side hard quotas/alerts.
2. Review public Terms/Privacy that include required Google terms/privacy, attribution rules and any regional terms. Only after owner approval set `GOOGLE_PLACES_ENABLED=true`; defaultsfalse. `GOOGLE_PLACES_DAILY_LIMIT=200` default service requests/24h,20/user; review billing by requested fields. No provider results persisted/cache/favorite stores. Official logo/attribution must remain visible and unmodified.
3. Restart API, `/api/places/status` configured:true. Verified user → Nearbyhardware→explicitSearchGooglePlaces. Grant location only if desired; no automatic provider query. Toggle Googlemap with restricted browser key. Verify positions/list attribution, no network/key leaks except intended public key, errors/no-location/quota, actual merchant status; never infer stock/hours. Test CSP/GoogleSDK network in real HTTPS staging. No live SDK test was done here.

## AI provider and quota setup
API secrets: OPENAI_API_KEY,stable32+characterAI_QUOTA_SECRET (e.g. owner secret-store generated random bytes). Model OPENAI_MODEL defaults gpt-4o-mini; validate current provider model/options. Defaults AI_DAILY_LIMIT20,AI_DAILY_TOKEN_BUDGET140000,AI_PROJECT_DAILY_TOKEN_BUDGET280000,AI_GLOBAL_DAILY_TOKEN_BUDGET1400000;14k reservation/turn means defaultidentity token budget allows10calls/day. Approve provider hard-dollar caps/alerts, privacy/retention/data-residency and price per token. Token budgets are not priced dollar guarantees. Secret must stay stable across replicas; rotation needs ledger migration/grace.
Restart API; `/api/assistant/status`; signed-in verified user explicitly consents, streams/saves/deletes/cancels. Validate provider failures/timeouts/usage and budget accounting under real model,disconnect/cross-replica cancellation, deletion+provider retention. No workspace retrieval/tools enabled. Request content sent only explicit consent, links identified unverified. Do not paste secrets into prompts.

## Read-only GitHub App
1. Register GitHub App with only metadata/contents/issues/pull_requests Read-only; webhooks push,pull_request,issues,installation,installation_repositories. URL **PUBLIC_APP_URL/api/github/webhook**,strongGITHUB_WEBHOOK_SECRET. App private key/API ID server-only: GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY; escaped\n PEM supported; use secret manager.
2. Install on only approved repos. Owner/operator enters exact `GITHUB_INSTALLATION_GRANTS=projectId:installationId,...` after verifying workspace owner and intended teammate audience. Do not invent IDs. Installation token requests are restricted to selected repo and read-only permissions. No end-user App-install OAuth wizard implemented.
3. Workspace owner links URL+approvedinstallationID; members can read recent activity,not write code. Test unauthorized members,unlink/transfer/revocation/private-audience behavior. GitHubstatus endpoints show configuration flags only. Validate webhook signatures/replays/repo removal against real deliveries; tokens/payloads must not enter logs.
4. Public resource metadata is uncredentialed; no global GITHUB_TOKEN fallback. Configure provider quota/backoff/cache strategy before scale; background refresh incomplete.

## Admin/monitoring/privacy approval
Trusted operator grantsisAdmin to designated owner-approved account (never demo). Validate suspension→sessions denied→restore+reauth,admin/self lockout,report/store audit. Queue-health UI/API exposes counts only; externally monitor failed/pending mail/storage,expiredAI and redactederror codes. No owner monitoring account/provider was configured here. Approve48hquota-HMAC/30daywebhook/90dayread-notification retention,account export truncation/support,legalAI/privacy/merchant policies and officialGoogle/dependency notices. These decisions do not replace remaining engineering gates.

## Current additional configuration (supersedes older pending descriptions)
- Set independent stable `CHAT_POSITION_SECRET` and `EXPORT_CURSOR_SECRET`>=32randomcharacters in the secret store on every production replica. Optional `_PREVIOUS` supports <=24hrotation overlap; follow OPERATIONS. They are required even when AI is off.
- Public GitHub cache/background refresh/shared upstream quota are now implemented and locally tested; live App audience/grants/provider quotas still require validation, not new cache implementation.
- `GOOGLE_PLACES_CONTACT_DETAILS=false` remains default. Approving and enabling it requests optional phone/current-hours fields that can change billing. No provider content persistence; review actual terms/field costs/attribution in staging.
- Monitor CLI is tested; systemd unit/timer templates are supplied. Choose operator alert destination, securely renew monitor admin session and validate delivery. No external alert provider/timer was activated here.
- Container CI/disposable compose are supplied but unexecuted in this Docker-less sandbox. Authorize execution on a capable isolated host; then real staging/prod rollout remains separately approved.
- Encrypted local DB+files/restored-service verification passes; choose off-site destination/key escrow/retention and authorize an independent-host restore exercise. Local ephemeral test keys are not production backup keys.

## New production inputs, not completion of engineering
- Approve provider model and conservative maximum input/output/reasoning token rate. Set matching `AI_PRICING_MODEL`/`OPENAI_MODEL`, `AI_MAX_TOKEN_PRICE_MICROUSD_PER_MILLION`, `AI_USER_DAILY_MICROUSD_BUDGET`, `AI_PROJECT_DAILY_MICROUSD_BUDGET`, `AI_GLOBAL_DAILY_MICROUSD_BUDGET`. Example values in `.env.example` are examples, not authoritative billing quotes.
- Allocate private scanner service resources/network and signature updates; never expose unauthenticated clamd3310. Container/signature/startup testing is agent-owned engineering still unexecuted, not a manual owner certification.
- Approve portability24hexobject TTL24h, snapshot privacy scope, resource limits and retention/deletion policy. Grant S3 ListBucket for inventory separately from object operations if using S3. No actual vendor grants/account created here.

### Scanner/storage rollout note
Agent implemented persistent legacy scan/quarantine and verified local real engine/EICAR, not production patch compliance. Hosting must provide private supported patched scanner/signature updates and private immutable storage. Local installed1.4.3 flagged outdated vs1.4.6; do not use that as approved production image. Engineering still owns patched/pinned/freshness/throughput/S3/crash validation; owner approves hosting/grants/retention and deployment. Migrations expire incompatible old exports, pending files/images unavailable until scan verification; follow OPERATIONS maintenance/rescan workflow. No manual DB clean override.
