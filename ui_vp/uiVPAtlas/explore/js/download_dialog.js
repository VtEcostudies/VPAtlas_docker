/*
    download_dialog.js — Admin Download Pool Data dialog.

    A modal launched from the explore hamburger menu (admin-only). Filters
    pools by data-type (All / Mine / Review) and pool status, and downloads
    Mapped / Visit / Survey records as CSV via the existing API endpoints
    /pools/mapped/csv, /pools/visit/csv, /pools/survey/csv (all support
    ?download=1 for Content-disposition: attachment).

    One CSV file per data type checked. Browsers may prompt "Allow multiple
    downloads?" the first time the user picks more than one.

    Filters in the dialog pre-populate from the current home-page filter
    state (filters.dataType + filters.poolStatuses from url_state.js); the
    admin can adjust before downloading. Town/county/pool-ID filters on
    the home page are NOT applied — by design, this dialog is the sole
    source of truth for the download's filter set in v1.

    "Review" + Mapped/Survey is disabled (no sensible interpretation —
    "needs review" is a per-visit concept). The visit endpoint accepts a
    ?visitNeedsReview=1 flag added in db_common.js + vpVisit.service.js.

    GeoJSON support is planned but not in v1.
*/

import { filters } from './url_state.js';

const config = window.appConfig;

const ALL_STATUSES = ['Potential', 'Probable', 'Confirmed', 'Duplicate', 'Eliminated'];
const ADMIN_ONLY_STATUSES = ['Duplicate', 'Eliminated'];

let styleInjected = false;
function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const css = `
        .dl-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000; padding: 16px;
        }
        .dl-modal {
            background: #fff; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,0.25);
            width: 100%; max-width: 480px; max-height: calc(100vh - 32px);
            display: flex; flex-direction: column;
        }
        .dl-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 18px; border-bottom: 1px solid #e3efe5;
        }
        .dl-header h3 { margin: 0; font-size: 18px; color: #2c5530; font-weight: 600; }
        .dl-close {
            background: none; border: 0; font-size: 24px; line-height: 1; color: #777;
            cursor: pointer; padding: 0 4px;
        }
        .dl-close:hover { color: #333; }
        .dl-body { padding: 14px 18px; overflow-y: auto; }
        .dl-section { margin-bottom: 16px; }
        .dl-section:last-child { margin-bottom: 0; }
        .dl-section-label {
            font-size: 13px; font-weight: 600; color: #2c5530;
            text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px;
        }
        .dl-row { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; }
        .dl-row label {
            display: inline-flex; align-items: center; gap: 6px;
            font-size: 14px; cursor: pointer; user-select: none;
        }
        .dl-row label.disabled { opacity: 0.45; cursor: not-allowed; }
        .dl-row input { cursor: pointer; }
        .dl-note {
            font-size: 12px; color: #777; margin-top: 6px;
        }
        .dl-footer {
            display: flex; justify-content: flex-end; gap: 10px;
            padding: 12px 18px; border-top: 1px solid #e3efe5;
        }
        .dl-btn {
            padding: 7px 16px; font-size: 14px; border-radius: 4px;
            border: 1px solid #ccc; background: #f5f5f5; cursor: pointer;
        }
        .dl-btn:hover { background: #eee; }
        .dl-btn.primary {
            background: #2c5530; border-color: #2c5530; color: #fff;
        }
        .dl-btn.primary:hover { background: #244a28; }
        .dl-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
        .dl-error {
            color: #c44100; font-size: 13px; padding: 6px 18px 0;
        }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

// Map dialog dataType + dataKind to the right (table, params) tuple.
// Returns the API path and an array of `key=value` query parts (already
// URI-encoded). The caller assembles the full URL.
function buildParts({ dataType, dataKind, statuses, user }) {
    let parts = [`download=1`];
    statuses.forEach(s => parts.push(`mappedPoolStatus=${encodeURIComponent(s)}`));

    // dataType=Mine — filter by current user's id on the relevant column
    // (matches the client-side filterRowsByDataType in url_state.js: it
    // uses userId against visitUserId / mappedUserId / surveyUserId).
    if (dataType === 'Mine' && user && user.id != null) {
        if (dataKind === 'mapped') parts.push(`mappedUserId=${user.id}`);
        if (dataKind === 'visit')  parts.push(`visitUserId=${user.id}`);
        if (dataKind === 'survey') parts.push(`surveyUserId=${user.id}`);
    }

    // dataType=Review — per-visit needs-review flag added in db_common.js
    // visitNeedsReview() + vpVisit.service.getCsv. Only meaningful for the
    // visit table; mapped/survey are not offered when Review is selected.
    if (dataType === 'Review' && dataKind === 'visit') {
        parts.push(`visitNeedsReview=1`);
    }

    let path;
    if (dataKind === 'mapped') path = 'pools/mapped/csv';
    if (dataKind === 'visit')  path = 'pools/visit/csv';
    if (dataKind === 'survey') path = 'survey/csv';
    return { path, parts };
}

function todayStamp() {
    let d = new Date();
    let mm = String(d.getMonth() + 1).padStart(2, '0');
    let dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}${mm}${dd}`;
}

// Trigger a download via an off-DOM <a> tag. The browser uses the
// `download` attribute to hint the saved filename, overriding the
// server's Content-disposition header. Some browsers ask the user to
// approve "multiple downloads" the first time a single user action
// kicks off more than one — that's expected and acceptable.
function triggerDownload(url, filename) {
    let a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch(_) {} }, 100);
}

export function openDownloadDialog(user) {
    injectStyles();

    let userIsAdmin = !!(user && user.userrole === 'admin');
    if (!userIsAdmin) return;

    // Snapshot the home page filters at open time so toggling the dialog
    // controls doesn't bleed back into the home page. Map a legacy
    // dataType (Visited / Monitored) to All — those are level chips now,
    // not data-type radios, so they have no slot in this dialog.
    let initialDataType = filters.dataType;
    if (initialDataType !== 'Mine' && initialDataType !== 'Review') initialDataType = 'All';
    let initialStatuses = Array.isArray(filters.poolStatuses) && filters.poolStatuses.length
        ? filters.poolStatuses.slice() : ALL_STATUSES.slice(0, 3);

    let overlay = document.createElement('div');
    overlay.className = 'dl-overlay';

    // Status checkboxes — admin sees all 5; everyone else would see 3,
    // but openDownloadDialog already short-circuits for non-admins above.
    let statusHtml = ALL_STATUSES.map(s => `
        <label><input type="checkbox" class="dl-status" value="${s}"
            ${initialStatuses.includes(s) ? 'checked' : ''}> ${s}</label>
    `).join('');

    overlay.innerHTML = `
        <div class="dl-modal" role="dialog" aria-modal="true" aria-labelledby="dl-title">
            <div class="dl-header">
                <h3 id="dl-title">Download Pool Data</h3>
                <button class="dl-close" aria-label="Close">&times;</button>
            </div>
            <div class="dl-body">
                <div class="dl-section">
                    <div class="dl-section-label">Which pools</div>
                    <div class="dl-row">
                        <label><input type="radio" name="dl-dtype" value="All"    ${initialDataType==='All'?'checked':''}> All</label>
                        <label><input type="radio" name="dl-dtype" value="Mine"   ${initialDataType==='Mine'?'checked':''}> Mine</label>
                        <label><input type="radio" name="dl-dtype" value="Review" ${initialDataType==='Review'?'checked':''}> Review</label>
                    </div>
                </div>
                <div class="dl-section">
                    <div class="dl-section-label">Pool status</div>
                    <div class="dl-row">${statusHtml}</div>
                </div>
                <div class="dl-section">
                    <div class="dl-section-label">What data to include</div>
                    <div class="dl-row" id="dl-kinds">
                        <label data-kind="mapped"><input type="checkbox" class="dl-kind" value="mapped" checked> Mapped Pool records</label>
                        <label data-kind="visit"><input type="checkbox" class="dl-kind" value="visit"> Atlas Visits</label>
                        <label data-kind="survey"><input type="checkbox" class="dl-kind" value="survey"> Monitoring Surveys</label>
                    </div>
                    <div class="dl-note" id="dl-kinds-note">Output: one CSV file per data type checked. GeoJSON support coming later.</div>
                </div>
            </div>
            <div class="dl-error" id="dl-error" style="display:none;"></div>
            <div class="dl-footer">
                <button class="dl-btn" id="dl-cancel">Cancel</button>
                <button class="dl-btn primary" id="dl-download">Download</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    let kindLabels = overlay.querySelectorAll('#dl-kinds label');
    let kindInputs = overlay.querySelectorAll('.dl-kind');
    let dtypeInputs = overlay.querySelectorAll('input[name="dl-dtype"]');
    let kindsNote = overlay.querySelector('#dl-kinds-note');
    let errEl = overlay.querySelector('#dl-error');

    // Review is per-visit: gray out Mapped and Survey checkboxes when
    // Review is selected, and force-check Visit. Restoring to All/Mine
    // re-enables them but leaves whatever the user had checked.
    function syncDataKinds() {
        let dt = [...dtypeInputs].find(r => r.checked)?.value || 'All';
        if (dt === 'Review') {
            kindLabels.forEach(lbl => {
                let kind = lbl.dataset.kind;
                let cb = lbl.querySelector('input');
                if (kind === 'visit') {
                    lbl.classList.remove('disabled');
                    cb.disabled = false;
                    cb.checked = true;
                } else {
                    lbl.classList.add('disabled');
                    cb.disabled = true;
                    cb.checked = false;
                }
            });
            kindsNote.textContent = 'Review means "needs review", which only applies to Atlas Visits. Mapped Pool records and Monitoring Surveys are not offered with Review.';
        } else {
            kindLabels.forEach(lbl => {
                lbl.classList.remove('disabled');
                lbl.querySelector('input').disabled = false;
            });
            kindsNote.textContent = 'Output: one CSV file per data type checked. GeoJSON support coming later.';
        }
    }
    syncDataKinds();
    dtypeInputs.forEach(r => r.addEventListener('change', syncDataKinds));

    function close() {
        try { document.body.removeChild(overlay); } catch(_) {}
    }
    overlay.querySelector('.dl-close').addEventListener('click', close);
    overlay.querySelector('#dl-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });

    overlay.querySelector('#dl-download').addEventListener('click', () => {
        errEl.style.display = 'none';
        let dataType = [...dtypeInputs].find(r => r.checked)?.value || 'All';
        let statuses = [...overlay.querySelectorAll('.dl-status:checked')].map(cb => cb.value);
        let kinds = [...kindInputs].filter(cb => cb.checked && !cb.disabled).map(cb => cb.value);

        if (!kinds.length) {
            errEl.textContent = 'Pick at least one data type to download.';
            errEl.style.display = 'block';
            return;
        }
        if (!statuses.length) {
            errEl.textContent = 'Pick at least one pool status.';
            errEl.style.display = 'block';
            return;
        }

        let stamp = todayStamp();
        // Trigger each download. Stagger by a short delay so browsers
        // handle the back-to-back navigations cleanly (Chrome especially
        // is happier with a small gap before the "allow multiple" prompt).
        kinds.forEach((kind, idx) => {
            let { path, parts } = buildParts({ dataType, dataKind: kind, statuses, user });
            let url = `${config.api.fqdn}/${path}?${parts.join('&')}`;
            let filename = `vpatlas_${kind}_${stamp}.csv`;
            setTimeout(() => triggerDownload(url, filename), idx * 250);
        });

        // Close after the last download has been triggered.
        setTimeout(close, kinds.length * 250 + 200);
    });
}
