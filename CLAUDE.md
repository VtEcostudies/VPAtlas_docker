# VPAtlas Docker — Project Guide

## 🔒 Locked decisions — re-read before every non-trivial change

These are explicit user-locked rules. Do **not** violate without going back
to the user and re-discussing. When in doubt, scan this list first. Each
entry: rule + date logged + short rationale; click through to memory for
the full why.

- **No cache-key suffix bumps in code** (2026-05-13) — Do not bump
  `POOL_CACHE_KEY` / sibling keys in [/js/cache_keys.js](ui_vp/uiVPAtlas/js/cache_keys.js)
  as a stale-cache fix. **Reset App** on
  [/admin/profile.html](ui_vp/uiVPAtlas/admin/profile.html) is the user-side
  invalidation mechanism. Make consumers tolerant of older cached schemas
  instead. A code-side bump forces every active user to refetch the full
  ~98 MB `/pools` payload — heavy-handed and not what we want from a deploy.
- **Patch-only versioning, stay in 3.5.x** — No major or minor bumps until
  told otherwise. `node sw-build.js patch` only.
- **Every user-visible change → today's changelog, same commit** — See
  the *Changelog* workflow section below. No batching.
- **Every new client-side file → urlsToCache.js, same commit** — Public PWA,
  field-offline use. See the *Offline / Service Worker* workflow section.
- **Changelogs live ONLY in [ui_vp/uiVPAtlas/docs/](ui_vp/uiVPAtlas/docs/)** —
  Never duplicate at the repo root; that path isn't served.
- **`api_vp/**` edits require `up -d --build api_vp`** — A plain `restart`
  keeps old code.
- **Daily changelog roll-over closes older partials** (2026-05-20) — Every
  time a new `CHANGELOG-YYYY-MM-DD-partial.md` is created, scan
  [ui_vp/uiVPAtlas/docs/](ui_vp/uiVPAtlas/docs/) for any older `-partial.md`
  files and finalize them **in the same change**: verify the entries cover
  every user-visible change that landed on that date, rename the file (drop
  `-partial`), update the H1 (drop `(partial)`), and update both
  `urlsToCache.js` and `docs/index.html` DOCS array. A `-partial` file
  older than yesterday is a missed roll-over. See *Changelog — REQUIRED
  workflow → Daily roll-over rule* below for mechanics.
- **No prod deploys without explicit OK** (2026-05-26) — Do **not** run
  anything that reaches `vpatlas.org` / `api.vpatlas.org` (e.g. a
  `deploy-prod.sh`, an `ssh ubuntu@vpatlas.org` build/restart, a `git push`
  to a branch that auto-deploys to prod) until the user explicitly says
  "deploy to prod" / "deploy to production" / "deploy live". The local
  dev rebuild (`docker compose ... up -d --build ui_vp`) and
  `deploy/deploy-dev.sh deploy|ui|logs` (which targets the dev.vpatlas.org
  stack) remain fine as routine workflow. When in doubt → ask, don't run.

How to add a new locked decision: when the user says "we decided X" /
"don't do Y" / "from now on Z," append a bullet here in the same change.
Date it. Cross-reference a memory file if there's a longer rationale.

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
./db_dump_restore/db_backup.sh                               # Backup → db_backup/vpatlas_vp_complete_YYYYMMDD.sql.gz (cron pattern)
./db_dump_restore/db_restore.sh vp db_backup/<file>.sql.gz   # Restore from a .sql.gz dump (preferred)
./db_restore.sh                                              # Legacy restore from db_backup/*.backup (used by deploy scripts)
./test_stack.sh                                              # Full smoke suite (must run after every deploy)
./ui_vp/uiVPAtlas/test-offline-serve.sh                      # Just the offline-deliverability slice
```

The `db_dump_restore/` pipeline mirrors LoonWeb's so the two projects' backup
systems operate identically. Designed to be cron'd on the vpatlas server,
not run from a dev machine — see [`db_dump_restore/README.md`](db_dump_restore/README.md)
for the cron line, optional `~/.vpatlas_backup.conf` (S3 + SNS), and the
post-restore migration step.

### Required deploy sequence
After UI/API changes, run all three — see `feedback_build_workflow.md`:

1. `node ui_vp/uiVPAtlas/sw-build.js patch` — bump version + regen sw.js (precache validator runs first).
2. `docker compose -f docker-compose-vpatlas.yml up -d --build ui_vp` (add `api_vp` when `api_vp/**` changed).
3. `./test_stack.sh` — must report zero failures. Includes the **Offline deliverability** section that runtime-checks every URL in `urlsToCache.js` against the live ui_vp (runtime complement to sw-validate's build-time graph check). Catches "in the list but not actually served" regressions.

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

## Offline contract — READ [`OFFLINE_CONTRACT.md`](OFFLINE_CONTRACT.md) BEFORE TOUCHING app.js / sw_template.js / urlsToCache.js / any data load

Offline is a **normal expected state, not an error.** The same regression
has been reintroduced many times: code calls `fetch()` unconditionally →
SW returns 503 offline → 503 thrown → page shows an error instead of using
cache. **The rule:** network available → fetch, fall back to cache on
failure; network unavailable → do NOT fetch, use cache/IndexedDB, show no
error. The only sanctioned online check is `isOnline()` in
[`js/net_status.js`](ui_vp/uiVPAtlas/js/net_status.js) — never bare
`navigator.onLine` (unreliable on captive portals / webviews). `app.js`
must never unregister the SW; the SW's cache-fallback handlers must stay
cache-first. Full rules + required manual offline test in
[`OFFLINE_CONTRACT.md`](OFFLINE_CONTRACT.md).

## SW update flow — READ [`SW_UPDATE_FLOW.md`](SW_UPDATE_FLOW.md) BEFORE TOUCHING app.js update logic / sw_template.js

Parallel rule for the update-path side of the same files. The page-side
update logic in [`ui_vp/uiVPAtlas/js/app.js`](ui_vp/uiVPAtlas/js/app.js)
has three loop-defense gates (30 s cooldown, 3-in-5-min cap, bandwidth
probe). Each can silently block a legitimate update. The most recent
regression — single deploys not showing the new version — came from a
pre-emptive cooldown stamp inside `activateWaitingSW()` that poisoned
the RELOAD broadcast's own cooldown check. **Cooldown must only be
stamped at the actual `window.location.reload()` call, never during
activation.** Full happy-path table, gate semantics, localStorage keys,
diagnostic recipe, and required manual test in
[`SW_UPDATE_FLOW.md`](SW_UPDATE_FLOW.md).

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

## Changelog — REQUIRED workflow
Every user-visible change ships with a changelog entry. This is the only record we keep of *why* a change happened, since commit messages on this repo are uniformly `deploy vunknown`.

**When you make any user-visible change** — bug fix, feature, UI tweak, behavior change, new page, API change, migration — **add an entry to today's running changelog under [`ui_vp/uiVPAtlas/docs/`](ui_vp/uiVPAtlas/docs/) in the same change.** Don't batch entries for later; you'll forget the context.

Naming and location:
- Daily file format: `CHANGELOG-YYYY-MM-DD.md` (use today's local date).
- Until the day is "closed" (work continues), name it `CHANGELOG-YYYY-MM-DD-partial.md` and title the H1 `# Changelog — Snapshot YYYY-MM-DD (partial)`. Drop the `-partial` suffix and the `(partial)` qualifier when the day's work is finalized.
- File lives ONLY in [`ui_vp/uiVPAtlas/docs/`](ui_vp/uiVPAtlas/docs/) — never duplicate at the repo root.
- After creating a new daily file, add it to **two** lists (both — missing either one breaks the offline experience):
  1. The `DOCS` array (newest first) in [`ui_vp/uiVPAtlas/docs/index.html`](ui_vp/uiVPAtlas/docs/index.html) — controls what appears in the in-app changelog menu.
  2. The `// === Documentation / changelog ===` block in [`ui_vp/uiVPAtlas/urlsToCache.js`](ui_vp/uiVPAtlas/urlsToCache.js) — without this the file isn't precached, so users navigating to the changelog page offline get a 503. When a `-partial` is renamed to its final form, update both lists.

Entry style (match the existing format in nearby files):
- Top of file: `# Changelog — Snapshot YYYY-MM-DD` (or `(partial)`), blank line, `## v3.5.NNN` (or `v3.5.NNN – v3.5.MMM` for a span), blank line.
- Group changes under `### Section heading` (e.g. "Explore — Pools near me", "Service worker / build", "Documentation").
- Lead each bullet with a bold one-line claim (`**The gap.**`, `**The fix.**`, `**Why.**`), then a sentence or two of detail. Cite the file(s) you touched as markdown links: `[explore/js/filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js)`.
- Always include a `### Service worker / build` section noting the version bump (e.g. `manifest.json 3.5.NNN → 3.5.MMM`) and any `urlsToCache.js` changes.
- Don't write entries for purely internal changes (writing a memory file, asking the user a clarifying question, doc-only tweaks the user wouldn't see). Do write entries for anything a user could observe in the running app.

If today's file doesn't exist yet, create it with the `-partial` naming and title, add to the index, and add your entry. Don't append today's entry to yesterday's file.

**Daily roll-over rule — close out older partials whenever you create today's.** When you create a new day's `CHANGELOG-YYYY-MM-DD-partial.md`, in the same change scan [`ui_vp/uiVPAtlas/docs/`](ui_vp/uiVPAtlas/docs/) for any older `-partial.md` files and finalize each one:

1. **Verify completeness.** Skim the file's existing entries against `git log --since=YYYY-MM-DD --until=YYYY-MM-(DD+1) --oneline -- ui_vp/uiVPAtlas/` for that date. Append any missing user-visible entries before finalizing — that's the last chance to capture them, since after finalization the file is the historical record.
2. **Rename the file.** `CHANGELOG-YYYY-MM-DD-partial.md` → `CHANGELOG-YYYY-MM-DD.md`.
3. **Update the H1.** `# Changelog — Snapshot YYYY-MM-DD (partial)` → `# Changelog — Snapshot YYYY-MM-DD`. Remove the boilerplate "Partial day's work; additional changes may land later under a follow-up YYYY-MM-DD changelog." paragraph if it's still there.
4. **Update both index lists** — the `// === Documentation / changelog ===` block in [`urlsToCache.js`](ui_vp/uiVPAtlas/urlsToCache.js) (precache: drop `-partial.md` from the path) AND the `DOCS` array in [`docs/index.html`](ui_vp/uiVPAtlas/docs/index.html) (both `file:` and `title:` fields: drop `-partial` and `(partial)`). Missing either breaks the offline changelog view with a 503.

A `-partial` file older than yesterday is a missed roll-over and needs catching up immediately. The mechanical sequence (rename → H1 → urlsToCache → docs/index → sw-build → today's changelog entry → rebuild) is the same as any other doc workflow.

## Reference Projects
- **VPAtlas_orig**: `/home/jloomis/VPAtlas/VPAtlas_orig/` — Angular 14 source (being replaced)
- **LoonWeb**: `/home/jloomis/LoonWeb/` or `/home/jloomis/Docker/VCE_db_docker/ui_csup/uiLoonWeb/` — reference implementation for PWA, survey GPS, ES6 module patterns
- **CSWG BeeWiki**: `/home/jloomis/cSWG/api/beewiki/` — filter token UI pattern
- **LoonWeb iOS wrapper**: `/home/jloomis/Docker/VCE_db_docker/LoonWebSurvey-iOS/` — PWA-in-WebView pattern for App Store distribution
