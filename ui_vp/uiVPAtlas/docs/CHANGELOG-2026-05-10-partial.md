# Changelog — Snapshot 2026-05-10 (partial)

## v3.5.232 – v3.5.235

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

### Documentation — single canonical changelog location + workflow rule

- **Repo-root duplicates removed.** Daily `CHANGELOG-2026-05-*.md` files were being maintained in two places: the repo root and [ui_vp/uiVPAtlas/docs/](ui_vp/uiVPAtlas/docs/). Only the latter is served by the app (`/docs/` resolves there via `app.use('/', express.static('uiVPAtlas'))` in `ui_vp/server.js`). The root copies were byte-identical duplicates with no consumer; deleted.
- **05-06 partial finalized, 05-09 indexed, 05-10 partial created.** The 2026-05-06 changelog is now the full v3.5.181 – v3.5.197 version (was a partial covering only v3.5.181 – v3.5.190); 2026-05-09 (v3.5.198 – v3.5.231) added to the in-app changelog index; this 2026-05-10 partial created. [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) `DOCS` array updated; the old `CHANGELOG-2026-05-06-partial.md` removed.
- **New workflow rule in [CLAUDE.md](CLAUDE.md).** "Changelog — REQUIRED workflow" section: every user-visible change must ship with an entry in today's `CHANGELOG-YYYY-MM-DD(-partial).md` under `ui_vp/uiVPAtlas/docs/` in the same change. If today's file doesn't exist, create it with the `-partial` naming and add to the `DOCS` array. The repo's commit messages are uniformly `deploy vunknown`, so the changelog is the only place the *why* lives — losing entries to "I'll batch them later" is now structurally discouraged.

### Service worker / build

- **Four patch versions** — `manifest.json` 3.5.231 → 3.5.235 via `node sw-build.js` (one bump per deploy: near-me live tracking, docs cleanup, pinned-pool visibility, this changelog + workflow rule deploy). No new files in `urlsToCache.js` (the docs folder isn't precached; the changelog page is online-only).
