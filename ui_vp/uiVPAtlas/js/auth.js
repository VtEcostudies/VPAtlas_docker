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

// Login - authenticate and store token + user
export async function login(username, password) {
    let res = await authenticate({ username, password });
    if (res.token) {
        await setLocal('auth_token', res.token);
        await setLocal('auth_user', res.user || res);
        return res;
    }
    throw res;
}

// Logout - clear stored auth
export async function logout() {
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
