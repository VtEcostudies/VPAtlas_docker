/*
    profile_icon.js - Shared profile icon for all VPAtlas pages
    Creates a profile avatar in the header that opens an account dialog.
    Import and call setupProfileIcon(containerId) after DOMContentLoaded.
*/
import { getUser, logout } from '/js/auth.js';

// In-app cache reset. Replicates /sw-reset.html so users running the
// standalone PWA on iOS — where there is no address bar — can still
// recover from a stuck cache or wedged service worker. Inlined (no new
// imports) so it works even if much of the app's JS failed to load.
async function resetAppCacheAndReload(persistDisable) {
    if (persistDisable) {
        try { localStorage.setItem('vpa_disable_sw', '1'); } catch(_) {}
    } else {
        try { localStorage.removeItem('vpa_disable_sw'); } catch(_) {}
    }
    try { sessionStorage.removeItem('vpa_sw_reloaded_this_session'); } catch(_) {}

    if ('serviceWorker' in navigator) {
        try {
            let regs = await navigator.serviceWorker.getRegistrations();
            for (let reg of regs) await reg.unregister();
        } catch(_) {}
    }
    if ('caches' in self) {
        try {
            let names = await caches.keys();
            for (let n of names) await caches.delete(n);
        } catch(_) {}
    }
    // Bypass HTTP cache too — a fresh start_url load gets the latest.
    window.location.href = '/explore/?_reset=' + Date.now();
}

// Inline modal (avoid dependency on explore/js/modal.js)
function showProfileModal(html, buttons) {
    return new Promise(resolve => {
        let overlay = document.createElement('div');
        overlay.className = 'vp-modal';
        let content = document.createElement('div');
        content.className = 'vp-modal-content';
        let msg = document.createElement('div');
        msg.className = 'vp-modal-message';
        msg.innerHTML = html;
        content.appendChild(msg);
        let btnDiv = document.createElement('div');
        btnDiv.className = 'vp-modal-buttons';
        buttons.forEach(b => {
            let btn = document.createElement('button');
            btn.textContent = b.text;
            btn.addEventListener('click', () => { resolve(b.value); overlay.remove(); });
            btnDiv.appendChild(btn);
        });
        content.appendChild(btnDiv);
        overlay.appendChild(content);
        overlay.addEventListener('click', e => { if (e.target === overlay) { resolve(null); overlay.remove(); } });
        document.body.appendChild(overlay);
    });
}

export async function setupProfileIcon(containerId = 'profile_container') {
    let container = document.getElementById(containerId);
    if (!container) return;

    let user = await getUser();

    let icon = document.createElement('div');
    icon.className = 'profile-icon' + (user ? ' signed-in' : '');
    if (user) {
        icon.textContent = (user.handle || user.username || user.firstName || 'U')[0].toUpperCase();
    } else {
        // Signed-out: show a person silhouette
        icon.innerHTML = '<i class="fa fa-user" aria-hidden="true"></i>';
    }
    icon.title = user ? `Signed in as ${user.handle || user.username}` : 'Sign in';

    icon.addEventListener('click', async () => {
        if (user) {
            let name = [user.firstName, user.lastName].filter(Boolean).join(' ');
            let handle = user.handle || user.username || '';
            let result = await showProfileModal(
                `<div style="text-align:center; padding:4px 0 8px;">
                    <div style="width:56px; height:56px; border-radius:50%; background:var(--primary-color); color:white;
                        font-size:24px; font-weight:600; display:flex; align-items:center; justify-content:center; margin:0 auto 8px;">
                        ${handle[0].toUpperCase()}
                    </div>
                    <div style="font-size:17px; font-weight:600;">${handle}</div>
                    ${name ? `<div style="font-size:14px; color:var(--text-secondary);">${name}</div>` : ''}
                    <div style="font-size:15px; font-weight:600; color:var(--text-secondary); margin-top:4px;">${user.email || ''}</div>
                    ${user.userrole ? `<div style="font-size:14px; font-weight:600; color:var(--text-secondary); margin-top:4px;">${user.userrole}</div>` : ''}
                </div>`,
                [
                    { text: '\u{1F464} My Profile', value: 'profile' },
                    { text: '\u{1F4E5} My Visits and Tracks', value: 'visits' },
                    { text: '\u{1F504} Reset App', value: 'reset' },
                    { text: '\u{1F6AA} Sign Out', value: 'signout' },
                ]
            );
            if (result === 'signout') {
                await logout();
                window.location.reload();
            } else if (result === 'profile') {
                window.location.href = '/admin/profile.html';
            } else if (result === 'visits') {
                window.location.href = '/explore/visit_list.html';
            } else if (result === 'reset') {
                await handleResetAppMenu();
            }
        } else {
            // Signed-out users still need a way to recover from a wedged PWA.
            let result = await showProfileModal(
                `<div style="text-align:center; padding:8px 0;">
                    <div style="font-size:17px; font-weight:600; margin-bottom:4px;">Not signed in</div>
                    <div style="font-size:14px; color:var(--text-secondary);">Sign in to record visits, or reset the app if it's stuck.</div>
                </div>`,
                [
                    { text: '\u{1F511} Sign In', value: 'signin' },
                    { text: '\u{1F504} Reset App', value: 'reset' },
                ]
            );
            if (result === 'signin') {
                window.location.href = '/explore/login.html';
            } else if (result === 'reset') {
                await handleResetAppMenu();
            }
        }
    });

    container.appendChild(icon);
}

// Confirmation + execution wrapper for the Reset App menu item. Reachable
// from the profile dropdown on every page so iOS standalone PWA users
// (no address bar) have a way out of a wedged cache.
async function handleResetAppMenu() {
    let result = await showProfileModal(
        `<div style="padding:4px 0;">
            <div style="font-size:17px; font-weight:600; margin-bottom:6px; color:#7c2d12;">Reset App?</div>
            <div style="font-size:14px; line-height:1.4;">
                This unregisters the offline service worker and clears every
                cached file. Local drafts and saved visits are kept.
                <br><br>
                The app will reload. <strong>Use it online once</strong> after
                the reset so the offline cache can repopulate.
            </div>
        </div>`,
        [
            { text: 'Cancel', value: null },
            { text: 'Reset', value: 'go' },
        ]
    );
    if (result === 'go') {
        await resetAppCacheAndReload(false);
    }
}
