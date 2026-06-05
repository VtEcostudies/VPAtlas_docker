/*
    pool_list.js - Pool list rendering and interaction for VPAtlas explore page
    ES6 module. Manages the left tri-pane with pool list table.
    Pattern from LoonWeb explore/js/signup_table.js
*/
import { fetchPools, fetchMappedPoolStats } from '/js/api.js';
import { ensureCachesLoaded } from '/js/pool_data_cache.js';
import { showWait, hideWait } from './utils.js';
import { filters, putUserState } from './url_state.js';
import { getLocal, setLocal } from '/js/storage.js';
import { isOnline } from '/js/net_status.js';
import { POOL_CACHE_KEY as CACHE_KEY } from '/js/cache_keys.js';
// Older POOL_CACHE_KEY values. When the key suffix is bumped (schema
// change), an offline user who hasn't been online since the bump has no
// data under the new key. Rather than strand them with an error, fall
// back to the most recent legacy cache. Newest-first.
const LEGACY_POOL_CACHE_KEYS = ['pool_cache_v2', 'pool_cache'];
// CACHE_KEY: see /js/cache_keys.js — bump the suffix there to invalidate
// existing client caches after schema changes. { rows, fingerprint, ts,
// shapeVersion }
const STALE_MS = 60 * 1000;            // check freshness after 1 min

// Hard cap on the cold-start /pools fetch. The endpoint returns ~98 MB; on
// poor cell the underlying fetch has no client-side timeout and can hang
// for minutes with no UI feedback (Bug 1 on iPhone). Boot path only — we
// deliberately don't touch fetchApiRoute in api.js because visit submits
// and S123 imports need their long fetch budget on slow networks.
const BOOT_FETCH_TIMEOUT_MS = 30 * 1000;

// Shape version of the dedup output stored in the pool cache. Bumped
// whenever deduplicateByPoolId adds a new synthetic field downstream code
// depends on (e.g. _lastUpdatedAt for the "Updated" sort, the photo /
// review counts, etc.). Mismatch on load → online: silently refetch;
// offline: serve the cached rows anyway (getSortVal falls back to the
// source columns). This is the sibling of the stats-fingerprint freshness
// check, but for CODE-shape changes instead of DATA-content changes — and
// avoids the locked-decision "don't bump cache keys" trap, since the
// existing cache survives and is repopulated in place.
//   v2 (2026-05-19): added _lastUpdatedAt = max(mapped, visit, review
//                    updatedAt) used by the "Updated" sort.
const POOL_CACHE_SHAPE_VERSION = 2;

var onPoolSelect = null;
var onPoolDeselect = null;
var onPinSelect = null;     // fires when a pool is pinned (single-select on the map)
var onPinDeselect = null;   // fires when the pinned pool is un-pinned
var listContainer = null;
var titleContainer = null;
var currentUsername = null;
var zoomToFilteredCallback = null;
// Single-select. Kept as a Set for backwards compat with putUserState
// (poolFinderPools is persisted as an array) and so existing iteration
// patterns still work, but only one entry is ever held at a time.
var selectedPoolIds = new Set();
var focusedPoolId = null;         // currently viewed pool in summary pane

// =============================================================================
// INITIALIZE
// =============================================================================
export function initPoolList(containerId, titleId, poolSelectCallback, username=null, zoomCallback=null, poolDeselectCallback=null, pinSelectCallback=null, pinDeselectCallback=null) {
    listContainer = document.getElementById(containerId);
    titleContainer = document.getElementById(titleId);
    onPoolSelect = poolSelectCallback;
    onPoolDeselect = poolDeselectCallback;
    onPinSelect = pinSelectCallback;
    onPinDeselect = pinDeselectCallback;
    currentUsername = username;
    zoomToFilteredCallback = zoomCallback;
    // Restore saved pool selection. Force single-select even if storage
    // somehow contains multiple ids (legacy multi-select state).
    if (filters.poolFinderPools && filters.poolFinderPools.length) {
        selectedPoolIds.add(filters.poolFinderPools[0]);
        if (filters.poolFinderPools.length > 1) {
            putUserState(0, { poolFinderPools: [...selectedPoolIds] });
        }
    }
}

// =============================================================================
// LOAD AND RENDER POOL LIST
// =============================================================================
// Load pool data: instant from IndexedDB cache, then check freshness in background.
// Returns deduplicated master rows. Caller handles all filtering.
// onRefresh callback is called if background check finds stale data and reloads.
export async function loadPools(onRefresh = null) {
    if (!listContainer) return [];

    // 1. Try cache first — instant render
    let cache = await getLocal(CACHE_KEY);
    if (cache && cache.rows && cache.rows.length) {
        let shapeOk = cache.shapeVersion === POOL_CACHE_SHAPE_VERSION;
        if (!shapeOk) {
            // CODE-shape change (new synthetic field, etc.) since this
            // cache was written. Online → silently refetch so the new
            // shape lands and downstream code (e.g. "Updated" sort)
            // works. Offline → serve the cached rows anyway; getSortVal
            // falls back to source columns for missing synthetic fields.
            if (await isOnline()) {
                console.log(`pool_list: cache shape v${cache.shapeVersion || 1} < v${POOL_CACHE_SHAPE_VERSION} — refetching`);
                return await fetchAndCache(onRefresh);
            }
            console.warn(`pool_list: cache shape v${cache.shapeVersion || 1} stale and offline — serving as-is`);
            return cache.rows;
        }
        console.log(`pool_list: loaded ${cache.rows.length} pools from cache (shape: v${POOL_CACHE_SHAPE_VERSION})`);
        // Freshness check + ensureCachesLoaded both hit the network. Only
        // do them when actually online — offline they'd throw / 503 and
        // (for ensureCachesLoaded) thrash. Cache-first render already
        // happened; staleness can wait until we're back online.
        isOnline().then(on => {
            if (!on) return;
            checkFreshness(cache, onRefresh);
            ensureCachesLoaded();
        });
        return cache.rows;
    }

    // 2. No cache under the current key. Before doing anything network,
    //    check connectivity — this is the path that has repeatedly
    //    regressed into "blank/error pool list offline".
    //    Paint a visible "Loading…" message in the list pane BEFORE the
    //    isOnline probe so the user has feedback during the (~3.5 s)
    //    probe and any subsequent fetch — Bug 1 (silent blank screen).
    renderBootLoading();
    if (!(await isOnline())) {
        // OFFLINE with no current-key cache. A POOL_CACHE_KEY bump is the
        // usual reason (the user simply hasn't been online since the new
        // build). Recover the newest legacy cache instead of erroring.
        for (let legacyKey of LEGACY_POOL_CACHE_KEYS) {
            let legacy = await getLocal(legacyKey);
            if (legacy && legacy.rows && legacy.rows.length) {
                console.warn(`pool_list: offline, no '${CACHE_KEY}' cache — serving stale '${legacyKey}' (${legacy.rows.length} pools)`);
                return legacy.rows;
            }
        }
        // Genuinely nothing cached and offline — calm message, not a
        // red error. Nothing we fetch will succeed; don't pretend.
        console.warn('pool_list: offline and no cached pools available');
        if (listContainer) {
            listContainer.innerHTML = `<div style="padding:12px; color:var(--text-secondary);">
                You're offline and no pools have been cached on this device yet.
                Connect to the internet once and the map will work offline afterward.</div>`;
        }
        return [];
    }

    // 3. Online and no cache — fetch from DB (shows wait overlay)
    return await fetchAndCache(onRefresh);
}

// Build a fingerprint from stats to detect any data changes (new visits, surveys, status changes)
function statsFingerprint(s) {
    if (!s) return null;
    return [s.total_data, s.total, s.visited, s.monitored, s.review,
            s.potential, s.probable, s.confirmed, s.duplicate, s.eliminated].join(':');
}

// Cache-busted stats fetch used ONLY for the freshness fingerprint
// (baseline write in fetchAndCache + probe in checkFreshness). The SW
// keeps /pools/mapped/stats in DATA_CACHE_PATTERNS — stale-while-
// revalidate keyed on the full URL including query string. Without a
// buster, the probe reads the same cached fingerprint that's already
// stored in our pool cache, the equality test passes, and a real
// data change never triggers a refetch. Window the buster to STALE_MS
// so we don't bloat the SW cache: at most one new entry per freshness
// window (~1/min), and the entire data cache is versioned by APP_VERSION
// so it clears on the next deploy. Other callers of
// fetchMappedPoolStats (filter_bar, pool_summary, pool_data_cache)
// keep hitting the plain URL and stay on the SW cache — offline
// behavior unchanged. getStats only reads `params.username`, so the
// extra _cb param is silently ignored server-side.
function fetchFreshStats() {
    let win = Math.floor(Date.now() / STALE_MS);
    return fetchMappedPoolStats(`_cb=${win}`);
}

// Boot-path /pools fetch with a client-side abort timeout. Mirrors the
// shape of fetchPools()/fetchApiRoute() (URL, Authorization header from
// the stored JWT, JSON response) but adds an AbortController so a slow
// cell connection can't hang the boot for minutes with no feedback. On
// timeout the AbortError surfaces to the caller's catch where we fall
// back to a legacy cache or render a Retry / Continue panel.
// Inline "Loading…" message that paints into the list pane itself, so it's
// visible at phone scale even when showWait()'s centered overlay reads as a
// tiny dot against an empty layout. Used by the cold-start path in both
// loadPools (before the isOnline probe) and fetchAndCache (before the
// fetch). Clobbered when real content renders.
function renderBootLoading() {
    if (!listContainer) return;
    listContainer.innerHTML = `<div style="padding:14px; color:var(--text-secondary);">
        <i class="fa fa-spinner fa-spin"></i> Loading pool data… on a slow connection this can take a minute.</div>`;
}

async function fetchPoolsWithTimeout(ms) {
    let url = `${appConfig.api.fqdn}/pools`;
    let ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), ms);
    try {
        let headers = { 'Content-Type': 'application/json' };
        try {
            let token = await getLocal('auth_token');
            if (token) headers.Authorization = `Bearer ${token}`;
        } catch(_) {}
        let res = await fetch(url, { method: 'GET', headers, signal: ctl.signal });
        let text = await res.text();
        if (!res.ok) {
            throw {
                name: 'APIError',
                status: res.status,
                message: `${res.status} ${res.statusText}`,
                detail: text.substring(0, 200)
            };
        }
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

async function fetchAndCache(onRefresh) {
    // Paint the in-list "Loading…" message before showWait so it's
    // visible at phone scale (the centered overlay alone reads as blank
    // on an empty page). Bug 1 fix.
    renderBootLoading();
    showWait();
    try {
        // Boot-path-only AbortController-wrapped fetch — bounded so a
        // poor cell connection doesn't hang the boot for minutes.
        let data = await fetchPoolsWithTimeout(BOOT_FETCH_TIMEOUT_MS);
        let rawRows = data.rows || [];
        let rows = deduplicateByPoolId(rawRows);

        // Get current stats fingerprint for future staleness checks.
        // fetchFreshStats() bypasses the SW data cache so the baseline
        // and the probe in checkFreshness always compare like-for-like.
        let fingerprint = null;
        try {
            let stats = await fetchFreshStats();
            if (stats.rows && stats.rows[0]) fingerprint = statsFingerprint(stats.rows[0]);
        } catch(e) {}

        await setLocal(CACHE_KEY, { rows, fingerprint, ts: Date.now(), shapeVersion: POOL_CACHE_SHAPE_VERSION });
        console.log(`pool_list: fetched and cached ${rows.length} pools (fp: ${fingerprint}, shape: v${POOL_CACHE_SHAPE_VERSION})`);
        // Also refresh visit/survey caches (fire-and-forget)
        ensureCachesLoaded();
        return rows;
    } catch(err) {
        // AbortError = our BOOT_FETCH_TIMEOUT_MS fired. On slow cell
        // this is the common case; recover gracefully instead of red-
        // erroring. Other errors (real backend failure) keep the
        // existing red-error path so we don't mask a real bug.
        let isTimeout = err && (err.name === 'AbortError' || err.message === 'The operation was aborted.');
        if (isTimeout) {
            console.warn(`pool_list: /pools fetch exceeded ${BOOT_FETCH_TIMEOUT_MS}ms timeout`);
            // Fall back to the newest legacy cache silently. checkFreshness
            // will retry the network later when conditions improve.
            for (let legacyKey of LEGACY_POOL_CACHE_KEYS) {
                let legacy = await getLocal(legacyKey);
                if (legacy && legacy.rows && legacy.rows.length) {
                    console.warn(`pool_list: timed out, serving stale '${legacyKey}' (${legacy.rows.length} pools)`);
                    return legacy.rows;
                }
            }
            // No legacy cache either — render a calm Retry / Continue panel.
            if (listContainer) {
                listContainer.innerHTML = `<div style="padding:14px; color:var(--text-secondary);">
                    Trouble reaching the server on this connection.
                    <div style="margin-top:12px; display:flex; gap:10px;">
                        <button class="btn btn-sm btn-primary" id="pool_boot_retry_btn">Retry</button>
                        <button class="btn btn-sm btn-outline-secondary" id="pool_boot_continue_btn">Continue Without Data</button>
                    </div>
                </div>`;
                let retryBtn = document.getElementById('pool_boot_retry_btn');
                let contBtn = document.getElementById('pool_boot_continue_btn');
                if (retryBtn) retryBtn.addEventListener('click', async () => {
                    let rows = await fetchAndCache(onRefresh);
                    if (onRefresh && rows && rows.length) onRefresh(rows);
                });
                if (contBtn) contBtn.addEventListener('click', () => {
                    if (listContainer) listContainer.innerHTML = `<div style="padding:12px; color:var(--text-secondary);">
                        No pool data loaded yet. Tap Retry from the menu, or reconnect and reload, to fetch.</div>`;
                });
            }
            return [];
        }
        console.error('pool_list.js=>loadPools error:', err);
        if (listContainer) {
            listContainer.innerHTML = `<div style="padding:10px; color:var(--danger-color);">
                Error loading pools: ${err.message || 'Unknown error'}</div>`;
        }
        return [];
    } finally {
        hideWait();
    }
}

// Force-refresh: bypass the cache and re-fetch from the API.
// Returns the freshly-fetched rows so the caller can update its state.
// Offline-safe: returns null without firing a fetch when offline, so the
// SW's 503 never bubbles up to the list pane as a red "Unknown error"
// (per OFFLINE_CONTRACT.md). Callers should check `isOnline()` themselves
// to give the user explicit feedback (e.g. a toast); this is just the
// defense-in-depth guard.
export async function refreshPools() {
    if (!(await isOnline())) return null;
    return await fetchAndCache(null);
}

// Background freshness check: compare stats fingerprint (pool counts, visit counts, etc.)
// Any change in total/visited/monitored/review/status counts triggers a refresh.
async function checkFreshness(cache, onRefresh) {
    // Skip if checked very recently
    if (cache.ts && (Date.now() - cache.ts) < STALE_MS) return;

    try {
        let stats = await fetchFreshStats();
        let dbFingerprint = stats.rows && stats.rows[0] ? statsFingerprint(stats.rows[0]) : null;
        if (dbFingerprint === null) return;

        if (dbFingerprint !== cache.fingerprint) {
            console.log(`pool_list: cache stale — reloading (was: ${cache.fingerprint}, now: ${dbFingerprint})`);
            let rows = await fetchAndCache(null);
            if (onRefresh && rows.length) onRefresh(rows);
        } else {
            // Fingerprint matches — update timestamp so we don't re-check immediately
            cache.ts = Date.now();
            await setLocal(CACHE_KEY, cache);
        }
    } catch(err) {
        console.warn('pool_list: freshness check failed', err);
    }
}

// =============================================================================
// DEDUPLICATE ROWS BY POOL ID
// =============================================================================
// The /pools JOIN returns multiple rows when a pool has multiple visits/surveys.
// Merge into one row per pool, preserving whether it has visits/surveys/reviews.
function deduplicateByPoolId(rows) {
    // The /pools cross-join multiplies rows when a pool has N visits and M
    // reviews. To answer "does this pool need re-review?" we need the
    // LATEST visit edit and the LATEST review across all joined rows, not
    // whichever pair happened to land in the first row. Track the max
    // timestamps explicitly; null/undefined treated as "never".
    function maxTs(a, b) {
        if (!a) return b || null;
        if (!b) return a;
        return (new Date(a).getTime() >= new Date(b).getTime()) ? a : b;
    }
    let poolMap = new Map();
    for (let row of rows) {
        let pid = row.poolId || row.mappedPoolId || '';
        if (!pid) continue;
        let existing = poolMap.get(pid);
        // Per-VISIT rollup for the Review filter. Reviews are tied to a
        // specific visit (vpreview.reviewVisitId = vpvisit.visitId), and the
        // /pools LEFT JOIN is `ON "reviewVisitId"="visitId"`, so each joined
        // row's review (if any) belongs to THAT row's visit. Build
        // _visitMap[visitId] = { lastEditedAt, hasReview,
        // maxReviewUpdatedAt, maxReviewQADate } so the filter can ask
        // "does any one visit need (re)review?" instead of comparing
        // pool-wide maxes (which could pair visit-A's edit against
        // visit-B's review).
        //
        // We track BOTH maxReviewUpdatedAt (precise ISO timestamp the review
        // row was last touched) and maxReviewQADate (the user-entered QA
        // date, no time component). The filter prefers maxReviewUpdatedAt;
        // maxReviewQADate stays for legacy cached pools whose dedupe
        // pre-dated this fix.
        function rollupVisit(target, r) {
            if (!r.visitId) return;
            let vm = target._visitMap || (target._visitMap = {});
            let v = vm[r.visitId] || (vm[r.visitId] = {
                lastEditedAt: r.lastEditedAt || null,
                hasReview: false,
                maxReviewUpdatedAt: null,
                maxReviewQADate: null,
            });
            // lastEditedAt is a per-visit column — identical across this
            // visit's joined rows; first non-null wins.
            if (!v.lastEditedAt && r.lastEditedAt) v.lastEditedAt = r.lastEditedAt;
            if (r.reviewId) {
                v.hasReview = true;
                v.maxReviewUpdatedAt = maxTs(v.maxReviewUpdatedAt, r.reviewUpdatedAt);
                v.maxReviewQADate    = maxTs(v.maxReviewQADate,    r.reviewQADate);
            }
        }

        if (!existing) {
            // Clone and init tracking fields
            let seed = {
                ...row,
                _hasVisit: !!row.visitId,
                _hasSurvey: !!row.surveyId,
                _hasReview: !!row.reviewId,
                _visitIds: new Set(row.visitId ? [row.visitId] : []),
                _surveyIds: new Set(row.surveyId ? [row.surveyId] : []),
                _photoCount: row.photoCount || 0,
                // Max-of timestamps across joined rows for this pool.
                // Retained for the debug strip; the Review filter no longer
                // uses these (it uses _visitMap, per-visit).
                _maxVisitUpdatedAt:  row.visitUpdatedAt  || null,
                _maxReviewUpdatedAt: row.reviewUpdatedAt || null,
                _maxReviewQADate:    row.reviewQADate    || null,
                _visitMap: {},
            };
            rollupVisit(seed, row);
            poolMap.set(pid, seed);
        } else {
            // Merge: mark if any joined row has a visit/survey/review
            if (row.visitId) { existing._hasVisit = true; existing._visitIds.add(row.visitId); }
            if (row.surveyId) { existing._hasSurvey = true; existing._surveyIds.add(row.surveyId); }
            if (row.reviewId) existing._hasReview = true;
            // photoCount is per-pool — same value across joined rows; preserve it
            if (row.photoCount && !existing._photoCount) existing._photoCount = row.photoCount;
            // Keep usernames from all rows for "Mine" filter
            if (row.visitUserName && !existing.visitUserName) existing.visitUserName = row.visitUserName;
            if (row.visitObserverUserName && !existing.visitObserverUserName) existing.visitObserverUserName = row.visitObserverUserName;
            if (row.surveyUserName && !existing.surveyUserName) existing.surveyUserName = row.surveyUserName;
            existing._maxVisitUpdatedAt  = maxTs(existing._maxVisitUpdatedAt,  row.visitUpdatedAt);
            existing._maxReviewUpdatedAt = maxTs(existing._maxReviewUpdatedAt, row.reviewUpdatedAt);
            existing._maxReviewQADate    = maxTs(existing._maxReviewQADate,    row.reviewQADate);
            rollupVisit(existing, row);
        }
    }
    // Replace visitId/surveyId/reviewId with merged booleans for filterRowsByDataType
    let result = [];
    for (let row of poolMap.values()) {
        row._visitCount = row._visitIds.size;
        row._surveyCount = row._surveyIds.size;
        delete row._visitIds;
        delete row._surveyIds;
        if (row._hasVisit && !row.visitId) row.visitId = true;
        if (row._hasSurvey && !row.surveyId) row.surveyId = true;
        if (row._hasReview && !row.reviewId) row.reviewId = true;
        // _lastUpdatedAt = the freshest user-meaningful change on this
        // pool — the max of the mapped, visit, and review updatedAt
        // timestamps. Powers the "Updated" sort option so a user can
        // ask "show me visited pools, freshest first" in one step. All
        // three columns are TIMESTAMPs maintained by trigger_updated_at
        // server-side; lexical ISO compare is correct ordering.
        row._lastUpdatedAt = maxTs(
            maxTs(row.mappedUpdatedAt, row._maxVisitUpdatedAt),
            row._maxReviewUpdatedAt
        );
        result.push(row);
    }
    return result;
}

// =============================================================================
// RENDER POOL LIST (card view)
// =============================================================================
function renderPoolTable(rows) {
    if (!listContainer) return;

    if (!rows.length) {
        listContainer.innerHTML = '<div style="padding:10px;">No pools found matching filters.</div>';
        return;
    }

    // Apply current sort
    let sortedRows = sortCol ? sortRowsBy(rows, sortCol, sortAsc) : rows;

    let html = `<div class="pl-sort-bar" style="display:flex; gap:8px; align-items:stretch; padding:6px 8px; border-bottom:1px solid #eee;">
        <label style="display:flex; align-items:center; font-weight:600; font-size:16px; margin:0;">Sort:</label>
        <select id="pool_sort_select" style="font-size:16px; line-height:1.2; padding:6px 10px; height:40px; box-sizing:border-box; border:1px solid var(--primary-color); border-radius:6px; color:var(--primary-color); background:white; vertical-align:middle;">
            <option value="mappedPoolId" style="font-size:16px;" ${sortCol==='mappedPoolId'?'selected':''}>Pool ID</option>
            <option value="townName" style="font-size:16px;" ${sortCol==='townName'?'selected':''}>Town</option>
            <option value="poolStatus" style="font-size:16px;" ${sortCol==='poolStatus'?'selected':''}>Status</option>
            <option value="_visitCount" style="font-size:16px;" ${sortCol==='_visitCount'?'selected':''}>Visits</option>
            <option value="_surveyCount" style="font-size:16px;" ${sortCol==='_surveyCount'?'selected':''}>Surveys</option>
            <option value="_photoCount" style="font-size:16px;" ${sortCol==='_photoCount'?'selected':''}>Photos</option>
            <option value="_lastUpdatedAt" style="font-size:16px;" ${sortCol==='_lastUpdatedAt'?'selected':''}>Updated</option>
        </select>
        <button id="pool_sort_dir" title="Toggle direction" style="font-size:20px; font-weight:bold; line-height:1; height:40px; min-width:44px; padding:0; box-sizing:border-box; border:1px solid var(--primary-color); background:white; color:var(--primary-color); border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; vertical-align:middle;">${sortAsc ? '↑' : '↓'}</button>
    </div>`;

    html += '<div class="vq-list pl-list">';
    sortedRows.forEach(row => {
        let poolId = row.mappedPoolId || row.poolId || '';
        let town = row.townName || row.mappedTownName || '';
        let status = row.poolStatus || row.mappedPoolStatus || '';
        let statusClass = getStatusClass(status);
        let visits = row._visitCount || 0;
        let surveys = row._surveyCount || 0;
        let photos = row._photoCount || row.photoCount || 0;
        let isPinned = selectedPoolIds.has(poolId);
        let countParts = [];
        if (visits) countParts.push(`${visits}v`);
        if (surveys) countParts.push(`${surveys}s`);
        if (photos) countParts.push(`<i class="fa fa-camera"></i>${photos}`);
        let counts = countParts.join(' · ');

        // Debug strip: the actual inputs the (new) per-visit Review filter
        // uses. e = newest visit.lastEditedAt across this pool's visits
        // (NULL until a user edits a visit through the app — migration 016);
        // q = newest review.reviewQADate; nr = count of visits with no
        // review. A pool is in the Review queue when nr>0 OR e>q.
        function fmtTs(ts) {
            if (!ts) return '—';
            let s = String(ts);
            return s.length >= 10 ? s.slice(0, 10) : s;
        }
        let _vm = row._visitMap || {};
        let _vmVals = Object.values(_vm);
        let dbgEdited = null, dbgQA = null, dbgNoReview = 0;
        for (let v of _vmVals) {
            if (v.lastEditedAt && (!dbgEdited || new Date(v.lastEditedAt) > new Date(dbgEdited))) dbgEdited = v.lastEditedAt;
            if (v.maxReviewQADate && (!dbgQA || new Date(v.maxReviewQADate) > new Date(dbgQA))) dbgQA = v.maxReviewQADate;
            if (!v.hasReview) dbgNoReview++;
        }
        let dbgHtml = `<span class="pl-dbg-ts" style="font-size:11px; color:#888; margin-left:4px;" `
            + `title="ed: newest visit last-edited date · qa: newest review QA date · nr: # visits with no review">`
            + `ed:${fmtTs(dbgEdited)} · qa:${fmtTs(dbgQA)} · nr:${dbgNoReview}</span>`;

        html += `<div class="pl-row pool-row" data-pool-id="${poolId}">
            <button class="pl-pin${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Remove from Pool Finder' : 'Add to Pool Finder'}">
                <i class="fa fa-thumbtack"></i>
            </button>
            <span class="pl-status status-badge ${statusClass}">${status}</span>
            <span class="pl-pool-id">${poolId}</span>
            <span class="pl-town">${town}</span>
            ${counts ? `<span class="pl-counts">${counts}</span>` : ''}
            ${dbgHtml}
        </div>`;
    });
    html += '</div>';
    listContainer.innerHTML = html;

    // Restore multi-select highlighting
    listContainer.querySelectorAll('.pool-row').forEach(el => {
        if (selectedPoolIds.has(el.dataset.poolId)) el.classList.add('selected');
        if (focusedPoolId === el.dataset.poolId) el.classList.add('focused');
    });

    // Click handlers
    listContainer.querySelectorAll('.pool-row').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', function(e) {
            let poolId = this.dataset.poolId;
            // Pin button → single-select. Pinning a new pool clears the prior
            // pin (and its map halo). Pinning the already-pinned pool clears it.
            let pinBtn = e.target.closest('.pl-pin');
            if (pinBtn) {
                e.stopPropagation();
                let wasPinned = selectedPoolIds.has(poolId);
                let priorPinned = [...selectedPoolIds][0] || null;

                // Clear previous pin (visually + state) — there is at most one.
                if (priorPinned) {
                    selectedPoolIds.delete(priorPinned);
                    listContainer.querySelectorAll(`.pool-row[data-pool-id="${CSS.escape(priorPinned)}"]`).forEach(r => {
                        r.classList.remove('selected');
                        let pb = r.querySelector('.pl-pin');
                        if (pb) { pb.classList.remove('pinned'); pb.title = 'Add to Pool Finder'; }
                    });
                    if (onPinDeselect) onPinDeselect(priorPinned);
                }

                if (!wasPinned) {
                    selectedPoolIds.add(poolId);
                    pinBtn.classList.add('pinned');
                    pinBtn.title = 'Remove from Pool Finder';
                    this.classList.add('selected');
                    if (onPinSelect) onPinSelect(poolId);
                }
                putUserState(0, { poolFinderPools: [...selectedPoolIds] });
                updateSelectionCount();
                dispatchPinChanged();
                return;
            }
            // Row click → focus
            if (focusedPoolId === poolId) {
                focusedPoolId = null;
                listContainer.querySelectorAll('.pool-row').forEach(r => r.classList.remove('focused'));
                if (onPoolDeselect) onPoolDeselect();
            } else {
                focusedPoolId = poolId;
                listContainer.querySelectorAll('.pool-row').forEach(r => {
                    r.classList.toggle('focused', r.dataset.poolId === poolId);
                });
                if (onPoolSelect) onPoolSelect(poolId);
            }
        });
    });

    // Sort controls
    let sortSelect = document.getElementById('pool_sort_select');
    let sortDirBtn = document.getElementById('pool_sort_dir');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            sortCol = sortSelect.value;
            // For date-shaped sorts the user almost always wants newest
            // first; flip to descending on the switch so they don't have
            // to immediately tap the direction toggle. Other columns
            // (Pool ID, Town, Status) keep ascending as default.
            if (/UpdatedAt$|CreatedAt$|QADate$|Date$/.test(sortCol)) sortAsc = false;
            renderPoolTable(rows);
        });
    }
    if (sortDirBtn) {
        sortDirBtn.addEventListener('click', () => {
            sortAsc = !sortAsc;
            renderPoolTable(rows);
        });
    }
}

function getStatusClass(status) {
    switch(status) {
        case 'Confirmed': return 'status-confirmed';
        case 'Probable': return 'status-probable';
        case 'Potential': return 'status-potential';
        case 'Duplicate': return 'status-duplicate';
        case 'Eliminated': return 'status-eliminated';
        default: return '';
    }
}

var sortCol = 'mappedPoolId';
var sortAsc = true;

// Pull the sort value off a row, computing synthetic date fields on the
// fly when needed. _lastUpdatedAt was added to deduplicateByPoolId, but
// rows already sitting in the IndexedDB pool cache (deduped by an older
// build) don't carry it. Per the "no cache-key suffix bumps" locked
// decision, consumers must tolerate older cached shapes — so derive it
// from the source columns, which are always present.
function sortRowsBy(rows, col, asc) {
    // Date-shaped columns: ISO-string lexical compare is correct ordering;
    // but null/empty must always sink to the bottom regardless of
    // direction, otherwise "Updated descending" floats every pool with no
    // mapped/visit/review updatedAt to the top — the opposite of useful.
    let isDateCol = /UpdatedAt$|CreatedAt$|QADate$|Date$/.test(col);
    return [...rows].sort((a, b) => {
        let va = a[col];
        let vb = b[col];
        if (isDateCol) {
            let aEmpty = va == null || va === '';
            let bEmpty = vb == null || vb === '';
            if (aEmpty && bEmpty) return 0;
            if (aEmpty) return 1;   // a sinks
            if (bEmpty) return -1;  // b sinks
            // ISO 8601 strings — lexical compare matches chronological.
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1 : -1;
            return 0;
        }
        if (va == null) va = '';
        if (vb == null) vb = '';
        if (typeof va === 'number' || typeof vb === 'number') {
            let na = Number(va) || 0;
            let nb = Number(vb) || 0;
            return asc ? na - nb : nb - na;
        }
        va = va.toString().toLowerCase();
        vb = vb.toString().toLowerCase();
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
    });
}

function updateSelectionCount() {
    let btn = document.getElementById('poolfinder-btn');
    let countEl = document.getElementById('poolfinder-count');
    if (!btn) return;
    if (selectedPoolIds.size) {
        btn.style.display = 'inline-flex';
        countEl.textContent = `Find ${selectedPoolIds.size}`;
    } else {
        btn.style.display = 'none';
    }
}

export function getSelectedPools() {
    return [...selectedPoolIds];
}

// Clear pool focus (return to summary view)
export function clearFocus() {
    focusedPoolId = null;
    if (listContainer) {
        listContainer.querySelectorAll('.pool-row').forEach(r => r.classList.remove('focused'));
    }
}

// Single-select pin id (the pool currently halo'd on the map). null when none.
export function getPinnedPoolId() {
    return [...selectedPoolIds][0] || null;
}

// Decoupled signal for "the pinned pool changed" — fired any time the
// pin set mutates (user clicked a pin, user clicked Clear All, the page
// programmatically restored a pin from saved state). Filter_bar listens
// for this to keep the "Find Pool <id>" chip in sync without having to
// poll or take a hard import dependency.
function dispatchPinChanged() {
    try {
        document.dispatchEvent(new CustomEvent('explore:pin-changed', {
            detail: { pinnedPoolId: getPinnedPoolId() }
        }));
    } catch(_) {}
}

// Programmatically clear the pin from outside this module (e.g. the
// Find Pool chip's X). Mirrors the second-click-on-pin teardown:
// state, row UI, callbacks, persistence, and the broadcast.
export function clearPin() {
    let priorPinned = [...selectedPoolIds][0] || null;
    if (!priorPinned) return;
    selectedPoolIds.delete(priorPinned);
    if (listContainer) {
        listContainer.querySelectorAll(`.pool-row[data-pool-id="${CSS.escape(priorPinned)}"]`).forEach(r => {
            r.classList.remove('selected');
            let pb = r.querySelector('.pl-pin');
            if (pb) { pb.classList.remove('pinned'); pb.title = 'Add to Pool Finder'; }
        });
    }
    if (onPinDeselect) onPinDeselect(priorPinned);
    putUserState(0, { poolFinderPools: [...selectedPoolIds] });
    updateSelectionCount();
    dispatchPinChanged();
}

export function getFocusedPoolId() {
    return focusedPoolId;
}

// Set focus from outside (e.g. map marker click)
export function setFocusedPoolId(poolId) {
    focusedPoolId = poolId;
    if (listContainer) {
        listContainer.querySelectorAll('.pool-row').forEach(r => {
            r.classList.toggle('focused', r.dataset.poolId === poolId);
        });
    }
}

// Re-render pool list from pre-filtered rows (no DB fetch)
export function renderFilteredRows(rows) {
    if (titleContainer) {
        titleContainer.innerHTML = `<div style="display:flex; align-items:center; justify-content:space-between;">
            <h5 style="margin:0;">Vernal Pools (${rows.length.toLocaleString()})</h5>
            <div id="poolfinder-btn" style="display:none; align-items:stretch; gap:0;">
                <a id="poolfinder-link" href="#" title="Open selected pools in Pool Finder"
                    style="display:flex; align-items:center; font-size:14px; font-weight:600; padding:6px 14px; background:var(--primary-light); border:1px solid var(--primary-color); border-radius:18px 0 0 18px; color:var(--primary-color); text-decoration:none; white-space:nowrap;">
                    <i class="fa fa-location-arrow"></i>&nbsp;<span id="poolfinder-count"></span>
                </a><button id="poolfinder-clear" title="Clear all selected pools"
                    style="display:flex; align-items:center; font-size:18px; font-weight:bold; padding:0 12px; border:1px solid var(--primary-color); border-left:none;
                    border-radius:0 18px 18px 0; background:white; color:var(--primary-color); cursor:pointer;">&times;</button>
            </div>
        </div>`;
        let pfLink = document.getElementById('poolfinder-link');
        if (pfLink) {
            pfLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (selectedPoolIds.size) {
                    window.location.href = `/survey/find_pool.html?pools=${[...selectedPoolIds].join(',')}`;
                }
            });
        }
        let pfClear = document.getElementById('poolfinder-clear');
        if (pfClear) {
            pfClear.addEventListener('click', () => {
                // Capture the previously-pinned pool BEFORE clearing so the
                // map can drop its halo. Single-select means at most one.
                let priorPinned = [...selectedPoolIds][0] || null;
                selectedPoolIds.clear();
                updateSelectionCount();
                // Unpin all and remove selected highlight
                if (listContainer) {
                    listContainer.querySelectorAll('.pl-pin').forEach(btn => {
                        btn.classList.remove('pinned');
                        btn.title = 'Add to Pool Finder';
                    });
                    listContainer.querySelectorAll('.pool-row').forEach(r => r.classList.remove('selected'));
                }
                if (priorPinned && onPinDeselect) onPinDeselect(priorPinned);
                // Clear from user_state so pool finder doesn't restore them
                import('/js/storage.js').then(({ setLocal, getLocal }) => {
                    getLocal('user_state').then(s => {
                        if (s) { s.poolFinderPools = []; setLocal('user_state', s); }
                    });
                });
                dispatchPinChanged();
            });
        }
        updateSelectionCount();
    }
    renderPoolTable(rows);
}
