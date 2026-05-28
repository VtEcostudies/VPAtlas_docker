# Changelog — Snapshot 2026-05-27 (partial)

Partial day's work; additional changes may land later under a follow-up
2026-05-27 changelog.

## v3.5.331 – v3.5.340

### Visit form — Pool Disturbance section restored (4g on the original datasheet)

- **The gap.** The original paper datasheet's section **4g) Pool Disturbance** never made it back into the docker rewrite of [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html). The DB columns were carried over from the legacy schema (`visitDisturbSiltation`, `visitDisturbDumping`, `visitDisturbVehicleRuts`, `visitDisturbRunoff`, `visitDisturbDitching`, `visitDisturbOther`) and the read-only visit card already rendered all six in its **Disturbances** row, but the form had no inputs — so volunteers couldn't enter the values in the first place.
- **The fix.** New **Pool Disturbance** form-section in the Verify tab, immediately after Surrounding Habitat. Five checkboxes for *Siltation*, *Dumping*, *Vehicle Ruts*, *Agriculture Runoff*, *Ditching/Draining* plus a free-text *Other* field, wired into the existing load (populate from row on edit) and save (post body) field lists. No API or DB change — the columns were already there waiting; visit_card.js's render lines 149-186 already cover the display side.

### Service worker / build

- `manifest.json` 3.5.338 → 3.5.340 — entry was first written at 3.5.339 (local sw-build patch) but the actual deploy ran sw-build a second time as part of `deploy-prod.sh ui`, shipping at 3.5.340. UI rebuild only; no API or DB change.

### Visit form — save-as-you-type, plus last-chance saves before any reset

- **The user report.** *"It seems that I'm increasingly having an issue where a visit resets itself in the middle of adding data, wiping everything that was already entered."* Reproduced on **iPhone in airplane mode** — so the cause is NOT a service-worker auto-update (no network → no `registration.update()` → nothing can install or reload). The remaining automatic mechanism in airplane mode is **iOS WebKit standalone-PWA process eviction**: under memory pressure, iOS discards the WebView; on resume, iOS re-loads the URL and the page cold-starts. The app shell still looks like it's running (the user thought eviction would close the app entirely — it doesn't; iOS PWAs feel like apps but are still webviews underneath, and webviews can be recycled independently of the wrapping shell).
- **The bug.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) only autosaved drafts to IndexedDB every **30 seconds**, with no `pagehide` / `visibilitychange` / `beforeunload` saves. That 30-second gap was the data-loss window: anything typed since the last tick was gone after any reset (iOS eviction, SW reload, refresh, JS error).
- **The fix — save-as-you-type, ~500 ms after the last input.** One delegated `input` listener + one delegated `change` listener on `document`, debounced via `setTimeout`. Reuses the existing `saveLocal('draft')` function at [visit_create.html:1988](ui_vp/uiVPAtlas/survey/visit_create.html#L1988) (already verified safe — reads form values, never re-populates the DOM). The 30-second timer stays as a backstop.
- **The fix — last-chance lifecycle saves.** `pagehide`, `beforeunload`, and `visibilitychange` (when `document.hidden`) all call `saveLocal('draft')`. iOS fires `pagehide` reliably before WebKit evicts the WebView. Three independent hooks so a save runs even if one event doesn't fire on a particular iOS / browser version.
- **Why this is a simplification, not added complexity.** The earlier suggestion — "lock SW updates while a form is open" — was a coordination layer between two subsystems. This fix instead closes the data-loss window in the *one* subsystem where it lives. The form becomes durable against any reset, not just SW-update reset.

### SW update path — bandwidth gate now covers the whole update flow, not just our explicit check

- **The user report.** *"I had thought that we had added a low-bandwidth guard to prevent App updates when they would take a long time. In addition to this bug, updates are still happening with low bandwidth, causing the App to be disabled by very long-running updates."*
- **The hole.** The existing bandwidth gate at [app.js:282-333](ui_vp/uiVPAtlas/js/app.js#L282-L333) only guarded *our* `registration.update()` call. It did **not** guard (a) the browser's own SW update fetch (which previously fired on every navigation because the registration used `updateViaCache: 'none'`), nor (b) the install/activate sequence once new sw.js bytes were detected. So on slow cellular the browser still found the new sw.js, install still ran, and the SW saturated the connection downloading the ~148-entry, ~17 MB precache list — making the app feel disabled for several minutes.
- **Fix 1 — `updateViaCache: 'none'` → `'all'`.** [app.js:295](ui_vp/uiVPAtlas/js/app.js) now registers with `'all'`, which lets the browser respect HTTP cache headers on sw.js. Combined with a new `Cache-Control: max-age=86400` header on `/sw.js` (set by a tiny middleware in [ui_vp/server.js](ui_vp/server.js) before the static handlers), the browser's automatic SW update check is throttled to **at most once per day per device**. `forceSWUpdate()` console helper and Reset App still force an immediate check.
- **Fix 2 — bandwidth probe now gates ACTIVATE too, not just UPDATE.** The bandwidth-probe block was extracted into a small `bandwidthOk()` helper. It's now called from three places: the explicit `registration.update()` site (unchanged), the cold-load waiting-SW activation site, AND the `statechange === 'installed'` site. If bandwidth is below the 1500 kbps gate at any of those points, the new SW is left in `waiting`, the existing `showUpdatePausedToast()` appears, and the user keeps the OLD version. New diagnostic log values: `install-skipped why: bandwidth` and `waiting-skipped why: bandwidth` — documented in the updated [SW_UPDATE_FLOW.md](SW_UPDATE_FLOW.md) gates table and diagnostic recipe.
- **Cache-Control middleware.** [ui_vp/server.js](ui_vp/server.js) gets a 12-line middleware that sets `max-age=86400` on `/sw.js`, `no-cache` on `/manifest.json` and all `*.html` pages, and leaves everything else to the static handler's defaults. The middleware runs BEFORE the static mounts so the static middleware preserves the headers when sending the file. `manifest.json` *must* stay `no-cache` because it carries the user-visible version number.
- **User-facing how-to updated.** [howto_update_app.html](ui_vp/uiVPAtlas/docs/howto_update_app.html) gains two sentences explaining that auto-updates may take up to a day to appear, and that the app intentionally pauses the auto-reload on slow cellular so the user can keep working — with **Reset App** as the override.

### Service worker / build

- `manifest.json` 3.5.337 → 3.5.338 via `node sw-build.js patch`. **Full-stack** change (server.js change must reach the ui_vp container — deploy via `deploy-prod.sh deploy`).

### "Top of the Home Page" how-to — Town/County AND-vs-OR logic + boundary-click toggle

- **The gap.** [docs/howto_top_filters.html](ui_vp/uiVPAtlas/docs/howto_top_filters.html) had a one-sentence "Town and County" section that didn't explain (a) that Town + County combine as a logical AND while multiple Towns / multiple Counties combine as an OR, or (b) that you can add a Town to the filter by clicking its polygon on the map when the Town Boundaries layer is on. Field volunteers were trying combinations like "Strafford + Addison County" and seeing zero results without knowing why.
- **The fix.** Two new paragraphs in the Town and County section, plus an explicit note that map clicks and dropdown picks produce the same chip text (so either method can remove a chip added by the other) &mdash; the casing-unification shipped in 3.5.335 makes that promise actually true.

### Service worker / build

- `manifest.json` 3.5.335 → 3.5.336 via `node sw-build.js patch`. UI-only.

### Home filter — clicking a town on the map now matches the dropdown's casing

- **The bug.** Two ways to add a town to the home-page filter produced different casings, so the filter-chip set treated them as different towns. Choosing **Strafford** from the town dropdown produced `Strafford` (Mixed Case — the canonical form from `/vtinfo/towns` and `vptown.townName` in the DB), but clicking the Strafford polygon on the map produced `STRAFFORD` (UPPERCASE). Both chips would coexist; toggling the polygon off didn't remove the dropdown-added chip and vice versa.
- **The cause.** [js/map_common.js:433](ui_vp/uiVPAtlas/js/map_common.js) was reading `feature.properties.TOWNNAME` from [geojson/Polygon_VT_Town_Boundaries.geo.json](ui_vp/uiVPAtlas/geojson/Polygon_VT_Town_Boundaries.geo.json), which stores names UPPERCASE (e.g. `"CANAAN"`). The same features carry a second property, `TOWNNAMEMC` (`"Canaan"`), that matches the canonical Mixed Case used by the API / dropdown / DB.
- **The fix.** Prefer `TOWNNAMEMC` on the town overlay's `onEachFeature` reader. The fallback chain (`townName`, then `TOWNNAME`, then `NAME`) is kept harmless. Counties are intentionally UPPERCASE in both paths (per CLAUDE.md: *"County names in DB are UPPERCASE"*) — the county handler at [map_common.js:418](ui_vp/uiVPAtlas/js/map_common.js) is unchanged, still reads `CNTYNAME`.
- **What this changes visibly.** Map-click filter chips now match dropdown chips — `Strafford` from both paths. Hover tooltips on town polygons also switch from UPPERCASE to Mixed Case for consistency.
- **Stale state.** Anyone who already has an UPPERCASE town in their filter (from before this fix) will see that stale chip persist in IndexedDB; remove it with the `×` on the chip, or via Reset App on the Profile page. New map clicks always produce Mixed Case.

### Service worker / build

- `manifest.json` 3.5.334 → 3.5.335 via `node sw-build.js patch`. UI-only.

### s123 survey ingest — stop creating phantom "Obs 2" rows in vpsurvey_amphib

- **The problem.** Yesterday's UI fix in [survey_view.html](ui_vp/uiVPAtlas/explore/survey_view.html) hid the phantom second observer on the survey detail page, but downstream consumers — `/survey/csv` exports, `/survey/geojson` (and its `?download=1`), external API pulls, and any direct read of `vpsurvey_amphib` — still saw the phantom rows. As the user put it: *"this matters for data views — downloads, API pulls, etc."*
- **The cause was the trigger.** [api_vp/vpSurvey/vpSurvey.s123.service.js](api_vp/vpSurvey/vpSurvey.s123.service.js) `upsertSurvey` packed every Survey123 observer slot into the `surveyAmphibJson` JSONB column on `vpsurvey`. The AFTER-INSERT trigger `insert_vpsurvey_subtables_from_vpsurvey_jsonb` then looped `jsonb_each(amphibJson)` and inserted a row whenever the sub-object was `!= '{}'`. An empty Obs 2 sub-object is NOT `'{}'` — it has the form `{ surveyAmphibObsEmail: null, …counts: null… }` — so the guard never fired. Worse, the trigger used `->` (JSONB) instead of `->>` (text) for the email column, which made a JSON null land as the four-character text string `'null'` in the TEXT column. Net result: 489 phantom rows on prod (~19% of `vpsurvey_amphib`), 454 phantom rows locally — all with `surveyAmphibObsId NULL`, `surveyAmphibObsEmail = 'null'`, every count column at 0.
- **The fix — new migration [018_amphib_skip_placeholder_observer.sql](db_migrate/migrations/018_amphib_skip_placeholder_observer.sql).** `CREATE OR REPLACE` the trigger function with two changes inside the amphib loop: (1) compute `cleaned_email := NULLIF(NULLIF(phibJson->>'surveyAmphibObsEmail','null'),'')` and `CONTINUE` when it's NULL and no `vpuser.email` lookup succeeds — drops placeholder slots before the INSERT; (2) use `->>` (text) instead of `->` (JSONB) for the email column so any future JSON null lands as a real SQL NULL, not literal text `'null'`. Migration also runs a one-time `DELETE FROM vpsurvey_amphib` on rows where `surveyAmphibObsId IS NULL AND surveyAmphibObsEmail IS NULL/''/'null'` — same predicate as the new guard. Verified locally: 454 → 0 placeholder rows, total dropped from 2,413 → 1,959, real-observer rows untouched (survey 5977 still has sfaccio + jloomis with their real counts).
- **The fix — JS importer too.** [api_vp/vpSurvey/vpSurvey.s123.service.js](api_vp/vpSurvey/vpSurvey.s123.service.js) `upsertSurvey` now deletes placeholder observer keys from `amphibRow` before storing it in `surveyRow.surveyAmphibJson`, AND collapses the literal `'null'` email string to a real `null` upstream. So the JSONB column on `vpsurvey` itself comes out clean for anyone reading it directly, even if the trigger guard was somehow bypassed. Belt and suspenders — the SQL guard is the safety net.
- **What survives.** All real-observer rows. The display-side `isRealAmphibObserver` filter shipped in v3.5.330 stays in place as defense-in-depth for any client that has cached old placeholder rows.

### Service worker / build

- `manifest.json` 3.5.332 → 3.5.333 via `node sw-build.js patch`. **Full-stack** change (API + DB migration — deploy with `deploy-prod.sh deploy`, not `ui`). NOT deployed to prod yet.

### Reviews — show `reviewReasons` on the read-only review detail page

- **The gap.** Yesterday's [v3.5.329 multi-select Reasons feature](CHANGELOG-2026-05-26.md) let admins *enter* structured reasons on [admin/review_create.html](ui_vp/uiVPAtlas/admin/review_create.html), but the read-only detail view at [admin/review_view.html](ui_vp/uiVPAtlas/admin/review_view.html) didn't render them — the new column was being saved, returned by the API, and silently dropped at display time. You had to click **Edit Review** to see what reasons were on a row.
- **The fix.** `renderReviewInfo` in [admin/review_view.html](ui_vp/uiVPAtlas/admin/review_view.html) now inserts a **Reasons** row immediately after **Pool Status**, rendered as a compact `<ul>` (one bullet per reason). Conditional on `Array.isArray(r.reviewReasons) && r.reviewReasons.length`, matching the existing pattern for the **Notes** row that only renders when populated — so older rows with no reasons (null or empty array) stay visually unchanged.

### Service worker / build

- `manifest.json` 3.5.330 → 3.5.332 via `node sw-build.js patch` (two patch bumps: 3.5.331 carried the review_view change; 3.5.332 was needed because `sw-build.js` was re-run to pick up the `urlsToCache.js` changelog list change and the default re-bumps the patch number). UI rebuild only; no API or DB change. No new client-side files; [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) is only updated to add today's changelog file and finalize yesterday's.

### Documentation

- Finalized [CHANGELOG-2026-05-26.md](CHANGELOG-2026-05-26.md) (was `-partial`) — dropped the `(partial)` qualifier from the H1 and removed the "Partial day's work…" boilerplate paragraph. Updated both index lists ([urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) precache block, [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) DOCS array) per the daily roll-over rule.
