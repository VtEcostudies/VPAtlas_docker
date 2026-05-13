# Changelog — Snapshot 2026-05-13 (partial)

## v3.5.263

Partial day's work; additional changes may land later under a follow-up
2026-05-13 changelog.

### Explore — debug strip on the pool list to diagnose the Review filter

- **The problem.** The Review filter (admin) is currently showing pools that don't need review, and hiding some that do. The filter rule is `visitUpdatedAt > coalesce(reviewUpdatedAt, 1900-01-01)`, but `updatedAt` on either table can be bumped by data migrations independently of when a user actually edited the visit or reviewed it — so the inequality is comparing two migration-tainted timestamps. The true "when the review made its decision" signal is `reviewQADate`, not `reviewUpdatedAt`.
- **The instrumentation.** Each row in the home page pool list now renders a small grey timestamp strip:
  `v:YYYY-MM-DD · q:YYYY-MM-DD · r:YYYY-MM-DD`
  where `v` is `max(vpvisit.updatedAt)` across the pool's visits, `q` is `max(vpreview.reviewQADate)`, and `r` is `max(vpreview.updatedAt)`. Hover tooltip spells out which field is which.
  - **Backend:** [api_vp/vpPools/vpPools.service.js](api_vp/vpPools/vpPools.service.js) — added `"reviewQADate"` to the explicit SELECT lists in `getMappedJoinAll` and the visit-side query (the third query already uses `vpreview.*` so reviewQADate was already present there).
  - **Dedup:** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) `deduplicateByPoolId` now also accumulates `_maxReviewQADate` per pool, alongside the existing `_maxVisitUpdatedAt` / `_maxReviewUpdatedAt`.
  - **Render:** the row template appends the debug strip after the existing counts.
- **What I'm hoping to learn.** Once the strip is live, spot-check a pool that wrongly appears in Review: if `q` is *after* `v`, the QA date already says "review is newer than the visit edit" and the filter should switch to `visitUpdatedAt > coalesce(reviewQADate, 1900-01-01)`. If `q` is *before* `v` but the review was clearly made after the user's last meaningful edit, then we need a different signal entirely (e.g. user-edit-only timestamp column).

### Service worker / build

- **One patch version** — `manifest.json` 3.5.262 → 3.5.263 via `node sw-build.js`.
- **API rebuild required** — the SELECT change in vpPools.service.js takes effect only after `docker compose up -d --build api_vp`. UI rebuild alone won't pick it up.
- **`urlsToCache.js`** picked up the new `/docs/CHANGELOG-2026-05-13-partial.md` entry (per the changelog workflow rule).
