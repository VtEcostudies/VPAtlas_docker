# Changelog — Snapshot 2026-05-19 (partial)

## v3.5.272 – v3.5.281

Partial day's work; additional changes may land later under a follow-up
2026-05-19 changelog.

### Pool list — new "Updated" sort, freshest activity first

- **The ask.** Need to sort visited (or any-scope) pools by recency of activity — mapped edits, visit edits, review edits, whichever is freshest.
- **The data.** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) `deduplicateByPoolId` now stamps `_lastUpdatedAt = max(mappedUpdatedAt, _maxVisitUpdatedAt, _maxReviewUpdatedAt)` on every pool. All three are TIMESTAMPs maintained by `trigger_updated_at` server-side, so they capture every meaningful edit on the pool. Lexical ISO compare is correct chronological order, no Date() construction needed.
- **The UI.** New `Updated` option appended to the sort dropdown. `sortRowsBy` now special-cases date-shaped columns (`/UpdatedAt$|CreatedAt$|QADate$|Date$/`): null/empty rows always sink to the bottom regardless of direction (otherwise "Updated descending" floats every pool with no activity to the top — the opposite of useful), and ISO strings compare lexically. The change handler flips the direction toggle to descending when the user picks a date column, since newest-first is the natural expectation; other columns keep their ascending default.
- **Cache shape versioning — the missing piece.** Initially the "Updated" sort did nothing because rows already in the IndexedDB pool cache were deduped by an older build and didn't carry `_lastUpdatedAt`. Per the locked decision, bumping `POOL_CACHE_KEY` is out (forces a 98 MB refetch on every active user). Instead the cache blob now carries a `shapeVersion` field, mirroring the existing stats-fingerprint freshness check but keyed on CODE-shape changes instead of DATA-content changes: bumped to `2` for this build (added `_lastUpdatedAt`). `loadPools` reads the cache, sees the shape mismatch, and — when online — silently refetches in place. Offline → serves the cached rows as-is; the new sort returns empty for "Updated" until the next online load, consistent with the OFFLINE contract (no error). Going forward, any new synthetic field in `deduplicateByPoolId` only needs a shape-version bump to roll out cleanly — no key bump, no special-casing in consumers.

### Reviews ↔ visits — surface the QA date, clearer strip labels

- **Right pane — show the review QA date, not just the id.** [explore/js/pool_summary.js](ui_vp/uiVPAtlas/explore/js/pool_summary.js): the `reviewByVisit` map now carries `{ reviewId, qaDate }`; a reviewed visit's tag reads `📋 qa:<date> #<reviewId>` (the QA date is the at-a-glance signal; id kept for cross-reference). Still gated on `isOnline()` + try/catch — offline degrades to no tag, never an error.
- **Left pane — clearer strip labels.** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js): the per-row debug strip relabelled `e:` → `ed:` (newest visit last-edited date) and `q:` → `qa:` (newest review QA date); `nr:` (visits with no review) unchanged. Tooltip updated to spell each out.

### Reviews ↔ visits — show which visit each review evaluated

- **The ask.** No way to tell at a glance which visits have been reviewed: pool_view listed reviews but not the visit each one evaluated, and the home-page right-pane visit list gave no review signal at all.
- **pool_view reviews list.** [explore/pool_view.html](ui_vp/uiVPAtlas/explore/pool_view.html) `renderReviews` now appends `→ visit #<id>` next to the review id, sourced from `reviewVisitId` (modern FK) with `reviewVisitIdLegacy` as the pre-migration fallback. Hidden when neither is set.
- **Home page right-pane visit list.** [explore/js/pool_summary.js](ui_vp/uiVPAtlas/explore/js/pool_summary.js) — `fetchVisitsByPool` carries no review info, so the summary now also fetches `review?reviewPoolId=<id>` and builds a `visitId → reviewId` map; reviewed visits get a `📋 #<reviewId>` tag. **Offline-safe:** reviews have no offline cache, so this is treated as an optional enhancement — gated on `isOnline()` and wrapped in try/catch that silently degrades to no-tags (never an error), per the OFFLINE contract.

### My Visits and Tracks — server visits visible offline (snapshot cache)

- **The gap.** After the offline-contract fix, the server-visit fetch was correctly skipped offline (no error) — but that meant a field user with no local drafts saw an empty My Visits list offline. Their uploaded/server visits were invisible until back on a network.
- **The fix — same snapshot paradigm as pool_cache / track syncFromServer.** [explore/visit_list.html](ui_vp/uiVPAtlas/explore/visit_list.html): whenever the page loads online and the server fetch succeeds, the raw rows are written to IndexedDB under the new `MY_VISITS_CACHE_KEY` ([js/cache_keys.js](ui_vp/uiVPAtlas/js/cache_keys.js)) as `{ userId, ts, rows }`. Offline (or on a failed/flaky online fetch), the list restores from that snapshot instead of fetching.
- **One mapper, no drift.** The dedup-against-local + row-shape mapping was extracted into a single `buildServerVisits(rawRows)` used by both the live-fetch path and the snapshot-restore path, so the offline list is identical to the online one (minus freshness). Raw rows are snapshotted (not mapped rows) so the mapper/dedup runs the same way on restore.
- **Per-user, self-guarding.** The snapshot stores `userId` and the restore path only uses it when `snap.userId === currentUser.id`. The key is deliberately *not* in `KEEP_ON_USER_CHANGE`, so a different user signing in wipes it; the userId check is a second line of defense. The diagnostic line shows the snapshot timestamp ("offline — cached snapshot from …") so the user knows how stale it is.
- **Scope.** Visibility only. Offline deletions still fail (acknowledged — server-gated). Editing a server visit is the existing visit_view→Edit flow, which stages a local draft before upload; unchanged here.

### Home page — taller bottom tab bar, clear of the OS gesture strip

- **The problem.** On mobile the Explore bottom tab bar (List / Map / Info) sat flush at `bottom: 0`. The OS reserves the bottom screen strip for the home-indicator / swipe-up gesture (~34 px on modern iPhones), so the tab buttons' tap area overlapped the reserved zone and there wasn't enough operable height above it.
- **The fix.**
  - [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) viewport meta gains `viewport-fit=cover` — required for `env(safe-area-inset-*)` to resolve to real device values instead of 0.
  - [explore/css/common.css](ui_vp/uiVPAtlas/explore/css/common.css): new `--tabbar-h = calc(60px + env(safe-area-inset-bottom))` declared once in the mobile media query and reused by the body bottom-padding and both pane-height `calc()`s, so the reserved space stays in lockstep with the bar (replaces the three hard-coded `52px`).
  - `.explore-tabs` gets `padding-bottom: env(safe-area-inset-bottom)` — the white bar extends *into* the gesture strip as inert padding while the buttons stay entirely above it.
  - `.explore-tab-btn` is now a fixed **60 px** operable height (was ~50 px from padding), with a larger 20 px icon / 12 px label and `-webkit-tap-highlight-color: transparent`.
  - `header` top padding switched to `max(4px, env(safe-area-inset-top))` so `viewport-fit=cover` doesn't tuck the Explore header under the status bar / notch. `max()` keeps the original 4 px on every other page (where `env()` is 0), so this is inert app-wide except on the home page.
- **Scope.** Only the home page opts into `viewport-fit=cover`; all other pages are untouched (their `env()` reads 0, the `max()`/fallbacks preserve prior layout).

### Home page — title reverted to non-heading so it uses the body sans-serif

- **Back-and-forth, resolved.** An earlier 05-11 change promoted the header "VPAtlas" wordmark from `<span>` to `<h3>` specifically so it'd pick up the new Lora title serif. The user has now decided the wordmark should be sans-serif after all.
- **The change.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) — the title is back to `<span class="header-name light-foreground header-app-name">VPAtlas</span>`. The only thing that applied the serif was the global `h1–h6 { font-family: var(--font-title) }` rule in [css/common.css](ui_vp/uiVPAtlas/css/common.css); neither `.header-name` nor `.header-app-name` sets `font-family`, so as a `<span>` the wordmark now inherits `--font-body` (Noto Sans) from `html, body`. No CSS change needed. `.header-name`'s `display:inline` + the existing `margin:0/line-height:1` on `.header-app-name` mean the flex header layout is unaffected by the tag swap.

### Review queue — auto-refresh without a hard reload

- **The gap.** After the per-visit Review filter rework (migrations 015/016, 2026-05-18), the queue showed the right pools and the right pools dropped off when a review was added — **but only after a hard browser reload**. The existing background freshness check (`checkFreshness` in [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js), gated by `STALE_MS = 60 s`) never fired for review-related changes.
- **Two root causes.**
  1. The SW puts `/pools/mapped/stats` in `DATA_CACHE_PATTERNS` ([sw_template.js](ui_vp/uiVPAtlas/sw_template.js)) — `handleDataRequest` is stale-while-revalidate keyed on full URL including query string. The freshness probe was reading the *same* cached fingerprint that's stored in our pool cache → equality → no refetch ever.
  2. The stats `review` count in [api_vp/vpMapped/vpMapped.service.js](api_vp/vpMapped/vpMapped.service.js) `getStats` used the old pool-level rule (`reviewId IS NULL AND visitId IS NOT NULL`). Moved when a first review was added/removed, but **didn't move** for the per-visit "user edited a visit after its review" case.
- **Fix 1 — cache-busted freshness probe.** [explore/js/pool_list.js](ui_vp/uiVPAtlas/explore/js/pool_list.js) gains a small `fetchFreshStats()` helper that appends `?_cb=<STALE_MS-windowed timestamp>` so the probe URL is unique per freshness window → SW cache miss → fresh network read. Used at both fingerprint sites (baseline write in `fetchAndCache`, probe in `checkFreshness`) so baseline and probe compare like-for-like. `getStats` only reads `params.username`; the extra `_cb` param is silently ignored. Other consumers (`filter_bar`, `pool_summary`, `pool_data_cache`) keep hitting the plain URL and stay on the SW cache — **offline behavior unchanged**. Cache growth is bounded: at most ~1 new entry per freshness window, all under the version-scoped `vpAtlas-data-<APP_VERSION>` cache that clears on the next deploy.
- **Fix 2 — per-visit `review` count.** [api_vp/vpMapped/vpMapped.service.js](api_vp/vpMapped/vpMapped.service.js) `getStats` review subquery rewritten to mirror the client filter exactly: count distinct `visitPoolId`s where **any** visit either has no review (LEFT JOIN against `(reviewVisitId, max(reviewQADate))` → NULL) or has `lastEditedAt::date > max_qa`. The fingerprint now moves on **both** add-first-review **and** edit-after-review events. Uses the columns guaranteed by migrations 015 (`vpreview.reviewQADate` NOT NULL) and 016 (`vpvisit.lastEditedAt` nullable, set only by the API's user-edit path).
- **Result.** An admin adds a review on a pool in the Review queue → within ≤60 s (or on the next home-page navigation) the pool drops off without a hard reload. A user edits a previously-reviewed visit via the app's Edit flow → `lastEditedAt = now()` is stamped → the stats `review` count ticks up → fingerprint changes → `onRefresh` fires → the pool re-appears in the queue.
- **No SW config change, no schema change, no client cache-key bump.**

### Tooling — offline-deliverability test in the standing smoke suite

- **Why.** sw-validate.js catches "the precache list is internally consistent" at build time, but doesn't tell us whether the live ui_vp container actually serves every URL in `urlsToCache.js` right now. A regression where a listed URL 404s on the server (e.g., not copied into the image, served from a stale layer) would silently break first-visit offline support and only surface as a "Unavailable Offline" report from the field.
- **The test.** New [ui_vp/uiVPAtlas/test-offline-serve.sh](ui_vp/uiVPAtlas/test-offline-serve.sh) curls every URL in `urlsToCache.js` against `$BASE` (default `http://localhost:8090`) and verifies HTTP 200 + non-empty body. Standalone, idempotent, exits non-zero on any failure, prints the failing URLs.
- **Wired into [test_stack.sh](test_stack.sh)** as a new section ("Offline deliverability (urlsToCache.js → ui_vp)") that delegates to the standalone script and folds one PASS/FAIL into the suite roll-up. Suite now reports 69 / 69 passing.
- **Deploy rule updated** in [CLAUDE.md](CLAUDE.md) (Required deploy sequence) and the build-workflow memory: `sw-build` → `docker compose up -d --build` → `./test_stack.sh` is now the three-step deploy contract. The test must show zero failures before declaring a change complete.

### Documentation — finalize 2026-05-14 and 2026-05-18 changelogs

- **Why.** Both days had been published as `-partial` files because work continued past the snapshot point at the time; the day is long since closed for each. Per the changelog workflow rule (CLAUDE.md), the `-partial` suffix and `(partial)` qualifier come off once the day is finalized.
- **Mechanical close-out.** Renamed `docs/CHANGELOG-2026-05-14-partial.md` → `CHANGELOG-2026-05-14.md` and `docs/CHANGELOG-2026-05-18-partial.md` → `CHANGELOG-2026-05-18.md`; dropped the `(partial)` qualifier from each file's H1 and removed the boilerplate "Partial day's work; additional changes may land later…" paragraph. The matching pair of entries was updated in both [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) (precache list) and [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) (in-app changelog menu) — same-change, so the renamed files install in the SW precache and appear in the menu without a 503. Today's 2026-05-19 is still open, so its `-partial` entry stays.

### Home page — Vermont Fish &amp; Wildlife crest in the header

- **The ask.** The legacy Angular app credited VTF&W alongside VCE as a project partner (footer + home-page block). The Docker rewrite's header was only carrying the VCE logo + bird icon; the F&W crest belongs there too so the sponsorship is visible from the first screen instead of buried in a footer that this app doesn't have yet.
- **The asset.** New `images/vfw-crest.png` (~10 KB, portrait shield) supplied by the user. Sits next to the VCE logo inside the existing `.header-logo-link` span in [explore/index.html](ui_vp/uiVPAtlas/explore/index.html), wrapped in an anchor to `https://vtfishandwildlife.com/` (matches the legacy app's link target), `target="_blank" rel="noopener"`. Alt text "VT Fish & Wildlife" + title attr for the hover tooltip.
- **Responsive treatment.** New `.header-vfw-logo` class in [explore/css/common.css](ui_vp/uiVPAtlas/explore/css/common.css) mirrors `.header-vce-logo` down through the 768 px breakpoint (36 px → 32 px). Below 420 px the two diverge: VCE still collapses to its bird-icon + "VCE" text abbreviation, but the F&W crest has no equivalent shorthand, so it stays visible — shrunk to 28 px so it doesn't crowd the title on the narrowest phones.
- **Offline.** `'/images/vfw-crest.png'` added to the images block of [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) so the crest renders in the precached home shell even without a network — same treatment as the VCE logos already get.

### Service worker / build

- **Patch versions** — `manifest.json` 3.5.271 → 3.5.272 (tab bar), then 3.5.272 → 3.5.273 (My Visits offline snapshot), then 3.5.273 → 3.5.274 (home title back to non-heading sans-serif), then 3.5.274 → 3.5.275 (reviews↔visits cross-references), then 3.5.275 → 3.5.276 (review QA date in right pane + ed:/qa: strip labels), then 3.5.276 → 3.5.277 (Review queue auto-refresh via cache-busted freshness probe + per-visit stats subquery), then 3.5.277 → 3.5.278 (finalize 05-14 / 05-18 changelogs), then 3.5.279 → 3.5.280 (F&W crest in header), then 3.5.280 → 3.5.281 (keep F&W crest visible under 420 px at 28 px) via `node sw-build.js`; `sw.js` regenerated each time.
- **`urlsToCache.js`** picked up the new `/docs/CHANGELOG-2026-05-19-partial.md` entry earlier today, switched the 2026-05-14 / 2026-05-18 entries from `-partial.md` to `.md` for the finalize step, and added `/images/vfw-crest.png` for the new sponsor logo.
- **UI + API rebuild this round** — the Review-queue auto-refresh changed `vpMapped.service.js` SQL, so `up -d --build api_vp` is needed alongside `ui_vp`. No new columns → no `--force-recreate` needed. The F&W crest is a UI-only addition (`up -d --build ui_vp`).
