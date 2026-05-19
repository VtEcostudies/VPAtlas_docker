/*
  net_status.js — the ONE portable "are we online?" check for VPAtlas.

  ───────────────────────────────────────────────────────────────────────────
  WHY THIS EXISTS (read before changing anything):

  This app is a field PWA. Volunteers are routinely offline. The repeated,
  app-breaking regression has been: data-loading code calls fetch()
  unconditionally, the service worker returns a 503 when offline, the 503
  gets thrown, and the page renders an ERROR instead of silently using
  cached / IndexedDB data.

  The rule, forever:
    • Network available  → fetch fresh, fall back to cache on failure.
    • Network unavailable → DO NOT fetch. Use cache / IndexedDB. No error,
                            no console noise the user can see, no spinner
                            that never resolves.

  Detecting "network available" is NOT the same on every browser:
    • `navigator.onLine === false` is RELIABLE across all browsers when it
      is present and false — it means the OS reports no connectivity.
      Trust it as a fast definitive "offline".
    • `navigator.onLine === true` is NOT reliable — it only means "there is
      a network interface", not "the server is reachable". Captive portals,
      dead Wi-Fi, airplane-mode-with-stale-flag all report true.
    • Some embedded webviews don't implement `navigator.onLine` at all
      (returns undefined).

  So: fast-path the reliable negative, then CONFIRM a positive with a real,
  guarded network request to a tiny same-origin probe file that the service
  worker is configured to always pass through to the network
  (STATIC_NO_CACHE_PATTERNS in sw_template.js — /images/speed-test*). A
  cached probe would always "succeed" and defeat the check, which is why
  the probe URL must stay in the SW no-cache list.

  Do not replace this with bare `navigator.onLine`. Do not remove the
  probe. Do not remove the timeout. See /docs OFFLINE contract.
  ───────────────────────────────────────────────────────────────────────────

  Usage:
    import { isOnline } from '/js/net_status.js';
    if (await isOnline()) {
        try { data = await fetchFromApi(); cache(data); }
        catch (e) { data = await readCache(); }   // online but flaky
    } else {
        data = await readCache();                  // offline: silent
    }
*/

// Same-origin, tiny, and excluded from SW caching (STATIC_NO_CACHE_PATTERNS
// matches /images/speed-test-small.jpg). Excluded == every request really
// hits the network, so a 200 genuinely means "server reachable".
const PROBE_URL = '/images/speed-test-small.jpg';
const PROBE_TIMEOUT_MS = 3500;

// Within one page load, many callers ask near-simultaneously (pool list,
// visit list, filter bar, profile icon). Cache the answer briefly so we
// fire at most one probe per few seconds instead of one per caller.
const RESULT_TTL_MS = 4000;
let _cached = { value: null, ts: 0, inflight: null };

export async function isOnline() {
    // 1. Reliable definitive negative — no probe needed.
    //    navigator.onLine === false is trustworthy on every browser that
    //    implements it. (undefined or true → must confirm via probe.)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false;
    }

    // 2. Short-lived cached answer so concurrent callers share one probe.
    let now = Date.now();
    if (_cached.value !== null && (now - _cached.ts) < RESULT_TTL_MS) {
        return _cached.value;
    }
    if (_cached.inflight) return _cached.inflight;

    // 3. Confirm the positive with a guarded probe.
    _cached.inflight = (async () => {
        let online = false;
        let controller = new AbortController();
        let timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        try {
            // cache:'no-store' + the SW no-cache exemption + a cache-buster
            // query all ensure this is a real network round-trip.
            let res = await fetch(`${PROBE_URL}?_n=${Date.now()}`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });
            // The SW's offline errorResponse() is a synthetic 503. Any 2xx
            // here means the request actually reached the origin.
            online = res.ok;
        } catch (_) {
            // AbortError (timeout), TypeError (network down), SW 503 that
            // throws — all mean "treat as offline".
            online = false;
        } finally {
            clearTimeout(timer);
        }
        _cached = { value: online, ts: Date.now(), inflight: null };
        return online;
    })();

    return _cached.inflight;
}

// Force the next isOnline() call to re-probe (e.g. after an 'online'
// event fires). Cheap; just invalidates the short cache.
export function resetNetStatusCache() {
    _cached = { value: null, ts: 0, inflight: null };
}

// Keep the cache honest when the browser does fire connectivity events.
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online',  resetNetStatusCache);
    window.addEventListener('offline', () => { _cached = { value: false, ts: Date.now(), inflight: null }; });
}
