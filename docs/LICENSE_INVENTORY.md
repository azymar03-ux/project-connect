# Dependency and artwork license checkpoint — 9 October 2026
`node scripts/release-check.mjs` inventories licenses declared by the locked packages into `docs/evidence/licenses-current.json`. This is a technical inventory, not legal approval.

396 locked package entries at this checkpoint, including optional platform variants. `busboy` and `streamsearch` omit lockfile license metadata; their installed `LICENSE` files contain the MIT grant (copyright Brian White). Preserve those notices in deployment/distribution.

Sharp/libvips and platform dependencies include LGPL-3.0-or-later and combined LGPL/Apache/MIT declarations. Review their redistribution/linking obligations for the chosen delivery model; do not claim the entire dependency tree is MIT. Other declared licenses include Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, MIT-0, MPL-2.0, CC-BY-4.0 and BlueOak-1.0.0. The machine-readable inventory records actual package/version declarations, not guessed licenses.

Project concept-cover SVGs are original code-authored illustrations in `apps/web/public/images`. They are not actual photographs of community projects. Prior externally sourced stock thumbnails were removed. Lucide icons use ISC. Legal ownership/notice review remains an owner launch prerequisite.

## Official Google Maps attribution asset
`apps/web/public/images/google-maps-attribution.png` is the unmodified white 2x logo from Google's official attribution assets zip fetched 9 October 2026: https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip . This is a Google trademark/required API attribution, not an original ProjectConnect illustration or generally reusable stock image. Display height18px with10px left/right/top and5px bottom clear space; review exact production background/contrast and Google terms before enabling. Source policies: https://developers.google.com/maps/documentation/places/web-service/policies .
