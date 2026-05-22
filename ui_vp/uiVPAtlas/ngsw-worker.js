// /ngsw-worker.js — retirement stub for the legacy Angular service worker
//
// Background: vpatlas.org migrated from the Angular app (which registered
// this filename as its service worker) to the docker rewrite (which uses
// /sw.js instead). Phones that installed the PWA while the legacy site was
// live still have THIS path registered as their service worker.
//
// On every navigation the browser does an SW update check by fetching this
// file; when it sees different bytes than the cached SW it installs this
// one. The install + activate handlers below skip waiting, clear every
// cache on the origin, and unregister this registration. After that there
// is no service worker — the next launch/navigation loads the current
// docker app straight from the network, which registers /sw.js.
//
// IMPORTANT — why this file does NOT reload the page:
// An earlier version called clients.claim() + clients.navigate() in
// `activate` to force an immediate reload into the new app. On iOS that
// unregister→navigate sequence did not terminate cleanly: the forced
// reload re-ran the SW lifecycle, which activated and navigated again, in
// a ~1-second loop that made the screen flash. A retirement stub must
// NEVER reload anything — it has no cooldown and nothing to stop a loop.
// It only unregisters; the clean app appears on the next normal launch.
//
// This file is deliberately NOT in urlsToCache.js — it must be served
// fresh from the network so the browser's update check always sees it.

self.addEventListener('install', (event) => {
    // Activate as soon as install finishes — no waiting phase.
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Drop every cache on this origin (legacy Angular SW caches etc.).
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        } catch (_) { /* caches API can throw in odd contexts; keep going */ }

        // Unregister this registration. Once it's gone, future page loads
        // have no service worker and fetch the live docker app directly.
        try { await self.registration.unregister(); } catch (_) { /* no-op */ }

        // NOTHING ELSE. No clients.claim(), no clients.navigate(), no
        // reload — those are what caused the iOS reload loop.
    })());
});

// No fetch handler — every request passes straight through to the network.
