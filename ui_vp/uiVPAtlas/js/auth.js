/*
    auth.js - Authentication module for VPAtlas
    Handles JWT token storage, login/logout, and auth guards.
    Replaces Angular AuthenticationService + AuthGuard.
*/
import { getLocal, setLocal, delLocal } from './storage.js';
import { authenticate, register, resetPassword } from './api.js';

// Get current user from stored token
export async function getUser() {
    try {
        let user = await getLocal('auth_user');
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
        await setLocal('auth_token', res.token);
        await setLocal('auth_user', res.user || res);
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

// Logout - clear stored auth and any other user's server-side track stubs.
// We deliberately keep locally-recorded tracks; they may not be uploaded yet.
export async function logout() {
    await delLocal('auth_token');
    await delLocal('auth_user');
    try {
        const m = await import('/survey/js/track_recorder.js');
        await m.clearServerStubs();
    } catch (err) {
        console.warn('auth.js: clearServerStubs on logout failed', err);
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

// Auth guard - redirect to login if not authenticated
export async function requireAuth(redirectUrl='/explore/login.html') {
    let loggedIn = await isLoggedIn();
    if (!loggedIn) {
        let returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `${redirectUrl}?returnUrl=${returnUrl}`;
        return false;
    }
    return true;
}

// Get auth token for display/debug
export async function getToken() {
    return await getLocal('auth_token');
}
