# Changelog — Snapshot 2026-05-10 (partial)

## v3.5.232

Partial day's work; additional changes may land later under a follow-up
2026-05-10 changelog.

### Explore — "Pools near me" now follows you live

- **The gap.** The Near Me filter captured a single `getCurrentPosition` fix when the checkbox was toggled on and stored it as a static `nearMeOrigin`. Once on, the radius origin never moved — opening the app or returning to the home page after walking a few hundred meters showed a list of pools centered on yesterday's location until the user manually toggled the filter off and on again.
- **The fix.** [explore/js/filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js) — Near Me now drives a `GPSMonitor` (`watchPosition`) instead of a one-shot fix. Lifecycle is tied to the checkbox: `startNearMeTracking()` on toggle-on, `stopNearMeTracking()` on toggle-off (and on token-X removal, which dispatches a `change` event into the same handler). The first position event fulfills the toggle's "Locating…" promise; subsequent events update `filters.nearMeOrigin` in place and call `applyFilters()` to re-run the three-pane render.
- **15 m movement threshold.** Position events at ~1 Hz would re-render the pool list / map / summary too often on a stationary GPS that's jittering inside its own accuracy circle. After the first fix, subsequent fixes only re-apply when the user has moved at least 15 m from the origin currently in use. Origin within `filters` always reflects the last *applied* position (so stepper changes and persistence stay in sync); the live fix is held in the `GPSMonitor` instance until it crosses the threshold.
- **Auto-resume on cold load.** When `nearMeKm > 0 && nearMeOrigin` is restored from IndexedDB at page load, `initFilterBar` kicks off `startNearMeTracking({ silent: true })` automatically — same as if the user had toggled the filter on themselves. The first fresh fix re-renders the panes with the current location, replacing whatever stale origin was carried over from the previous session. The filter no longer goes stale across app launches or page navigations.
- **Two GPS monitors, one watch.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html)'s existing auto-click of the map's GPS button on resume is unchanged. Both GPSMonitor instances (the map's and the filter's) share the `gps-shared` BroadcastChannel, so only one tab actually calls `watchPosition` — the other goes passive and receives positions over the channel. No extra battery cost, no duplicate permission prompt.

### Documentation

- **Changelogs rolled forward.** The 2026-05-06 partial finalized to its full form (v3.5.181 – v3.5.197), 2026-05-09 (v3.5.198 – v3.5.231) added to the in-app changelog index, this 2026-05-10 partial created. [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) `DOCS` array updated; old `CHANGELOG-2026-05-06-partial.md` removed from `docs/`.

### Service worker / build

- **One patch version** — `manifest.json` 3.5.231 → 3.5.232 via `node sw-build.js`. No new files in `urlsToCache.js` (the docs folder isn't precached; the changelog page is online-only).
