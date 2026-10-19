# ProjectConnect — The Complete User Guide
### What the website does for you, screen by screen. Written so a first-time builder can follow every step.

---

## 1 · Getting in
1. **Open the site.** The home page (*Discover*) shows real project cards even before you sign in.
2. **Create an account** → *Sign in → Register*. Give a name, email and a strong password. Check your inbox and click the activation link (one-time, expires, and nobody can tell whether an email is registered — spam harvesters get nothing).
3. **Sign in** two ways: email+password or **Continue with Google**.
4. **Session basics:** staying signed in is a single HttpOnly cookie. *Account security → Sessions* lists every device; revoke any one, or **log out everywhere** (this also happens automatically when you change your password).
5. Forgot the password? *Forgot password → one-use emailed link → new password.* Old links die after first use or expiry.

## 2 · Be findable: your profile
- **Edit your profile** (top-right avatar button): bio, education, portfolio URL, city, **skills** and **interests** — skills power project matching and what owners see when you apply.
- **Profile photo:** upload any PNG/JPEG. The file is virus-scanned and security-checked first, so the avatar may briefly show “loading” or a *Retry preview* button — that's the safety pipeline, not a bug. Delete it any time.
- **What's public:** name, initials/avatar, bio, skills, interests, city, portfolio link, your public projects. **Private forever:** email, password, sessions, tokens, your draft applications' contact details.

## 3 · Find your people (Discover, People, Nearby)
- **Discover:** search box + category chips (drones, renewable energy, agriculture, hardware…) + skill filters. Cards show needed roles, capacity and tags.
- **Saved projects:** bookmark anything from a card; find the list later in the sidebar.
- **People:** browse makers, follow them, or send a **connection request** (they accept/decline; either of you can end it; **block** removes visibility and messaging both ways). Match scores are shown with the *why* (shared skills, city, activity) — never a mystery percentage.
- **Nearby hardware:** finds hobbyist/electronics stores around a city you type — distance-sorted, with hours/phone when available, directions links, and your favorites. Community members can submit stores and flag bad data.
- **Activity feed:** the public pulse — new projects, team wins, posts you can like. Post your own updates; delete them any time.

## 4 · Launch or join a project (the core loop)
**Joining:** open a card → read roles, skills, timeline → **Apply** with a short pitch and what you bring → the owner reviews in *My projects → Applications* → accept → you're on the team: chat opens, you appear in the workspace, notifications tell both sides.
**Launching:** *My projects → New project*: title, description, category, cover image, skills wanted, **open positions with capacity** (e.g. “2 firmware engineers” — enforced atomically, so the 3rd accept can't oversubscribe), location/remote, status. Edit or archive later; deleting a project cleans up its images and applications truthfully.
**Managing applications:** owners accept/decline with a note; applicants may cancel or reapply under the project rules; capacity, duplicate-acceptance protection and audit events are automatic.

## 5 · Work together (the Workspace tab on your project)
| Tab | What it is for |
|---|---|
| **Overview** | What's due, who's active, pinned status |
| **Tasks** | Kanban board — drag with a mouse *or* move with the keyboard; priority, assignee, due date, labels |
| **Milestones** | Group tasks; progress % is computed from real task states, not vibes |
| **Team** | Invite by link/username, change roles, remove members, **transfer ownership**, leave gracefully |
| **Files** | Private project files (quota'd, scanned, deleted-or-captured automatically) — only members can read them |
| **GitHub** | Link repos; stars/language/last-push metadata cached; connect a private token only if you choose to |
| **Updates** | Shipped progress posts that flow into the Activity feed |
| **Invitations** | Pending team invites in one place |
| **Chat** | Per-project channel + direct messages: unread badges, gap-safe catch-up after a dropped connection, read receipts, and *retry* — no silent message loss, and blocked users cannot reach you |

## 6 · Level up (Resources & AI assistant)
- **Resources hub:** community-curated repos, docs, APIs, datasets, tutorials. Search/filter, upvote, bookmark, and **attach to your project** so teammates see the same toolbelt. You can submit resources; moderation verifies them.
- **AI assistant:** asks about your project → ideas, stack picks, debug hints, roadmap drafts. Guardrails you should know: per-day cost caps (yours and global), your chats are private to you, and every external citation is labelled verified or unverified — **it will not invent GitHub repos or shops**, and drone/electrical answers carry safety disclaimers. Turn “roadmap → tasks” into real board items with one confirmation (duplicate-safe).
- When an integration isn't configured by the site operator yet, you'll see an honest *not configured* note — never a fake success screen.

## 7 · Your account, your data (Account security view + /account)
- **Preferences:** which notifications you get (mentions, applications, messages…).
- **Sessions:** every active login with device/time; revoke individually or all.
- **Export my data:** queues a ZIP (profile, projects, messages, files list…) — you get a download link when ready; large exports keep working even if a server restarts mid-zip.
- **Delete account:** after confirmation, your profile, applications, messages and uploads are removed or anonymised per the retention rules; files still needed as legal evidence/quarantine stay sealed and invisible — that's intentional.
- **Reports:** flag a profile or project → the moderation queue → actions taken feed back into your notifications.

## 8 · Small things that matter
- **401 in the console on first load** = you're simply logged out; the site uses it to show guest mode. Normal.
- Images from the preview environment may need cookies; if a photo won't load inside an embedded frame, open the preview in a new tab.
- Rate limits protect logins, uploads and messages — “slow down” responses are self-healing; wait the shown seconds.
- Works from 320px phones to ultrawide; full keyboard + screen-reader-friendly dialogs (focus is trapped and restored, Esc closes); reduced-motion honoured.

**The one-sentence rule of this site:** everything you post is yours, everything you share is consented, and every team decision the platform makes (capacity, acceptance, access, scan results) is enforced by the server — not just drawn by the UI.
