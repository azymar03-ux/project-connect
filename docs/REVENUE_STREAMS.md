# ProjectConnect — Revenue Streams
### How this specific platform makes money, mapped to the enforcement points that already exist in the code.
*(All prices/ranges are planning assumptions, not validated market data — they exist so the owner can decide. Anything marked **needs-build** requires new engineering.)*

## Why the map works in our favour
Monetisation usually fails when it needs brand-new trust machinery. ProjectConnect already enforces **per-user daily AI budgets in integer micro-USD (`AI_USER_DAILY_MICROUSD_BUDGET`), quotas, roles, capacity rules, invites, moderation, export/delete, and a DB-backed mail queue**. That means most paid tiers are *raising existing gates*, not inventing new ones — the honest, cheap way to price.

## The streams

### 1 · Builder Pro (consumer subscription) — the core line
Free: everything a member needs to join and ship (browsing, applying, chat, workspace, 1 project, base AI allowance).
Pro (suggest **$7/mo · $60/yr · students free via verified campus email**):

| Pro benefit | Where it plugs in | Build cost |
|---|---|---|
| Bigger daily AI budget + priority model routing | AI ledger ceilings are per-user integers — already multi-tier capable | small (a `plan` column + ceiling lookup) |
| Advanced filters & explainable match deep-links (search "firmware + battery + within 50km + open to students") | discovery/search is server-side with pagination | small |
| Showcase boost (pinned in category for 7 days, clearly labelled *Promoted*) | cards already render from API; needs a slot field | small + moderation rule: always labelled |
| Unlimited active owned projects (free = 1…2) | owner-capacity checks already exist | trivial |
| Private "co-founder match" reports | fit-v2 scoring exists | medium |
| **Needs-build:** billing (Stripe/Paddle merchant-of-record for global VAT), plan gate middleware, refund/export interplay (billing data lives at the processor — disclose it in the privacy draft) | — | medium |

### 2 · Teams & Club plans (seat billing)
Student clubs, maker spaces, small hardware startups need: more workspace members than free allows, larger private-file quotas (S3 quota code exists), milestone/velocity summaries across projects (task data is persisted — reporting is a read-model), GitHub integration per team (already built).
Suggested **$25/mo per 10 seats**; club verification through the existing admin flow. Seat caps enforce themselves via the team-role system.

### 3 · Hiring & talent (B2B, highest ceiling)
The product is a *portfolio of people who shipped real things* — recruiters pay for that signal.
- Job/partner post tied to open positions (positions with capacity already exist — a "hiring" position type is a label + queue).
- Sponsor-a-project: a company funds an open-source hardware project's parts/AI budget in exchange for a labelled sponsor badge.
- **Never** sell raw user data or scraping — profiles are user-owned; recruiter views show only public fields, exactly the serializer that already exists.

### 4 · Local hardware partnerships (the moat stream)
The Nearby page lists *our own* community store DB (Google Places results are transient by policy — so ads go on our records, which is legally clean).
- Stores claim listings free → verified badge, hours, offers, “sponsored” slot at top of a city (clearly labelled).
- Coupon/partnership campaigns for hackathon parts packs.
Suggested **$19–49/mo per store** + revenue-share on tracked redemptions (needs-build: simple redemption codes).

### 5 · Events, hackathons, content
Ticketed virtual hackathons (platform already has teams, invitations, milestones, chat channels — that *is* a hackathon product), sponsor packages, and a “Build Log” editorial arm (the feed + Resources hub double as CMS). Mostly operations cost, small engineering.

### 6 · White-label for universities/incubators (**needs-build, later**)
Campus-branded instance per tenant. Honest status: current schema is single-tenant; a `campus` scoping column + subdomain routing is the minimum. Price **$2–10k/yr per campus**. Only pursue after #1 proves out.

### 7 · Marketplace / commerce cut — explicitly deferred
Parts resale or group-buying wants escrow, payments, dispute tooling: real engineering + legal exposure. Parked until ≥25k MAU; do not promise it early.

## Unit economics sanity (assumptions, re-measure monthly)
- AI: at the repo's own approved price ceiling, a Pro user's daily ceiling × 30 days is the *worst case* monthly COGS — cap Pro tiers so AI-COGS ≤ ~25% of $7; the ledger already reports spend per user (admin telemetry).
- Hosting at launch scale is one small VPS + managed DB ≈ $35–70/mo → break-even at ~10 Pro subs.
- Store/hiring streams are near-zero marginal cost — they fund discounts for students.

## Sequencing (do not parallelise money experiments)
1. Free growth → 2. Builder Pro → 3. Club seats → 4. Store partnerships → 5. Hiring → 6. Events → 7. White-label → 8. Commerce.

## Rules that protect the brand (already true of this product; keep)
Every paid placement labelled *Promoted/Sponsored*; free-forever students; no dark patterns in cancellation (export & delete are first-class features); invoices/PII stay in the processor, app export discloses that. Revenue decisions are owner decisions — the engineering only enforces them.
