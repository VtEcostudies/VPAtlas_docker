# Changelog — Snapshot 2026-05-25 (partial)

## v3.5.313 – v3.5.314

Partial day's work; additional changes may land later under a follow-up
2026-05-25 changelog.

### Basemap tiles — fix SW TypeError on offline / timed-out tile fetches

- **The bug.** `handleTileRequest` in the service worker returned `new Response('', { status: 204 })` when a tile fetch threw (offline, timeout, basemap-server error). Per the Fetch spec, statuses **101/103/204/205/304** are "null body statuses" — the body MUST be `null`; an empty string still counts as a body. The `Response` constructor threw `TypeError` and the rejection bubbled through `respondWith()`, surfacing as `Failed to load 'https://server.arcgisonline.com/.../tile/N/X/Y'. A ServiceWorker passed a promise to FetchEvent.respondWith() that rejected with 'TypeError: Response constructor: Response body is given with a null body status.' sw.js:290` in the browser console — one line per failed tile.
- **The fix.** [sw_template.js](ui_vp/uiVPAtlas/sw_template.js) `handleTileRequest` now returns `new Response(null, { status: 204 })`. Same semantic (silent no-content placeholder so the browser doesn't render a broken-image icon), spec-compliant body type.
- **Latent since.** The bug has been there since `handleTileRequest` was added; only fires on tile-fetch failure (offline, timeout, basemap-server error), so it only became visible when field devices panned into uncached regions or the basemap CDN hiccuped.

### Service worker / build

- `manifest.json` 3.5.313 → 3.5.314 via `node sw-build.js patch`. UI rebuild only; no API or DB change.

### iPhone fix — SW auto-reload loop, round 2 (defense in depth)

- **The bug, still.** After v3.5.312 shipped the localStorage cooldown fix two days ago, the user confirmed their iPhone PWA was running v3.5.312 but the reload-loop *still* fired on a cell connection — wait-cursor flashing and the page appearing to reload roughly every second. WiFi remained fine.
- **What was different.** Reading the deployed code, two gaps survived the v3.5.312 fix on the cell path:
  1. The 30 s cooldown was checked at the `statechange === 'installed'` decision point (whether to send `SKIP_WAITING` to a freshly-installed SW), but the **BroadcastChannel `RELOAD` handler itself was unguarded** — any RELOAD message that reached the page (queued waiting SW from a previous session, multi-tab race, SW restart with `isUpdate=true` still set in module scope, iOS replaying a queued broadcast on foreground) reloaded the page with no brake.
  2. The bandwidth gate at [js/app.js](ui_vp/uiVPAtlas/js/app.js) accepted `navigator.connection.downlink > 1500 kbps` at face value as a fast-yes, skipping the real probe. iOS Safari standalone PWA's `connection.downlink` is bucketed and notoriously stale — it can carry a "WiFi" reading into a fresh cell-only session and let the update check run on cell anyway.
- **The fix (defense in depth — all in [js/app.js](ui_vp/uiVPAtlas/js/app.js)).**
  - **Cooldown check added to the `RELOAD` broadcast handler.** Any RELOAD that arrives within the 30 s cooldown is now ignored with a console warn. Closes the unguarded-broadcast hole that was almost certainly the visible driver of the user's flashing.
  - **Hard reload cap.** New sliding-window counter in `localStorage` (`vpa_sw_reload_events`): at most 3 auto-reloads per 5-minute window. When the cap trips, both the RELOAD handler AND the SKIP_WAITING decision point AND the waiting-SW-on-cold-load path all leave the new SW in `waiting` and skip the auto-reload. Cap entries age out, so the user is never permanently stuck — worst case they wait 5 minutes for the entries to roll off and the auto-update fires on the next launch.
  - **Bandwidth gate tightened.** The fast-yes shortcut on `navigator.connection.downlink` is gone; the real `bandwidthMonitor.measureBandwidth()` probe runs every time and we take `MIN(connection-api, probe)`. So a stale "WiFi" reading from the connection API can't sneak past the gate when the device is actually on cell. Costs ~500 ms on a cold boot (which is then sessionStorage-cached for 5 minutes by the existing probe module).
  - **Diagnostic ring buffer.** New `vpa_sw_reload_log` in `localStorage` keeps the last 10 reload-decision events (timestamp + reason: `broadcast-reload`, `broadcast-skipped` (cooldown / cap), `install-activating`, `install-skipped`, `waiting-activating`, `waiting-skipped`). ~1 KB. Lets the next bug report carry evidence — surface via System Info in a follow-up if useful.
- **What's intentionally NOT changed.** The SW (`sw_template.js`) is untouched — its lifecycle is fine, the bug is on the page side. `pool_list.js`, `api.js`, `net_status.js` are untouched.
- **If the user still sees flashing after this lands.** Read out `localStorage.vpa_sw_reload_log` from Safari Web Inspector and paste it back — we'll know exactly which path is firing and whether the cap actually trips.

### Documentation — finalized 2026-05-22 changelog

- Closed out `CHANGELOG-2026-05-22-partial.md` → [CHANGELOG-2026-05-22.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-05-22.md) (rename, drop `(partial)` H1, drop boilerplate paragraph). Three days stale per the daily roll-over rule. Today's work lives in this `2026-05-25-partial` file.

### Service worker / build

- `manifest.json` 3.5.312 → 3.5.313 via `node sw-build.js patch`. UI rebuild only; no API or DB change. (3.5.313 = iPhone SW reload-loop round-2 fix.)
- `urlsToCache.js`: 2026-05-22 entry switched from `-partial.md` → `.md`; new `2026-05-25-partial.md` entry added.
- `docs/index.html` DOCS array updated to match — both list ordering and the title/file fields.
