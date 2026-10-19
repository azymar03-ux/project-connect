# ProjectConnect — Sales & Marketing Plan
### Built from what this product *actually does*, so every promise is keepable. Targets are planning assumptions to measure against, not claims.

---

## 1 · Positioning
**One line:** *Where hardware ideas get built — find teammates, ship the project, keep the receipts.*
**Enemy (real, non-abstract):** Discord servers where projects die, LinkedIn where makers perform, hackathons where teams disband at 6 a.m. ProjectConnect is the boring glue: teams, tasks, files, chat, resources, local parts — in one place that persists.
**Proof lines you may use (all enforced in code):** server-enforced team capacity · private scanned file storage · per-day AI cost ceilings (no runaway bills) · local hardware directory with real distance math · account export/delete in two clicks · “NOT configured” honesty instead of fake features.

## 2 · Who buys, who uses (and they're different people)
| Segment | Value | Where to find them |
|---|---|---|
| Student builders (primary) | Free; teammates + mentorship + AI planning | Robotics/EDA/42-coder clubs, maker faires, university societies (Chennai/Hangzhou/Berlin-type clusters beat national campaigns) |
| Independent hardware devs | Hiring + collaborators + store deals | X/Bluesky build-log posters, r/hardware, Hackaday comments, Tindie/Etsy maker lists |
| University clubs/labs (buyer #1) | Club plan = organisation without spreadsheets | Direct email to faculty sponsors & club presidents, one campus at a time |
| Hardware stores / suppliers (buyer #2) | Sponsored local listings, community demand signal | Walk in. Seriously. Local electronics markets are the entire moat |
| Hiring companies (buyer #3, later) | Portfolio-verified candidates | Founder LinkedIn outreach + 2 partner universities first |

## 3 · The launch motion (90 days, sequenced)
**Weeks 0–4 · Pre-launch — supply before demand.**
An empty network is the death of this category. Recruit **30 anchor teams** by hand (club projects already in flight get free Club plan + “founding” badge — costs $0). Seed 60 stores into the Nearby directory via friendly shop visits (their listings + optional offers). Build-in-public: one weekly post from the founder showing real commits, metrics, and *bug autopsies* — this audience rewards honesty; our whole codebase is built on it.
**Weeks 5–8 · Closed beta — the product literally supports it** (production registration = pending + email activation). Waitlist page → admit 25/week from referrals first (invite code loop exists in-app). KPI: **activation = first connection made within 14 days**, not signups.
**Weeks 9–12 · Public wave — one region.** Pick one city cluster (e.g., South Indian engineering colleges OR Shenzhen hobbyist scene) and win it: campus hackathon sponsorship (~$200–500), one “find-your-cofounder” night per university, flyers with QR to their *own* project page (per-project pages + sitemap are already SEO-ready — real product capability). Then let case studies, not ads, widen.

## 4 · Channel-by-channel playbook (ranked by expected yield for this product)
1. **Club partnerships (top)**: one signed campus club = 40–150 organic users with instant teams. Offer: free club plan, founding badge, our hackathon sponsorship kit.
2. **Build-log content engine**: teams posting progress *is the product loop* (activity feed exists). Externalise: weekly best-builds email/X thread; ask every activated team at day 21 for their log.
3. **SEO — project pages, not blog spam**: shareable stable URLs + metadata + partitioned sitemaps are implemented; long-tail queries (“drone ESC tuning team project”) are exactly what indexed project cards answer. Expect months, not weeks — seed content must be real projects, never placeholders.
4. **Local stores as co-marketers**: shop owners tell *everyone* who walks in; a “Find parts + teammates here” window sticker costs nothing and maps 1:1 to the Nearby feature. Sponsored listings sold face-to-face at launch.
5. **Reddit/HN carefully**: maker subreddits reward a genuine “we built an open-hardware team platform, here's the failure log” post; show-HN with the demo dataset. One well-timed post ≈ 1–3 weeks of waitlist. Never astroturf — this audience executes your startup by reading your code comments.
6. **Paid (only after activation ≥35%)**: tiny X/Reddit tests at $10/day targeted at hardware interests, creative = real project cards; kill rule: CAC > $4 per activated user for a free product = stop.
7. **Events**: sponsor a drone/robotics track at 2 college fests per term; the prize = Club plan + AI credits. Cheap, on-brand, produces content.

## 5 · Sales plays for the three buyers
- **Clubs (self-serve-ish):** faculty email: 90-word offer (free founding club) → 20-min demo → semester MoU. Renewal trigger = end of term; owner: student ID verification for free Pro tier is a **needs-build** item (don't promise until coded).
- **Stores (founder-led, local):** walk-in pitch with live demo of *their own* listing; free first 30 days; $19–49/mo sponsored tier (see REVENUE_STREAMS §4). Upsell: post their stock arrivals as feed items (feed already renders rich text/links; no scraping of their data — they post it, unlike transient Google Places content which the product deliberately never stores — keep it that way).
- **Hiring (post-scale):** two design partners free for 6 months in exchange for case studies; price only when 200+ public “open to work” profiles exist. Never sell raw data — recruiter views use the same public serializer as everything else (already enforced).

## 6 · Funnel metrics & rituals (instrumented with what exists)
Funnel: visit → signup → pending-activated → profile complete → first apply → first connection → 14-day return → first shipped update (feed post = retention gold). Admin telemetry + audit + outbox delivery logs give most of this **today**; a metrics page is **needs-build**.
Weekly ritual (30 min): activation %, 14-day return %, store-listing growth, AI-budget burn vs ceiling (ledger), moderation queue age. Every public number gets the same discipline as code: measured or marked estimate.

## 7 · Budget (three tiers — start at first)
| Tier | $/mo | Buys |
|---|---|---|
| Bootstrap | 0–50 | Founder time, stickers, hackathon swag |
| Regional push | 150–400 | 1 event sponsorship + tiny paid tests + email tool |
| Post-PMF | 1k–3k | Content freelancer, 2 events/term, referral merch |

## 8 · What we explicitly don't do (keeps brand and codebase aligned)
No bought followers/users (empty networks are visible in a network app), no spam cold blasts without consent (the mail queue is transactional by design), no scraping competitors' or Google's restricted content for marketing, no “AI does everything” claims (assistant ships with honest budget/consent/citation states), no launch countdown theatrics while a Go/No-Go gate is open. **Marketing promises must be verifiable in the LAUNCH_STATUS matrix — same evidence rule the engineering follows.**
