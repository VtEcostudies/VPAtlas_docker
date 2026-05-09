/*
    storage.js — IndexedDB wrapper for VPAtlas (idb-keyval).

    Cross-user isolation strategy: logging out as user1 and in as user2 is
    treated as a fresh install on this device. wipeUserData() (called by
    auth.js on logout AND on a login where the user differs from the prior
    auth_user) clears every IDB key except the explicit keep-list of public
    reference data + device-level UX prefs. Same isolation guarantee as
    per-user key prefixing, far less code.
*/
import { get, set, del, keys, entries } from '/js/idb-keyval_6.esm.js';
import { KEEP_ON_USER_CHANGE as KEEP_LIST } from '/js/cache_keys.js';

export async function getLocal(key)    { return await get(key); }
export async function setLocal(key, v) { return await set(key, v); }
export async function delLocal(key)    { return await del(key); }
export async function getKeys()        { return await keys(); }
export async function getEntries()     { return await entries(); }

// Keys that survive a user-change wipe. Sourced from /js/cache_keys.js so
// the keep-list can never drift from the actual cache key constants.
// Anything NOT in this list gets cleared on logout / user-change login —
// drafts, tracks, filter state, last-known location, auth itself.
const KEEP_ON_USER_CHANGE = new Set(KEEP_LIST);

// Wipe local-device state on user change. Auth keys (auth_token, auth_user)
// are NOT in the keep-list — callers wipe first, then write the new auth
// blob. localStorage and sessionStorage are also cleared of the bits we
// know are tied to the prior session.
export async function wipeUserData() {
    try {
        const all = await keys();
        for (const k of all) {
            if (typeof k === 'string' && KEEP_ON_USER_CHANGE.has(k)) continue;
            await del(k);
        }
    } catch (err) {
        console.warn('storage.js: wipeUserData (idb) failed', err);
    }
    // The only user-level localStorage pref (set by /survey/js/visit_sync.js).
    try { localStorage.removeItem('allowCellularPhotoUpload'); } catch (_) {}
    // sessionStorage holds the bandwidth-probe cache, navigation hints, and
    // admin import scratch state — all transient and cheap to re-derive.
    try { sessionStorage.clear(); } catch (_) {}
}
