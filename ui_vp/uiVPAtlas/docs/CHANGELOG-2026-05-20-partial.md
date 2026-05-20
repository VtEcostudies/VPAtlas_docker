# Changelog — Snapshot 2026-05-20 (partial)

## v3.5.284 – v3.5.295

Partial day's work; additional changes may land later under a follow-up
2026-05-20 changelog.

### Production cutover — vpatlas.org is now the docker rewrite

- **What changed.** `vpatlas.org` now serves the new docker UI (this app). The legacy Angular site at `/var/www/vpatlas` has been retired (snapshot preserved for rollback). API moved from `vpatlas.org:4322` to a proper `api.vpatlas.org` subdomain, fronted by nginx with SSL.
- **Data.** A fresh `pg_dump` of the legacy production DB was restored into the new docker stack and all 16 dev-era migrations were applied. 34 real visits from dev (kevtolan, mbrios94, jloomis), 9 new pools (NEW1507–NEW1515), 31 photos, and 1 track were harvested over to the new system. 25 dev visits that already existed in prod via Survey123 dual-write were skipped.
- **CORS.** The Express `cors()` middleware on `api_vp_prod` and the nginx `add_header` directives were both emitting `Access-Control-Allow-Origin`, and nginx APPENDS rather than replaces, so browsers were seeing the combined string `*, https://vpatlas.org` and rejecting every API call. Fixed with `proxy_hide_header` for the four CORS keys in [deploy/nginx-api.vpatlas.org.conf](deploy/nginx-api.vpatlas.org.conf) so nginx is the only source of truth.

### Kill-switch service worker for legacy Angular installs

- **The problem.** Users who had visited the old Angular site still have its service worker (`/ngsw-worker.js`) registered in their browser. After the cutover, that SW continues to intercept every fetch on `vpatlas.org` and serve cached Angular content — they don't see the new docker app at all, even though the server has changed.
- **The fix.** New file [ngsw-worker.js](ui_vp/uiVPAtlas/ngsw-worker.js) at the legacy SW's exact path. On the next navigation, the browser does its standard SW update check, sees different bytes, installs this SW; on `activate` it deletes every cache on the origin, claims all clients, unregisters itself, and reloads every open tab. The reload hits the docker app fresh and registers `/sw.js` (the docker app's own SW) as the new controller.
- **Not precached.** Deliberately excluded from [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) — we want it served fresh from the network so the browser's update check always succeeds.

### Service worker / build

- `manifest.json` 3.5.294 → 3.5.295 via `node sw-build.js patch`.
- No `urlsToCache.js` changes (the kill switch is intentionally out of the precache).

### Home page — "Refresh Pool Data" no longer errors offline

- **The bug.** Selecting "Refresh Pool Data" from the home page hamburger menu offline fired an unconditional `refreshPools()` → `fetchAndCache()` → `fetchPools()`. Offline the SW returned 503, the catch in `fetchAndCache` painted a red *"Error loading pools: Unknown error"* in the left pane, and the user got no calm signal that the action just needs a network. Direct violation of the offline contract — offline must be silent + cache-backed, never an error.
- **The fix — menu handler.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) now gates the menu action on `isOnline()`. Offline → a calm Bootstrap warning toast: *"You're offline — pool data refresh needs a network connection."* The list pane is untouched (the existing cached rows stay rendered).
- **Defense in depth.** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) `refreshPools()` itself now returns `null` without firing a fetch when offline, so any other code path that calls it (now or later) can't accidentally trip the same 503 → red-error chain.

### Home page — admin-only "Reviewed" level chip (4th, OR-style with the other three)

- **The ask.** Admins wanted to list pools that already *have* a review. Originally implemented as an AND-style data-type button next to Mine/Review — that was the wrong slot. Reworked as a **4th level chip** alongside `Mapped` / `Visited` / `Monitored` in the lower chip row, with **OR semantics** (the level chips have always been "any of these" toggles, never "all of these").
- **The OR semantics.** A pool's mutex survey level is one of `potential` / `visited` / `monitored` (computed from row data; that's why the chips were mutex-styled). The new `reviewed` toggle is *orthogonal* — a monitored-and-reviewed pool is visible when EITHER `Monitored` OR `Reviewed` is on. Disable both and it hides. Disable just `Monitored` and reviewed-monitored pools stay (via the Reviewed chip); plain monitored pools without a review go away. That matches the user's mental model: each chip widens the visible set.
- **The chip.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) `LEVEL_CHIPS` gained a 4th entry `{ key: 'reviewed', label: 'Reviewed', adminOnly: true, … }` with a small check-mark SVG (reviewed pools render as their underlying survey-level shape on the map; the chip swatch is just iconography). `renderStatusChips` filters `LEVEL_CHIPS` by `!adminOnly || userIsAdmin` so non-admins don't see it.
- **The filter logic.** [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) introduces `isLevelVisible(level, hasReview)` — `levelVisible[level] !== false || (hasReview && levelVisible['reviewed'] !== false)`. Every marker is tagged with `_vpHasReview = !!(row.reviewId || row._hasReview)` at plot time; `plotPoolRows`, `applyFilters`, and the dispatched `map:layer-filter` rows all use `isLevelVisible` instead of the old single-key lookup. Mirror the same OR logic in [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) `applyMapVisibility()`, which feeds the left-pane list + right-pane summary.
- **Map legend parity.** The legend in [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) renders the 4th checkbox under "Survey Level" for admins only (`legendLevels = isAdmin ? [...LEVEL_ORDER, 'reviewed'] : LEVEL_ORDER`), with a count via `updateFilterCounts` (`reviewedCount` derived from `_vpHasReview` across all markers). Toggling either the legend checkbox or the chip syncs the other via the existing `setLevelVisible` / change-event flow.
- **Persistence.** `levelVisible['reviewed']` initializes from `settings.levelVisible` and writes back via `saveSettings` — same path as the three mutex levels — so admins keep their last toggle state across reloads.
- **Reverted.** The previous attempt — an admin-only `Reviewed` *data-type* button between Mine and Review in [filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js), with a `case 'Reviewed':` arm in `url_state.js` `filterRowsByDataType` and a matching scope-narrative phrase in `pool_summary.js` — was removed. Those would have made Reviewed AND-with-other-filters, which isn't what we want.

### Visit detail — no more red error when opened offline

- **The bug.** Opening a visit detail page offline (e.g. from My Visits and Tracks → tapping a server row → visit_view.html?visitId=N) called `fetchVisitById` unconditionally. Offline that hit the SW's 503, threw, and rendered `Error: https://api.dev.vpatlas.org/pools/visit/2940` in the page. Direct violation of the OFFLINE contract — offline must be silent + cache-backed.
- **The fix.** [explore/visit_view.html](ui_vp/uiVPAtlas/explore/visit_view.html) now gates the main `fetchVisitById` on `isOnline()`. Offline (and on a flaky online failure) it reads the visit from the `MY_VISITS_CACHE_KEY` snapshot written by My Visits and Tracks — the snapshot rows are flat-joined (visit + mapped fields merged on one object), which drops directly into the existing `visit/mapped` access pattern (the existing fallback already treated a flat row as both `visit` and `mapped`).
- **Photos and reviews are optional.** They have no offline cache, so both fetches are now also gated on `isOnline()`. Offline → empty arrays; the tabbed renderer's empty-state handles the rest. Lightbox + lightbox image src still won't resolve offline (photos live under `/photos/*` which isn't precached), but the page renders cleanly and the tabs work — same compromise as everywhere else.
- **Limitation made calm.** A user can only have their OWN visits in the snapshot (it's per-user, populated by `?visitObserverUserId=N`). Opening *someone else's* visit offline → no snapshot row → calm grey "This visit isn't cached on this device. Reconnect to the internet to view it." instead of a red error. The last-resort catch also detects offline and shows the calm message; the red "Error:" is reserved for genuine online failures.

### Zoom to Lat/Lon — force-prefix the longitude sign on iOS

- **The bug.** iOS Safari's `inputmode="decimal"` keyboard has no "−" key. A user opening the home page hamburger → Zoom to Lat/Lon… → Longitude couldn't enter a negative value, so any Vermont longitude was unreachable from a phone (Vermont longitudes are all ~−72 to −73).
- **The fix.** The longitude input in [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) `promptLatLng()` now force-prefixes a minus sign: on every `input` event it strips any "−" the user typed/pasted then re-prepends one. The user types `73.2121` → field shows `-73.2121`; pastes `-73.2121` → still `-73.2121`; clears the field → empty (no orphan "−"). Cursor parks at end after the rewrite (acceptable for an 8-char mobile field; left-to-right typing was already cursor-at-end). Helper text under the inputs explains the auto-prefix so the behavior reads as intentional, not buggy.
- **Two backstops** because programmatic value sets don't fire `input`: the "lat, lon" paste-split handler runs the longitude half through the same `normalizeLng()` helper, and `submit()` does one last `if (lng > 0) lng = -lng` before range-validation — so positive longitudes can't slip past via autofill or `.value=` from any other code path.

### Home page — thousands comma on the list header + "near me" in the scope narrative

- **Left pane.** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) — the "Vernal Pools (N)" title now formats `N` with `toLocaleString()` so the 13,000+ pool count reads as `13,456` instead of `13456`. The right pane's narrative already used `.toLocaleString()`; this brings the left pane in line.
- **Right pane "Pools near me" qualifier.** [explore/js/pool_summary.js](ui_vp/uiVPAtlas/explore/js/pool_summary.js) `describeCurrentView` now checks `filters.nearMeKm > 0 && filters.nearMeOrigin` and surfaces the radius in the descriptive sentence. Examples:
  - State + near-me: *"114 pools within 3.5 km of my GPS location"* (radius replaces "Statewide" — the radius **is** the geo).
  - Town + near-me: *"8 pools in Stowe and within 3.5 km of my GPS location"* (appended, because the user has intentionally narrowed by both).
  - Other filter combinations (status/level/data-type) unchanged — they slot in after the geo as before.
- One-decimal-place rounding on the kilometre value so a `3.5` stepper read renders as `3.5 km`, not `3.4999999999 km`.

### Documentation — daily roll-over rule, and 2026-05-19 finalized

- **The rule.** [CLAUDE.md](CLAUDE.md) now codifies a daily roll-over responsibility: every time a new `CHANGELOG-YYYY-MM-DD-partial.md` is created, scan [`ui_vp/uiVPAtlas/docs/`](ui_vp/uiVPAtlas/docs/) for any older `-partial.md` files and finalize each in the same change — verify entries cover the date (cross-check `git log --since=…` if uncertain), rename file (drop `-partial`), update H1 (drop `(partial)` qualifier), and update both `urlsToCache.js` and `docs/index.html`. A `-partial` file older than yesterday is a missed roll-over. Added in two places: the top-of-file *🔒 Locked decisions* section (one-line summary) and the *Changelog — REQUIRED workflow → Daily roll-over rule* subsection (full mechanics). Mirrored to a feedback memory so future-me sees it in the MEMORY.md index too.
- **Applied the rule.** Finalized `CHANGELOG-2026-05-19-partial.md` → [CHANGELOG-2026-05-19.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-05-19.md): dropped the `-partial` suffix on the filename, dropped `(partial)` from the H1, removed the "Partial day's work; additional changes may land later…" boilerplate paragraph. Updated the matching pair of entries in [`urlsToCache.js`](ui_vp/uiVPAtlas/urlsToCache.js) (precache) and [`docs/index.html`](ui_vp/uiVPAtlas/docs/index.html) DOCS array (in-app menu) so the renamed file is precached and listed without a 503. Cross-checked `git log --since=2026-05-19 --until=2026-05-20` against the file's existing entries — no missing items.

### Right pane — chip label as the primary adjective in the narrative

- **The gap.** Clicking the "Monitored" data-type chip used to produce a narrative like *"114 pools Statewide (Monitored) with Monitoring Surveys"* — the chip's own word ("Monitored") was buried in a parenthetical *and* paired with a different phrasing ("Monitoring Surveys") in the suffix. Same for "Visited". The narrative didn't read back the chip the user just selected.
- **The fix.** [explore/js/pool_summary.js](ui_vp/uiVPAtlas/explore/js/pool_summary.js) `describeCurrentView` now lifts the chip label to a primary adjective placed BEFORE "pools":
  - **Visited / Monitored chips** → that exact word is the adjective. The redundant "with Monitoring Surveys" / "with Atlas Visits" suffixes are dropped — the adjective already conveys it.
  - **All chip** with rows of a single detected level → that level (`Mapped` / `Visited` / `Monitored`) is the adjective. So a default "All" view with only unvisited pools reads *"114 Mapped pools Statewide"* instead of the previous parenthetical *"(Mapped)"*.
  - **Mixed-level "All"** → no level adjective; pure "pools".
  - **Mine** and **Review** keep their trailing-suffix phrasing ("associated with your account" / "needing review") because those don't read as adjectives.
- **Examples:**
  - *"114 Monitored pools Statewide"* (Monitored chip)
  - *"12 pools Statewide associated with your account"* (Mine)
  - *"23 Potential Mapped pools within 3.5 km of my GPS location"* (status + level adjectives + near-me geo)

### Right pane — "with …" data-presence suffix back, OR-joined for multi

- **The ask.** The earlier rewrite that promoted the data-type chip to a leading adjective ("114 Monitored pools…") dropped the trailing-suffix phrasing ("with Monitoring Surveys") entirely. With the Reviewed→level-chip refactor, the leading-adjective approach also couldn't surface mixed data presence. User wants the suffix back, naming what kinds of data are actually present in the visible rows.
- **The fix.** [explore/js/pool_summary.js](ui_vp/uiVPAtlas/explore/js/pool_summary.js) `describeCurrentView` now builds a `dataPresence` array from per-row INDEPENDENT detection (a monitored pool has both a visit and a survey, so both names appear). The leading-adjective `primaryAdj` block is gone. Suffix phrasing:
  - 0 → no suffix (rows are all mapped-only — "with [nothing]" would be noise).
  - 1 → *"with Atlas Visits"*.
  - 2 → *"with Atlas Visits or Reviews"*.
  - 3 → *"with Atlas Visits, Monitoring Surveys, or Reviews"* (Oxford comma + "or").
- **"Mapped" stays off the list** — it's the default state, the implicit baseline. Per user direction.
- **Mine and Review keep their phrasing** ("associated with your account" / "needing review"). Those chip suffixes describe the *reason* the rows are in the view, not what's in them, and override the data-presence list.
- **Examples:**
  - All chip, mixed rows: *"13,456 pools Statewide with Atlas Visits, Monitoring Surveys, or Reviews"*
  - All chip, only mapped pools: *"5,000 pools Statewide"* (no suffix)
  - Visited level chip on: *"1,828 pools Statewide with Atlas Visits"* (or *"with Atlas Visits or Reviews"* if any reviewed)
  - Status filter + Town filter: *"14 Confirmed pools in Stowe with Atlas Visits"*

### Right pane — data-presence suffix now respects the level-chip state

- **The bug.** With the 3.5.291 "with …" suffix in place, toggling the **Reviewed** level chip OFF didn't remove "or Reviews" from the narrative. Because the level chips have OR semantics for inclusion, a visited-AND-reviewed pool stays in the visible row set even when `Reviewed` is off (the `Visited` chip lets it through). The dataPresence loop saw the row's `reviewId` and listed "Reviews" — the suffix was reading the data, not the user's stated intent.
- **The fix.** [explore/js/pool_summary.js](ui_vp/uiVPAtlas/explore/js/pool_summary.js) imports `getMapFilters` from [./map.js](ui_vp/uiVPAtlas/explore/js/map.js) and gates each dataPresence push by the matching chip's `levelVisible` flag:
  - `Atlas Visits` → `lv['visited'] !== false` AND any row has a visit
  - `Monitoring Surveys` → `lv['monitored'] !== false` AND any row has a survey
  - `Reviews` → `lv['reviewed'] !== false` AND any row has a review
  Defaults preserved via `!== false`, matching the rest of the chip system. Re-rendering already happens on chip toggle via the existing `map:layer-filter` event flow, so no listener changes were needed.
- **Net behavior.** Reviewed chip OFF → "Reviews" disappears from the suffix even if the visible rows still contain reviewed pools (they're in the set because *another* chip let them through). Reviewed chip ON, no Reviewed pools in the visible set → still no "Reviews" (the AND with anyReview handles that). Same gating logic applied symmetrically to Visited and Monitored.

### Right pane — status-chip selection now reflected in narrative

- **The bug.** Symmetric to the v3.5.292 Reviewed-chip-gating issue, but on the status side: the narrative's `statusDesc` was derived from whichever statuses appeared in the *visible rows*, not from the *status-chip state*. Toggle on only the **Confirmed** status chip in a scope with zero Confirmed pools → the chip says Confirmed-on, the map shows nothing, the right pane silently dropped the word "Confirmed" from the narrative. Confusing — the narrative should reflect what the user selected, regardless of what data happened to fall into the current scope.
- **The fix.** [explore/js/pool_summary.js](ui_vp/uiVPAtlas/explore/js/pool_summary.js) `describeCurrentView` now derives `statusDesc` from `getMapFilters().statusVisible` (same chip-state import already used for `levelVisible` in 3.5.292) instead of from a `present` Set built off `rows`. Same `!== false` default convention as the rest of the chip system. The "only show statusDesc when a strict subset is selected" rule is preserved — all five on → no qualifier, partial selection → comma-joined list.
- **Net behavior.** Confirmed chip on, zero Confirmed pools in scope: narrative still reads *"0 Confirmed pools …"*. Mirror of the Reviewed-chip fix one version back — chip state is what the narrative is *about*.

### Deployment — containers restart on host reboot

- **The gap.** None of the VPAtlas containers had a `restart:` policy, so a host reboot (or a `docker daemon` restart) left the stack down until someone manually re-ran `docker compose up -d`. LoonWeb's compose files have used `restart: unless-stopped` on the long-running services for a while; matched that pattern here.
- **The change.** Added `restart: unless-stopped` to `db_vp`, `api_vp`, and `ui_vp` in both [docker-compose-vpatlas.yml](docker-compose-vpatlas.yml) (production) and [docker-compose.yml](docker-compose.yml) (base/dev). `db_migrate_vp` keeps its existing `restart: "no"` — it's a one-shot job, not a daemon. [docker-compose-dev.yml](docker-compose-dev.yml) is an env-var override file; no `restart:` needed there because Compose merges from the base.
- **`unless-stopped` vs `always`.** `unless-stopped` is the LoonWeb pattern and the right choice — auto-restarts after a crash or host reboot, but respects a manual `docker stop` (won't fight you when you intentionally bring something down for maintenance). `always` would.
- **Applied to the live stack.** Reconciled the running containers with `docker compose up -d` so the policy takes effect on the existing containers, not just future `up`s. `docker inspect` confirms `db_vp / api_vp / ui_vp = unless-stopped`, `db_migrate_vp = no`.

### Service worker / build

- **Eleven patch versions** — `manifest.json` 3.5.283 → 3.5.284 (visit_view offline cache-backed render), 3.5.284 → 3.5.285 (Zoom to Lat/Lon longitude auto-prefix), 3.5.285 → 3.5.286 (thousands comma + near-me scope narrative), 3.5.286 → 3.5.287 (changelog daily-roll-over rule + finalize 05-19), 3.5.287 → 3.5.288 (first attempt at admin-only "Reviewed" — wrong slot, reverted in 3.5.290), 3.5.288 → 3.5.289 (chip label as primary adjective in scope narrative), 3.5.289 → 3.5.290 (admin-only "Reviewed" reworked as OR-style 4th level chip), 3.5.290 → 3.5.291 ("with …" data-presence suffix back, OR-joined), 3.5.291 → 3.5.292 (data-presence suffix gated by level-chip state), 3.5.292 → 3.5.293 (Refresh Pool Data offline-gated, no more red error), 3.5.293 → 3.5.294 (status-chip gated narrative — symmetric to 3.5.292) via `node sw-build.js`. UI rebuild only; no `api_vp` or DB change.
- **`urlsToCache.js`** picked up the new `/docs/CHANGELOG-2026-05-20-partial.md` entry, and the 2026-05-19 entry switched from `-partial.md` to `.md` as part of the roll-over.
- **`./test_stack.sh`** ran clean after each deploy, including the offline-deliverability section (all precached URLs serve 200).
