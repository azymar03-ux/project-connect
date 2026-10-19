# Explainable recommendation evaluation
9 October 2026 · fit-v2

`core/recommendations.ts` contains matching arithmetic; discovery SQL uses the same weights. Score = 25 baseline + up to 55 skill overlap + 10 exact case-insensitive city + up to 5 explicit interest overlap + 5 for at least one visible public project update within 30 days. People use their skills/interests; projects use required skills and tags/category. No-key/anonymous viewers receive no personal score. Empty fields are safe. Activity count cannot accumulate a bonus beyond five points, and private chat/tasks/online status never contribute.

Matched skills/interests, city, public-activity boolean and algorithm version accompany results. This is an explainable heuristic, **not a success probability or trained AI model**. No behavioral tracking or demographic inference is used. Public activity hidden by moderation, archive/suspension/activation or the viewer's blocking is excluded.

Tests in `tests/recommendations.spec.ts` cover perfect/cold/missing/mismatched/partial signal cases, case normalization, monotonic weights, endpoint/SQL arithmetic, moderated activity exclusion, lower-fit ordering, public serialization and cursor tampering/profile changes. Existing discovery tests cover pagination/filter/scope/blocking. Creation itself emits a public project update; thus a new skill+city match without shared interests scores 95 rather than the old skill/city-only 100.

Cursors are HMAC-signed with a separate discovery purpose using the export signing-key ring, bound to viewer/profile/filter state and a fixed 30-minute page window. Later new public activity/rows do not drift into that window. Current visibility/deletion and profile edits are live: this is not a consistent snapshot. A ranking refresh restarts the list. Deployment requires the stable current key on every replica, with optional previous-key rotation overlap.

Not measured: real-user relevance/acceptance, fairness across sparse profiles, adversarial keyword stuffing, production ranking latency or online A/B outcomes. These require representative consented data and hosted measurements. Do not call deterministic fixture results proof of recommendation quality.
