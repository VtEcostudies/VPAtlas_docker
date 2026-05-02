/*
    profile_icon.js - Shared profile icon for all VPAtlas pages
    Creates a profile avatar in the header that opens an account dialog.
    Import and call setupProfileIcon(containerId) after DOMContentLoaded.
*/
import { getUser, logout } from '/js/auth.js';

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
    icon.textContent = user ? (user.handle || user.username || user.firstName || 'U')[0].toUpperCase() : '';
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
                    <div style="font-size:13px; color:var(--text-muted);">${user.email || ''}</div>
                    ${user.userrole ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${user.userrole}</div>` : ''}
                </div>`,
                [
                    { text: '\u{1F464} My Profile', value: 'profile' },
                    { text: '\u{1F4E5} My Visits', value: 'visits' },
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
            }
        } else {
            window.location.href = '/explore/login.html';
        }
    });

    container.appendChild(icon);
}
