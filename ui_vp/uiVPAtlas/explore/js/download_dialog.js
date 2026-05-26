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

import { filters, filterRowsByDataType } from './url_state.js';

// appConfig is a top-level `const` in /js/config.js — a classic script loaded
// BEFORE the module bundle. It exists as a lexical global, NOT as a property
// of `window` (const/let don't attach to window). Match api.js's pattern and
// bind it via the bare identifier, not `window.appConfig`.
const config = appConfig;

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

// Each data kind's path + the query-param name it uses to filter by
// pool id. The dialog filters the POOL SET first (via the dataType radio
// applied to masterRows), then asks each CSV endpoint for that kind's
// records constrained to those pool ids. Mapped's pool-id column is
// "mappedPoolId", visit's is "visitPoolId", and so on.
const KIND_PATH = {
    mapped:  { path: 'pools/mapped/csv', poolIdCol: 'mappedPoolId' },
    visit:   { path: 'pools/visit/csv',  poolIdCol: 'visitPoolId'  },
    survey:  { path: 'survey/csv',       poolIdCol: 'surveyPoolId' },
    reviews: { path: 'review/csv',       poolIdCol: 'reviewPoolId' }
};

// Build the URL params for one (dataKind, pool-id-set) pair.
//
// Semantics: dataType (All / Mine / Review) filters the POOL SET. The
// dialog has already done that work and passes `poolIds` (an array of
// mappedPoolId strings) for Mine and Review, or `null` for All. Each
// data kind then downloads its own records for THOSE pools — status
// filter applies on top, same column (mappedPoolStatus) for every kind
// since they all JOIN vpmapped.
//
// poolIds === null  → All: no pool-id filter sent (returns every record
//                          matching the status filter).
// poolIds.length===0→ Mine/Review with zero matching pools. Caller is
//                          expected to short-circuit and not call us;
//                          we still emit a sentinel that produces an
//                          empty CSV if anyone does call.
function buildParts({ dataKind, statuses, poolIds }) {
    let parts = [`download=1`];
    statuses.forEach(s => parts.push(`mappedPoolStatus=${encodeURIComponent(s)}`));

    let { path, poolIdCol } = KIND_PATH[dataKind];
    if (Array.isArray(poolIds)) {
        if (poolIds.length === 0) {
            // Sentinel that will produce 0 rows. Should be rare — caller
            // surfaces "no pools match" before getting here.
            parts.push(`${poolIdCol}=__NO_MATCH__`);
        } else {
            poolIds.forEach(id => parts.push(`${poolIdCol}=${encodeURIComponent(id)}`));
        }
    }
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

export function openDownloadDialog(user, masterRows) {
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
                        <label data-kind="reviews"><input type="checkbox" class="dl-kind" value="reviews"> Reviews</label>
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

    let kindInputs = overlay.querySelectorAll('.dl-kind');
    let dtypeInputs = overlay.querySelectorAll('input[name="dl-dtype"]');
    let kindsNote = overlay.querySelector('#dl-kinds-note');
    let errEl = overlay.querySelector('#dl-error');

    // The "Which pools" radio filters the POOL SET. The "What data"
    // checkboxes then pick which records to include for that pool set.
    // So Review + Mapped = mapped records for the pools-needing-review
    // set (= the same pools the home page's Review filter shows);
    // Review + Visit = all visits OF those pools; etc.
    function syncDataKinds() {
        let dt = [...dtypeInputs].find(r => r.checked)?.value || 'All';
        if (dt === 'Mine') {
            kindsNote.textContent = '"Mine" filters the pool set to pools you have any role on (mapped, visited, or surveyed). Each checked data kind below downloads its records for that pool set.';
        } else if (dt === 'Review') {
            kindsNote.textContent = '"Review" filters the pool set to pools needing review — same as the home page\'s Review filter. Each checked data kind below downloads its records for that pool set.';
        } else {
            kindsNote.textContent = 'Output: one CSV file per data kind checked. GeoJSON support coming later.';
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
        let kinds = [...kindInputs].filter(cb => cb.checked).map(cb => cb.value);

        if (!kinds.length) {
            errEl.textContent = 'Pick at least one data kind to download.';
            errEl.style.display = 'block';
            return;
        }
        if (!statuses.length) {
            errEl.textContent = 'Pick at least one pool status.';
            errEl.style.display = 'block';
            return;
        }

        // Resolve the pool-set filter. Mine and Review run the same
        // filterRowsByDataType the home page uses, against masterRows
        // (deduped, _visitMap-equipped pool rows). For All, no pool-id
        // filter is sent — the CSV returns every record matching status.
        let poolIds = null;
        if (dataType === 'Mine' || dataType === 'Review') {
            let rows = Array.isArray(masterRows) ? masterRows : [];
            // Temporarily set filters.dataType so filterRowsByDataType
            // does the right thing — it reads from the module-scoped
            // `filters` object, not from a parameter.
            let savedDataType = filters.dataType;
            filters.dataType = dataType;
            try {
                let filtered = filterRowsByDataType(rows, user);
                let ids = new Set();
                filtered.forEach(r => {
                    let id = r.mappedPoolId || r.poolId;
                    if (id) ids.add(id);
                });
                poolIds = [...ids];
            } finally {
                filters.dataType = savedDataType;
            }
            if (poolIds.length === 0) {
                errEl.textContent = `No pools match the "${dataType}" filter — nothing to download.`;
                errEl.style.display = 'block';
                return;
            }
            // Soft URL-length guard. ~14 chars overhead per param + ~8
            // chars per pool ID × 4 endpoints. Above ~400 pools the URL
            // approaches nginx's default 8 KB header buffer; warn but
            // proceed.
            if (poolIds.length > 400) {
                console.warn(`[download] large pool set (${poolIds.length}) — request URL may be long.`);
            }
        }

        // Diagnostic so a stale-SW cache hit is easy to spot: if this log
        // shows poolIds: null when you've picked Mine or Review, you're
        // running the old dialog and need to hard-refresh.
        console.log('[download] dataType=%s poolIds=%s statuses=%s kinds=%s',
            dataType,
            poolIds === null ? 'null (All)' : `[${poolIds.length}] ${poolIds.slice(0, 6).join(',')}${poolIds.length > 6 ? '…' : ''}`,
            statuses.join(','),
            kinds.join(','));

        let stamp = todayStamp();
        // Trigger each download. Stagger by a short delay so browsers
        // handle the back-to-back navigations cleanly (Chrome especially
        // is happier with a small gap before the "allow multiple" prompt).
        kinds.forEach((kind, idx) => {
            let { path, parts } = buildParts({ dataKind: kind, statuses, poolIds });
            let url = `${config.api.fqdn}/${path}?${parts.join('&')}`;
            console.log('[download] →', url);
            let filename = `vpatlas_${kind}_${stamp}.csv`;
            setTimeout(() => triggerDownload(url, filename), idx * 250);
        });

        // Close after the last download has been triggered.
        setTimeout(close, kinds.length * 250 + 200);
    });
}
