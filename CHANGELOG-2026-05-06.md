# Changelog — Snapshot 2026-05-06

## v3.5.181 – v3.5.197

### Per-user IndexedDB scoping — no more cross-user leakage on shared devices

- **The leak.** A single shared idb-keyval store meant that user1's draft visits, recorded tracks, filter history, and PoolFinder targets were visible to user2 after a logout/login on the same device. Field volunteers swap iPads, lab partners share a laptop — this surfaced more than once.
- **Prefix-based namespace.** [js/storage.js](ui_vp/uiVPAtlas/js/storage.js) now auto-prefixes every key with `u<id>:` for the signed-in user (or `anon:` when nobody is signed in). `getLocal`/`setLocal`/`delLocal`/`getKeys`/`getEntries` all flow through `scope()`; callers don't change. `SHARED_KEYS` is the small whitelist that bypasses the prefix — `auth_token`, `auth_user`, `pool_cache`, `visit_cache`, `survey_cache`, `parcel_cache`, `map_settings`. Default-deny: any new key gets scoped unless explicitly added to the list.
- **Login pins the scope.** [js/auth.js](ui_vp/uiVPAtlas/js/auth.js) calls `setStorageUser(user.id)` immediately after `setLocal('auth_user')` on login, and `setStorageUser(null)` on logout. `getUser()` is also idempotent — page refreshes / inter-page navigation re-pin the scope from the persisted auth blob before any other read fires.
- **Auth guard pins too.** `requireAuth()` now awaits `getUser()` so any IDB read on a protected page lands in the right namespace even on a cold load (previously it just decided the redirect and returned).
- **One-shot legacy migration.** First login on a pre-deploy device runs `migrateLegacyKeysToUser` — moves un-prefixed keys (visits, tracks, user_state, poolfinder_*) into `u<id>:*`, with a per-user `_migrated_v1` flag so repeat logins are no-ops. The first user to sign in claims the legacy data; subsequent users start clean. `SHARED_KEYS` and already-prefixed keys are skipped.
- **Logout no longer deletes track stubs.** Per-user prefixes mean each user's tracks live in their own namespace already; the prior `track_recorder.clearServerStubs()` call was redundant and would have wiped the wrong user's stubs if it ever ran out of order. Removed.
- **Raw helpers exported** (`getRaw`, `setRaw`, `delRaw`, `rawKeys`) — un-prefixed access for the migration code only. Comment in `storage.js` warns nothing else should touch them.

### User activity tracking — Last Active + profile activity block

- **Why.** Admins wanted to know who's still actively contributing without having to cross-reference visits/surveys/tracks tables manually.
- **DB-side: correlated activity rollup.** [api_vp/users/vpUser.service.pg.js](api_vp/users/vpUser.service.pg.js) — new `ACTIVITY_SUBQUERIES` constant adds `lastVisitAt`, `lastSurveyAt`, `lastTrackAt`, and a `GREATEST` `lastActiveAt` rollup as correlated subqueries on `vpvisit`/`vpsurvey`/`vptrack`. Used by `getAll`, `getPage`, and a new `getByIdFull`. `'epoch'::timestamp` is the COALESCE floor inside `GREATEST` so a user with no contributions still rolls up to `u."updatedAt"`; outside the rollup the columns stay NULL so the UI can render `—`.
- **Two `getById`s.** New `getByIdFull` runs the full subquery set; the original lightweight `getById` is unchanged because it's hit by `_helpers/jwt.js` on every authed request — paying for the activity MAXes there would be wasted work. The user routes (`GET /users/:id`) switched to `getByIdFull`; the JWT middleware did not.
- **Login bumps `updatedAt`.** `authenticate()` fires a `UPDATE vpuser SET "updatedAt" = now()` on successful login, fire-and-forget so a DB hiccup doesn't block sign-in. Conflates "last login" with "last profile edit" intentionally — see the **plan note** in the source. The UI labels this honestly so admins know the conflation exists.
- **Admin user list — Last Active column.** [admin/users_admin.html](ui_vp/uiVPAtlas/admin/users_admin.html) — new column, sortable via the existing sort dropdown (`Last Active` option added).
- **Admin profile — 4-line activity block.** [admin/profile.html](ui_vp/uiVPAtlas/admin/profile.html) — top line stays as `Status | Joined`; below that, four explicit lines:
  - Last login or profile edit (= `updatedAt`)
  - Last visit (= `lastVisitAt`)
  - Last survey (= `lastSurveyAt`)
  - Last track upload (= `lastTrackAt`)

  Missing values render as `—` rather than being omitted, so the block layout doesn't reflow per user.

### Bandwidth monitor — now a drop-in module

- **Goal: portable into LoonWeb (and future apps).** [js/bandwidth_monitor.js](ui_vp/uiVPAtlas/js/bandwidth_monitor.js) was already self-contained (no app imports, only standard browser APIs) but had three things baked in: `TEST_FILES` URLs/byte counts, the `bandwidth_monitor_last` sessionStorage key, and the threshold tunables.
- **Parameterized via `DEFAULTS` + config merge.** The IIFE now defines a `DEFAULTS` object, exposes a `BandwidthMonitor(config)` constructor, and reads `window.bandwidthMonitorConfig` (set BEFORE the script tag) to override defaults. All previously module-scoped constants moved to `this.config`; `readCache`/`writeCache` became prototype methods reading `this.config.cacheKey` and `this.config.cacheTtlMs`.
- **Two globals exposed:**
  - `window.BandwidthMonitor` — constructor, for apps that want to manage their own instance.
  - `window.bandwidthMonitor` — auto-instantiated default, configured from `window.bandwidthMonitorConfig` if set.
- **No VPAtlas consumer changes.** Defaults match the prior hardcoded values exactly. [js/app.js](ui_vp/uiVPAtlas/js/app.js) and [explore/system.html](ui_vp/uiVPAtlas/explore/system.html) still call `window.bandwidthMonitor.measureBandwidth(...)` unchanged.
- **Manual probe button now skips both caches.** `explore/system.html` button now passes `{ force: true, allowReprobe: false }` so the user sees a fresh, raw single-shot measurement when they click "Run bandwidth test" — previously the button could return a 5-minute-stale cached value or an averaged-with-reprobe number, neither of which is what someone clicking "test now" wants.
- **Out of scope (next task):** LoonWeb back-port. Drop the file into LoonWeb, set `window.bandwidthMonitorConfig` in pages that want a custom cache-key namespace, delete LoonWeb's inline ~30-line bandwidth check in `app.js`.

### PoolFinder — header cleanup, zoom-to-track follow-through

- **Removed inline `+ New Pool` button.** [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html) — the `+ New Pool` action moved into the always-visible overflow `⋮` menu. The header was getting crowded with the always-visible ellipsis (added in the previous snapshot for *View Track*) plus the new-pool button plus the target list, so consolidating into the overflow menu reclaims horizontal space. `newPoolHref()` still uses the GPS position when available.
- **Zoom-to-track wires to both line types.** A previous snapshot added the *Zoom to track* button on the zoom toolbar; this snapshot completes the wiring. New module-scoped `recordingTrackLine` + `savedTrackLine` references and `updateZoomTrackBtn()` show/hide the button whenever either is non-null. Recorder events (`started`, `point`, `stopped`, `discarded`, resume on reload) all call `updateZoomTrackBtn()`; `displayTrackParam()` (the URL-param path that loads a finished track) does the same.

### Pool popups — on-demand parcel fetch

- **The gap.** [explore/js/map.js](ui_vp/uiVPAtlas/explore/js/map.js) `poolPopupHtml` reads from the parcel cache via `findParcelAt` to render the landowner block. Parcels stream in only as the user pans/zooms, so opening a popup at a location the user hasn't yet visited would show "no landowner data" until they wiggled the map.
- **The fix.** New `popupopen` listener: if `findParcelAt({lat,lng})` returns nothing, fire `prefetchParcelsNear(lat, lng)` (a small VCGI bbox request around the pool), then re-set the popup content. Exits early if the popup was closed before the fetch returned.
- **New export from `parcels.js`:** `prefetchParcelsNear` — wired through `parcels.js` and added to the `map.js` import.

### Service worker / build

- **17 patch versions** between this snapshot and the prior changelog (v3.5.181 – v3.5.197). Auto-bumps from `node sw-build.js` after every UI/asset edit.

### Database

- No new migrations this snapshot. The activity-tracking work runs entirely as read-side JOINs against the existing `vpvisit.updatedAt`, `vpsurvey.updatedAt`, `vptrack.uploadedAt`, and `vpuser.updatedAt` columns — no schema changes required.
