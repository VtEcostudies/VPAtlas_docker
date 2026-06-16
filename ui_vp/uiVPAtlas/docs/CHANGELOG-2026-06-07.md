# Changelog — Snapshot 2026-06-07

## v3.5.363

### Reviews — Reassign Visit button is now visible without clicking a suggestion

- **The bug.** First-pass implementation of the Reassign Visit feature only revealed the **Reassign Visit** action button after the admin clicked a dropdown suggestion. If you typed the target pool ID directly (e.g. `MLS255`) without clicking the suggestion, nothing happened — no button, no way to apply the change. User report: *"After entering a reassign-to poolID, there was no action button or other way to apply that change."*
- **The fix.** [admin/review_create.html](ui_vp/uiVPAtlas/admin/review_create.html) `wireReassign()` now reveals the fate radios and the Reassign button as soon as the input has ≥ 2 characters, regardless of whether a suggestion was clicked. The button validates that the typed pool ID exists on click (the API already returns 404 if the target doesn't exist; the validation surfaces naturally through the existing error path). The suggestion dropdown is still helpful — clicking a suggestion now just fills the input and re-renders the same button — but it's no longer a *gate*.
- **No backend change.** The transaction logic, the admin guard, and the trigger-safety analysis are all unchanged. Verified end-to-end on review 1713 / visit 1764 / NEW397 → MLS1716 earlier; that path still works identically.

## v3.5.361 – v3.5.362

### Reviews — Reassign Visit (admin): one-click move of a misassigned visit + review to a different pool

- **The problem.** When a volunteer in the field doesn't realize an existing mapped pool sits where they're standing, they create a placeholder `NEW####` pool and attach their visit to it. The admin later sees two pools stacked on the map — the real one (e.g. `MLS255`) and the volunteer's duplicate (e.g. `NEW1531`) — with the visit on the wrong one. Cleaning this up by hand took several pages of editing.
- **The feature.** A new **Reassign Visit (admin)** section at the bottom of [admin/review_create.html](ui_vp/uiVPAtlas/admin/review_create.html) (visible only in edit mode and to admin users). Type a target pool ID in the search box — type-ahead drops matching pools — pick one, see a preview of *"Will move visit X from oldPool → newPool"*, choose what happens to the orphan pool (default **Duplicate**, alternative **Delete**), confirm, done. The form reloads on the new state.
- **What the single click actually does** — one PG transaction, three coordinated writes:
  1. `vpvisit.visitPoolId` → newPool (the visit belongs on the right pool)
  2. `vpreview.reviewPoolId` → newPool (the review follows the visit so it doesn't dangle on the orphan)
  3. Either `vpmapped[oldPool].mappedPoolStatus = 'Duplicate'` (default) OR `DELETE FROM vpmapped WHERE mappedPoolId = oldPool` (opt-in).
- **Delete guard — hard refuse.** If `fate=delete` is selected but the old pool still has other visits, reviews, or surveys, the API returns HTTP 409 with the exact counts (`"Cannot delete NEW397: still referenced by 2 other visit(s), 1 other review(s), 0 survey(s). Use 'Duplicate' instead."`). Protects against accidental cleanup of pools that turn out to be real.
- **Trigger safety.** The existing `trigger_set_mapped_pool_location_after_update_vpvisit` fires on every visit update but is gated by `IF (method = 'Visit' AND count = 1)` — so reassigning a visit to a real existing pool (`method=Aerial/Survey/Other` or with > 1 visits) is a no-op for that trigger. Verified locally on review 1713 / visit 1764: MLS1716's `mappedLatitude` was `43.08762983` before and after the move. The target pool's coordinates are never corrupted.

### API — POST /review/:id/reassign

- New route in [api_vp/vpReview/vpReview.routes.js](api_vp/vpReview/vpReview.routes.js). **Admin-only** (returns 403 for non-admin JWT). Body: `{ newPoolId: string, fate: 'duplicate' | 'delete' | 'leave' }` — `fate` defaults to `duplicate` if omitted; `'leave'` is API-only (the UI surfaces only Duplicate and Delete).
- New service function `reassign(reviewId, body)` in [api_vp/vpReview/vpReview.service.js](api_vp/vpReview/vpReview.service.js). Validates (review exists, new pool exists, not same as current), pre-checks the delete-guard, then runs `db.pgpDb.tx()` for the three writes. Returns `{ reviewId, visitId, oldPoolId, newPoolId, fate }`.
- New client wrapper `reassignReview(id, body)` in [js/api.js](ui_vp/uiVPAtlas/js/api.js).

### Service worker / build

- `manifest.json` 3.5.360 → 3.5.362 via `node sw-build.js patch` (two bumps: 3.5.361 for the feature code, 3.5.362 after adding today's changelog file to [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) so it precaches). **API + UI** rebuild. Subsumed into the 3.5.363+ prod ship below.
