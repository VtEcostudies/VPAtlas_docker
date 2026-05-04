/*
    home_button.js — Hide the .home-button when the previous page was /explore/.
    Rationale: if the X (back) button already returns home, a separate Home
    button is redundant. We rely on document.referrer to detect that.
*/
(function() {
    function isHomeReferrer() {
        let ref = document.referrer || '';
        if (!ref) return false;
        try {
            let u = new URL(ref);
            // Only same-origin counts as "came from home" — cross-site referrers
            // mean the user followed a link in and a Home button is useful.
            if (u.origin !== window.location.origin) return false;
            // /explore/ or /explore/index.html, with optional query/hash
            return /^\/explore\/(index\.html)?$/.test(u.pathname);
        } catch (_) {
            return false;
        }
    }
    function apply() {
        if (!isHomeReferrer()) return;
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
