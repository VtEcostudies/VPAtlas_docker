# Changelog — Snapshot 2026-05-10 (partial)

## v3.5.232 – v3.5.238

Partial day's work; additional changes may land later under a follow-up
2026-05-10 changelog.

### Explore — "Pools near me" now follows you live

- **The gap.** The Near Me filter captured a single `getCurrentPosition` fix when the checkbox was toggled on and stored it as a static `nearMeOrigin`. Once on, the radius origin never moved — opening the app or returning to the home page after walking a few hundred meters showed a list of pools centered on yesterday's location until the user manually toggled the filter off and on again.
- **The fix.** [explore/js/filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js) — Near Me now drives a `GPSMonitor` (`watchPosition`) instead of a one-shot fix. Lifecycle is tied to the checkbox: `startNearMeTracking()` on toggle-on, `stopNearMeTracking()` on toggle-off (and on token-X removal, which dispatches a `change` event into the same handler). The first position event fulfills the toggle's "Locating…" promise; subsequent events update `filters.nearMeOrigin` in place and call `applyFilters()` to re-run the three-pane render.
- **15 m movement threshold.** Position events at ~1 Hz would re-render the pool list / map / summary too often on a stationary GPS that's jittering inside its own accuracy circle. After the first fix, subsequent fixes only re-apply when the user has moved at least 15 m from the origin currently in use. Origin within `filters` always reflects the last *applied* position (so stepper changes and persistence stay in sync); the live fix is held in the `GPSMonitor` instance until it crosses the threshold.
- **Auto-resume on cold load.** When `nearMeKm > 0 && nearMeOrigin` is restored from IndexedDB at page load, `initFilterBar` kicks off `startNearMeTracking({ silent: true })` automatically — same as if the user had toggled the filter on themselves. The first fresh fix re-renders the panes with the current location, replacing whatever stale origin was carried over from the previous session. The filter no longer goes stale across app launches or page navigations.
- **Two GPS monitors, one watch.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html)'s existing auto-click of the map's GPS button on resume is unchanged. Both GPSMonitor instances (the map's and the filter's) share the `gps-shared` BroadcastChannel, so only one tab actually calls `watchPosition` — the other goes passive and receives positions over the channel. No extra battery cost, no duplicate permission prompt.

### Explore — pinned pool stays visible when filtered out of scope

- **The gap.** When a pool was pinned via the list's pin icon and the user then narrowed the filters (different town, different status chip, etc.), the pinned pool's row dropped out of the list and its marker dropped off the map. The only remaining unpin path was the small `×` next to the `Find 1` chip in the list title — easy to miss, and the map halo had no marker to attach to.
- **The fix.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) `refreshUI()` and the `map:layer-filter` listener wrap their filter outputs in a new `ensurePinnedVisible()` helper. If a pool is pinned but the filtered rows don't contain it, the pinned row is prepended back from `masterRows` so the map, list, and summary all see it. The user can unpin via the row's pin icon again, and the halo stays attached. No-op when nothing's pinned.
- **Caveat.** The map's internal status/level visibility filter inside `plotPoolRows` still hides the marker if the pinned pool's status is toggled off via the layer chips — but the row stays in the list, so the unpin path is preserved either way.

### Explore — cold-load with Near Me fits both pools and user

- **The gap.** On cold app-open with Near Me on, the map zoom landed on either the filtered pools or the user (whichever async event ran last) — not on a fit-both that frames "where am I relative to what's around me?". Manual GPS clicks and the dedicated zoom-both button worked fine; only the cold-load case was wrong.
- **The fix.** [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) — the inner zoom-fit logic was extracted from the both-button click into an exported `zoomToBoth()` function. `wireGpsButton(btn, opts)` now accepts `opts.onFirstFix`, a callback that overrides the default user-recenter on the very first GPS fix; deferred via `setTimeout(0)` so any other position listeners (filter_bar's own `GPSMonitor`, refreshUI's `zoomToFilteredPools`) finish first and the override gets the last word.
- **Wired in [explore/index.html](ui_vp/uiVPAtlas/explore/index.html).** When `filters.nearMeKm > 0` at init time, the GPS button is wired with `onFirstFix: () => zoomToBoth()`. Subsequent manual clicks still recenter on the user (existing behavior). When Near Me is off, no override — the GPS button behaves exactly as before.

### Explore — zoom-to-both ignores hidden markers

- **The bug.** With only Pool Status filters changed (Eliminated hidden by default), the zoom-to-both button — and the new cold-load auto-fit — was framing pools that weren't on the map. One Eliminated pool had bad coords near the Atlantic, so the bounds ballooned out to include Greenland and South America.
- **The cause.** `zoomToBoth()` was iterating the module-level `markers` dict, which holds every plotted marker including ones currently hidden by status/level chips. `zoomToFilteredPools()` had been doing the right thing all along by reading `poolLayer.getBounds()` (the FeatureGroup of visible markers only).
- **The fix.** [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) — `zoomToBoth()` now pushes `poolLayer.getLayers()` (visible only) into its bounds calc instead of `Object.values(markers)`. The Eliminated/Duplicate-hidden bad-coords rows no longer participate. Plus a comment so the next person reaching for `markers` here knows why not.

### App-wide — disable page pinch-zoom

- **Why.** Pinch-zooming the page on a phone shifts the layout horizontally/vertically and toolbar buttons can scroll off-screen with no obvious way back. The PWA's UI is already mobile-tuned at native scale; user-zoom of the page provides no benefit and routinely breaks the layout for volunteers in the field.
- **Change.** All HTML pages under [ui_vp/uiVPAtlas/](ui_vp/uiVPAtlas/) now use `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`. Four pages already had this (`survey/find_pool.html`, `survey/visit_create.html`, `survey/survey_create.html`, `admin/review_create.html`); the remaining 23 were brought into alignment with one `sed` pass.
- **Map zoom unaffected.** Leaflet handles its own pinch-zoom on the map's touch events independently of the page-level viewport meta, so the in-map gesture still works as expected. The viewport restriction only blocks the *browser's* pinch from rescaling the page chrome.

### Sign in — block attempts when offline, clearer error message

- **The misleading message.** Submitting the login form offline used to fall through the SW's 503 translation into the generic catch block, which surfaced "Login failed. Check your credentials." — making users think their password was wrong when actually their phone had no signal.
- **The fix.** [explore/login.html](ui_vp/uiVPAtlas/explore/login.html) — the page now reads `navigator.onLine` at load time and on `online`/`offline` events, disables the Sign In button while offline, and shows "You're offline. Sign in needs a network connection — try again once you reconnect." in place of the form's status line. The submit handler also short-circuits on offline before calling the API. The catch block now distinguishes a network failure (SW 503, "Failed to fetch", `navigator.onLine === false`) from a real auth error and renders "Couldn't reach the server. Check your connection and try again." for the network case. Real credential errors keep the existing message.

### Changelog — works offline now

- **The gap.** The hamburger Changelog link sends users to `/docs/`, which routes through the SW's navigation handler. `/docs/index.html` and the `CHANGELOG-*.md` files weren't precached, so a user clicking Changelog offline got a 503 from the SW (the file wasn't in any cache).
- **The fix.** [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) — new `// === Documentation / changelog ===` block adds `/docs/`, `/docs/index.html`, and every existing daily changelog (`CHANGELOG-2026-05-01.md` through `CHANGELOG-2026-05-10-partial.md`). The docs page's runtime fetches now hit the precache instead of the network when offline.
- **Workflow rule extended.** The "Changelog — REQUIRED workflow" section in [CLAUDE.md](CLAUDE.md) and the matching memory entry now say: when adding a new daily changelog file, add it to BOTH `docs/index.html` `DOCS` array AND `urlsToCache.js`. When a `-partial` rolls into its final form, update both lists.

### Documentation — single canonical changelog location + workflow rule

- **Repo-root duplicates removed.** Daily `CHANGELOG-2026-05-*.md` files were being maintained in two places: the repo root and [ui_vp/uiVPAtlas/docs/](ui_vp/uiVPAtlas/docs/). Only the latter is served by the app (`/docs/` resolves there via `app.use('/', express.static('uiVPAtlas'))` in `ui_vp/server.js`). The root copies were byte-identical duplicates with no consumer; deleted.
- **05-06 partial finalized, 05-09 indexed, 05-10 partial created.** The 2026-05-06 changelog is now the full v3.5.181 – v3.5.197 version (was a partial covering only v3.5.181 – v3.5.190); 2026-05-09 (v3.5.198 – v3.5.231) added to the in-app changelog index; this 2026-05-10 partial created. [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) `DOCS` array updated; the old `CHANGELOG-2026-05-06-partial.md` removed.
- **New workflow rule in [CLAUDE.md](CLAUDE.md).** "Changelog — REQUIRED workflow" section: every user-visible change must ship with an entry in today's `CHANGELOG-YYYY-MM-DD(-partial).md` under `ui_vp/uiVPAtlas/docs/` in the same change. If today's file doesn't exist, create it with the `-partial` naming and add to the `DOCS` array. The repo's commit messages are uniformly `deploy vunknown`, so the changelog is the only place the *why* lives — losing entries to "I'll batch them later" is now structurally discouraged.

### Service worker / build

- **Seven patch versions** — `manifest.json` 3.5.231 → 3.5.238 via `node sw-build.js` (one bump per deploy: near-me live tracking, docs cleanup, pinned-pool visibility, changelog + workflow rule, cold-load fit-both + viewport pinch lockdown, zoom-to-both ignores hidden markers, offline sign-in + offline changelog).
- **`urlsToCache.js` grew by 10 entries** — `/docs/`, `/docs/index.html`, and the eight existing changelog `.md` files. Validator unaffected (the docs index has no static `<script>`/`<link>` deps the validator would walk).
