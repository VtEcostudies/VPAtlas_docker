# Changelog — Snapshot 2026-05-26 (partial)

## v3.5.315 – v3.5.318

Partial day's work; additional changes may land later under a follow-up
2026-05-26 changelog.

### s123 visit import — photos now actually arrive in vpvisit_photos

- **The bug.** Out of 339 visits ingested from Survey123 in production, only **2** had any rows in `vpvisit_photos` — a 0.6% success rate. The visit row landed correctly but its photos almost never did. Admins running the import from [admin/s123_visit_import.html](ui_vp/uiVPAtlas/admin/s123_visit_import.html) couldn't tell anything was wrong; the import reported success.
- **The cause.** [api_vp/vpVisit/vpVisit.s123.service.js](api_vp/vpVisit/vpVisit.s123.service.js) `getAttachments` only queried Survey123's `queryRelatedRecords` endpoint, looking for attachments on **child feature records** (the multi-row species/repeat-table pattern that VPSurvey uses for amphib/macro sub-records). The VPVisit Survey123 form doesn't use that pattern — it attaches photos directly to the parent visit record. So for nearly every visit the child query returned empty, `attachmentInfos` was `[]`, and the downstream `db.pgp.helpers.insert([], …)` threw "Cannot generate an INSERT from an empty array", which the caller swallowed as a "MIXED RESULTS" non-error.
- **The fix — parent-attachment query.** `getAttachments` now also calls `vpS123Util.getFeatureAttachmentInfo(serviceId, 0, objectId)` for the parent visit BEFORE the existing 1..8 child-feature loop. That hits `/FeatureServer/0/<objectId>/attachments`, which is where the parent attachments actually live. Each result is tagged `featureServerId=8` (POOL in the `attachFeatureIds` map) so the existing `upsertAttachments` insert path uses `'POOL'` as `visitPhotoSpecies`. Smarter species classification by parsing `attachment.keywords` is a follow-up.
- **The fix — empty-array guard.** `upsertAttachments` now short-circuits with `resolve([])` when `valArr.length === 0` instead of letting `helpers.insert([])` throw. So a visit with genuinely no photos imports cleanly and the import log line is `no attachments to insert for visitId N`, not a buried error.
- **Helper export.** `getFeatureAttachmentInfo` was a private function in [api_vp/vpUtil/vpS123.service.js](api_vp/vpUtil/vpS123.service.js); added it to the module's `exports` so the visit service can call it directly.
- **Out of scope (follow-up).** The imported `visitPhotoUrl` stays an absolute `https://services1.arcgis.com/.../attachments/N` URL — works while Survey123 is reachable but breaks the offline contract (a tile-cached field device can't load the photo without a signal). A follow-up should `fetch(url)` → write to `photo_data/<poolId>/<visitId>/<species>.N.jpg` → rewrite `visitPhotoUrl` to the local `/photos/...` path, mirroring what the manual `visit_create` form already does.

### Service worker / build

- `manifest.json` 3.5.317 → 3.5.318 via `node sw-build.js patch`. API change (deploy via `deploy-prod.sh deploy`, not `ui`).

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

### Admin Download — CSV export from the home page hamburger

- **The ask.** Bring back the legacy product's download capability, initially CSV only and admin-only. The dialog filters pools by data-type (All / Mine / Review) and pool status — matching the home page's primary filter axes — and lets the admin pick which records to include (Mapped Pool records, Atlas Visits, Monitoring Surveys). GeoJSON support deferred to a follow-up.
- **The plumbing.** The API already exposed `/pools/mapped/csv`, `/pools/visit/csv`, and `/survey/csv` with `?download=1` for `Content-disposition: attachment` (and accepts the same WHERE-clause query params as the regular `/pools/*` GETs). So the build is almost entirely front-end:
  - New module [explore/js/download_dialog.js](ui_vp/uiVPAtlas/explore/js/download_dialog.js) — self-contained modal with injected CSS, radio (data-type) + checkboxes (status + data kinds), pre-populated from the home-page `filters.dataType` + `filters.poolStatuses`. On Download it builds the URL(s) and triggers one `<a download>` per checked data kind. Browsers may prompt "Allow multiple downloads?" the first time the user picks more than one — expected.
  - Admin-only menu item `Download…` added between *Users* and the S123 import items in [explore/index.html](ui_vp/uiVPAtlas/explore/index.html). Gated on `user.userrole === 'admin'`, same gate as the rest of the admin section.
  - File names: `vpatlas_mapped_YYYYMMDD.csv`, `vpatlas_visit_YYYYMMDD.csv`, `vpatlas_survey_YYYYMMDD.csv` — set via the `<a download>` attribute so they override the server's static `vp_mapped.csv` / `vp_visit.csv` / `vp_survey.csv` defaults.
- **Per-visit Review support.** The home page's `Review` filter is purely client-side per-visit logic (`url_state.js` case `'Review'`). To make it work for a streaming CSV download, mirrored the SQL on the backend:
  - New `visitNeedsReview()` helper in [api_vp/_helpers/db_common.js](api_vp/_helpers/db_common.js) returns the same condition: `NOT EXISTS (review for this visit) OR (lastEditedAt > MAX(reviewQADate))`.
  - [api_vp/vpVisit/vpVisit.service.js](api_vp/vpVisit/vpVisit.service.js) `getCsv` now ANDs the fragment in when `?visitNeedsReview=1` is passed. Same pattern as the existing `visitHasIndicator` opt-in.
  - The dialog disables the Mapped and Survey checkboxes when Review is selected (Review = "needs review" = per-visit only) and shows an inline note explaining it.
- **Filter scope.** v1 honors only the dialog's controls (data-type + status). Town / county / pool-ID / near-me from the home page are NOT applied to the download — the dialog is the sole source of truth for the download's filter set. Easy to add later if the workflow demands it.
- **Authentication.** All three `/csv` endpoints are unauthenticated GETs (matching every other pool-data read), so the download can be triggered with a plain `<a href>`. The admin gate is the menu-item visibility check, consistent with the rest of the admin tooling in this app.

### Service worker / build

- `manifest.json` 3.5.314 → 3.5.317 via `node sw-build.js patch`. UI **and** API rebuild this time — `api_vp` changed (new `visitNeedsReview` helper + `getCsv` opt-in). (3.5.315 = howto sign-in warning; 3.5.316 = pool_create basemaps/overlays; 3.5.317 = admin Download dialog + visit-needs-review backend filter.)
- `urlsToCache.js`: adds `/explore/js/download_dialog.js`.
