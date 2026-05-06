# Changelog — Snapshot 2026-05-06 (partial)

## v3.5.181 – v3.5.190

Partial day's work; additional changes may land later under a follow-up
2026-05-06 changelog.

### User activity tracking — admin users list & profile

- **`vpuser.updatedAt` doubles as last-login timestamp.** `authenticate()` in `api_vp/users/vpUser.service.pg.js` now fires a fire-and-forget `UPDATE vpuser SET "updatedAt" = now() WHERE id = $1` after a successful password match (covers the regular and token-bearing paths). Avoids a new column at the cost of conflating "row last edited" with "last login" — the UI labels the field accordingly.
- **Activity subqueries on user reads.** New `ACTIVITY_SUBQUERIES` constant in the same service composes four correlated scalar subqueries:
  - `lastVisitAt` — `MAX(vpvisit.updatedAt)` for any visit where the user is `visitUserId` *or* `visitObserverUserId`.
  - `lastSurveyAt` — `MAX(vpsurvey.updatedAt)` over `surveyUserId`.
  - `lastTrackAt` — `MAX(vptrack.uploadedAt)` over `vptrack.userId`.
  - `lastActiveAt` — `GREATEST(u."updatedAt", COALESCE(visit, epoch), COALESCE(survey, epoch), COALESCE(track, epoch))`. The COALESCE floor keeps users with no visits/surveys/tracks from poisoning GREATEST with a NULL.
- **Two `getById` shapes.** `getById()` stays lightweight — it's hit by `_helpers/jwt.js` on every authed request and the extra subqueries would be wasted there. New `getByIdFull()` carries the activity columns. `vpUser.routes.pg.js` `GET /users/:id` switched to `getByIdFull` so the admin profile page receives the activity timestamps; the JWT auth path is unchanged.
- **`getAll` and `getPage` rewritten** with `vpuser u` alias and `${ACTIVITY_SUBQUERIES}` after `u.*`. The existing `pgUtil.whereClause` filter still works since unqualified column names resolve through the `FROM vpuser u` alias. `getPage`'s `(SELECT count(*) FROM vpuser ${where.text})` count subquery is independent and unchanged.
- **Last Active column in admin users list.** `admin/users_admin.html`:
  - New `{ key: 'lastActive', label: 'Last Active' }` entry in the columns array; matching `<option>` in the card-mode sort dropdown.
  - `sortValue()` switch returns `u.lastActiveAt || ''` (string compare on ISO timestamp gives correct chronological order).
  - New `<td data-label="Last Active">` cell renders `formatDate(u.lastActiveAt)` next to the existing Joined column; CSS rule extended so the new column shares the nowrap+1% width with Joined / Status / Actions.
- **Four-line activity block on profile.** `admin/profile.html` profile_meta block restructured:
  - First line stays one-liner: `Status | Joined`.
  - New `.profile-activity` block underneath shows four label/value rows:
    - Last login or profile edit: `formatDate(u.updatedAt)`
    - Last visit: `formatDate(u.lastVisitAt)` or `—`
    - Last survey: `formatDate(u.lastSurveyAt)` or `—`
    - Last track upload: `formatDate(u.lastTrackAt)` or `—`
  - "Or profile edit" qualifier on the first line keeps the conflation honest. The `?id=N` admin path already lets admins view other users' profiles — same display works there.
  - CSS additions: `.profile-meta .profile-activity` (line-height 1.5), `.profile-meta .profile-activity > div` (flex), `.profile-meta .profile-activity .label` (min-width 200 px, font-weight 600).

### PoolFinder — quieter motion-permission prompt

- **iOS DeviceOrientationEvent permission preference persists to IndexedDB.** New `poolfinder_motion_pref` key (`granted` | `denied` | `dismissed`) stored via the existing `getLocal/setLocal` storage helpers. `survey/find_pool.html` `startDeviceOrientation()` was rewritten:
  - First-time users see the "Tap the compass to enable motion-based navigation" prompt + pulsing ring as before.
  - After they answer (granted, denied) or dismiss the prompt once, the prompt and pulsing ring are not shown again on subsequent loads — the compass is still tap-to-request, just quietly.
  - Tapping the compass continues to call `DeviceOrientationEvent.requestPermission()` (must be a user gesture on iOS), records the resulting state, and on `'granted'` attaches the orientation listeners.
  - Android Chrome / desktop short-circuit straight to `attachOrientation()` — no permission gate, no preference stored.

### Bandwidth monitor — drop-in refactor

- **`js/bandwidth_monitor.js` is now self-contained.** No imports, no app-specific assumptions. Configurable via `window.bandwidthMonitorConfig` set BEFORE the script tag loads:
  ```js
  window.bandwidthMonitorConfig = {
      testFiles: { small: { url: '/img/probe-s.jpg', bytes: 12345 },
                   large: { url: '/img/probe.jpg',   bytes: 67890 } },
      cacheKey: 'myapp_bw'
  };
  ```
  Defaults still point at VPAtlas's `/images/speed-test*.jpg` probes. New globals: `window.BandwidthMonitor` (constructor, for apps that want to manage their own instance) plus the auto-instantiated `window.bandwidthMonitor`.
- **Accuracy improvements.**
  - `PerformanceResourceTiming` (`responseEnd − responseStart`) preferred over wall-clock when available. On a cold connection, DNS/TCP/TLS setup can dwarf the transfer of a 35 KB probe and make the raw wall-clock math read "below threshold" on a fast link.
  - SessionStorage-cached result with TTL (default 5 min) so repeated page loads in the same session don't reprobe.
  - Auto-reprobe + average when the first probe was suspiciously fast (< 30 ms transfer time) AND landed below the gate threshold — a too-short transfer means the math is unreliable regardless of clock source.
- **`measureBandwidth({ size, force, allowReprobe })`.** New options. `force` skips the cache; `allowReprobe` enables/disables the corroboration probe. The "Run bandwidth test" button on `explore/system.html` now passes `{ force: true, allowReprobe: false }` so a manual click always shows the user a raw single-shot measurement.

### Filter bar — chip baseline + filter-token split-pill

- **40 px chip baseline at every breakpoint.** `explore/css/filter_bar.css` `.data-type-btn` now sets `height: 40px; padding: 6px 12px; min-width: 44px; box-sizing: border-box` outside of a media query. Previously these touch-friendly numbers were inside `@media (max-width: 768px)` so on desktop the near-me stepper (whose inner +/− buttons set their own intrinsic height from `font-size: 22px`) rendered taller than plain chips alongside it. Same height everywhere now.
- **Filter tokens refactored to a split-pill layout.** Tinted label half + white "×" half with a `border-left` divider, mirroring the PoolFinder zoom-button look. Wrapper has `padding: 0; overflow: hidden`; the label and remove button each provide their own padding so the divider runs corner to corner. Mobile rule overrides the wrapper padding (some chip-rule selectors collide on `padding`) and bumps the label/× internal spacing for fingertip use.

### Other

- **Pool-finder Clear button drops the pin halo.** `explore/js/pool_list.js` `poolfinder-clear` handler now captures the previously-pinned pool id (`[...selectedPoolIds][0]`) before clearing the set, then calls `onPinDeselect(priorPinned)` so `index.html` can drop the green halo from the map. Without this the halo lingered after the chips were removed.
- **`docs/index.html`** updated with a link to the 2026-05-05 changelog (the rollover for this snapshot will follow when this partial is finalised).

### Service worker / build

- **Ten patch versions.** `manifest.json` advanced 3.5.180 → 3.5.190 over the day; auto-bumped by `node sw-build.js patch` after each UI/SW change. No new files in `urlsToCache.js`.
- **No new database migrations** — user activity reuses existing `vpuser.updatedAt` plus `vpvisit.updatedAt`, `vpsurvey.updatedAt`, `vptrack.uploadedAt`, all of which were already in place.
