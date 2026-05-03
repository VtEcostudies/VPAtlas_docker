# Changelog

## v3.5.20–3.5.27 (2026-04-30 – 2026-05-01)

### Offline / PWA

- **Full offline pool data caching** — visit and survey summaries are now bulk-fetched and cached in IndexedDB on app startup. Clicking any pool while offline shows pool detail, visits, and surveys from cache. Affects explore pool summary, pool view, pool create, PoolFinder, and visit create.
- **New API endpoints** — `GET /pools/visit/summary` and `GET /survey/summary` return lightweight bulk summaries (4–5 fields per row) for offline caching.
- **New module: `pool_data_cache.js`** — central offline data access layer with `getPoolById()`, `getVisitsByPoolId()`, `getSurveysByPoolId()`, and background cache population.
- **Persistent tile cache** — map tiles now persist across SW version updates instead of being wiped on every bump. Old versioned tile caches are migrated automatically.
- **SW data cache patterns** — added `/pools/visit/summary` and `/survey/summary` to the service worker's data cache for belt-and-suspenders offline coverage.

### Parcel / Landowner Layer

- **New module: `parcels.js`** — VCGI parcel data with on-demand fetching, Leaflet layer toggle, and point-in-polygon lookup.
- **Landowner info in pool summary** — pool detail pane now shows landowner name, address, town, and acreage from VCGI parcel data via ray-casting point-in-polygon.
- **Parcel layer on explore map** — toggleable parcel boundary overlay with cached data.

### Explore UI

- **Visit list page** — new `visit_list.html` for browsing visits.
- **Pool view improvements** — expanded `pool_view.html` with more detail.
- **PoolFinder clear button** — pool selection badge in the list header now has a clear (×) button to deselect all pools at once.
- **Explore layout and styling** — updated `index.html` layout, `common.css` cleanup, and map styling improvements.

### Survey / Visit System

- **PoolFinder** — renamed from `survey_start.html` to `find_pool.html`. Updated navigation and pool selection with offline fallback.
- **Visit sync overhaul** — `visit_sync.js` significantly expanded with improved upload flow.
- **Visit store refactor** — `visit_store.js` simplified.
- **Visit queue UI** — `visit_queue_ui.js` and `visit_queue.css` updated with new features.
- **Visit create** — `visit_create.html` updated with offline pool lookup fallback and form improvements.

### API

- **Atomic pool+visit creation** — new `vpVisitNew.service.js` for creating a pool and visit in a single transaction.
- **Visit photo service** — new `vpVisitPhoto.service.js` for photo upload handling.
- **Visit routes** — expanded `vpVisit.routes.js` with photo upload, summary, and new pool+visit endpoints.

### Build / DevOps

- **Fixed version drift** — removed `sw-build.js` from Dockerfile so container version always matches local source. Version bump is now local-only before `docker compose build`.
- **Test suite expanded** — `test_stack.sh` grew from 61 to 68 tests, adding authenticated API tests (create pool, create visit, create pool+visit, update visit) with auto-provisioned test user.
- **Photo data** — sample visit photos added to `photo_data/` for testing.
