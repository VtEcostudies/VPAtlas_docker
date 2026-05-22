# Changelog — Snapshot 2026-05-22 (partial)

## v3.5.306 – v3.5.311

Partial day's work; additional changes may land later under a follow-up
2026-05-22 changelog.

### Documentation — how-to guides for basic field workflows

- **The gap.** The Documentation page had install guides and daily changelogs, but nothing explaining how to actually *use* the app in the field. Added five focused how-to guides, listed at the top of the **Guides** section so they're the first thing a volunteer sees.
- **The guides.** Each is a self-contained HTML page in [docs/](ui_vp/uiVPAtlas/docs/), modeled on the existing install-guide styling:
  - [howto_update_app.html](ui_vp/uiVPAtlas/docs/howto_update_app.html) — **Updating the App Before Going Out.** How the PWA self-updates, checking the version in the header, and using menu → *Refresh Pool Data* to pull the latest pool records before losing signal.
  - [howto_cache_basemaps.html](ui_vp/uiVPAtlas/docs/howto_cache_basemaps.html) — **Caching Basemaps for Offline Use.** Explains that map tiles are cached automatically as you view them (no download button), so you pre-load a field area by panning/zooming across it while still online.
  - [howto_top_filters.html](ui_vp/uiVPAtlas/docs/howto_top_filters.html) — **Using the Top Filters.** Data-type buttons, Pool ID search, Town/County, Indicator Spp, Near me, and the status / survey-level chips.
  - [howto_primary_features.html](ui_vp/uiVPAtlas/docs/howto_primary_features.html) — **Find Pool, Atlas Visit & New Pool.** What each action does and how to start it.
  - [howto_gps_compass.html](ui_vp/uiVPAtlas/docs/howto_gps_compass.html) — **Enabling GPS & Compass.** Granting location for "Near me" and the Pool Finder, and the iOS compass-permission tap.
- **Offline.** All five are pure static HTML (inline CSS, no external assets) and added to [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) so the service worker precaches them — the how-to guides are available in the field offline.

### Documentation page — mobile-portrait layout fix

- **The bug.** On a phone in portrait orientation, the document list sat as a panel above the displayed document and grew with its entries, pushing the document itself off the bottom of the screen. Landscape (list and document side-by-side) was fine.
- **The fix.** [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) — a portrait-only media query (`max-width: 700px and orientation: portrait`) now caps the document list at one-third of the screen height with its own scrollbar, leaving the other two-thirds for the document body. Landscape keeps the existing side-by-side row layout, untouched.

### Pool Finder — clearer map labels, consolidated stop-track dialog

- **GPS pill says what it is.** The map's GPS-quality pill read `<quality label> (5m)` (e.g. "Excellent (5m)"), which didn't say what the number meant. Now reads `Position Accuracy (5m)` — the colour-graded dot still conveys good/poor at a glance, but the text names the metric. [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html) `updateGpsDisplay`.
- **Track pill says what it is.** The track-recording pill read `Recording (26)`. Now reads `Track Points (26)` so the number is self-explanatory as a point count. Idle default label also changed `Recording` → `Track Points`.
- **One stop-track dialog.** Stopping a track previously offered only `Cancel` / `Save`, with a *separate* "Discard Track" menu item (and its own confirm modal) as the only way to throw points away. Tapping **Stop Track** now opens a single `Cancel` / `Discard` / `Save` dialog — discard is folded in where the decision is actually made. The redundant standalone "Discard Track" menu item and its modal were removed.

### Documentation — Pool Finder how-to guide

- **The gap.** The Pool Finder is the most involved field screen (GPS, compass navigation, track recording) and had no how-to. Added [howto_pool_finder.html](ui_vp/uiVPAtlas/docs/howto_pool_finder.html) — **Using the Pool Finder** — covering opening the finder, reading Position Accuracy, the compass arrow, the map-framing zoom buttons, recording a track end-to-end (Start → Track Points pill → Stop's Cancel/Discard/Save), and launching a Visit from a pool.
- Listed in the **Guides** section of the Documentation page right after "Find Pool, Atlas Visit & New Pool", and precached via [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) so it's available offline like the other guides.

### Documentation — in-app guide cross-links fixed

- **The bug.** The how-to guides render inside an iframe on the Documentation page, and the parent page routes by URL hash. Guide-to-guide cross-links used a plain `href="howto_x.html"`, so clicking one reloaded just the *iframe* with the bare guide — the sidebar, page title, and active-link state all stopped matching what was shown.
- **The fix.** Every guide-to-guide link now uses an absolute `href="/docs/#howto_x.html"` with `target="_top"`. A fragment-only `href="#howto_x.html"` resolves against the *iframe's* own document URL (`/docs/howto_primary_features.html`), so `target="_top"` would send the top window to `/docs/howto_primary_features.html#howto_x.html` — a path the router doesn't serve. The absolute `/docs/#…` form sets the hash on the Documentation index page itself, so its router opens the linked guide with the full sidebar/title chrome intact. Fixed across all six guides — [howto_pool_finder.html](ui_vp/uiVPAtlas/docs/howto_pool_finder.html) (3 links), plus one each in [howto_primary_features.html](ui_vp/uiVPAtlas/docs/howto_primary_features.html), [howto_update_app.html](ui_vp/uiVPAtlas/docs/howto_update_app.html), [howto_cache_basemaps.html](ui_vp/uiVPAtlas/docs/howto_cache_basemaps.html), and [howto_top_filters.html](ui_vp/uiVPAtlas/docs/howto_top_filters.html).

### Service worker / build

- `manifest.json` 3.5.303 → 3.5.311 via `node sw-build.js patch`. UI rebuild only; no API or DB change. (3.5.307 = Pool Finder label/dialog changes + the new how-to guide; 3.5.308 = guide cross-link fix; 3.5.309 = corrected those links to the absolute `/docs/#…` form; 3.5.310 = Pool Finder guide wording; 3.5.311 = prod deploy bump.)
- `urlsToCache.js` adds the five `howto_*.html` guides plus `howto_pool_finder.html`; the 2026-05-21 changelog entry switched from `-partial.md` to `.md` as part of the daily roll-over.

### Documentation — 2026-05-21 finalized

- Closed out `CHANGELOG-2026-05-21-partial.md` → [CHANGELOG-2026-05-21.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-05-21.md): dropped the `-partial` suffix and the `(partial)` H1 qualifier, removed the partial-day boilerplate, and corrected the version span to `v3.5.302 – v3.5.303` (the day carried two patch bumps — kill-switch fix and the wetland-complex pool type — not one). Updated the matching entries in [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) and the `DOCS` array in [docs/index.html](ui_vp/uiVPAtlas/docs/index.html).
