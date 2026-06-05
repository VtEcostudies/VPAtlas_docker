# Changelog — Snapshot 2026-06-05 (partial)

Partial day's work; additional changes may land later under a follow-up
2026-06-05 changelog.

## v3.5.356 – v3.5.357

### Reviews — Pool Locator checkbox now actually moves the pool on the map

- **The bug.** Ticking *Pool Locator → Yes* on [admin/review_create.html](ui_vp/uiVPAtlas/admin/review_create.html) and saving was supposed to relocate the pool to the visit's GPS coordinates. The database trigger `set_vpmapped_geolocation_from_vpvisit_coordinates()` had been firing on `vpreview` insert/update for some time, and it DID update `vpmapped."mappedPoolLocation"` (the PostGIS geometry column) — but the UI everywhere reads the **scalar** `mappedLatitude`/`mappedLongitude` columns, which the trigger never touched. Result: geometry column was correct, but every map view, every API call, every GeoJSON export kept showing the old position. Looked from the outside like the Pool Locator feature simply didn't work.
- **The fix.** New migration [db_migrate/migrations/018_review_pool_locator_updates_lat_lon.sql](db_migrate/migrations/018_review_pool_locator_updates_lat_lon.sql) — `CREATE OR REPLACE FUNCTION` that keeps every existing gate and side-effect (only acts when `reviewPoolLocator` is true, still clears the flag on other reviews of the same pool to preserve the pseudo-uniqueness constraint), and additionally writes `mappedLatitude` and `mappedLongitude` from the visit's coordinates so all three location columns stay in sync.
- **Side benefit — town reassignment now happens for free.** Updating `mappedLatitude`/`mappedLongitude` fires the existing `set_geometry_townid_from_pool_lat_lon()` trigger, which recomputes `mappedTownId` from the new coordinates. So if a Pool Locator move crosses a town boundary, the pool's town/county also update automatically — previously you had to edit the pool separately.
- **No code or UI changes required.** The form was already submitting `reviewPoolLocator: true/false` correctly. The triggers were already wired to the right INSERT/UPDATE events. The fix is purely the function body. After applying migration 018 and rebuilding `api_vp` is *not* needed — function changes don't affect `staticColumns`.
- **Verified locally.** Inserted a test review on pool MLS1937 / visit 897 inside a transaction (rolled back). Before: `mappedLatitude = 43.37076311`, `mappedLongitude = -72.91822764`. After trigger fired: lat/lon both match the visit's `43.37076311 / -72.91822760`, and the PostGIS geometry rebuilt to the same point. Old behavior (only the geometry column updated) is gone.

### Documentation — finalized 2026-06-03 partial (2 days stale)

- Closed out `CHANGELOG-2026-06-03-partial.md` → [CHANGELOG-2026-06-03.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-06-03.md) per the daily roll-over rule. Dropped `(partial)` from H1 and removed the boilerplate paragraph. Updated [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) precache block and the [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) DOCS array.

### Service worker / build

- `manifest.json` 3.5.355 → 3.5.357 via `node sw-build.js patch` (two bumps: 3.5.356 was the local sw-build after the urlsToCache changelog-list edit; 3.5.357 was the additional patch bump that `deploy-prod.sh deploy` runs internally). **DB-only** behavior change — no JS/HTML/CSS files changed for the fix itself. The version bump is solely to invalidate clients' cached copy of [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) and [docs/index.html](ui_vp/uiVPAtlas/docs/index.html), which were edited only to add today's changelog file and finalize yesterday's. **Shipped to prod** at 2026-06-05 15:14 UTC; migration 018 applied via `db_migrate_vp_prod` (60 ms, 0 failures).
