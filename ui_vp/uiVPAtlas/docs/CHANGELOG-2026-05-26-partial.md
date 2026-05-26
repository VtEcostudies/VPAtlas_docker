# Changelog — Snapshot 2026-05-26 (partial)

## v3.5.315 – v3.5.321

Partial day's work; additional changes may land later under a follow-up
2026-05-26 changelog.

### Admin Download — Mapped is always downloadable; Reviews added as a 4th data kind

- **The bug.** With dataType=Mine + Mapped checked, the download came back empty: only ~2,200 of ~13,500 mapped records have a `mappedUserId` and an admin who isn't one of those users got 0 rows. With dataType=Review, the Mapped checkbox was *disabled* — same family of mistake but the other direction. As the user put it: *"Mapped pools is just pool location data. It should always be downloadable."*
- **The fix — Mapped ignores dataType.** [explore/js/download_dialog.js](ui_vp/uiVPAtlas/explore/js/download_dialog.js) `buildParts` no longer adds `mappedUserId` (Mine) or `visitNeedsReview` (Review) for the Mapped kind. Mapped CSV is now: status filter only, every time. Same treatment for the new Reviews kind. Visit keeps Mine + Review filters; Survey keeps Mine only. Removed the disable-checkboxes-when-Review logic and the "Visit is the only one allowed" note — every kind is always selectable.
- **New data option: Reviews.** Added a 4th checkbox `Reviews` next to Mapped Pool records / Atlas Visits / Monitoring Surveys, backed by a new `/review/csv` endpoint:
  - [api_vp/vpReview/vpReview.routes.js](api_vp/vpReview/vpReview.routes.js) — added `router.get('/csv', getCsv)` above `'/:id'` (Express order matters or `csv` is matched as an id and we get an enum-cast error), plus a `getCsv` handler that calls the existing `service.getAll` and pipes the result through `json-2-csv` with `Content-disposition: attachment; filename=vp_review.csv`. Same pattern as `vpMapped`, `vpVisit`, `vpSurvey`.
  - [api_vp/vpReview/vpReview.service.js](api_vp/vpReview/vpReview.service.js) — staticColumns expanded from `[vpreview, vptown]` to `[vpreview, vpmapped, vpvisit, vptown]` so the existing `mappedPoolStatus` filter passes through `pgUtil.whereClause` and reaches the SQL. (Documented the `createdAt`/`updatedAt` ambiguity risk in a comment — those columns exist on all four tables; don't pass them as filter params.)
- **Inline note in the dialog** now adapts to dataType: explains for Mine which downloads get user-filtered, and for Review that only Visit is filtered to "needs review" — the others return whatever matches the pool-status filter.

### s123 visit import — photos now actually arrive in vpvisit_photos

- **The bug.** Out of 339 visits ingested from Survey123 in production, only **2** had any rows in `vpvisit_photos` — a 0.6% success rate. The visit row landed correctly but its photos almost never did. Admins running the import from [admin/s123_visit_import.html](ui_vp/uiVPAtlas/admin/s123_visit_import.html) couldn't tell anything was wrong; the import reported success.
- **The actual cause (took two passes to find).** [api_vp/vpVisit/vpVisit.s123.service.js](api_vp/vpVisit/vpVisit.s123.service.js) hard-coded a loop `relationshipId = 1..8` against Survey123's `queryRelatedRecords` endpoint to find the species sub-records that hold the photos. But the VPVisit service's relationship IDs are **9..16** (mapping to repeat-table layers 1..8) — Esri started numbering them at 9 in this service. The legacy code's queries for relationshipId 1..8 errored out with "Unable to perform query." for every visit, the resulting `attachmentInfos` was empty, and `db.pgp.helpers.insert([], …)` threw silently as "MIXED RESULTS." For comparison the VPSurvey service uses relationshipId 1..7 (matching its relatedTableIds), which is why surveys imported photos fine and visits never did.
- **The fix — dynamic relationship discovery.** New `getRelationships(serviceId)` helper in [api_vp/vpUtil/vpS123.service.js](api_vp/vpUtil/vpS123.service.js) fetches `/FeatureServer/0?f=pjson` once per process per service and returns the actual `[{id, relatedTableId, name}]` list. `getAttachments` in [api_vp/vpVisit/vpVisit.s123.service.js](api_vp/vpVisit/vpVisit.s123.service.js) iterates the discovered list instead of a hard-coded range — works for any Esri-assigned ID layout (visits, surveys, future forms with different numbering).
- **The fix — decouple `relationshipId` from attachment layer id in the shared util.** `getRepeatAttachments` previously used the same number `fetId` for both `queryRelatedRecords?relationshipId=…` AND `getFeatureAttachmentInfo(srvId, fetId, objId)`. That's wrong when they diverge (visit service: rel 16 → table 8). New optional `qry.attachmentLayerId` lets the caller pass the actual table id; falls back to `featureId` when absent (preserves survey behaviour unchanged).
- **The fix — empty-array guard.** `upsertAttachments` short-circuits with `resolve([])` when `valArr.length === 0` instead of letting `helpers.insert([])` throw. A visit with genuinely no photos now imports cleanly with `no attachments to insert for visitId N` in the log, not a buried error.
- **Helper exports.** `getFeatureAttachmentInfo` and `getRelationships` are now exported from [api_vp/vpUtil/vpS123.service.js](api_vp/vpUtil/vpS123.service.js).
- **What the wrong first attempt was.** v3.5.318 added a "parent-attachment" query against `/FeatureServer/0/<objectId>/attachments` on the assumption Survey123 attached visit photos directly to the parent form record. The parent layer has `hasAttachments: false` — that query returned `400 "Layer does not support attachments"` for every visit. Photos actually live on the repeat-table layers (1..8) reached via the relationships. The wrong block has been removed; the dynamic-discovery approach above replaces it.
- **Out of scope (follow-up).** The imported `visitPhotoUrl` stays an absolute `https://services1.arcgis.com/.../attachments/N` URL — works while Survey123 is reachable but breaks the offline contract (a tile-cached field device can't load the photo without a signal). A follow-up should `fetch(url)` → write to `photo_data/<poolId>/<visitId>/<species>.N.jpg` → rewrite `visitPhotoUrl` to the local `/photos/...` path, mirroring what the manual `visit_create` form already does.

### Service worker / build

- `manifest.json` 3.5.317 → 3.5.318 via `node sw-build.js patch`. API change (deploy via `deploy-prod.sh deploy`, not `ui`).
- `manifest.json` 3.5.318 → 3.5.319 — `download_dialog.js` `window.appConfig` → bare `appConfig` (config.js declares it with `const`, which doesn't attach to window; api.js's pattern matched).
- `manifest.json` 3.5.319 → 3.5.320 — admin Download: Mapped/Reviews ignore dataType, new `/review/csv` endpoint, Reviews data-kind checkbox. API change.
- `manifest.json` 3.5.320 → 3.5.321 — s123 visit photo import: dynamic relationship discovery + attachmentLayerId decoupling. Reverts the wrong 3.5.318 parent-attachment block. API change.

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
