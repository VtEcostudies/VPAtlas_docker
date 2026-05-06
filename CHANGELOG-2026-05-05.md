# Changelog — Snapshot 2026-05-05

## v3.5.128 – v3.5.180

### Registration, password reset, and email change — confirmation loops, end to end

- **Registration field-name fix.** `register.html` had been POSTing `firstName` / `lastName` (camelCase) but the `vpuser` columns are lowercase `firstname` / `lastname`. The API helper `parseColumns()` only forwards body keys that exactly match a real column, so the values were being silently dropped — every registration then failed with a 400 NOT NULL violation on `firstname`. Form ids and the body keys are now lowercase to match the DB.
- **`.env` is now actually used and not at risk of leaking.** `docker-compose-vpatlas.yml` for `api_vp` reads `EMAIL_PASSWORD`, `APP_EMAIL`, `UI_PROT/UI_HOST/UI_PORT` via `${VAR:-default}` substitution so the project-root `.env` reaches the container. `.env` was added to `.gitignore` (it was untracked but unguarded — `git add .` would have staged it). `api_vp/secrets.js` is unchanged from its env-var-reading form; if you set `EMAIL_PASSWORD` in `.env`, registration emails now actually go out.
- **Registration confirmation page that exists.** The original Angular `/explore/confirm/registration` route mapped to `LoginComponent`. The docker rewrite never built that page. The email link now points at `/explore/login.html?token=…`; `login.html` detects the token, shows "Welcome — sign in to complete your VPAtlas registration", and forwards the token to `authenticate`. The backend already handles the `status='registration' → confirmed` flip when both credentials and a matching token are present.
- **Password-reset confirmation page.** New `/explore/confirm_reset.html`. On load it POSTs the URL token to `/users/verify` (server checks the JWT and matching token row) and either renders a "set new password" form or shows "this link is invalid or has expired". Submitting the form POSTs `{token, password}` to `/users/confirm`. The matching email URL in `api_vp/users/sendmail.js` was redirected from the unbuilt `/explore/confirm/reset` to `/explore/confirm_reset.html`.
- **`api.js` GET → POST fix.** `verifyUser` and `confirmUser` were declared as `fetchApiRoute` (GET) but the backend routes are POST and read from `req.body`. They're now `postApiRoute` so the new confirm-reset page actually works.
- **Email change is now deferred-swap with history.** The original behaviour wrote the new address to `vpuser.email` immediately on request, leaving accounts bound to unverified addresses if the user never clicked through. New flow:
  - Migration `008_add_email_history.sql` adds `vpuser.pendingEmail`, `vpuser.pendingEmailToken`, `vpuser.pendingEmailRequestedAt` and a `vpuser_email_history(id, userId, email, changedAt, changedBy)` table.
  - `userService.new_email(id, email)` now writes pending columns only, sends a JWT-bearing link to the new address, and rejects if that address is already in use as another user's `email` or `pendingEmail`. A second request from the same user overwrites the first pending change.
  - New `userService.confirm_email(token)` verifies the JWT, looks up the user whose `pendingEmailToken` matches, archives the previous email to `vpuser_email_history` (`changedBy = self`), and promotes `pendingEmail → email`.
  - New public route `POST /users/confirm_email` (added to `_helpers/jwt.js` `unless` list) and new auth-required `GET /users/:id/email_history`.
  - New `/explore/confirm_email.html` — auto-submits the URL token on page load and shows "Email updated to … Please sign in with the new address." or "This confirmation link is invalid or has expired."
  - `admin/profile.html` got a Change button next to the (still read-only) email field, an inline "new email + confirm new email" form, a yellow "A confirmation link has been sent to …" banner whenever `pendingEmail` is set, and a Previous Emails section that hits `GET /users/:id/email_history`.

### Saved tracks — pull from DB to UI on login

- **Track sync on login.** `auth.js login()` now fires `track_recorder.syncFromServer()` after successful authentication (dynamic import to avoid a top-level dep on `/survey/`). Tracks recorded on another device show up in *My Visits and Tracks* without the user needing to navigate to that page first.
- **Track sync on logout.** `auth.js logout()` calls `track_recorder.clearServerStubs()` so a different user signing in on the same device doesn't see the previous user's tracks. Locally-recorded tracks (uploaded or queued) are deliberately preserved — they may not have uploaded yet.
- **Server stubs in the local queue.** New `track_recorder.syncFromServer({fetchGeometry})` fetches `/tracks` metadata and merges into the IDB queue. Existing local entries with a matching `remoteId` get name / notes / uploadedAt / lengthM refreshed but keep their points (the local recording is the source of truth). Server-only tracks become stubs with `localId: 'sv_<remoteId>'`, `source: 'server'`, `points: null`.
- **Lazy geometry fetch.** New `track_recorder.getTrackPoints(localId)` returns local points if present, otherwise hits `/tracks/:id`, parses `geomJson`, persists `points` back to IDB, and returns them. The first viewer of a server-only track caches it for offline reuse.
- **Tracks tab simplified in `visit_list.html`.** Dropped the in-page server/local merge — the page now calls `syncFromServer()` once on load, then renders directly from the unified queue. `source` is read from each entry rather than hard-coded. Server-stub deletes also remove the orphaned local stub so the row doesn't reappear (sync only adds/updates; it doesn't auto-prune server-deleted rows).
- **Tracks auth fix.** `vpTrack.routes.js` was reading `req.dbUser.id`, but `express-jwt 6.x` overwrites `req.user` with the decoded JWT payload after `isRevoked` runs and the DB row only survives at `req.dbUser`. Routes now resolve user id from `req.user.sub` (the JWT subject) with `req.dbUser.id` as a fallback. `requireAuthedUser` returns 401 with diagnostic detail when both are missing.
- **Track-view tools wired into PoolFinder.** *Zoom to track* button on the PoolFinder zoom toolbar (visible only when a track is showing). The PoolFinder `⋮` ellipsis is now always-visible (no longer gated behind a fix). New *View Track* menu item launches `find_pool.html?trackId=…` for a server track or `?localTrackId=…` for an unuploaded local track. *View* buttons added next to each row in the tracks tab.

### Explore home page — single-select pin with pulsing green halo

- **Pin click is now single-select.** `pool_list.js`: clicking a pin clears the previously-pinned pool first (visually + state + map halo) before pinning the new one. The legacy multi-id `selectedPoolIds` Set is kept for storage compat but only ever holds one entry. A previously-saved multi-pin set is collapsed to its first id on init.
- **Pulsing green halo follows the pin.** New `setPoolHalo(poolId)` / `clearPoolHalo()` exports in `explore/js/map.js`. Halo is an `L.marker` with a divIcon containing a hollow ring (3 px green border, 60 px diameter, scale + opacity pulse @ 1.4 s) — the underlying canvas pool marker remains visible through the centre.
- **Halo restored after every refresh.** Earlier the halo was set once after `loadPools()` but `withWait` defers `plotPoolRows` via two `requestAnimationFrame`s, so `markers[poolId]` didn't exist yet and the call no-op'd. The restore now lives inside the `withWait` callback in `refreshUI`, which means filter changes also re-drive the halo onto the freshly-recreated markers.
- **`getPinnedPoolId()` exported** from `pool_list.js` so `index.html` can re-apply the halo without `pool_list` having to import `map.js`.

### GPS user marker — blue person + pulsing blue halo, everywhere

- **Single source of truth in `map_common.js`.** New `createUserLocationMarker(latlng, opts)` returns an `L.marker` with a divIcon that contains both the halo ring and the `fa fa-user` glyph in one composite. Pass `{ interactive: true }` if you need to bind a tooltip. New `createPoolHaloMarker(latlng)` for the green pool halo.
- **All three GPS-marker sites converted.** `explore/js/map.js`, `survey/find_pool.html`, and `survey/visit_create.html` now use the helper; the prior `L.circleMarker` blue dots are gone. `explore/js/map.js` uses an existing accuracy `L.circle` alongside the marker; `survey/find_pool.html` does the same; `survey/visit_create.html` keeps its dashed accuracy ring and binds *You are here* on the marker.
- **CSS additions in `css/map.css`.** `.user-loc-marker` / `.user-loc-icon` (composite container), `.user-halo` (pulsing blue ring, `@keyframes user-halo-pulse` 1.4 s), `.pool-halo` (green ring, `@keyframes pool-halo-pulse` 1.4 s).

### PoolFinder — target halo and compass refinements

- **Green halo around the active target.** `selectedPools` entries now also carry a `halo` Leaflet marker. The halo is added on `addPoolById` (immediately after `addPoolMarker`), removed on `removePool`, and removed on the prior target when the user accepts a "Switch target?" prompt. Same visual as the explore-page pinned-pool halo.
- **Compass dial grew.** `.pf-compass` 84 px → 115 px. `.pf-compass-prompt` `bottom` rebased from 110 px → 141 px so the speech-bubble retains its gap above the now-taller dial.
- **Compass arrow stayed small.** Arrow SVG is 23 × 75 (was 24 × 80) — the arrow now floats inside the larger dial with a clear margin between its tip and the rim.
- **One distance label, not two.** `.pf-compass-dist` was removed. The remaining `.pf-compass-label` is the single rendered element; `.pf-compass.simple .pf-compass-label` overrides its color from `var(--primary-color)` (orange, rose mode) to `#14532d` (dark green, simple/green-arrow mode). `updateCompass()` now sets `label.textContent = formatDistance(dist)` unconditionally.
- **Distance label stays above the compass.** A brief experiment moved the label inside the dial (translucent pill / transparent variant); reverted to the original above-dial position with white-shadow text since both centred styles sat poorly under the rotating arrow.

### Service worker / build

- **48 patch versions** between this snapshot and the prior changelog (v3.5.128 – v3.5.180). Most are auto-bumps from `node sw-build.js` after every `urlsToCache.js` or asset edit; the one-line script keeps clients invalidating their precache as new files appear.
- **`urlsToCache.js` additions:** `/explore/confirm_reset.html`, `/explore/confirm_email.html`, `/explore/reset.html` (the last was missing — pre-existing oversight, fixed in passing).
- **PWA icons updated.** New `apple-touch-icon.png`, `favicon-32.png`, `favicon.ico`, `icons/icon-192.png`, `icons/icon-512.png`. `Spotted Salamander.png` renamed to `spotted_salamander.png` (no spaces).

### Database migrations applied

- `008_add_email_history.sql` — `vpuser_email_history` table + `vpuser.pendingEmail/pendingEmailToken/pendingEmailRequestedAt` columns. Idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- `009_add_vptrack.sql` — `vptrack` table (PostGIS LineString + LineStringZ, GIST index, `userId` index) used by the new tracks API.
