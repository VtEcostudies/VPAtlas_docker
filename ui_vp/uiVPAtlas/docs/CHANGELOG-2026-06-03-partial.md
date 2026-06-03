# Changelog — Snapshot 2026-06-03 (partial)

Partial day's work; additional changes may land later under a follow-up
2026-06-03 changelog.

## v3.5.346 – v3.5.347

### GPS how-to — corrected the "No location" troubleshooting bullet for PWAs

- **The bug.** The "If something isn't working" list in [docs/howto_gps_compass.html](ui_vp/uiVPAtlas/docs/howto_gps_compass.html) told users to confirm that *"VPAtlas (or your browser)"* was allowed to use Location Services. That's wrong on every platform that hosts the PWA: installed PWAs do not appear as standalone entries in iOS Location Services or the Android per-app permission list. Permission is granted to the host browser (Safari on iPhone, Chrome/Firefox on Android), and the PWA inherits it. Users who looked for a "VPAtlas" toggle in iOS Settings never found one and concluded the docs were broken.
- **The fix.** Rewrote the bullet to tell users to check the **browser**'s Location Services permission specifically, naming the per-platform candidates, and added one sentence clarifying that VPAtlas itself will not appear as a separate entry — the PWA inherits its location permission from the browser it was installed from.

### Service worker / build

- `manifest.json` 3.5.346 → 3.5.347 via `node sw-build.js patch`. Docs-only change.

## v3.5.346

### Visit form + Pool Finder — map tab now fills the visible viewport on mobile

- **The bug.** On mobile (iOS Safari especially), the Map tab in [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) and the map area in [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html) didn't fill the visible screen height. The other tabs in the visit form *looked* correct because their content is scrollable — the user could reach everything even if the bottom tab bar was clipped off-screen. The map can't scroll, so the missing bottom (or unreachable tab bar) was obvious.
- **The cause.** Both pages used `height: 100vh` on their outer flex container (`.visit-app`, `.pf-app`). On iOS Safari, `100vh` is anchored to the *largest* possible viewport (URL bar fully collapsed). When the URL bar is visible, the layout extends below the visible area and the bottom tab bar / lower map edge gets pushed off-screen.
- **The fix.** Added `height: 100dvh` (dynamic viewport height) immediately after the existing `height: 100vh` declaration in both files. `100dvh` tracks the live visible viewport as the URL bar shows/hides, so the bottom tabs (visit form) and the map's lower edge (Pool Finder) always sit inside the visible area. Older browsers without `dvh` support fall back to `100vh`.
- **Belt-and-braces.** Also added `overflow: hidden` to `.visit-tab-map` in [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) so the map tab can never scroll, even if some future child element accidentally exceeds 100% height. The map and its absolute-positioned overlays (zoom buttons, GPS pill, instruction label) stay locked to the visible tab area.

## v3.5.345

### Maps — legend collapse toggle moved to the bottom

- **The gap.** Every map's legend control sits at `bottomleft` and grows upward as items are added. On small phone screens — especially in portrait — the legend body is taller than the visible map area, so the legend's top edge (where the collapse/expand toggle used to live) was pushed off the top of the map. Users on those devices had no way to collapse the legend to see the map underneath.
- **The fix.** Moved the *Legend ▲* toggle from the top of the legend control to the bottom in both legend builders:
  - [js/map_common.js](ui_vp/uiVPAtlas/js/map_common.js) `addLegend()` — the static legend used by every "single map" page ([admin/review_view.html](ui_vp/uiVPAtlas/admin/review_view.html), [admin/review_create.html](ui_vp/uiVPAtlas/admin/review_create.html), [explore/pool_view.html](ui_vp/uiVPAtlas/explore/pool_view.html), [explore/visit_view.html](ui_vp/uiVPAtlas/explore/visit_view.html), [explore/survey_view.html](ui_vp/uiVPAtlas/explore/survey_view.html), [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html), [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html)).
  - [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) `statusControl` — the rich interactive legend on the main Explore map (status + level checkboxes + counts + parcels overlay).
- **Why this works.** The legend container is anchored at the bottom-left of the map, so its bottom edge is always inside the visible map area regardless of how tall the body grows. Putting the toggle at the bottom keeps it reachable on any screen size; expanded legends still extend upward and may overflow, but the user can collapse them with one tap.
- **CSS adjustments.** [css/map.css](ui_vp/uiVPAtlas/css/map.css): `.pool-legend-toggle-header` swapped `border-bottom`/`margin-bottom`/`padding-bottom` for `border-top`/`margin-top`/`padding-top` so the divider sits above the toggle (between body and toggle). The expanded-state arrow flipped from `▼` to `▲` (pointing up at the content above), and the collapsed-state rotation flipped from `rotate(-90deg)` to `rotate(180deg)` so it points down (no body to point at).
- **Persisted state unchanged.** The `legendCollapsed` setting is still read/written through `loadSettings()`/`saveSettings()`, so a user who collapsed the legend before this change still sees it collapsed after.

### Documentation — finalized stale 2026-06-01 partial

- Closed out `CHANGELOG-2026-06-01-partial.md` → [CHANGELOG-2026-06-01.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-06-01.md) per the daily roll-over rule (2 days stale). Dropped `(partial)` from H1, removed the boilerplate paragraph. Updated [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) and [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) DOCS array.

### Service worker / build

- `manifest.json` 3.5.344 → 3.5.346 via `node sw-build.js patch` (two bumps today — 3.5.345 for the legend-toggle move, 3.5.346 for the map-tab height fix). UI rebuilds only; no API or DB change. No new client-side files, so [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) is only updated for the changelog file rename + today's new partial. NOT deployed to prod yet.
