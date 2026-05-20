// /ngsw-worker.js — kill switch for the legacy Angular service worker
//
// Background: vpatlas.org migrated from the Angular app (which registered
// this filename as its service worker) to the docker rewrite (which uses
// /sw.js instead). Users who visited the legacy site still have the old
// Angular SW installed in their browser — it intercepts every fetch and
// serves stale Angular content from its cache, hiding the new docker app
// even though the server has changed.
//
// On every navigation, browsers do an "SW update check" by fetching this
// file and comparing it byte-for-byte with the cached version. As soon as
// they see a different file here, they install the new SW. The install +
// activate handlers below then:
//   1. delete every cache on this origin
//   2. take control of all controlled tabs
//   3. unregister this SW (so future loads go straight to the network)
//   4. reload every open tab, which then hits the live docker app fresh
//
// After that, /js/app.js registers the docker /sw.js as the new SW.
//
// This file is deliberately NOT in urlsToCache.js — we want it served
// fresh from the network so the SW update check always succeeds.

self.addEventListener('install', (event) => {
    // Skip the "waiting" phase so we activate as soon as install finishes.
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // 1. Delete every cache on this origin (Angular SW caches + anything else).
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        } catch (_) { /* caches API can throw in odd contexts; keep going */ }

        // 2. Take control of any pages still controlled by the old SW.
        try { await self.clients.claim(); } catch (_) { /* no-op */ }

        // 3. Unregister this kill-switch SW.
        try { await self.registration.unregister(); } catch (_) { /* no-op */ }

        // 4. Reload every controlled window so it picks up the new docker app.
        try {
            const windows = await self.clients.matchAll({ type: 'window' });
            for (const w of windows) {
                try { await w.navigate(w.url); } catch (_) { /* about:srcdoc etc. */ }
            }
        } catch (_) { /* no-op */ }
    })());
});

// No fetch handler — all requests pass through to the network until this
// SW unregisters itself in `activate`.
