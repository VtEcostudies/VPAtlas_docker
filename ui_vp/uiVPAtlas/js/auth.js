/*
    auth.js - Authentication module for VPAtlas
    Handles JWT token storage, login/logout, and auth guards.
    Replaces Angular AuthenticationService + AuthGuard.

    Cross-user isolation: a wipeUserData() (see storage.js) clears all
    per-user IndexedDB keys plus the relevant localStorage / sessionStorage
    entries. The wipe fires only when a *different* user logs in than was
    last seen on this device — same-user re-login keeps drafts / tracks /
    filter state.

    The "who was last here?" check uses two sources, in order:
      1. auth_user — present when the prior session ended by tab-close (no
         explicit logout). UI code reads this for personalization.
      2. last_user_id — stashed by logout() before auth_user is cleared.
         Sentinel only; never read by UI code, so it doesn't leak the
         prior user's identity into the logged-out UX.
*/
import { getLocal, setLocal, delLocal, wipeUserData } from './storage.js';
import { authenticate, register, resetPassword } from './api.js';

const LAST_USER_ID = 'last_user_id';

// Get current user from stored auth blob
export async function getUser() {
    try {
        let user = await getLocal('auth_user');
        return user || null;
    } catch (err) {
        return null;
    }
}

// Check if user is logged in
export async function isLoggedIn() {
    let token = await getLocal('auth_token');
    return !!token;
}

// Login - authenticate, then (if a *different* user was last seen on this
// device) wipe the prior user's local data before writing the new auth
// blob. Same-user re-login leaves drafts / tracks / filter state intact.
//
// confirmToken (optional): registration/reset/new_email token from a
// confirmation email link. Backend uses it to flip status from
// 'registration' to 'confirmed'.
export async function login(username, password, confirmToken=null) {
    let body = { username, password };
    if (confirmToken) body.token = confirmToken;
    let res = await authenticate(body);
    if (res.token) {
        let userObj = res.user || res;
        // Resolve who was last here — auth_user (tab-close path) wins over
        // the logout sentinel.
        let priorId = null;
        let prior = await getLocal('auth_user');
        if (prior && prior.id != null) {
            priorId = prior.id;
        } else {
            priorId = await getLocal(LAST_USER_ID);
        }
        if (priorId != null && userObj && userObj.id != null &&
            Number(priorId) !== Number(userObj.id)) {
            await wipeUserData();
        }
        // Always clear the sentinel — either the wipe just removed it, or
        // we kept state for the same user and don't need it anymore.
        await delLocal(LAST_USER_ID);
        await setLocal('auth_token', res.token);
        await setLocal('auth_user', userObj);
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

// Logout - clear auth keys so isLoggedIn / getUser report logged-out, but
// stash the user's id in last_user_id so the next login can recognize a
// same-user re-login and skip the wipe. Drafts / tracks / filter state stay
// on disk for that path.
export async function logout() {
    let user = await getLocal('auth_user');
    if (user && user.id != null) {
        await setLocal(LAST_USER_ID, user.id);
    }
    await delLocal('auth_token');
    await delLocal('auth_user');
}

// Register new user
export async function registerUser(body) {
    return await register(body);
}

// Reset password
export async function resetUserPassword(body) {
    return await resetPassword(body);
}

// Auth guard - redirect to login if not authenticated.
export async function requireAuth(redirectUrl='/explore/login.html') {
    let loggedIn = await isLoggedIn();
    if (!loggedIn) {
        let returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        // Use replace() so the would-be-form URL doesn't sit in history under login —
        // back from login (or from the form after login) skips both and goes home.
        window.location.replace(`${redirectUrl}?returnUrl=${returnUrl}`);
        return false;
    }
    return true;
}

// Get auth token for display/debug
export async function getToken() {
    return await getLocal('auth_token');
}
