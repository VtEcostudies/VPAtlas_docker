# Changelog — Snapshot 2026-05-21 (partial)

## v3.5.302

Partial day's work; additional changes may land later under a follow-up
2026-05-21 changelog.

### Kill-switch SW — fixed a 1-second reload loop on iOS

- **The bug.** Phones that installed the PWA while `vpatlas.org` still served the legacy Angular app have `/ngsw-worker.js` registered as their service worker. Yesterday's kill switch ([ngsw-worker.js](ui_vp/uiVPAtlas/ngsw-worker.js)) ended its `activate` handler with `clients.claim()` + `clients.navigate()` to force an immediate reload into the new app. On iOS that unregister→navigate sequence didn't terminate — the forced reload re-ran the SW lifecycle, which activated and navigated again, ~1 second per cycle, flashing the screen. The kill switch had no reload cooldown (unlike `app.js`'s real update path) so nothing broke the loop.
- **The fix.** [ngsw-worker.js](ui_vp/uiVPAtlas/ngsw-worker.js) is now the canonical loop-proof "retire a service worker" stub: `install` skips waiting, `activate` clears caches and unregisters — **no `claim`, no `navigate`, no reload**. The legacy SW still gets cleaned up; the current docker app simply appears on the next normal launch instead of via a forced reload.

### Visit form — new "Associated with wetland complex" pool type

- **The ask.** The Verify tab's **Pool Type** choices on the "+ Atlas Visit" form ([survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html)) were Forest Depression / Floodplain / Manmade / Other. Added a fifth option, **"Associated with wetland complex"**, placed before "Other".
- **Storage.** Stored in `vpvisit.visitPoolType` (a free-text column — no enum constraint), so the new value needs no API or DB change.

### Service worker / build

- `manifest.json` 3.5.301 → 3.5.302 via `node sw-build.js patch`. UI rebuild only.
