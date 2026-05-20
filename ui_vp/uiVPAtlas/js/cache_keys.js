/*
  cache_keys.js — single source of truth for IndexedDB cache key names.

  Why this file exists: in May 2026 we shipped a bug where the writer
  (pool_list.js) bumped its key to `pool_cache_v2` to invalidate stale
  client caches after a schema change, but the reader (pool_data_cache.js)
  still looked up `pool_cache`. Online everything worked because callers
  fall back to the API; offline the fallback returned empty rows and the
  PoolFinder silently lost its target pool, its compass, and its nav line.

  Every module that reads or writes one of these caches MUST import the
  constant from here. The keep-list in storage.js MUST also reference
  POOL_CACHE_KEY etc. by import (not by string literal). Whenever you
  bump a key suffix, only this file changes.
*/

// Pool list cache. Keep stable.
//
// **Locked decision (2026-05-13):** Do NOT bump the suffix in source as a
// way to invalidate stale caches when consumers add new derived fields.
// The Reset App button on /admin/profile.html is the user-side mechanism
// for that, and the freshness-fingerprint check in pool_list.js handles
// routine data-change refresh. Bumping the key forces every active user
// on every device to refetch the full ~98 MB /pools payload, which is
// not the behavior we want for a deploy. Instead, make the **consumer**
// tolerant of older cached row schemas (fall back to single-row
// `visitUpdatedAt` / `reviewUpdatedAt`, or recompute on read).
//
// History: a v2 → v3 bump landed briefly on 2026-05-13 as a wrong fix
// for the timestamp-based Review filter showing empty; reverted same
// day in favor of a defensive fallback in `filterRowsByDataType`.
export const POOL_CACHE_KEY = 'pool_cache_v2';

// Visit and survey summary caches — used by the offline pool detail pages.
export const VISIT_CACHE_KEY = 'visit_cache';
export const SURVEY_CACHE_KEY = 'survey_cache';

// Per-tile parcel cache for the parcels overlay on PoolFinder.
export const PARCEL_CACHE_KEY = 'parcel_cache';

// Snapshot of the signed-in user's OWN server visits, taken whenever
// "My Visits and Tracks" loads online, so the list still shows their
// uploaded/server visits when offline. Shape: { userId, ts, rows }.
// Deliberately NOT in KEEP_ON_USER_CHANGE — it's per-user data and must
// be wiped when a different user signs in on the device (the snapshot
// also self-guards by storing userId and checking it on read).
export const MY_VISITS_CACHE_KEY = 'my_visits_cache';

// Map UI state — base layer choice, overlay toggles. Device-level UX
// preference, not user-specific.
export const MAP_SETTINGS_KEY = 'map_settings';

// Keys that survive a user-change wipe (logout / login as a different
// user). Reference data and device-level UX prefs only — never anything
// that's tied to a specific user (drafts, tracks, auth, filter state).
export const KEEP_ON_USER_CHANGE = [
    POOL_CACHE_KEY,
    VISIT_CACHE_KEY,
    SURVEY_CACHE_KEY,
    PARCEL_CACHE_KEY,
    MAP_SETTINGS_KEY,
];

// "UI hint" prefs — one-time onboarding dialogs and similar suppression
// flags. These are wiped by Reset App so a stuck user gets to see the
// hints again and doesn't have to reason about IndexedDB. They are NOT
// wiped on user-change (they're device-level UX, not user-specific).
//
// Add to this list when you persist a "don't show again" decision so
// Reset App keeps doing the right thing. Currently empty: the compass
// permission prompt previously lived here but iOS doesn't persist the
// DeviceOrientationEvent grant across page loads, so suppressing the
// prompt on later loads left the compass silently broken — see the
// comment block in startDeviceOrientation() in find_pool.html. The
// prompt now shows every time on iOS, which is the only way to keep
// the compass actually working.
export const UI_HINT_PREF_KEYS = [];
