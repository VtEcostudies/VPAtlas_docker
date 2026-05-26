# Changelog — Snapshot 2026-05-26 (partial)

## v3.5.315 – v3.5.316

Partial day's work; additional changes may land later under a follow-up
2026-05-26 changelog.

### "Updating the App" how-to — sign-in warning added

- **The user report.** A volunteer in the field with poor service couldn't create a visit because they weren't signed in, and login can't succeed without a network. The existing [howto_update_app.html](ui_vp/uiVPAtlas/docs/howto_update_app.html) guide didn't say this.
- **The fix.** Two additions to the guide:
  - A bold warning callout near the top: *"Sign in while you have a good connection — before you head out."* with a sentence explaining that login requires a network and that without it, you can't create or submit a visit, survey, or new pool in the field.
  - A new step in the **Before you head out** checklist: *"Make sure you're signed in. Tap the menu (☰) → Login. Login requires a network, so do it now while signal is good — you can't sign in offline."*

### Documentation — finalized 2026-05-25 changelog

- Closed out `CHANGELOG-2026-05-25-partial.md` → [CHANGELOG-2026-05-25.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-05-25.md) (rename, drop `(partial)` H1, drop boilerplate paragraph). Daily roll-over per the locked rule. Updated [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) and the DOCS array in [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) accordingly, and added today's `CHANGELOG-2026-05-26-partial.md` to both.

### Map a Pool — full basemap + boundary overlay layer control

- **The gap.** [explore/pool_create.html](ui_vp/uiVPAtlas/explore/pool_create.html) — the admin "Map a Vernal Pool" screen — was using a bare OpenStreetMap-only basemap. The explore home page and the Pool Finder both expose the full VCGI basemap stack (CIR, Leaf-Off, Lidar DEM/DSM/Slope) plus county/town boundary overlays, which are exactly the layers an admin needs to *accurately* place a new pool marker. Inconsistent and worse-for-task.
- **The fix.** Same one-liner pattern the explore page uses, reusing the existing helpers in [`js/map_common.js`](ui_vp/uiVPAtlas/js/map_common.js):
  - `createBaseLayers()` for the basemap dict (Google Satellite +, Esri Topo, Street Map, Satellite, Open Topo, VCGI CIR, VCGI Leaf-Off, VCGI Lidar DEM/DSM/Slope).
  - `loadBoundaryOverlays(map)` + `addBoundaryOverlays(...)` for the state/county/town overlays as a separate radio control. Boundary clicks zoom-to-bounds, same as the explore page.
- Added `esri-leaflet_3.0.12.js` script tag (was missing — needed for the Lidar `L.esri.imageMapLayer` layers; the file is already precached in urlsToCache).
- No urlsToCache change (pool_create.html, map_common.js, esri-leaflet, and all GeoJSON boundaries were already cached).

### Service worker / build

- `manifest.json` 3.5.314 → 3.5.316 via `node sw-build.js patch`. UI rebuild only; no API or DB change. (3.5.315 = howto sign-in warning; 3.5.316 = pool_create basemaps/overlays.)
