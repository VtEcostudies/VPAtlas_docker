# Changelog — Snapshot 2026-05-29

## v3.5.341 – v3.5.342

### Mobile bottom-tab bars on pool_view / visit_view / visit_create now match the home page

- **The gap.** The home page's mobile bottom-tab bar at [explore/css/common.css:218-263](ui_vp/uiVPAtlas/explore/css/common.css#L218-L263) gives each button a 60 px operable height, 12 px label font, 20 px icon, and `env(safe-area-inset-bottom)` padding below the bar so the iOS home-indicator gesture strip never overlaps the tap targets. Three other pages had their own tab styles that came in shorter and with smaller text — [explore/pool_view.html](ui_vp/uiVPAtlas/explore/pool_view.html) (`.pv-tab-btn`), [explore/visit_view.html](ui_vp/uiVPAtlas/explore/visit_view.html) (`.dv-tab-btn`), and [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) (`.visit-tab-btn`) — all running ~32 px high with 11 px / 18 px text, and no safe-area-inset padding. Hard to thumb on a phone, and the bottom row of icons sat directly in the home-indicator gesture strip on iPhones with no physical home button.
- **The fix.** All three tab bars now use the same shape as `.explore-tab-btn`: `height: 60px`, `font-size: 12px`, `i { font-size: 20px; margin-bottom: 3px; }`, `-webkit-tap-highlight-color: transparent`, and `padding-bottom: env(safe-area-inset-bottom, 0px)` on the container. For the position-fixed bars (pv-tabs, dv-tabs), the page's `body { padding-bottom: 60px }` updates to `calc(60px + env(safe-area-inset-bottom, 0px))` AND the `100dvh - 90px - 52px` pane-height calcs become `100dvh - 90px - 60px - env(safe-area-inset-bottom, 0px)` so the content area still ends exactly at the top of the bar. For visit_create, whose tab bar is a flex child of `.visit-app` (not fixed), the change is just height + safe-area padding on the container.
- **Dropped the < 500 px override on visit_create.** The previous `font-size: 10px; padding: 4px 1px; i { font-size: 16px; }` shrank labels on narrow phones, breaking parity with the home page. With 5 tabs (Map / Location / Verify / Pool / Species) × ~64 px per tab, the 60 px / 12 px sizing still fits a 320 px iPhone SE screen.

### pool_view map — target button now matches every other map view (crosshair + water-droplet)

- **The gap.** The "Zoom to pool" button on the [explore/pool_view.html](ui_vp/uiVPAtlas/explore/pool_view.html) map was a fixed 40 × 40 px square with a single `fa-crosshairs` icon and inline styles. Every other map view in the app — [explore/index.html](ui_vp/uiVPAtlas/explore/index.html), [explore/visit_view.html](ui_vp/uiVPAtlas/explore/visit_view.html), [explore/survey_view.html](ui_vp/uiVPAtlas/explore/survey_view.html), [explore/pool_create.html](ui_vp/uiVPAtlas/explore/pool_create.html), [admin/review_view.html](ui_vp/uiVPAtlas/admin/review_view.html), [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) — uses the canonical `.pf-zoom-btn` class (defined in [css/map.css](ui_vp/uiVPAtlas/css/map.css)) with two icons: `fa-crosshairs` + `fa-tint` (water droplet). That two-icon pattern is documented at [css/map.css:166-172](ui_vp/uiVPAtlas/css/map.css#L166-L172) as the standard "zoom to pool" labelling across PoolFinder, Explore, and all detail views.
- **The fix.** Drop the inline styles, switch to `class="pf-zoom-btn"`, add the `fa-tint` next to the existing `fa-crosshairs`. map.css was already loaded by pool_view.html, so no new CSS dependency.

### Documentation

- Finalized [CHANGELOG-2026-05-28.md](CHANGELOG-2026-05-28.md) (was `-partial`) per the daily roll-over rule — dropped the `(partial)` qualifier from the H1 and removed the boilerplate paragraph. Updated [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) precache block and the [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) DOCS array to drop the old partial path, add the finalized 2026-05-28 path, and add today's 2026-05-29 partial.

### Service worker / build

- `manifest.json` 3.5.340 → 3.5.341 via `node sw-build.js patch`. Ships both the changelog roll-over (urlsToCache + docs/index list updates) and the pool_view button change in one bump. UI rebuild only; no API or DB change.
- `manifest.json` 3.5.341 → 3.5.342 via `node sw-build.js patch`. Ships the mobile bottom-tab parity changes on pool_view / visit_view / visit_create. UI rebuild only.
