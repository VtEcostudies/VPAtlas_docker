# VPAtlas Docker — Project Guide

## What This Is
VPAtlas is a vernal pool ecological data management system for Vermont. This repo (`VPAtlas_docker`) is the new Dockerized rewrite, migrating from an Angular 14 app (`VPAtlas_orig`) to plain HTML/JS/CSS following patterns established in LoonWeb.

## Architecture

### Docker Stack (`docker-compose-vpatlas.yml`)
- **db_vp** — PostgreSQL 17 + PostGIS 3.5 on port 5433. Data in `db_data_vp/`.
- **api_vp** — Node.js/Express API on port 4010. Source in `api_vp/`. Copied from `VPAtlas_orig/VPAtlas-node-api/` with env-var config overlay.
- **ui_vp** — Nginx serving static files on port 8090. Source in `ui_vp/uiVPAtlas/`.

### Key Commands
```bash
docker compose -f docker-compose-vpatlas.yml up -d          # Start all
docker compose -f docker-compose-vpatlas.yml up -d --build ui_vp  # Rebuild UI only
./db_restore.sh                                              # Restore from db_backup/*.backup
./test_stack.sh                                              # Run full test suite (61 tests)
```

### Database
- Restored from `db_backup/vpatlas_*.backup` (pg_dump custom format, ~220MB)
- SSH tunnel to live DB: `~/AWS/ssh_vpatlas_tunnel.sh` (maps localhost:5432 to vpatlas.org)
- API columns endpoint: `/pools/columns` — `countyName` is NOT in static columns for `/pools` (it's a JOIN alias); `townCountyId` is. County names in DB are UPPERCASE.
- Town names are mixed case (e.g. "Addison"), county names are uppercase (e.g. "ADDISON").

### Git
- Remote: `https://github.com/VtEcostudies/VPAtlas_docker.git`
- User: `jloomisVCE` / `jloomis@vtecostudies.org`
- PAT at `~/.ssh/github_personal_access_token`

## UI Architecture (`ui_vp/uiVPAtlas/`)

### Pattern: ES6 Modules (matching LoonWeb)
- Plain HTML/JS/CSS, no framework
- ES6 `import/export` modules loaded with `<script type="module">`
- Functional style (no classes in explore app)
- IndexedDB via idb-keyval for persistence (storage.js)
- Bootstrap 5.2.3, Font Awesome 6.6, Leaflet 1.9.4

### Explore App (`explore/`)
Three-pane layout: pool list (left), map (center), summary (right).

**Single data flow** — all three panes driven from the same filtered rows:
```
loadPools() → deduplicateByPoolId() → filterRowsByDataType() → poolRows
  ├── renderPoolTable(poolRows)      // left pane
  ├── plotPoolRows(poolRows)         // map
  └── showScopeSummary(poolRows)     // right pane
```

**JS Modules:**
| File | Purpose |
|------|---------|
| `url_state.js` | Filter state, URL sync, IndexedDB persistence, buildSearchTerm() |
| `filter_bar.js` | Filter UI: data-type buttons, pool ID search (type-ahead ILIKE), town/county multi-select with tokens, status checkboxes |
| `pool_list.js` | Fetches `/pools`, deduplicates by poolId, applies data-type filter, renders table |
| `map.js` | Leaflet map with VCGI/ESRI/OSM basemaps, boundary overlays, pool markers |
| `pool_summary.js` | Right pane: scope-aware summary (no selection) or pool detail (selection) |
| `api.js` | All fetch calls to the API |
| `auth.js` | JWT login/logout/register |
| `storage.js` | IndexedDB wrapper (idb-keyval) |
| `modal.js` | Modal dialog system |
| `utils.js` | Date formatting, helpers |

**Filter System:**
- Primary data-type buttons: All, Visited, Monitored, Mine (logged-in), Review (admin)
- Pool ID: partial match with ILIKE wildcards and type-ahead dropdown
- Town/County: multi-select with type-to-filter, rendered as removable tokens
- Pool Status: checkboxes (default: Potential, Probable, Confirmed)
- All filters persist to IndexedDB and restore on page load
- URL params take priority over stored filters

**Map Markers:**
- Color = pool status: Potential→goldenrod(#DAA520), Probable→cyan(#00BFFF), Confirmed→dark blue(#00008B)
- Shape = highest survey level: potential→circle, visited→triangle, monitored→diamond
- Icon size scales with zoom (10px→28px)
- Clickable county/town boundary overlays zoom to bounds
- VCGI tile layers: CIR, Leaf-Off, Lidar DEM/DSM/Slope/SlopeSym

**Auth Pages:** `login.html`, `register.html` (functional, JWT-based)

### Shared Assets (`js/`, `css/`, `geojson/`)
- `config.js` — runtime config (API URL from env var or default)
- `app.js` — service worker registration, calls `window.initApp()`
- `geojson/` — VT state/county/town/biophysical boundary polygons

## API Layer (`api_vp/`)

Copied from `VPAtlas_orig/VPAtlas-node-api/` with a config.js overlay that reads env vars.

**Key endpoints:**
- `GET /pools` — joined vpmapped+vpvisit+vpreview+vpsurvey (returns multiple rows per pool)
- `GET /pools/overview` — lighter version with same JOIN
- `GET /pools/mapped` — vpmapped only (has countyName in columns)
- `GET /pools/mapped/geojson` — GeoJSON for map
- `GET /pools/mapped/stats` — count stats
- `GET /vtinfo/counties`, `/vtinfo/towns` — reference data
- `GET /pools/mapped/poolId/:poolId` — single pool detail
- `GET /pools/visit/poolId/:poolId` — visits for a pool

**API query param syntax:** DB column names with optional pipe operator:
```
?mappedPoolId|ILIKE=%NEW%    → WHERE "mappedPoolId" ILIKE '%NEW%'
?mappedPoolStatus=Confirmed  → WHERE "mappedPoolStatus" = 'Confirmed'
?townName=Stowe              → repeated params become IN(...)
```

## Survey Types
Two distinct survey sub-apps needed (not yet built):
- **vpvisit** — Pool visit observations: 5-page form (Location, Landowner, Field Verification, Pool Characteristics, Indicator Species). ~80 fields.
- **vpmon** — Pool monitoring with different data collection criteria.

Each needs its own SurveyState class, GPS tracking, and offline-first PWA support. Pattern from LoonWeb at `/home/jloomis/Docker/VCE_db_docker/ui_csup/uiLoonWeb/survey/`.

## What's Been Built
- [x] Docker stack (db, api, ui) with docker-compose
- [x] DB restore from backup
- [x] API with env-var config overlay
- [x] Explore page: three-pane layout, all filters working
- [x] Filter token system (from CSWG BeeWiki pattern)
- [x] Map with VCGI basemaps, boundary overlays, shaped/colored pool markers
- [x] IndexedDB filter persistence
- [x] Auth pages (login, register)
- [x] Test suite (61 tests via test_stack.sh)

## What's NOT Built Yet
- [ ] Pool detail page (pool_view.html)
- [ ] Pool create/edit form (pool_create.html)
- [ ] Visit create/edit form (visit_create.html)
- [ ] Review list and survey list pages
- [ ] Profile and admin pages
- [ ] Survey sub-apps with GPS tracking (vpvisit + vpmon)
- [ ] PWA service worker with offline caching
- [ ] Full migration from config.json files to Docker env vars

## Design Preferences
- Evolve config toward Docker env vars, not JSON config files
- ES6 modules, functional style (no classes in UI except SurveyState for surveys)
- Follow LoonWeb patterns for survey GPS tracking, wake lock, offline-first
- Filter token pattern from CSWG BeeWiki (`/home/jloomis/cSWG/api/beewiki/public/js/beewiki-filters.js`)
- Single data flow: one fetch drives list + map + summary
- Pool status colors: Potential=goldenrod, Probable=cyan, Confirmed=dark blue
- Pool shapes by survey level: potential=circle, visited=triangle, monitored=diamond

## Offline / Service Worker — REQUIRED workflow
This is a public PWA used by volunteers in the field, often without connectivity. Every static asset the app needs offline must be precached.

**When you create a new client-side file under `ui_vp/uiVPAtlas/`** — `.html`, `.js`, `.css`, font, image, GeoJSON, audio, etc. — **add it to [`ui_vp/uiVPAtlas/urlsToCache.js`](ui_vp/uiVPAtlas/urlsToCache.js) in the same change.** Do not skip this step; the file will silently work in dev (network present) and break in the field.

Exceptions (do NOT precache):
- Files matching `STATIC_NO_CACHE_PATTERNS` in `sw_template.js` (e.g. `/images/speed-test*.jpg` — bandwidth probes must always hit the network).
- API endpoints — those are handled by `DATA_CACHE_PATTERNS` / network-first logic in the SW, not by `urlsToCache`.
- One-off admin tools you don't expect users to need offline (rare — when in doubt, cache it).

After editing `urlsToCache.js`, rebuild the SW so the version bumps and clients pick up the new precache list:
```bash
node ui_vp/uiVPAtlas/sw-build.js
docker compose -f docker-compose-vpatlas.yml up -d --build ui_vp
```

When you delete or rename a file under `ui_vp/uiVPAtlas/`, also remove/rename its entry in `urlsToCache.js` — a stale entry causes precache install to fail with a 404 and the SW won't update.

## Reference Projects
- **VPAtlas_orig**: `/home/jloomis/VPAtlas/VPAtlas_orig/` — Angular 14 source (being replaced)
- **LoonWeb**: `/home/jloomis/LoonWeb/` or `/home/jloomis/Docker/VCE_db_docker/ui_csup/uiLoonWeb/` — reference implementation for PWA, survey GPS, ES6 module patterns
- **CSWG BeeWiki**: `/home/jloomis/cSWG/api/beewiki/` — filter token UI pattern
- **LoonWeb iOS wrapper**: `/home/jloomis/Docker/VCE_db_docker/LoonWebSurvey-iOS/` — PWA-in-WebView pattern for App Store distribution
