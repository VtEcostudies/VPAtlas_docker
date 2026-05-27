# Changelog — Snapshot 2026-05-27 (partial)

Partial day's work; additional changes may land later under a follow-up
2026-05-27 changelog.

## v3.5.331 – v3.5.336

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
