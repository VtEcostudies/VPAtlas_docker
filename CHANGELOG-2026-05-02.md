# Changelog — Snapshot 2026-05-02

## v3.5.28 – v3.5.81

### Header & navigation

- **Three-row explore header** — logo row, filter row, chip row. Buttons (hamburger, profile, filter toggle, sort dropdown) standardized to 40px touch targets. Filter row is always visible on mobile (no toggle); chip row stays inline with status, level, and filter tokens flowing as siblings.
- **VCE logo** added to the top-left of the explore header, linked to `val.vtecostudies.org/projects/vermont-vernal-pool-atlas/`. Stacked VPAtlas wordmark + version next to it.
- **Abbreviated VCE logo** (`vce_logo_abbrev.png`) auto-swapped via `<picture>` below 420px viewport width — reads `VT CENTER / FOR ECOS` to save horizontal space.
- **Refresh Pool Data** menu item in the hamburger — bypasses IndexedDB cache and re-fetches from API. Useful after schema changes.
- **My Visits** button added to the profile dialog. Email and role text are larger/bolder.
- **Hamburger menu** capped at `max-width: calc(100vw - 16px)` so long admin labels can't push it off-screen.
- **Header buttons & filter chips** sized for mobile (touch-target ≥ 36–40px). Status, level, and filter-token chips are visually identical (same padding, border, radius). Filter token's × button styled like the poolfinder split-pill close button.

### Login & auth

- **Email login works** — `authenticate()` now matches `username = $1 OR LOWER(email) = LOWER($1)`. The post-login token-confirmation `UPDATE` keys off `user.id` so it works for either lookup type.
- **Admin auth fix** — `vpUser.routes.pg.js` `getAll`/`getPage` checked `req.user.userrole` (always undefined; the JWT only has `role`). Changed to `req.user.role` so admins can list users.

### Visit list & queue

- **Unified My Visits page** — local drafts and server visits merged into one card list, sorted together by date. Status pills: draft (amber), complete (blue), uploaded (green), server (green). Sort dropdown for date/pool/status.
- **Card-based lists everywhere** — explore page left pane (pool list), pool view (visits, surveys, reviews), and visit list all use the same `vq-item` flex card pattern. Tables removed.
- **Pool list rows** show counts as `12v · 2s · 📷5` (visits / surveys / photos), with town in larger bold type. Pin icon (📍) replaces checkboxes for adding pools to Pool Finder.
- **Sync status feedback** — `visit_queue_ui.js` listens for `visitSyncStatus` events and shows colored banners inside the queue (success/error/warning), so upload outcomes are no longer silent.

### Photos

- **Per-pool photo count** — added `photoCount` subquery to `/pools` endpoint via `vpPools.service.js`. Pool list left pane displays a camera icon with the count and supports sorting by it.
- **Latest visit photos on pool view** and **pool_summary** — pool/vegetation thumbnails from the most recent visit appear at the top of the summary pane, with the visit ID and date.
- **All photos on visit_view** — bottom-of-page CSS-grid (`auto-fill, minmax(140px, 1fr)`) of all visit photos with type label overlays. Tap to open full-size in a new tab.
- **Monitoring survey photos** — same grid layout added to `survey_view.html`, sourced from the `surveyPhotos` json_agg already returned by the survey detail endpoint.
- **Photos on prod** — `deploy-dev.sh deploy` now `mkdir -p photo_data && chown -R 1001:1001 photo_data` on the remote so the container's `api` user (uid 1001) can write through the bind mount. `photo_data/` added to `.gitignore`.

### Pool Finder map

- **Three-button zoom toolbar** at the top-left of the map: 🎯 (pools), 🎯 GPS (user location), 🎯 Both (fit pools + GPS). GPS/Both auto-show/hide with GPS tracking state.
- **Default first-GPS-fix view = Both** — auto-fits the map to selected pools + user marker on the first GPS fix.
- **GPS-to-pool lines** — dashed blue polyline from user marker to each selected pool, with a midpoint label showing distance and compass bearing (e.g. `245 m NE`). Updates in real time as GPS position changes.
- **+ New Pool** moved from nav panel to the header (`detail-actions`) with a `⋮` overflow menu on mobile. GPS-aware link includes lat/lng when available.
- **Pool Finder title** wraps to two lines (`Pool / Finder`) to free header space for chips and GPS dot.

### Filters & dates

- **Indicator-species filter matches monitoring surveys** — `?visitHasIndicator=1` now generates `WHERE (visitHasIndicator() OR surveyHasIndicator())`. Client-side `rowHasIndicator()` parses `surveyAmphibJson` (observers 1 & 2 × {Edge, Interior} × {WOFR, SPSA, JESA, BLSA}).
- **Town/county type-ahead** — arrow-key navigation (↑/↓ to move, Enter to select highlighted, Esc to close). Mouse hover and keyboard highlight share the `.highlighted` class.
- **Auto-zoom on map tab** — switching to the Map tab on mobile zooms to the filtered pools. Filter changes still trigger zoom via `refreshUI()`.
- **Date timezone fix** — `formatDate()` and `formatDateTime()` now detect `YYYY-MM-DD` strings and append `T00:00` (no `Z`) so JavaScript treats them as local midnight instead of UTC midnight (which shifted dates back one day in EST).

### Performance & UX

- **Wait overlay during filter updates** — `withWait()` helper in `index.html` shows the spinner overlay for `refreshUI()` and chip-toggle work, using double-`requestAnimationFrame` so the wait state paints before the slow synchronous re-plot.
- **Depth counter on `withWait`** — nested calls (chip click → setStatusVisible → map:layer-filter listener) keep the overlay solid instead of flashing on/off/on/off.
- **Optimistic chip feedback** — chip click handler updates the chip's color/border/opacity inline before scheduling the slow re-render, so the user sees the toggle state instantly.
- **Cache-key bumped to `pool_cache_v2`** — abandons stale client caches when API schema changes (e.g. for `photoCount`).
- **Disabled double-tap zoom** — `touch-action: manipulation` on `<html><body>`. Preserves pinch-zoom for accessibility; doesn't affect Leaflet (its own rules win).

### User management

- **Admin user page redesigned** as a card list (`admin/users_admin.html`):
  - Search by username/email, plus role and status dropdowns (auto-apply on change)
  - Each card: avatar, username, email, role + status pills, joined date
  - Pending statuses (registration / reset / new_email / invalid) sort to the top
  - Inline editors for role and status; **Save**, **Reset PW**, **Delete** actions
  - Self-delete is disabled
  - Mobile-responsive: action buttons wrap below the info on narrow screens
- **`deleteUser(id)`** added to `js/api.js`.

### Forms

- **Read-only Pool ID, Observer, and Lat/Lng** on `visit_create.html` and `pool_create.html`. Users must use the map (or pool selection) to set location; identity fields come from the auth user / selected pool.
- **Profile page** drops its own profile icon (avoiding recursion).

### Build & deploy

- **Auto-commit in `deploy-dev.sh`** — `commit_local_changes()` helper runs `git add -A` and commits with a generated message (or `$2` custom message) before `git push`. Both `deploy` and `ui` targets use it.
- **Photo-data provisioning in deploy** — ensures `photo_data/` exists on the remote with uid 1001 ownership before `docker compose up`.
- **`app.js` double-init guard** — `initAppCalled` flag in `callInitApp()` prevents `setupProfileIcon()` (and other init work) from running twice on first load.
- **`pool_data_cache.js` v2** — cache key bumped so older clients re-fetch after the `photoCount` field was added.

### Service-worker / offline

- Various SW patches as version bumped from 3.5.28 → 3.5.81. The `sw-build.js patch` step is invoked on every UI rebuild and updates `manifest.json` + `sw.js` together.
