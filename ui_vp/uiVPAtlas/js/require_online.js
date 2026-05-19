/*
  require_online.js — guard for pages that must have a network connection.

  Some pages (admin/profile, admin/users_admin, admin/s123_*) only make
  sense online — they fetch and write user/admin data through the API. If
  the SW caches them and the user navigates while offline, the page would
  otherwise either render a broken half-loaded shell or crash on the first
  fetch with no obvious way back. ensureOnline() short-circuits that:
  it replaces the page body with a friendly "Unavailable Offline" panel
  while leaving the <header> intact (so the profile menu and back button
  still work), and auto-reloads the page when the network returns.

  Usage:
      import { ensureOnline } from '/js/require_online.js';

      document.addEventListener('DOMContentLoaded', async () => {
          if (!ensureOnline({ pageName: 'My Profile' })) return;
          if (!(await requireAuth())) return;
          // ... normal page init
      });

  Returns true if online (caller should proceed), false if offline (caller
  should bail — the panel is already on screen).
*/

import { isOnline } from '/js/net_status.js';

// NOTE: async. Bare `navigator.onLine` was unreliable across browsers
// (captive portals / dead Wi-Fi / webviews report online when they
// aren't). Delegates to the one portable check in net_status.js. All
// callers are inside `async DOMContentLoaded` handlers — await it:
//   if (!(await ensureOnline({ pageName: '…' }))) return;
export async function ensureOnline(opts = {}) {
    if (await isOnline()) return true;

    let pageName = opts.pageName || (document.title || 'This page').replace(/^VPAtlas\s*-\s*/i, '');
    let backHref = opts.backHref || '/explore/';

    // Hide every body child except the header so the user keeps their
    // navigation affordances. Skip <script> / <style> for cleanliness.
    let header = document.querySelector('header');
    let nodes = Array.from(document.body.children);
    for (let n of nodes) {
        if (n === header) continue;
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'LINK') continue;
        if (n.tagName === 'HR' && n.classList.contains('divider-header')) continue;
        n.style.display = 'none';
    }

    // Inject the offline panel.
    let panel = document.createElement('div');
    panel.id = 'require_online_panel';
    panel.style.cssText = `
        max-width: 480px; margin: 32px auto; padding: 24px 20px;
        background: white; border: 1px solid #e2e8f0; border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        text-align: center; font-family: Georgia, sans-serif;
        color: #2c5530;
    `;
    panel.innerHTML = `
        <div style="font-size:36px; color:#c44100; margin-bottom:8px;"><i class="fa fa-wifi"></i><span style="display:inline-block; margin-left:-22px; font-size:24px; transform:translateY(-2px);">⃠</span></div>
        <h3 style="color:#7c2d12; margin:0 0 6px; font-size:20px;">Unavailable Offline</h3>
        <p style="color:#5a6c7d; margin:0 0 16px; line-height:1.4; font-size:15px;">
            ${escapeHtml(pageName)} needs a network connection.
            Reconnect to the internet, or go back to a page that works offline.
        </p>
        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button type="button" id="ro_back_btn" style="padding:10px 18px; font-size:15px; cursor:pointer; border-radius:6px; border:1px solid var(--primary-color, #2c5530); background:white; color:var(--primary-color, #2c5530); font-weight:600;">← Back</button>
            <a href="${escapeHtml(backHref)}" style="padding:10px 18px; font-size:15px; color:white; background:var(--primary-color, #2c5530); border-radius:6px; text-decoration:none; font-weight:600;">Home</a>
        </div>
        <p style="margin:14px 0 0; font-size:12px; color:#999;">
            We'll reload automatically when the connection returns.
        </p>
    `;
    document.body.appendChild(panel);

    // Wire the Back button. history.back() is best-effort; if the user
    // landed here from a fresh tab with no history, fall back to home.
    panel.querySelector('#ro_back_btn').addEventListener('click', () => {
        if (window.history.length > 1) window.history.back();
        else window.location.href = backHref;
    });

    // Auto-reload when the network comes back. Once-only listener so we
    // don't fire repeatedly on flaky connections.
    window.addEventListener('online', () => window.location.reload(), { once: true });

    return false;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
