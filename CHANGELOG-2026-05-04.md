# Changelog — Snapshot 2026-05-04

## v3.5.100 – v3.5.127

### Visit photos — upload + UX

- **Save & Upload now actually uploads photos.** `btn_save_upload` had been calling `createVisit(body)` / `updateVisit(visitId, body)` with form JSON only — photos were being saved to IndexedDB but never POSTed to `/pools/visit/:id/photos`. The button now extracts the new `visitId` from the API response, then iterates `speciesPhotos` and POSTs each one as multipart `FormData` with `photoType=<species>` and `Authorization: Bearer <token>`. `currentVisitState.photos_uploaded` is set to `true` only when every photo succeeds.
- **Modal upload progress overlay** — full-screen translucent overlay with spinner, headline ("Uploading visit data…", "Uploading photos (3 of 9)") and progress detail (species + filename per photo). Body cursor switches to `wait`; all form inputs/buttons disabled via `body.uploading` CSS rule. Hides on success/error.
- **Photo thumbnails 40 → 60 px** — tap target up to 1.5×, no more tiny in-thumb buttons. Tap a thumbnail to open the new full-screen photo modal.
- **Per-photo modal** with Save-to-device / Delete / Cancel buttons (all 44 px tall touch targets). X-close, Esc, and tap-outside dismiss. Save uses `navigator.share({ files })` on iOS so users can pick "Save to Photos" from the share sheet, falling back to a `<a download>` click on desktop / Android (where it goes to Files / Downloads).
- **Photos help text rewritten** — explains that browser-captured photos are not auto-saved to the system Photos library and offers two workarounds: tap the thumbnail and choose Save to device, or use the phone's native Camera app first and then pick from gallery.

### Shared photo lightbox

- **New module `/js/photo_lightbox.js`** — `openPhotoLightbox({ src, blob, label, onDelete })` shows the image up to 96vw × 75vh in a dark overlay with header (title + X), Save-to-device button (same Web Share API + anchor-download fallback), optional Delete (when `onDelete` is supplied), and Cancel. Self-injects its CSS + DOM on first use; closes on backdrop click, X, or Esc.
- **Wired into every page that lists photos:**
  - `explore/visit_view.html` — full Photos grid on visit detail
  - `explore/pool_view.html` — Latest Visit Photos on pool detail
  - `explore/js/pool_summary.js` — right-pane Latest Visit Photos
  - `survey/survey_create.html` — local-file thumbnails on the monitoring survey form
- `survey/visit_create.html` keeps its existing in-page modal (it has the species/index delete-from-array logic that's specific to that page).

### Home button on every detail page

- **9 pages got a home (`fa-house`) button** to the left of the X (back) button: `admin/review_view`, `admin/review_create`, `explore/pool_create`, `explore/visit_list`, `explore/visit_view`, `explore/survey_view`, `explore/pool_view`, `survey/visit_create`, `survey/survey_create`.
- **`.home-button` CSS** added to `explore/css/common.css` and `survey/css/survey.css` — explicit 36×36 px (an `<a>` with `height: 100%` doesn't stretch in a flex parent the way a `<button>` does), `box-sizing: border-box`, `line-height: 1`, `display: inline-flex`, `text-decoration: none`. Removed the `margin-right: 6px` since the parent `.detail-header` / `.survey-header` already use flex `gap`.
- **Auto-hide via `/js/home_button.js`** — when the *immediate* previous page was `/explore/`, the home button is hidden (X back already returns home; a separate Home is redundant). Tracks the previous path in `sessionStorage` rather than `document.referrer` (which gets wiped during service-worker-driven reloads on first navigation). Loaded with `defer` from `<head>` on all 9 pages.

### System Info page

- **New `/explore/system.html`** — diagnostics for the user-facing field experience and for debugging cache / SW issues.
- **Tabbed UI** — top tab bar with one pane visible at a time: GPS (default), Network, Storage, Service Worker, App, Device. Below 600 px the tab bar wraps to two rows of three using `flex: 1 1 calc(33.333% - 4px)`. Below 360 px font drops to 11 px. Deep-link via `?tab=gps` or `#gps`.
- **Available from every overflow menu** — added to `/explore/` hamburger panel (between *Changelog* and *About*), and to the `⋮` ellipsis on `pool_view`, `visit_view`, `find_pool`, and `visit_create`.

#### App
- Manifest version, API endpoint, current URL, referrer.

#### Service Worker
- Registration state (active / waiting / installing), controller script, scope.
- Per-cache entry counts (`vpAtlas-app-3.5.127`, `vpAtlas-data-3.5.127`, `vpAtlas-map`, etc.).
- **Buttons:** *Check for update* (calls `registration.update()`), *Activate waiting SW* (posts `SKIP_WAITING`), *Clear all caches* (red, with confirm).

#### Network
- `navigator.onLine`, `effectiveType`, `downlink` (Mbps + kbps), `downlinkMax`, `rtt`, `type`, `saveData`. Rows go red/warn when fields are missing or below the 1.5 Mbps update gate.
- Inline note: **"Skips `registration.update()` if downlink<1.5 Mbps OR unknown"** so the user can see immediately whether they'd trip the gate.
- **Two bandwidth-test buttons** — *Field probe (~35 KB)* and *Accurate test (~210 KB)*. Each reports `Downloaded ${label} in ${elapsed}s → ${mbps} Mbps (~${kbps} kbps). Above/Below the 1.5 Mbps update gate.`

#### GPS — LoonWeb-style live monitor
- **Signal-quality bar** — colored dot + label (`EXCELLENT / GOOD / FAIR / POOR / UNKNOWN`) + accuracy badge (`±X.Xm`). Thresholds: ≤5 m / ≤10 m / ≤20 m / >20 m.
- **Source** — geolocation supported / not, data source (Device GPS / IP Geolocation / Denied / Unsupported, classified by accuracy ≤500 m), permission state via Permissions API with `change` listener, last-update timestamp, time-since-last-update (live-ticking at 500 ms via `setInterval`).
- **Tracking** — status (`STOPPED / ACQUIRING / ACTIVE`), points recorded, watch ID; **Start / Stop / Clear-history buttons** (uses `watchPosition` for continuous tracking), plus a *Request permission / single fix* button to invoke the system permission dialog without committing to continuous tracking. Auto-stops on `beforeunload` so GPS hardware doesn't keep running after navigation.
- **Motion** — speed (km/h *and* m/s), heading (°).
- **Position** — lat / lng to 6 decimals, altitude (m).
- **Accuracy** — horizontal `±m` (good ≤10 m, warn ≤30 m, bad >30 m), vertical `±m`, drift = average pairwise haversine distance over the last 3 fixes.
- **Recent Positions** — last 10 fixes, newest highlighted, mono-spaced.

#### Storage
- **Quota** — total used (bytes + percent of quota) and quota itself, plus per-bucket breakdown (typically `indexedDB`, `caches`) from `navigator.storage.estimate().usageDetails`. Persistent-storage flag.
- **localStorage / sessionStorage** — key count, approximate size (UTF-16 char × 2 bytes), and first 20 key names with overflow indicator. Bytes shown as `12.3 KB (12,634 bytes)` with comma separators.
- **IndexedDB** — list of databases via `indexedDB.databases()` with name + version (Chrome / Edge / Firefox 126+; Safari shows "Not supported" with a warn).

#### Device / Browser
- UA, platform, language, CPU cores, device memory, screen + viewport (with `devicePixelRatio`), touch points, PWA standalone flag.

#### Formatting helpers
- `fmtBytes(n)` — auto-tiers bytes / KB / MB / GB and shows the raw byte count with `toLocaleString()` thousand separators.
- `fmtCount(n)` — `Number(n).toLocaleString()` so cache entry counts, RTT, screen dimensions etc. all render with commas.

### Bandwidth monitor + speed-test fixtures

- **New `/js/bandwidth_monitor.js`** — exposes `window.bandwidthMonitor` with `measureBandwidth({ size })` (`'small'` ≈ 35 KB default, `'large'` ≈ 210 KB), `getStatus()`, `getAverageBandwidth()`, and a rolling `samples` array (max 5). Listens for `navigator.connection.change` events to keep `currentBandwidth` fresh on browsers that expose it.
- **Two test fixtures, both real pool photos:**
  - `/images/speed-test.jpg` — 209,636 bytes (copied from LoonWeb).
  - `/images/speed-test-small.jpg` — 35,523 bytes (cloned from `images/species/spotted-eggs-pool.jpg`, a real spotted-salamander egg-mass-in-vernal-pool shot).
- **Service-worker exemption** — new `STATIC_NO_CACHE_PATTERNS` list in `sw_template.js` checked at the top of the fetch handler so both test images always go to the network. Each measurement adds a `?_bw=<ts>` cache-buster as belt-and-braces.
- **Loaded before `/js/app.js` on all 19 pages** — the existing `else if (window.bandwidthMonitor)` fallback in `app.js`'s SW update gate finally has something to call. On Firefox/Safari (where `navigator.connection.downlink` doesn't exist), the gate now does a real network probe instead of always reporting "unknown" and skipping updates.
- **Field probe rationale** — the small file finishes in ≈0.2 s at the 1.5 Mbps gate threshold and ≈6 s at 50 kbps, so cellular volunteers don't pay 33 seconds of download time per page load just to measure bandwidth. The large file is reserved for the manual *Accurate test* button on System Info.

### Pool Finder — nearby pools

- **"Pools within range of me" bubble** — a faint dashed green circle (`NEARBY_RADIUS_M = 500 m`) follows the user's GPS position. Any other mapped pool inside the bubble is plotted as a smaller (16 px), 65%-opacity marker so volunteers can see existing mapped pools and avoid creating duplicates.
- **Bounding-box pre-filter on the server, true radius client-side.** Calls `pools/mapped/geojson` with `mappedLatitude|>=…`, `mappedLatitude|<=…`, `mappedLongitude|>=…`, `mappedLongitude|<=…` (a `cos(lat)` correction handles VT's ≈44° N latitude), then a haversine pass prunes the corners outside the true radius. The endpoint already filters out `Eliminated` and `Duplicate` pools, so only real candidates show up.
- **Move-based refetch threshold** (`NEARBY_REFETCH_M = 100 m`) — circle position updates every GPS tick, but the API call only re-runs when the user has moved at least 100 m from the last query. No hammering at 1 Hz.
- **Click a nearby marker** → it gets promoted to a fully-tracked navigation target via `addPool(row)` (chip + GPS-line + nav-arrow), and the dim version is removed from `nearbyMarkers` so it doesn't show twice. Pools already in `selectedPools` are skipped during the nearby render.
- **Toggle in the overflow menu** — *Nearby Pools: On/Off* (default On, `fa-eye`/`fa-eye-slash` icon). Off clears the bubble + markers and resets `lastNearbyQuery`; On refetches at the user's current position.
