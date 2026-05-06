/*
    auth.js - Authentication module for VPAtlas
    Handles JWT token storage, login/logout, and auth guards.
    Replaces Angular AuthenticationService + AuthGuard.
*/
import { getLocal, setLocal, delLocal,
         setStorageUser, getStorageUser, SHARED_KEYS,
         getRaw, setRaw, delRaw, rawKeys } from './storage.js';
import { authenticate, register, resetPassword } from './api.js';

const SCOPED_PREFIX_RE = /^(u\d+|anon):/;

// Get current user from stored auth blob. Also pins the storage scope so
// any subsequent getLocal/setLocal in this page session lands under the
// right user namespace — this is what makes already-logged-in page loads
// (refresh of /explore/, navigation between pages, etc.) work.
//
// Also kicks off the one-time legacy-key migration on first page load
// after the per-user-scoping deploy. Returning users (already-valid
// auth_token, never re-logged-in) would otherwise never trigger the
// migration in login() and would see their pre-deploy filter / draft /
// track data as "missing" because their reads land in an empty
// u<id>: namespace.
export async function getUser() {
    try {
        let user = await getLocal('auth_user');     // SHARED_KEYS — pre-init safe
        if (user && user.id != null) {
            if (getStorageUser() == null) setStorageUser(user.id);
            // Idempotent: per-user flag in the migrator early-returns if it
            // has already run. Awaited so the rest of the page boots in a
            // post-migration world.
            await migrateLegacyKeysToUser(user.id);
        }
        return user || null;
    } catch(err) {
        return null;
    }
}

// Check if user is logged in
export async function isLoggedIn() {
    let token = await getLocal('auth_token');
    return !!token;
}

// Login - authenticate and store token + user.
// confirmToken (optional): registration/reset/new_email token from a confirmation
// email link. Backend uses it to flip status from 'registration' to 'confirmed'.
export async function login(username, password, confirmToken=null) {
    let body = { username, password };
    if (confirmToken) body.token = confirmToken;
    let res = await authenticate(body);
    if (res.token) {
        let userObj = res.user || res;
        await setLocal('auth_token', res.token);    // SHARED — un-prefixed
        await setLocal('auth_user', userObj);       // SHARED — un-prefixed
        // Pin the storage scope BEFORE anything else reads/writes IndexedDB
        // — this is what makes per-user scoping take effect for the rest of
        // the session.
        if (userObj && userObj.id != null) {
            setStorageUser(userObj.id);
            await migrateLegacyKeysToUser(userObj.id);
        }
        // Fire-and-forget: pull this user's saved tracks from the DB into local
        // IndexedDB so they show up across devices and survive going offline.
        // Dynamic import keeps auth.js free of a top-level dep on /survey/.
        import('/survey/js/track_recorder.js')
            .then(m => m.syncFromServer())
            .catch(err => console.warn('auth.js: track sync after login failed', err));
        return res;
    }
    throw res;
}

// Logout - clear stored auth and unpin the storage scope. Per-user prefixes
// keep each user's drafts/tracks/filter state isolated on disk; nothing
// needs to be deleted on logout — the next user's reads simply land in
// their own namespace.
export async function logout() {
    await delLocal('auth_token');
    await delLocal('auth_user');
    setStorageUser(null);
}

// One-time per device: legacy un-prefixed keys (visits, tracks, user_state,
// poolfinder_*) get moved under the current user's namespace. The first
// user to log in on a pre-deploy device claims the legacy data; subsequent
// users start clean. Idempotent — guarded by a per-user migration flag so
// repeated logins are a no-op.
//
// Skip-don't-clobber: if the new u<id>: namespace already has a key (the
// user wrote something earlier this session before the migrator caught up),
// we keep the new value and just delete the legacy duplicate. This protects
// against the race where the explore page renders default-empty filters,
// the user changes one filter (writing u<id>:user_state), then we land on
// the migration — without this guard we'd overwrite their deliberate change
// with their pre-deploy state.
async function migrateLegacyKeysToUser(userId) {
    const flag = `u${userId}:_migrated_v1`;
    try {
        if (await getRaw(flag)) return;
        const all = await rawKeys();
        let moved = 0, skipped = 0;
        for (const k of all) {
            if (typeof k !== 'string') continue;
            if (SCOPED_PREFIX_RE.test(k)) continue;       // already scoped
            if (SHARED_KEYS.has(k)) continue;             // intentional global
            const target = `u${userId}:${k}`;
            const existing = await getRaw(target);
            if (existing != null) {
                // New namespace already has data → drop the legacy copy.
                await delRaw(k);
                skipped++;
                continue;
            }
            const v = await getRaw(k);
            await setRaw(target, v);
            await delRaw(k);
            moved++;
        }
        await setRaw(flag, { at: new Date().toISOString(), moved, skipped });
        if (moved || skipped) {
            console.log(`auth.js: migrated ${moved} legacy keys → u${userId}:* (skipped ${skipped} that already existed)`);
        }
    } catch (err) {
        console.warn('auth.js: legacy key migration failed', err);
    }
}

// Register new user
export async function registerUser(body) {
    return await register(body);
}

// Reset password
export async function resetUserPassword(body) {
    return await resetPassword(body);
}

// Auth guard - redirect to login if not authenticated. Also pins the storage
// scope (via getUser) so any IndexedDB reads on this protected page see
// only the current user's data.
export async function requireAuth(redirectUrl='/explore/login.html') {
    let loggedIn = await isLoggedIn();
    if (!loggedIn) {
        let returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `${redirectUrl}?returnUrl=${returnUrl}`;
        return false;
    }
    await getUser();   // idempotent setStorageUser side-effect
    return true;
}

// Get auth token for display/debug
export async function getToken() {
    return await getLocal('auth_token');
}
