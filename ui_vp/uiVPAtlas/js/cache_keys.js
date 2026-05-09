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

// Pool list cache. Bump the suffix when you add/remove/rename fields the
// UI reads from cached rows so existing client caches are abandoned and
// a fresh fetch is forced. Last bump: May 2026 (added _photoCount).
export const POOL_CACHE_KEY = 'pool_cache_v2';

// Visit and survey summary caches — used by the offline pool detail pages.
export const VISIT_CACHE_KEY = 'visit_cache';
export const SURVEY_CACHE_KEY = 'survey_cache';

// Per-tile parcel cache for the parcels overlay on PoolFinder.
export const PARCEL_CACHE_KEY = 'parcel_cache';

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
