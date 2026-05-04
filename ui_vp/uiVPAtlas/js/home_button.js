/*
    home_button.js — Hide the .home-button when the IMMEDIATE previous page
    was /explore/. Tracks the previous path in sessionStorage on every load.

    Uses sessionStorage as the source of truth (referrer can be wiped by
    service-worker-driven reloads on first navigation).
*/
(function() {
    const KEY = 'lastPath';
    let prev = '';
    try {
        prev = sessionStorage.getItem(KEY) || '';
        sessionStorage.setItem(KEY, window.location.pathname);
    } catch (_) {}

    function apply() {
        if (!/^\/explore\/(index\.html)?$/.test(prev)) return;
        document.querySelectorAll('.home-button').forEach(el => {
            el.style.display = 'none';
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
