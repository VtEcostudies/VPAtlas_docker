# Changelog — Snapshot 2026-05-12 (partial)

## v3.5.245

Partial day's work; additional changes may land later under a follow-up
2026-05-12 changelog.

### Explore — pool ID filter clear-X surfaced on reload + no map yank

- **Missing X on reload.** The pool ID search input had a clear-X button wired in [explore/js/filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js) that only appeared after the user typed into the field. On page reload with a persisted `poolIdSearch`, the input was repopulated from IndexedDB but the X stayed hidden — so the user had to manually delete the value character-by-character or use the filter token in the row below. Fixed by also showing the X when the persisted value is restored at the end of `initFilterBar`.
- **Map no longer yanks on clear.** Clearing the pool ID filter (via either the input X or the filter token X) used to fire `applyFilters()` which cascades into `refreshUI()` → `zoomToFilteredPools()` — yanking the map back to bounds of every visible pool. The user was usually still focused on the same area and didn't want the view reset. `applyFilters()` now accepts an `opts` object; both pool-ID clear paths pass `{ noZoom: true }`. The option plumbs through `onFilterChange(filters, opts)` to `refreshUI(opts)`, where `if (!opts.noZoom) zoomToFilteredPools()` skips the fit. Other filter removals (town, county, status, near me) still re-zoom as before.

### Service worker / build

- **One patch version** — `manifest.json` 3.5.244 → 3.5.245 via `node sw-build.js`.
- **`urlsToCache.js`** picked up the new `/docs/CHANGELOG-2026-05-12-partial.md` entry (per the changelog workflow rule).
