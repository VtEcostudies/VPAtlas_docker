# VPAtlas Offline Contract — DO NOT VIOLATE

This file exists because the same offline regression has been reintroduced
many times: data-loading code calls `fetch()` unconditionally, the service
worker returns a 503 when there is no network, the 503 is thrown, and the
page renders an **error** (or hangs on a spinner) instead of silently using
cached / IndexedDB data.

VPAtlas is a field PWA. Volunteers are routinely offline for hours. Offline
is a **normal, expected state — not an error condition.** Treat it that way
everywhere.

---

## The one rule

> **Network available → fetch fresh, fall back to cache on failure.
> Network unavailable → do NOT fetch; use cache / IndexedDB; show no error.**

A correct data load looks like this, every time:

```js
import { isOnline } from '/js/net_status.js';

if (await isOnline()) {
    try {
        data = await fetchFromApi();   // fresh
        await writeCache(data);
    } catch (e) {
        data = await readCache();      // online but flaky → cached
    }
} else {
    data = await readCache();          // offline → cached, SILENTLY
}
```

Never:
- call `fetch()` for page data without an `isOnline()` gate;
- render an error string / red banner / alert when the only problem is
  "we're offline";
- leave a loading spinner up because the fetch threw offline;
- use bare `navigator.onLine` as the online check (see below).

---

## Why `navigator.onLine` alone is wrong

- `navigator.onLine === false` — **reliable.** When present and false the
  OS reports no connectivity. Fast-path it as definitively offline.
- `navigator.onLine === true` — **not reliable.** It only means a network
  interface exists. Captive portals, dead Wi-Fi, and airplane-mode-with-
  stale-flag all report `true`.
- `navigator.onLine === undefined` — some embedded webviews don't
  implement it at all.

Therefore the positive case must be **confirmed with a real, guarded
network request**. That logic lives in exactly one place:

### `/js/net_status.js` — the only sanctioned online check

`isOnline()`:
1. Returns `false` immediately if `navigator.onLine === false`.
2. Otherwise probes `/images/speed-test-small.jpg` with `cache:'no-store'`,
   a cache-buster query, and an `AbortController` timeout (~3.5 s). 2xx →
   online; throw / timeout / non-2xx → offline.
3. Caches the answer ~4 s so concurrent callers share one probe; resets on
   the `online` event.

The probe URL **must** stay in `STATIC_NO_CACHE_PATTERNS` in
`sw_template.js`. If it gets precached, the probe always "succeeds" and the
whole check is defeated. Do not remove the probe, the timeout, or the
no-store. Do not replace `isOnline()` callers with `navigator.onLine`.

---

## The three protected files — change with extreme care

These three files implement the offline contract. They have been the
source of every offline outage. Read this whole document before editing
any of them, and re-verify the offline path manually after.

### `ui_vp/uiVPAtlas/js/app.js` (service-worker registration + update gate)

- The SW update check (`registration.update()`) must run **only when
  online and on a sufficiently fast connection** — it is already gated on
  `navigator.serviceWorker.controller` + the bandwidth probe. When the
  probe returns null (offline) the update check is **skipped silently**.
  Keep it that way. An offline app must still boot from cache.
- `app.js` must **never unregister the service worker** as a side effect of
  a config flag, a "kill switch", or a page opt-out. Unregistering the SW
  wipes offline support for every page on the device. (This caused a
  multi-day outage. The kill switch was removed for this reason.)
- Auto-reload after a SW activation is capped by a short cooldown
  (`vpa_sw_last_reload_ts`, 30 s) to prevent install loops. Do not
  re-introduce a per-session lock — it strands iOS standalone PWAs on a
  stale version until force-quit.

### `ui_vp/uiVPAtlas/sw_template.js` (the service worker; `sw.js` is generated)

- Navigation + static requests are **cache-first / cache-fallback**. When
  the network fails the SW serves the precached copy. Do not change a
  cache-fallback handler into network-only.
- `STATIC_NO_CACHE_PATTERNS` (speed-test probe images, `/sw-reset.html`)
  must always pass through to the network. Do not precache these.
- `DATA_NO_CACHE_PATTERNS` (`/pools/visit`, `/review`, `/users/…`) are
  network-only by design — which is *exactly why* callers of those
  endpoints must gate on `isOnline()` and fall back to IndexedDB
  themselves. The SW will not cache them for you.
- The offline `errorResponse()` is a synthetic **503**. Calling code must
  treat a thrown 503 / network error as "use cache", not "show error".

### `ui_vp/uiVPAtlas/urlsToCache.js` (precache manifest)

- Every client-side file the app needs offline must be listed here, added
  in the **same change** that introduces the file. `sw-validate.js`
  enforces this at build time — do not bypass it with `--skip-validate`
  to "fix later".
- Bumping `POOL_CACHE_KEY` (or any cache key) in `cache_keys.js`
  invalidates existing client caches. An offline user who hasn't been
  online since the bump has nothing under the new key. `pool_list.js`
  recovers by falling back to `LEGACY_POOL_CACHE_KEYS`; keep that list in
  sync when you bump.
- Files matching `STATIC_NO_CACHE_PATTERNS` and raw API endpoints are the
  only things that must NOT be in this list.

---

## Manual offline test — required after touching any of the above

1. Build + deploy locally.
2. In the browser: load the app **online** once (populates caches).
3. DevTools → Network → **Offline** (or real airplane mode on device).
4. Reload the home page → pools render from cache, **no error**.
5. Navigate to **My Visits and Tracks** → local visits render, **no
   error banner**, no dead spinner.
6. Open Pool Finder with a `?poolId=` → map + compass work.
7. Re-enable network → SW update check resumes; data refreshes.

If any step shows an error or a hung spinner for what is just "offline",
the contract is violated — fix it before shipping.
