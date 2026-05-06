/*
    storage.js - per-user-scoped IndexedDB wrapper for VPAtlas.

    Background: idb-keyval gives us a single shared key/value store. Without
    scoping, user1's drafts/tracks/filter-history were visible to user2 after
    a logout/login on the same device — see plan
    /home/jloomis/.claude/plans/design-review-discussion-here-soft-lake.md.

    Behavior:
      - getLocal/setLocal/delLocal auto-prefix the key with the current user
        ('u<id>:') or with 'anon:' when nobody is signed in.
      - SHARED_KEYS (auth, public reference caches, base-layer choice) bypass
        the prefix and live in the global namespace.
      - getKeys/getEntries return only the active scope, with prefixes stripped.
      - Raw helpers expose the unscoped store for the legacy-migration path
        in auth.js. Almost nothing else should ever touch them.

    Login wires the user with setStorageUser(id); logout clears it via
    setStorageUser(null). Page entry hooks via getUser() in auth.js.
*/
import { get, set, del, keys, entries } from '/js/idb-keyval_6.esm.js';

const SCOPED_PREFIX_RE = /^(u\d+|anon):/;

// Keys that intentionally live in the global namespace. Everything else gets
// auto-prefixed with the current user. Keep this list small; default to
// scoped so we don't accidentally leak something new.
export const SHARED_KEYS = new Set([
    'auth_token', 'auth_user',                       // auth itself; logout deletes
    'pool_cache', 'visit_cache', 'survey_cache',     // public reference data snapshots
    'parcel_cache',                                   // VCGI parcel boundaries (public)
    'map_settings',                                   // base layer / boundary / parcels — UX pref
    'user_state',                                     // filter / map-layer prefs — UX pref, no PII concern
]);

let _userId = null;

// Set by auth.js on login (with the user's id), on logout (with null), and
// idempotently from getUser() so already-loaded pages init correctly.
export function setStorageUser(id) {
    let n = (id == null) ? null : Number(id);
    _userId = (Number.isFinite(n) && n >= 0) ? n : null;
}
export function getStorageUser() { return _userId; }

function activePrefix() {
    return (_userId == null) ? 'anon:' : `u${_userId}:`;
}

function scope(key) {
    if (typeof key !== 'string') return key;
    if (SHARED_KEYS.has(key)) return key;
    if (SCOPED_PREFIX_RE.test(key)) return key;        // defensive: already scoped
    return activePrefix() + key;
}

// =============================================================================
// Public scoped API — drop-in replacements for the prior helpers.
// =============================================================================

export async function getLocal(key) {
    return await get(scope(key));
}

export async function setLocal(key, val) {
    return await set(scope(key), val);
}

export async function delLocal(key) {
    return await del(scope(key));
}

// Returns only the keys belonging to the active scope, prefix stripped.
export async function getKeys() {
    const all = await keys();
    const prefix = activePrefix();
    return all
        .filter(k => typeof k === 'string' && k.startsWith(prefix))
        .map(k => k.slice(prefix.length));
}

// Returns [key, value] pairs for the active scope only, prefix stripped.
export async function getEntries() {
    const all = await entries();
    const prefix = activePrefix();
    return all
        .filter(([k]) => typeof k === 'string' && k.startsWith(prefix))
        .map(([k, v]) => [k.slice(prefix.length), v]);
}

// =============================================================================
// Raw passthroughs — unscoped. Used by auth.js legacy migration only.
// =============================================================================

export async function getRaw(key)    { return await get(key); }
export async function setRaw(key, v) { return await set(key, v); }
export async function delRaw(key)    { return await del(key); }
export async function rawKeys()      { return await keys(); }
