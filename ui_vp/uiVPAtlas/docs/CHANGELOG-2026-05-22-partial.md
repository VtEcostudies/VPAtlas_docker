# Changelog — Snapshot 2026-05-22 (partial)

## v3.5.306

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

### Service worker / build

- `manifest.json` 3.5.303 → 3.5.306 via `node sw-build.js patch`. UI rebuild only; no API or DB change.
- `urlsToCache.js` adds the five `howto_*.html` guides; the 2026-05-21 changelog entry switched from `-partial.md` to `.md` as part of the daily roll-over.

### Documentation — 2026-05-21 finalized

- Closed out `CHANGELOG-2026-05-21-partial.md` → [CHANGELOG-2026-05-21.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-05-21.md): dropped the `-partial` suffix and the `(partial)` H1 qualifier, removed the partial-day boilerplate, and corrected the version span to `v3.5.302 – v3.5.303` (the day carried two patch bumps — kill-switch fix and the wetland-complex pool type — not one). Updated the matching entries in [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) and the `DOCS` array in [docs/index.html](ui_vp/uiVPAtlas/docs/index.html).
