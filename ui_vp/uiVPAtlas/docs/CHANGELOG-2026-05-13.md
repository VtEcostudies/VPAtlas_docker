# Changelog — Snapshot 2026-05-13

## v3.5.232 – v3.5.263

Consolidates the four 05-10 / 05-11 / 05-12 / 05-13 partial changelogs into
a single snapshot. Spans four days of work across explore, the Atlas
Visit form, typography, auth, the offline / changelog story, and the
admin Review filter.

---

### Explore — "Pools near me" now follows you live

- **The gap.** The Near Me filter captured a single `getCurrentPosition` fix when the checkbox was toggled on and stored it as a static `nearMeOrigin`. Once on, the radius origin never moved — opening the app or returning to the home page after walking a few hundred meters showed a list of pools centered on yesterday's location until the user manually toggled the filter off and on again.
- **The fix.** [explore/js/filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js) — Near Me now drives a `GPSMonitor` (`watchPosition`) instead of a one-shot fix. Lifecycle is tied to the checkbox: `startNearMeTracking()` on toggle-on, `stopNearMeTracking()` on toggle-off (and on token-X removal, which dispatches a `change` event into the same handler). The first position event fulfills the toggle's "Locating…" promise; subsequent events update `filters.nearMeOrigin` in place and call `applyFilters()` to re-run the three-pane render.
- **15 m movement threshold.** Position events at ~1 Hz would re-render the pool list / map / summary too often on a stationary GPS that's jittering inside its own accuracy circle. After the first fix, subsequent fixes only re-apply when the user has moved at least 15 m from the origin currently in use. Origin within `filters` always reflects the last *applied* position (so stepper changes and persistence stay in sync); the live fix is held in the `GPSMonitor` instance until it crosses the threshold.
- **Auto-resume on cold load.** When `nearMeKm > 0 && nearMeOrigin` is restored from IndexedDB at page load, `initFilterBar` kicks off `startNearMeTracking({ silent: true })` automatically — same as if the user had toggled the filter on themselves. The first fresh fix re-renders the panes with the current location, replacing whatever stale origin was carried over from the previous session. The filter no longer goes stale across app launches or page navigations.
- **Two GPS monitors, one watch.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html)'s existing auto-click of the map's GPS button on resume is unchanged. Both GPSMonitor instances (the map's and the filter's) share the `gps-shared` BroadcastChannel, so only one tab actually calls `watchPosition` — the other goes passive and receives positions over the channel. No extra battery cost, no duplicate permission prompt.

### Explore — pinned pool stays visible when filtered out of scope

- **The gap.** When a pool was pinned via the list's pin icon and the user then narrowed the filters (different town, different status chip, etc.), the pinned pool's row dropped out of the list and its marker dropped off the map. The only remaining unpin path was the small `×` next to the `Find 1` chip in the list title — easy to miss, and the map halo had no marker to attach to.
- **The fix.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) `refreshUI()` and the `map:layer-filter` listener wrap their filter outputs in a new `ensurePinnedVisible()` helper. If a pool is pinned but the filtered rows don't contain it, the pinned row is prepended back from `masterRows` so the map, list, and summary all see it. The user can unpin via the row's pin icon again, and the halo stays attached. No-op when nothing's pinned.
- **Caveat.** The map's internal status/level visibility filter inside `plotPoolRows` still hides the marker if the pinned pool's status is toggled off via the layer chips — but the row stays in the list, so the unpin path is preserved either way.

### Explore — cold-load with Near Me fits both pools and user

- **The gap.** On cold app-open with Near Me on, the map zoom landed on either the filtered pools or the user (whichever async event ran last) — not on a fit-both that frames "where am I relative to what's around me?". Manual GPS clicks and the dedicated zoom-both button worked fine; only the cold-load case was wrong.
- **The fix.** [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) — the inner zoom-fit logic was extracted from the both-button click into an exported `zoomToBoth()` function. `wireGpsButton(btn, opts)` now accepts `opts.onFirstFix`, a callback that overrides the default user-recenter on the very first GPS fix; deferred via `setTimeout(0)` so any other position listeners (filter_bar's own `GPSMonitor`, refreshUI's `zoomToFilteredPools`) finish first and the override gets the last word.
- **Wired in [explore/index.html](ui_vp/uiVPAtlas/explore/index.html).** When `filters.nearMeKm > 0` at init time, the GPS button is wired with `onFirstFix: () => zoomToBoth()`. Subsequent manual clicks still recenter on the user (existing behavior). When Near Me is off, no override — the GPS button behaves exactly as before.

### Explore — zoom-to-both ignores hidden markers

- **The bug.** With only Pool Status filters changed (Eliminated hidden by default), the zoom-to-both button — and the new cold-load auto-fit — was framing pools that weren't on the map. One Eliminated pool had bad coords near the Atlantic, so the bounds ballooned out to include Greenland and South America.
- **The cause.** `zoomToBoth()` was iterating the module-level `markers` dict, which holds every plotted marker including ones currently hidden by status/level chips. `zoomToFilteredPools()` had been doing the right thing all along by reading `poolLayer.getBounds()` (the FeatureGroup of visible markers only).
- **The fix.** [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) — `zoomToBoth()` now pushes `poolLayer.getLayers()` (visible only) into its bounds calc instead of `Object.values(markers)`. The Eliminated/Duplicate-hidden bad-coords rows no longer participate. Plus a comment so the next person reaching for `markers` here knows why not.

### Explore — Find Pool chip in the filter header

- **The ask.** When a pool is pinned for Pool Finder, surface it as a removable chip in the same filter row as the other active filters (town, county, near me) — with a one-tap X to clear it. The pin icon on the list row was the only unpin path before, and once the user scrolled away from that row it was hard to find.
- **Loose coupling between pool_list and filter_bar.** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) exports a new `clearPin()` and dispatches a `document.dispatchEvent(new CustomEvent('explore:pin-changed', { detail: { pinnedPoolId } }))` on every pin mutation — row pin click, row unpin click, programmatic Clear All. [explore/js/filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js) imports `getPinnedPoolId` and `clearPin`, listens for the custom event, and rebuilds tokens whenever the pin changes — so the chip stays in sync without filter_bar having to know about pool_list's internals beyond the two named exports.
- **Render and X handler.** `renderTokens` appends a `{ key: 'pinnedPool', label: 'Find Pool', value: poolId }` token whenever a pin is set; styling reuses the existing `.filter-token` rule, no new CSS. The X button uses `data-remove-key="pinnedPool"` and calls `clearPin()` in the dispatch table, which fires its own pin-changed event (re-render) and lets the existing `onPinDeselect` callback in index.html clear the map halo.

### Explore — pool ID filter clear-X surfaced on reload + no map yank

- **Missing X on reload.** The pool ID search input had a clear-X button wired in [explore/js/filter_bar.js](ui_vp/uiVPAtlas/explore/js/filter_bar.js) that only appeared after the user typed into the field. On page reload with a persisted `poolIdSearch`, the input was repopulated from IndexedDB but the X stayed hidden — so the user had to manually delete the value character-by-character or use the filter token in the row below. Fixed by also showing the X when the persisted value is restored at the end of `initFilterBar`.
- **Map no longer yanks on clear.** Clearing the pool ID filter (via either the input X or the filter token X) used to fire `applyFilters()` which cascades into `refreshUI()` → `zoomToFilteredPools()` — yanking the map back to bounds of every visible pool. The user was usually still focused on the same area and didn't want the view reset. `applyFilters()` now accepts an `opts` object; both pool-ID clear paths pass `{ noZoom: true }`. The option plumbs through `onFilterChange(filters, opts)` to `refreshUI(opts)`, where `if (!opts.noZoom) zoomToFilteredPools()` skips the fit. Other filter removals (town, county, status, near me) still re-zoom as before.

### Explore — pool ID filter is exact-match when picked from suggestions

- **The bug.** When a pool ID was a substring of other pool IDs (e.g. `SDF123` is also a prefix of `SDF1234`, `SDF1235`, …), picking the specific pool from the typeahead dropdown still left every match-by-containment pool on the map and list. The downstream client filter did `id.includes(term)` for every value of `filters.poolIdSearch`, with no way to express "I picked this one specifically."
- **The fix.** New `filters.poolIdExact` boolean in [explore/js/url_state.js](ui_vp/uiVPAtlas/explore/js/url_state.js). Set to `true` when the user clicks a suggestion in the typeahead dropdown; `false` for any free-text path (typing + Enter, the input X, the chip X, Clear All). The client filter in [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) `applyClientFilters` now switches between `id === term` and `id.includes(term)` based on the flag. Persisted to IndexedDB and the URL (`?poolIdExact=1`) so the exact-match state survives reload + back/forward.
- **Net behavior.** Type "SDF" → suggestions show SDF123, SDF1234, SDF1235. Click SDF123 → only SDF123 shows on the map and list. Type "SDF" + Enter (no click) → still substring, all SDF-containing pools shown — that's the free-text path and stays unchanged for users who explicitly want partial match.

### Explore — Zoom to Lat/Lon menu item

- **The ask.** A quick way to jump the home map to an arbitrary coordinate — for chasing down reports from external sources (Survey123 forms, email descriptions, "I'm at [coords]" texts).
- **Where.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) hamburger menu, between **Refresh Pool Data** and the changelog divider. The action calls a new inline `promptLatLng()` helper then `getMap().setView([lat, lng], max(currentZoom, 15))`. On mobile, also calls `switchTab('map')` so the user actually sees the result; the explicit `setView` is queued behind a short timeout so it overrides `switchTab`'s built-in `zoomToFilteredPools()` instead of being clobbered by it.
- **`promptLatLng()` helper.** A small inline modal using the existing `.vp-modal` styling — `showModal()` is button-only and doesn't surface input contents, so building it directly was simpler than retrofitting that module. Two decimal inputs with `inputmode="decimal"` for the iOS number keypad. Validation: both must be numbers, latitude `-90..90`, longitude `-180..180`. Errors render inline.
- **Paste-both convenience.** If the user pastes `44.4759, -73.2121` (or whitespace-separated) into the latitude field, an `input` listener auto-splits it into both fields and focuses longitude. Saves a step when copying from a maps app.

### Explore — admin Review filter became edit-aware

- **The rule.** A pool needs review when `visitUpdatedAt > coalesce(reviewUpdatedAt, 1900-01-01)` — i.e. there's a visit whose latest update is more recent than the latest review. Never-reviewed pools always match (the coalesce makes the inequality trivially true), and a freshly-edited reviewed visit re-qualifies because its `updatedAt` jumps past the review's. No backend change needed — `/pools` already exposes `visitUpdatedAt` and `reviewUpdatedAt` on every joined row.
- **Where the math lives.** The cross-join in `/pools` multiplies rows when a pool has multiple visits and reviews, so the rolled-up row has to track the MAX of each timestamp across the joined rows (the *latest* visit edit and the *latest* review). [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) `deduplicateByPoolId` now accumulates `_maxVisitUpdatedAt` and `_maxReviewUpdatedAt` per pool. The Review filter in [explore/js/url_state.js](ui_vp/uiVPAtlas/explore/js/url_state.js) reads those and applies the inequality. Old filter (`r.visitId && !r.reviewId`) is gone.
- **Why no review-row mutation.** Reviews are historical records — they describe the visit as it was when reviewed. Editing the visit doesn't invalidate the review's content; it just changes which version of reality the review was based on. The filter answering "needs another look?" is the right place to encode that, not a DELETE or a stale-flag.

### Explore — Review filter empty after edit-aware deploy (cache-invalidation fix)

- **The bug.** The edit-aware Review filter rewrote `filterRowsByDataType('Review')` to compare `_maxVisitUpdatedAt` vs. `_maxReviewUpdatedAt`, with both fields populated in the new `deduplicateByPoolId` path. What it forgot: bumping `POOL_CACHE_KEY` in [js/cache_keys.js](ui_vp/uiVPAtlas/js/cache_keys.js). Existing clients had `pool_cache_v2` populated with the *old* dedupe rows (no `_max*UpdatedAt` fields). The new filter read those fields, got `undefined`, hit the `if (!visitAt) return false` guard, and every pool failed. Net result: the admin-only **Review** button on the Explore page showed an empty list and an empty map.
- **The fix.** Bumped `POOL_CACHE_KEY` from `pool_cache_v2` → `pool_cache_v3` so existing IndexedDB caches are abandoned on next visit and the client refetches `/pools` through the new dedupe. The `cache_keys.js` comment that *exists exactly for this scenario* now points at this incident.
- **For users with the bad cache.** No action needed — the cache key bump makes the next page load a one-time refetch (the same ~98 MB body the initial load always pulled). The freshness fingerprint then takes over and routine reloads stay instant.

### Explore — debug timestamp strip on the pool list (Review filter diagnosis)

- **The follow-on problem.** The Review filter is currently showing pools that don't need review, and hiding some that do. The filter rule is `visitUpdatedAt > coalesce(reviewUpdatedAt, 1900-01-01)`, but `updatedAt` on either table can be bumped by data migrations independently of when a user actually edited the visit or reviewed it — so the inequality is comparing two migration-tainted timestamps. The true "when the review made its decision" signal is `reviewQADate`, not `reviewUpdatedAt`.
- **The instrumentation.** Each row in the home page pool list now renders a small grey timestamp strip:
  `v:YYYY-MM-DD · q:YYYY-MM-DD · r:YYYY-MM-DD`
  where `v` is `max(vpvisit.updatedAt)` across the pool's visits, `q` is `max(vpreview.reviewQADate)`, and `r` is `max(vpreview.updatedAt)`. Hover tooltip spells out which field is which.
  - **Backend:** [api_vp/vpPools/vpPools.service.js](api_vp/vpPools/vpPools.service.js) — added `"reviewQADate"` to the explicit SELECT lists in `getMappedJoinAll` and the visit-side query (the third query already uses `vpreview.*` so reviewQADate was already present there).
  - **Dedup:** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) `deduplicateByPoolId` now also accumulates `_maxReviewQADate` per pool, alongside the existing `_maxVisitUpdatedAt` / `_maxReviewUpdatedAt`.
  - **Render:** the row template appends the debug strip after the existing counts.
- **What we're hoping to learn.** Once the strip is live, spot-check a pool that wrongly appears in Review: if `q` is *after* `v`, the QA date already says "review is newer than the visit edit" and the filter should switch to `visitUpdatedAt > coalesce(reviewQADate, 1900-01-01)`. If `q` is *before* `v` but the review was clearly made after the user's last meaningful edit, then we need a different signal entirely (e.g. user-edit-only timestamp column).

---

### Visit detail — mapped vs. visit location shown distinctly

- **The gap.** [explore/visit_view.html](ui_vp/uiVPAtlas/explore/visit_view.html) plotted a single marker at `v.visitLatitude || m.mappedLatitude` — falling back to mapped when the visit had its own GPS too. When a volunteer's recorded location differed from the official mapped pool, you couldn't see the offset and there was no signal which point the marker represented.
- **The fix — two markers with role-bearing labels.** Mapped pool now renders as a **circle** (`surveyLevel: 'potential'`, size 22), visit as a **triangle** (`surveyLevel: 'visited'`, size 24). Tooltips and popups state the role explicitly: mapped reads "Mapped pool location — {poolId}, {town} ({status})" with a popup spelling out *Mapped pool location* / Pool ID / Status / Town; visit reads "Visit {N} location — {date}" with a *Visit location* popup / Visit ID / Date / Pool ID. The visit triangle plots after the mapped circle so it stacks on top when the two coords overlap — but the tooltip/popup wording is what disambiguates, not the stacking order.
- **Map framing.** When both coords exist and differ by more than ~10 cm of decimal-degree noise, `fitBounds([mapped, visit])` zooms to show both with 40 px padding. When they're nearly identical (or only one is present), keeps the existing single-point `setView([…], 16)`. The "Zoom to pool" button retitles to "Zoom to pool and visit" in the both-coords case and runs the same `fitBoth()` helper.

### My Visits and Tracks — pool status badge

- **The gap.** [explore/visit_list.html](ui_vp/uiVPAtlas/explore/visit_list.html) rendered the upload/server status next to each row (`server`, `draft`, `complete`, `uploaded`) but not the pool's own status. Without it the user couldn't tell at a glance whether a visit was to a Confirmed, Probable, Potential, or Eliminated pool — info that's right there in the home page list view.
- **The fix.** Added a `poolStatusClass()` helper (same color map as `pool_list.js getStatusClass`) and a `poolStatusHtml` snippet rendered between the upload-status badge and the pool ID link. Reuses the `.status-badge` + `.status-{confirmed,probable,potential,duplicate,eliminated}` classes from [pool_list.css](ui_vp/uiVPAtlas/explore/css/pool_list.css), which this page already loads — no new CSS. Server visits get a colored badge; local drafts (no `poolStatus` yet) skip the badge cleanly.

### My Visits — local edit of a server visit shows `server` + `edited`

- **The ask.** When a server visit gets an in-progress local edit, the row had been showing as a plain `draft` — losing the visual signal that it's actually an existing server visit being modified, not a brand-new one. Want both labels: the origin (server) AND the state (edited).
- **The change.** [explore/visit_list.html](ui_vp/uiVPAtlas/explore/visit_list.html) renderer now emits a `statusHtml` snippet per row (instead of a single class/label). For a local row with `server_visit_id` set, the snippet is two pills side-by-side: green `server` (origin) + amber `edited` (state), regardless of whether the underlying local `v.status` is `draft` or `complete`. Fresh new-visit drafts still get a single `draft` pill; new-visit completes still get a single `complete` pill; server-only rows still get a single `server` pill. The action buttons follow the same logic as before (Edit/Upload/Delete for draft, Upload/Delete for complete) — the underlying `v.status` drives the actions, just not the label. Delete tooltips on edit-of-server rows read "Discard edits" so users don't think they're deleting the server visit (they're discarding the local edit; the server row reappears in the list).

### My Visits — drop the unreliable `edited` pill

- **Why.** The timestamp-gap detection (`visitUpdatedAt > visitCreatedAt + 5 s`) lit up for every legacy visit because migrations 011–013 ran UPDATEs that bumped `vpvisit.updatedAt` server-side — making the gap months, not seconds, for every pre-migration row. The signal couldn't distinguish a user edit from a backend backfill.
- **The fix.** Removed the `editedHtml` block + the timestamp comparison from the row template. The `.vq-status-edited` CSS class is left in place ([survey/css/visit_queue.css](ui_vp/uiVPAtlas/survey/css/visit_queue.css)) for future reuse if/when a clean "user-edited" backend signal exists. With the Edit-Save-Draft fix below, the user sees their in-progress edit as a `draft` row that replaces the server row — no separate "edited" indicator needed for the common case.

---

### Atlas Visit — mapped pool circle visible even without visit GPS

- **The gap.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) in edit mode (`?visitId=…`) only plotted a triangle when `v.visitLatitude` was set. Old visits without recorded GPS landed on a blank Vermont overview with no anchor — the user couldn't see where the pool sits while picking a visit location.
- **The fix — always show the mapped circle, plus matching status color.** The `isEdit` branch now plots the mapped pool as a CIRCLE (`surveyLevel: 'potential'`, size 22) regardless of whether the visit has its own GPS, using the same affordance as the new-visit flow: tapping the circle snaps the editable visit location onto the pool's mapped point. The mapped status (Confirmed/Probable/Potential/etc.) drives the color, with a role-bearing tooltip ("Mapped pool location — {poolId}, {town} ({status})"). `poolLocation` is set so the existing "Zoom to pool" button works. `populateVisitForm()` now takes an optional `m` so the visit triangle picks up the same status color (previously hardcoded to Potential goldenrod) and a clearer "Visit {N} — recorded location" tooltip. When both coords exist and differ, `fitBounds()` zooms to show both with 40 px padding. GPS auto-init kicks in for the edit flow too, so the user can also see their own current location relative to the pool.

### Atlas Visit — split zoom and set-location actions, simpler prompt

- **Prompt.** The map-tab instruction line in [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) was a wordy "Tap the map to set pool location, or click the 'Use GPS' button." — relic from the new-pool flow where the same screen sets the *pool* location. Replaced with the simple, role-accurate "Set Visit Location (tap map)" for both the initial state and the post-GPS-fix state. The `setVisitLocation` success message ("Visit location set…") still overrides this when a location is committed.
- **Buttons.** The crosshair-and-person button (`btn_use_gps`) used to commit the visit location to the current GPS fix — same job as tapping the map at "where I'm standing", but easy to fire accidentally. It now matches the convention used on the home page and Pool Finder: a tap simply recenters the map on the user's GPS position with no side effect on the visit pin (title updated to "Zoom to my location").
- **New marker-and-person button (`btn_set_gps_loc`).** Sits to the right of the zoom-to-me button (`left: 182px`). Tapping it drops the editable visit marker on the user's GPS fix — the commit action, now explicit. Hidden until GPS gets its first fix (alongside the zoom-to-me button); both surface together. The two-intent split keeps "look at me on the map" and "use my position as the visit location" from being the same tap.

### Atlas Visit — green halo on the pool being visited

- **The visual.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) now imports `createPoolHaloMarker` from [map_common.js](ui_vp/uiVPAtlas/js/map_common.js) and drops a pulsing green halo behind the mapped pool circle in all three plot paths: new visit via `?poolId=`, draft resume, and edit-visit. Same halo style used elsewhere in the app (`pool-halo-marker` CSS, animates via `pool-halo-pulse`). Visual answer to "which pool am I visiting on this map?".

### Atlas Visit — upload requires the right data

- **The gap.** The upload button only enforced Pool ID (existing-pool case), Date, and location-for-new-pool. Visits could be uploaded with no observer, no location for existing pools, no vernal-pool answer, or a "Yes — this is a vernal pool" with zero indicator-species evidence. Reviewers were getting unverifiable Yeses.
- **The gate.** A single pre-confirm validation block now collects all errors together (better than fix-one-at-a-time):
  - `visitPoolId` (existing-pool case)
  - `visitObserverUserName`
  - `visitDate`
  - `visitLatitude` + `visitLongitude` — now required for every visit, not just new-pool. Hint matches the map-tab affordances: "tap the map, use GPS, or tap the pool marker".
  - `visitVernalPool` — must be answered (Yes / No / Don't Know).
  - If `visitVernalPool === 'Yes'`: at least one of the 13 obligate-indicator-species count fields (Wood Frog / Spotted / Jefferson / Blue-spotted salamander adults·eggs·larvae, or Fairy Shrimp) must read > 0. Mirrors the same indicator-set used by the home page's indicator-species filter.
- **Failure surface.** Errors render as a single `' • '`-joined string through `showMsg(…, 'error')` so the user sees the whole list in one shot. Save Draft remains unrestricted — required fields only gate the *upload*, not local persistence.

### Atlas Visit — validation errors auto-clear on next interaction

- **The friction.** The upload-required-data error message stuck around until the next *failed* upload, even after the user had corrected the offending field. Worse, the message scrolled out of view while they hunted for the field to fix.
- **The fix.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) `showMsg` is unchanged; a new capture-phase listener on `document` for `input` / `change` / `click` clears the message bar as soon as it's in `error` state and the user does *anything* — tap the map, change a radio, type a field. The `btn_save_upload` click that re-triggers validation also fires this listener, but the validation re-runs immediately inside that handler and re-renders any remaining errors, so re-validation is idempotent. Success / info messages still auto-clear after 3 s as before.

### Atlas Visit — local data now overrides server, save-draft persists

- **The bug.** Editing a server visit, then clicking Save Draft, was a silent no-op. `saveLocal()` returns early when `currentVisitState` is null, and the `isEdit` branch never initialized it — the original `createVisitState` call was guarded by `!isEdit`. So edits never persisted locally, and the visit list kept showing the unchanged server row.
- **The fix.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) `isEdit` branch now seeds `currentVisitState` from the server visit and stamps `server_visit_id: visitId` on it. Save Draft / autosave / Save & Upload all work the same as a normal new-visit flow from here on.
- **Local-overrides-server in the list.** [explore/visit_list.html](ui_vp/uiVPAtlas/explore/visit_list.html) already dedups by `server_visit_id` (`localServerIds.has(v.visitId)` skip) — so once the local draft exists with `server_visit_id` set, the corresponding server row drops out of the merged list and the user sees their in-progress edit instead. No new dedup logic needed.
- **Resume on second open.** If the user clicks Edit again on the same server visit before uploading (URL = `?visitId=X`), the new code calls `loadAllVisits()` and looks for a local row with `server_visit_id === X`. If found, the form populates from the local draft's `formData` (their last edits), not the now-stale server snapshot. If not, it seeds fresh from the server. Either way `currentVisitState` ends up non-null.
- **Post-upload behavior.** After Save & Upload, the local row flips to `status: 'uploaded'` (`photos_uploaded: true` when all photos succeeded). The visit-list filter hides those rows; the server row reappears with the updated data. End-state matches what the user expects.

### Atlas Visit — open frames on visit location, not bounds or pool

- **The ask.** On opening visit_create, when a visit location exists (edit of a server visit, or a resumed draft with a saved `visitLatitude/Longitude`), the map should land directly on the visit point — not a bounds-fit of (mapped, visit) and not the mapped-pool point. Tap-to-set then refines from that point instead of from somewhere the user has to scroll back to.
- **Two fixes in [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html).**
  - **Edit branch:** removed the trailing `fitBounds([visit, mapped])` block. `populateVisitForm()` already calls `map.setView([vLat, vLng], 16)` when the visit has its own GPS, and runs after the mapped-circle's `setView` — so its centering is the last word. When the visit has no GPS yet, the mapped-circle's earlier setView remains as the framing. (Bounds-fit of both points is still the right call on visit_view, the read-only detail page; it isn't the right call here where every tap refines the visit point.)
  - **Resume-draft branch:** the unconditional `map.setView([mapped], 16)` was clobbering populateVisitForm's visit-centered view. Now it only fires when the draft has no `visitLatitude/Longitude` — guard via `Number.isFinite(parseFloat(currentVisitState.visitLatitude ?? formData.visitLatitude))`. Drafts with a saved location stay at that location on open.
  - **No GPS auto-center anywhere in these flows.** `initGps()` continues to fire without `centerOnFix`, so the user's actual position is just rendered as the blue dot and never moves the map.

### Atlas Visit — one setView per open, no race

- **The follow-up.** Even after the bounds-fit removal, the edit branch was still firing two setViews per open: `setView(mapped, 16)` immediately when the mapped circle plotted, then a few milliseconds later (after `await loadAllVisits`) `populateVisitForm` fired `setView(visit, 16)`. The user briefly saw the map snap to mapped, then to visit — a visible flash that could read as a second "GPS-style" zoom.
- **The fix.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) edit branch no longer setViews on the mapped circle. The mapped marker (halo, addPoolMarker) is still added at the right location — only the centering is deferred. After `populateVisitForm` runs, a single fallback `setView([mLat, mLng], 16)` fires only when neither `currentVisitState.visitLatitude` nor `v.visitLatitude` resolves to a finite number. Net result: exactly one setView per open, on the visit when present, on the mapped when not. No flash sequence.

### Atlas Visit — GPS is now strictly on-demand

- **The user-visible bug.** On opening the edit/draft flow, the map zoomed to the visit location, then jumped again to the user's GPS location even though I'd guarded `initGps()` with `centerOnFix=false`. I couldn't pin the second zoom source from a code read; the simpler answer is to never auto-fetch GPS at all on this page, which removes any class of regression here.
- **The fix.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) no longer auto-invokes geolocation. All five call sites (edit, resume-draft, new-with-poolId, new-blank-pool, new-from-dropped-pin) had their `initGps(...)` calls deleted. The `initGps` function itself was renamed and rewritten as `ensureGps()` — an on-demand Promise-returning fetch that's called only by the two GPS buttons (zoom-to-me, set-visit-location-from-GPS). First click of either button: permission prompt fires, user-location marker drops, accuracy ring drops, position cached. Subsequent clicks reuse the cached fix without re-prompting.
- **Buttons visible by default.** Used to be `display: none` until the auto-`initGps()` got a fix. Now both buttons show from page load (`display: flex`); they're just inert until tapped. Failure path: if permission is denied or geolocation times out, the click shows a `GPS unavailable — check location permission` toast and no marker drops.
- **End state.** Open the visit_create page → exactly one setView per the framing rule (visit if visit lat/lng, mapped otherwise). No GPS prompt. No second zoom. Map stays put until the user explicitly asks for GPS via a button.

### Atlas Visit — visit-marker tooltip no longer reads "Visit undefined"

- **The bug.** `populateVisitForm` builds the visit-triangle's tooltip as `Visit ${v.visitId} — recorded location`. In edit mode when the local draft existed, the function was called with `existing.formData` as `v` — and `formData` is built by `getVisitFormData()` which doesn't include `visitId` (it only collects form-input ids like `visitPoolId`, `visitDate`, etc.). The tooltip read "Visit undefined — recorded location". Same happens in the resume-draft flow.
- **The fix.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) `populateVisitForm` now resolves the visit id from the first source that has it: `v.visitId` → `v.server_visit_id` → `currentVisitState.server_visit_id` → `currentVisitState.visit_uuid` → the URL `visitId` param. Falls back to "Visit — recorded location" (no number) if no id resolves, which only happens for the new-visit flow that hasn't uploaded yet — and that flow never sets `visitLatitude` until the user taps, so the marker isn't plotted at open anyway.

### Atlas Visit — drop forced bold on header title

- **`.visit-header h3`** in [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) had `font-weight: 700` baked in, forcing the "Atlas Visit" header title to a heavier weight than the rest of the app's headings. After the Lora switch, the disparity stood out.
- **Removed only the `font-weight` line.** The rest of the rule (flex sizing, truncation, font-size, `margin: 0`) is still doing real work — without `margin: 0` Lora's natural h3 margins would push the header bar's height out. Title now renders in Lora regular like every other heading.

---

### Pool Finder — `+ Atlas Visit` button bumped to thumb-sized

- **The ask.** The `+ Atlas Visit` per-pool action in the Pool Finder nav list was the same 14-px / weight-600 size as `+ Monitor Survey` and the other secondary actions, but it's the single most-tapped control on the page when a volunteer is at a pool. Easy to miss under wet-glove conditions.
- **The change.** New `.pf-visit-btn` class on the visit anchor only (Monitor Survey untouched) bumps it to `font-size: 21px` (~50% larger), `padding: 9px 24px`, `font-weight: 700`. CSS rule sits next to the existing `.pf-nav-actions a.near` rule in [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html); the JS template that emits the anchor now writes `class="pf-visit-btn${nearClass}"` so the `near` highlight still composes on top.

### Pool Finder — drop dead `.pf-header h3` rule

- **The rule.** [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html) had `.pf-header h3 { font-size: 15px; margin: 0; white-space: nowrap; }`. After the typography refactor brought Lora in with its own heading margins, the `margin: 0` half of that rule started visibly squeezing the "Pool / Finder" two-line title in the header.
- **The fix.** Deleted the rule entirely. The `<h3>` already carries an inline `style="margin-right:6px; white-space:normal; line-height:1.1; font-size:16px; max-width:6em;"` that overrode every property the rule set except for the top/left/bottom edges of `margin: 0`. So the only thing the rule was actually contributing was a vertical squeeze — and now that's gone, the title sits where its natural metrics put it.

---

### App-wide — single source of truth for fonts and colors

- **The drift.** Globals (color palette + body font) lived in [explore/css/common.css](ui_vp/uiVPAtlas/explore/css/common.css), with every survey/admin/docs page pulling it via an awkward `/explore/css/common.css` absolute path. On top of that [survey/css/survey.css](ui_vp/uiVPAtlas/survey/css/survey.css) redeclared the entire palette as a 1:1 duplicate (drift risk) and [survey/css/visit_queue.css](ui_vp/uiVPAtlas/survey/css/visit_queue.css) embedded the hex codes as `var(--c, #hex)` defensive fallbacks (more drift risk).
- **The fix.** New top-level [css/common.css](ui_vp/uiVPAtlas/css/common.css) is now the single source of truth. It declares `@font-face` for two self-hosted variable fonts, the full `:root` palette, named typography variables (`--font-title`, `--font-body`), and base font-family rules on `html, body` and `h1–h6`. The `:root` block + body font-family rules were removed from `explore/css/common.css` and `survey/css/survey.css`; both files retain their non-global rules (Leaflet divIcon hack, layout fixes, survey-specific header styles). The `var(--c, #hex)` fallbacks in `visit_queue.css` are left alone — harmless now that `:root` is guaranteed to be defined for every page.

### App-wide — typography refresh

- **New typography roles.** [css/common.css](ui_vp/uiVPAtlas/css/common.css) defines `--font-title: 'Lora', serif` and `--font-body: 'Noto Sans', sans-serif`. Headings (h1–h6) render in Lora; body text in Noto Sans. The previous app-wide Georgia is gone.
- **Self-hosted variable fonts.** Both fonts are SIL Open Font License, downloaded from Google Fonts' static CDN once and committed: [webfonts/lora-latin.woff2](ui_vp/uiVPAtlas/webfonts/lora-latin.woff2) (~37 KB) and [webfonts/noto-sans-latin.woff2](ui_vp/uiVPAtlas/webfonts/noto-sans-latin.woff2) (~36 KB). Each is a variable-font woff2 with the wght axis, so one file covers both regular (400) and bold (700) via a single `font-weight: 400 700` `@font-face` declaration. Latin subset only — Vermont volunteers don't need Cyrillic/Devanagari. Both precached in [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) so the field-offline experience renders correctly.
- **Calluna was the original ask.** It isn't on Google Fonts and Font Squirrel's CDN blocks automated downloads (Cloudflare 403). User chose Lora as the substitute — closest free-licensed stylistic match (same humanist warmth, similar transitional contrast). Easy to swap to a different serif later by replacing the woff2 file and updating one `@font-face` block.

### App-wide — every page loads `/css/common.css` first

- **25 HTML pages updated.** Each public-facing page across [explore/](ui_vp/uiVPAtlas/explore/) (13), [survey/](ui_vp/uiVPAtlas/survey/) (4), [admin/](ui_vp/uiVPAtlas/admin/) (7), and [docs/](ui_vp/uiVPAtlas/docs/) (1) now loads `<link rel="stylesheet" href="/css/common.css">` after the library sheets (bootstrap / font-awesome / leaflet) and before any route-local sheet. Variables are defined before any downstream rule consumes them.
- **`survey/survey_main.html`** is the special case that had been pulling `css/survey.css` only — relying on the now-removed duplicate palette. Adding `/css/common.css` covers it.
- **Path inconsistency unchanged.** Explore pages still keep their pre-existing `./css/common.css` (resolves to `/explore/css/common.css`); survey/admin keep `/explore/css/common.css`. Both pull the same residual file. The new `/css/common.css` runs first either way.

### Home page — VPAtlas title is now an actual heading

- **Was a span.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) had the "VPAtlas" header logo text as `<span class="header-app-name">`, leaving it on the body font (now Noto Sans) instead of picking up the new title serif. Every other page in the app already uses `<h3 class="header-name">` for its title.
- **Promoted to `<h3>`** for consistency with the rest of the header pattern. The existing `.header-app-name` class already declares `margin: 0` and `line-height: 1`, so browser default heading margins don't break the flex header layout. The global `h1–h6 { font-family: var(--font-title) }` rule in [css/common.css](ui_vp/uiVPAtlas/css/common.css) now gives the title Lora serif automatically.

### App-wide — disable page pinch-zoom

- **Why.** Pinch-zooming the page on a phone shifts the layout horizontally/vertically and toolbar buttons can scroll off-screen with no obvious way back. The PWA's UI is already mobile-tuned at native scale; user-zoom of the page provides no benefit and routinely breaks the layout for volunteers in the field.
- **Change.** All HTML pages under [ui_vp/uiVPAtlas/](ui_vp/uiVPAtlas/) now use `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`. Four pages already had this (`survey/find_pool.html`, `survey/visit_create.html`, `survey/survey_create.html`, `admin/review_create.html`); the remaining 23 were brought into alignment with one `sed` pass.
- **Map zoom unaffected.** Leaflet handles its own pinch-zoom on the map's touch events independently of the page-level viewport meta, so the in-map gesture still works as expected. The viewport restriction only blocks the *browser's* pinch from rescaling the page chrome.

---

### Auth — login no longer poisons back-button history

- **The bug.** Tap a link to a data-entry form (e.g. *+ New Pool*, *Edit Visit*) while signed out → `requireAuth()` redirected to `/explore/login.html?returnUrl=…` via `location.href`, which pushed login onto history. After signing in, `login.html` then navigated to the form via `location.href` too, pushing the form on top. So the back stack looked like: *home → login → form*. Tapping back from the form landed on login, then back again to home — two taps to escape, and worse, briefly re-rendering a signed-in login page.
- **The fix.** Two `location.href` → `location.replace()` swaps. [js/auth.js](ui_vp/uiVPAtlas/js/auth.js) `requireAuth()` now replaces the would-be-form entry with the login URL (so the form attempt isn't stuck in history under a redirect). [explore/login.html](ui_vp/uiVPAtlas/explore/login.html) post-submit replaces login with the destination, not pushes on top. Net history after the round-trip: *home → form*. Back from the form goes straight home, login is invisible in the back stack.

### Sign in — block attempts when offline, clearer error message

- **The misleading message.** Submitting the login form offline used to fall through the SW's 503 translation into the generic catch block, which surfaced "Login failed. Check your credentials." — making users think their password was wrong when actually their phone had no signal.
- **The fix.** [explore/login.html](ui_vp/uiVPAtlas/explore/login.html) — the page now reads `navigator.onLine` at load time and on `online`/`offline` events, disables the Sign In button while offline, and shows "You're offline. Sign in needs a network connection — try again once you reconnect." in place of the form's status line. The submit handler also short-circuits on offline before calling the API. The catch block now distinguishes a network failure (SW 503, "Failed to fetch", `navigator.onLine === false`) from a real auth error and renders "Couldn't reach the server. Check your connection and try again." for the network case. Real credential errors keep the existing message.

---

### Changelog — works offline now

- **The gap.** The hamburger Changelog link sends users to `/docs/`, which routes through the SW's navigation handler. `/docs/index.html` and the `CHANGELOG-*.md` files weren't precached, so a user clicking Changelog offline got a 503 from the SW (the file wasn't in any cache).
- **The fix.** [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) — new `// === Documentation / changelog ===` block adds `/docs/`, `/docs/index.html`, and every existing daily changelog. The docs page's runtime fetches now hit the precache instead of the network when offline.

### Documentation — single canonical changelog location + workflow rule

- **Repo-root duplicates removed.** Daily `CHANGELOG-2026-05-*.md` files were being maintained in two places: the repo root and [ui_vp/uiVPAtlas/docs/](ui_vp/uiVPAtlas/docs/). Only the latter is served by the app (`/docs/` resolves there via `app.use('/', express.static('uiVPAtlas'))` in `ui_vp/server.js`). The root copies were byte-identical duplicates with no consumer; deleted.
- **05-06 partial finalized, 05-09 indexed, daily partials adopted.** The 2026-05-06 changelog is now the full v3.5.181 – v3.5.197 version (was a partial covering only v3.5.181 – v3.5.190); 2026-05-09 (v3.5.198 – v3.5.231) added to the in-app changelog index. [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) `DOCS` array updated.
- **New workflow rule in [CLAUDE.md](CLAUDE.md).** "Changelog — REQUIRED workflow" section: every user-visible change must ship with an entry in today's `CHANGELOG-YYYY-MM-DD(-partial).md` under `ui_vp/uiVPAtlas/docs/` in the same change. If today's file doesn't exist, create it with the `-partial` naming and add to the `DOCS` array. The repo's commit messages are uniformly `deploy vunknown`, so the changelog is the only place the *why* lives — losing entries to "I'll batch them later" is now structurally discouraged.
- **05-10 → 05-13 rolled into this snapshot.** Four daily `-partial` files (05-10, 05-11, 05-12, 05-13) consolidated into this single non-partial CHANGELOG-2026-05-13. The partials and their `DOCS` / `urlsToCache.js` entries were removed; one new index entry points here.

---

### Auth — register/reset errors now reach the user instead of "failed"

- **The gap.** When `/users/register` or `/users/reset` returned a 400 (unknown email, duplicate username, SMTP auth failure, not-null constraint, etc.), [api_vp/_helpers/error-handler.js](api_vp/_helpers/error-handler.js) called `res.json(err)` on a `new Error('…')` object. Error's `name`/`message` are non-enumerable, so the body serialized to `{}` and the UI's `err.message` fallback rendered the generic "Registration failed." / "Reset request failed." line — leaving users with no clue whether the issue was their input, an account collision, or the server's mail credentials.
- **The fix.** The 400 branch now builds an explicit payload `{ ...err, name: err.name, message: err.message }`. The spread keeps the enumerable own props that Postgres (`code`, `severity`, `detail`, `hint`, `constraint`) and Nodemailer (`code: 'EAUTH'`, `command`) attach to their errors; the explicit name/message lines pull the Error-prototype fields that JSON.stringify would otherwise drop. The register/reset/login pages all already display `err.message` from the rejected promise, so no UI change needed — the real reason now flows straight through. Spot-checked locally: unknown reset email returns `{"name":"Error","message":"email X NOT found."}` instead of `{}`.
- **Field surface.** On the running app, reset against an unrecognized email now reads "email X NOT found." Registration against a taken username now reads "username 'X' is already taken." A server with a bad/empty `EMAIL_PASSWORD` env var (the case that triggered this fix on dev.vpatlas.org) now surfaces the EAUTH code plus Nodemailer's human-readable reason instead of disappearing into a generic failure.

### Service worker / build

- **32 patch versions across the snapshot** — `manifest.json` 3.5.231 → 3.5.263 via successive `node sw-build.js` runs. One bump per deploy across the four days. Spans the GPS-tracking refresh, the typography refactor, the cache-key bump that unblocked the Review filter, the API SELECT addition for the debug timestamp strip, and everything between.
- **`urlsToCache.js` grew** by the docs entries (the `/docs/` index plus the daily `.md` files), the two new self-hosted woff2 fonts, and `/css/common.css`. Precache validator still passes; the docs index has no static `<script>`/`<link>` deps the validator would walk.
- **API rebuilds required for two deploys.** The Review-filter debug-strip change in [api_vp/vpPools/vpPools.service.js](api_vp/vpPools/vpPools.service.js) takes effect only after `docker compose up -d --build api_vp`. UI rebuild alone wouldn't pick it up. Same pattern for any future SELECT-list change.
- **API-only rebuild** for the error-handler fix in [api_vp/_helpers/error-handler.js](api_vp/_helpers/error-handler.js). No `manifest.json` bump and no `urlsToCache.js` change — server-side error serialization only. Pushed via `docker compose -f docker-compose-vpatlas.yml up -d --build api_vp` on each deploy target.
