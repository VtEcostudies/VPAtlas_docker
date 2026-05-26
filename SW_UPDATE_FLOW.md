# VPAtlas Service-Worker Update Flow — Read Before Touching app.js or sw_template.js

This file exists because the page-side update logic in
[`ui_vp/uiVPAtlas/js/app.js`](ui_vp/uiVPAtlas/js/app.js) has accumulated
**three independent loop-defense gates** (cooldown, cap, bandwidth) layered
on top of the basic SW lifecycle. Every gate can silently block a
legitimate update, and the most recent regression — a single deploy never
showing the new version — was caused by a self-defeating interaction
between two of those gates. There was no single document mapping the
flow. This is that document.

The companion file is [`OFFLINE_CONTRACT.md`](OFFLINE_CONTRACT.md). Same
rule of engagement: read this whole file before editing
[`ui_vp/uiVPAtlas/js/app.js`](ui_vp/uiVPAtlas/js/app.js) or
[`ui_vp/uiVPAtlas/sw_template.js`](ui_vp/uiVPAtlas/sw_template.js), and
re-verify the manual test below afterwards.

---

## The two goals (in tension)

1. **Auto-update.** A deploy lands → user opens the app → they're on the
   new version without doing anything. No "Refresh to update" button, no
   user-visible chrome.
2. **No reload loops.** On iPhone PWA in standalone mode, certain edge
   cases (byte-unstable `sw.js`, stale `navigator.connection.downlink`,
   process eviction wiping `sessionStorage`) caused the install/activate/
   reload cycle to fire repeatedly, sub-second, until the user force-quit
   the app. The cooldown + cap exist purely to stop this.

The gates protect goal 2. They must never silently break goal 1. If a
gate fires, the user must see a recovery path (the
`showUpdatePausedToast()` toast). Silent stalls are the worst outcome.

---

## The happy path — single deploy, no loop

| # | Where | What happens |
|---|---|---|
| 1 | [app.js:136](ui_vp/uiVPAtlas/js/app.js#L136) IIFE | Page load. If config opt-out → skip update check, register stays. |
| 2 | [app.js:169](ui_vp/uiVPAtlas/js/app.js#L169) | `getRegistration('/sw.js')` — is a SW already waiting from a prior session? |
| 3a | [app.js:171](ui_vp/uiVPAtlas/js/app.js#L171) | If waiting → cooldown/cap guard → `activateWaitingSW(waiting)`. |
| 3b | [app.js:187](ui_vp/uiVPAtlas/js/app.js#L187) | If no waiting → `registerAndCheckForUpdates()`. |
| 4 | [app.js:223](ui_vp/uiVPAtlas/js/app.js#L223) | `register('/sw.js', {updateViaCache:'none'})`. |
| 5 | [app.js:282-333](ui_vp/uiVPAtlas/js/app.js#L282-L333) | Bandwidth probe → if ≥ 1500 kbps, call `registration.update()`. |
| 6 | [app.js:226](ui_vp/uiVPAtlas/js/app.js#L226) | Browser detects new `sw.js` bytes → fires `updatefound`. |
| 7 | [app.js:232](ui_vp/uiVPAtlas/js/app.js#L232) | `statechange` watcher armed; overlay shows "Downloading update…". |
| 8 | [app.js:235](ui_vp/uiVPAtlas/js/app.js#L235) | State reaches `'installed'` → cooldown/cap guard → `activateWaitingSW(newWorker)`. |
| 9 | [app.js:362](ui_vp/uiVPAtlas/js/app.js#L362) | `worker.postMessage({type:'SKIP_WAITING'})`. **No cooldown stamp here.** |
| 10 | [sw_template.js:132-135](ui_vp/uiVPAtlas/sw_template.js#L132-L135) | SW receives `SKIP_WAITING` → sets `isUpdate=true` → `self.skipWaiting()`. |
| 11 | [sw_template.js:118-126](ui_vp/uiVPAtlas/sw_template.js#L118-L126) | SW `activate` → `clients.claim()` + `cleanupOldCaches()` → broadcasts `{type:'RELOAD'}`. |
| 12 | [app.js:404](ui_vp/uiVPAtlas/js/app.js#L404) | Page receives RELOAD on BroadcastChannel `'sw-messages'`. |
| 13 | [app.js:411-419](ui_vp/uiVPAtlas/js/app.js#L411-L419) | Cooldown + cap re-checked (defense in depth). Pass. |
| 14 | [app.js:424-427](ui_vp/uiVPAtlas/js/app.js#L424-L427) | `markReloadedNow()` + `recordReloadForCap()` + `window.location.reload()`. |
| 15 | new page load | SW is now active, serves new precached HTML/JS/manifest.json. Top-bar version updates. `vpa_sw_reload_log` has `broadcast-reload` as last entry. |

The cooldown stamp lives **only at step 14**, immediately before the
actual reload. Pre-stamping at step 9 (the prior behavior) caused step 13
to drop the broadcast — a silent regression that left the new SW active
but the page on old HTML.

---

## The gates — what each one blocks, and what the user sees

All four gates live page-side ([app.js](ui_vp/uiVPAtlas/js/app.js)). The
SW itself does not gate anything beyond the standard install/activate
lifecycle.

| Gate | Where | Triggers when | If it fires |
|---|---|---|---|
| **Config opt-out** | [app.js:146](ui_vp/uiVPAtlas/js/app.js#L146) | `appConfig.useServiceWorker === false` on this page | Skip the update check; existing SW stays registered and continues serving offline. **Does not unregister** (intentional — unregistering broke offline for every other page). |
| **Bandwidth** | [app.js:283-333](ui_vp/uiVPAtlas/js/app.js#L283-L333) | Probe + `navigator.connection.downlink` MIN below 1500 kbps | Skip `registration.update()` call entirely. Console-only; no toast. Rationale: don't burn a slow user's data on an SW check; they'll get the update next time bandwidth is OK. |
| **30 s cooldown** | [app.js:172, 237, 411](ui_vp/uiVPAtlas/js/app.js#L172) | A real `window.location.reload()` happened within the last 30 s (stamp in `vpa_sw_last_reload_ts`) | New SW left in `waiting`; no auto-activation; `showUpdatePausedToast()` surfaces a recovery message. Catches genuine sub-second loops. |
| **3-in-5-min cap** | [app.js:175, 246, 416](ui_vp/uiVPAtlas/js/app.js#L175) | `vpa_sw_reload_events` has ≥ 3 entries inside the last 5 min | Same as cooldown — new SW left waiting, toast surfaced. Catches loops that fire above the cooldown threshold. |

The cooldown and cap **are correct**. The pre-emptive stamp inside
`activateWaitingSW()` (which used to live at the top of that function)
**is not**. It has been removed. Do not re-add it. The reasoning is in
the comment at the top of `activateWaitingSW()` in
[app.js](ui_vp/uiVPAtlas/js/app.js) — read it before any change there.

---

## localStorage keys — what they are, when to clear them

These survive iOS process eviction (which wipes `sessionStorage`).
That's by design — the cooldown must defend a PWA that just got killed
under memory pressure. Stored values are small (~1 KB total) and
non-PII.

| Key | Type | Set by | Read by | Wipe to recover |
|---|---|---|---|---|
| `vpa_sw_last_reload_ts` | number (ms since epoch) | [app.js:424](ui_vp/uiVPAtlas/js/app.js#L424) `markReloadedNow()` right before `window.location.reload()` | `alreadyReloadedRecently()` everywhere | If user is "stuck on old version" with cooldown active: `localStorage.removeItem('vpa_sw_last_reload_ts')` then reload. |
| `vpa_sw_reload_events` | JSON array of ms-timestamps | [app.js:425](ui_vp/uiVPAtlas/js/app.js#L425) `recordReloadForCap()` | `reloadCapExceeded()` everywhere | If cap is tripped: `localStorage.removeItem('vpa_sw_reload_events')` then reload. |
| `vpa_sw_reload_log` | JSON ring buffer (last 10 events) | [app.js:114](ui_vp/uiVPAtlas/js/app.js#L114) `logReloadEvent(reason, extra)` | Read with DevTools / paste back from field user | Diagnostic only. Safe to leave; safe to clear. |
| `vpa_disable_sw` | string | (removed in 3.5.224 — defensively scrubbed at [app.js:37](ui_vp/uiVPAtlas/js/app.js#L37)) | n/a | Already cleared on every load — should never be present. |

---

## Diagnosing a stuck client

The fastest signal is the reload log. In DevTools console on a stuck
client:

```js
JSON.parse(localStorage.getItem('vpa_sw_reload_log') || '[]')
```

Each entry looks like `{ t: "2026-05-26T...", reason: "...", why: "..." }`.
Map `reason` to root cause:

| `reason` | What it means |
|---|---|
| `waiting-activating` | Cold load found a waiting SW and activated it. Normal. |
| `waiting-skipped`, `why: cooldown` | Waiting SW present but we reloaded < 30 s ago. Wait 30 s and reopen, or Reset App. |
| `waiting-skipped`, `why: cap` | Waiting SW present but cap exceeded. Wait until cap window clears (~5 min), or Reset App. |
| `install-activating` | New SW installed and activation initiated. Normal. |
| `install-skipped`, `why: cooldown` | New SW installed but reloaded < 30 s ago. Wait, or Reset App. |
| `install-skipped`, `why: cap` | New SW installed but cap exceeded. Wait, or Reset App. |
| `broadcast-reload` | SW's RELOAD broadcast was honored — page reloaded. Normal. |
| `broadcast-skipped`, `why: cooldown` | RELOAD arrived during cooldown. **Should not happen during a single legitimate deploy** after the regression fix. If you see this on first-update, the regression has returned — check `activateWaitingSW()` for a pre-emptive stamp. |
| `broadcast-skipped`, `why: cap` | RELOAD arrived but cap exceeded. Real loop suppression — investigate `sw.js` byte stability if reported by a user. |

Also useful: `await getSWStatus()` ([app.js:495](ui_vp/uiVPAtlas/js/app.js#L495))
returns `{ controller, installing, waiting, active }` — confirms whether
a SW is genuinely waiting vs already active.

---

## Recovery actions

For a stuck client (any cause), in order of preference:

1. **Wait it out.** Cooldown clears in 30 s; cap clears 5 min after the
   oldest entry. The next cold open auto-activates.
2. **Reset App** on [`admin/profile.html`](ui_vp/uiVPAtlas/admin/profile.html).
   This is the documented user-side invalidation (see CLAUDE.md locked
   decisions). Bypasses the gates by clearing the relevant state.
3. **Manual localStorage wipe** (developer / support tool):
   ```js
   localStorage.removeItem('vpa_sw_last_reload_ts');
   localStorage.removeItem('vpa_sw_reload_events');
   location.reload();
   ```
4. **Hard reinstall** (last resort): remove from home screen, reinstall
   from `vpatlas.org`.

---

## When NOT to touch sw_template.js

The SW side of the flow is correct and minimal:

- `install` → optionally precache, send `info` message ([sw_template.js:112](ui_vp/uiVPAtlas/sw_template.js#L112)).
- `activate` → `clients.claim()` → `cleanupOldCaches()` → if `isUpdate`, broadcast `RELOAD` ([sw_template.js:118-126](ui_vp/uiVPAtlas/sw_template.js#L118-L126)).
- `message SKIP_WAITING` → set `isUpdate=true` → `self.skipWaiting()` ([sw_template.js:132-135](ui_vp/uiVPAtlas/sw_template.js#L132-L135)).

Every SW-update bug we've shipped has been **page-side**. Do not chase
update bugs into `sw_template.js` first. Read the reload log, identify
which gate fired, and look in `app.js`.

The one exception: `OFFLINE_CONTRACT.md` governs the fetch handler.
Update-flow rules and offline-handler rules don't overlap.

---

## Manual test — required after touching app.js update logic

Run this on a local dev rebuild before merging. Do **not** prod-deploy
without explicit user OK per the CLAUDE.md locked decision.

1. **Single-deploy happy path.** `localStorage.clear()` in DevTools.
   Hard reload. Run `node ui_vp/uiVPAtlas/sw-build.js patch` +
   `docker compose -f docker-compose-vpatlas.yml up -d --build ui_vp`.
   Reload the app. Expect: brief "Downloading update…" → "Activating
   update…" overlay → page reloads → top-bar version advances to the
   new patch. `JSON.parse(localStorage.getItem('vpa_sw_reload_log'))`
   shows `install-activating` then `broadcast-reload` as the last two
   entries — **not** `broadcast-skipped`.

2. **Back-to-back deploy (cooldown should fire visibly).** Within 30 s
   of test 1's reload, run sw-build + rebuild again. Reopen the app.
   Expect: new SW installs but auto-reload is blocked, and the yellow
   "An update is ready…" toast appears at the bottom of the screen.
   Tap **Reset App** on Profile → version advances.

3. **Outside cooldown.** Wait 60 s after test 1. Run sw-build + rebuild.
   Reopen. Expect: auto-reload completes, no toast.

4. **Loop defense still works.** In DevTools, repeatedly run:
   ```js
   navigator.serviceWorker.getRegistration().then(r => r.update())
   ```
   Look at the log after 3+ events: cap should fire and subsequent
   auto-reloads should be suppressed (toast appears).

5. **iPhone PWA.** Install the dev build to home screen on an iPhone in
   standalone mode. Repeat test 1. Confirm a single clean update with
   no reload loop.

If any test fails, the regression has returned. Re-read the "happy path"
table above and check that `activateWaitingSW()` is not pre-stamping
`markReloadedNow()`.
