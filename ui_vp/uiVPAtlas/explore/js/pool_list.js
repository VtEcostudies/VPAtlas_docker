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

// Bump the version suffix when adding/changing fields the UI depends on
// so existing client caches are abandoned and a fresh fetch is triggered.
const CACHE_KEY = 'pool_cache_v2';      // { rows: [...], fingerprint: 'total:visited:monitored:review', ts: epoch }
const STALE_MS = 60 * 1000;            // check freshness after 1 min

var onPoolSelect = null;
var onPoolDeselect = null;
var listContainer = null;
var titleContainer = null;
var currentUsername = null;
var zoomToFilteredCallback = null;
var selectedPoolIds = new Set();
var focusedPoolId = null;         // currently viewed pool in summary pane

// =============================================================================
// INITIALIZE
// =============================================================================
export function initPoolList(containerId, titleId, poolSelectCallback, username=null, zoomCallback=null, poolDeselectCallback=null) {
    listContainer = document.getElementById(containerId);
    titleContainer = document.getElementById(titleId);
    onPoolSelect = poolSelectCallback;
    onPoolDeselect = poolDeselectCallback;
    currentUsername = username;
    zoomToFilteredCallback = zoomCallback;
    // Restore saved pool selections (filters loaded from storage before this call)
    if (filters.poolFinderPools && filters.poolFinderPools.length) {
        filters.poolFinderPools.forEach(id => selectedPoolIds.add(id));
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
        console.log(`pool_list: loaded ${cache.rows.length} pools from cache`);
        // Check freshness in background
        checkFreshness(cache, onRefresh);
        // Populate visit/survey caches for offline use (fire-and-forget)
        ensureCachesLoaded();
        return cache.rows;
    }

    // 2. No cache — fetch from DB (shows wait overlay)
    return await fetchAndCache(onRefresh);
}

// Build a fingerprint from stats to detect any data changes (new visits, surveys, status changes)
function statsFingerprint(s) {
    if (!s) return null;
    return [s.total_data, s.total, s.visited, s.monitored, s.review,
            s.potential, s.probable, s.confirmed, s.duplicate, s.eliminated].join(':');
}

async function fetchAndCache(onRefresh) {
    showWait();
    try {
        let data = await fetchPools(false);
        let rawRows = data.rows || [];
        let rows = deduplicateByPoolId(rawRows);

        // Get current stats fingerprint for future staleness checks
        let fingerprint = null;
        try {
            let stats = await fetchMappedPoolStats();
            if (stats.rows && stats.rows[0]) fingerprint = statsFingerprint(stats.rows[0]);
        } catch(e) {}

        await setLocal(CACHE_KEY, { rows, fingerprint, ts: Date.now() });
        console.log(`pool_list: fetched and cached ${rows.length} pools (fp: ${fingerprint})`);
        // Also refresh visit/survey caches (fire-and-forget)
        ensureCachesLoaded();
        return rows;
    } catch(err) {
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
export async function refreshPools() {
    return await fetchAndCache(null);
}

// Background freshness check: compare stats fingerprint (pool counts, visit counts, etc.)
// Any change in total/visited/monitored/review/status counts triggers a refresh.
async function checkFreshness(cache, onRefresh) {
    // Skip if checked very recently
    if (cache.ts && (Date.now() - cache.ts) < STALE_MS) return;

    try {
        let stats = await fetchMappedPoolStats();
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
    let poolMap = new Map();
    for (let row of rows) {
        let pid = row.poolId || row.mappedPoolId || '';
        if (!pid) continue;
        let existing = poolMap.get(pid);
        if (!existing) {
            // Clone and init tracking fields
            poolMap.set(pid, {
                ...row,
                _hasVisit: !!row.visitId,
                _hasSurvey: !!row.surveyId,
                _hasReview: !!row.reviewId,
                _visitIds: new Set(row.visitId ? [row.visitId] : []),
                _surveyIds: new Set(row.surveyId ? [row.surveyId] : []),
                _photoCount: row.photoCount || 0,
            });
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

        html += `<div class="pl-row pool-row" data-pool-id="${poolId}">
            <button class="pl-pin${isPinned ? ' pinned' : ''}" title="${isPinned ? 'Remove from Pool Finder' : 'Add to Pool Finder'}">
                <i class="fa fa-thumbtack"></i>
            </button>
            <span class="pl-status status-badge ${statusClass}">${status}</span>
            <span class="pl-pool-id">${poolId}</span>
            <span class="pl-town">${town}</span>
            ${counts ? `<span class="pl-counts">${counts}</span>` : ''}
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
            // Pin button → toggle Pool Finder selection
            let pinBtn = e.target.closest('.pl-pin');
            if (pinBtn) {
                e.stopPropagation();
                if (selectedPoolIds.has(poolId)) {
                    selectedPoolIds.delete(poolId);
                    pinBtn.classList.remove('pinned');
                    pinBtn.title = 'Add to Pool Finder';
                    this.classList.remove('selected');
                } else {
                    selectedPoolIds.add(poolId);
                    pinBtn.classList.add('pinned');
                    pinBtn.title = 'Remove from Pool Finder';
                    this.classList.add('selected');
                }
                putUserState(0, { poolFinderPools: [...selectedPoolIds] });
                updateSelectionCount();
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

function sortRowsBy(rows, col, asc) {
    return [...rows].sort((a, b) => {
        let va = a[col] != null ? a[col] : '';
        let vb = b[col] != null ? b[col] : '';
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
            <h5 style="margin:0;">Vernal Pools (${rows.length})</h5>
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
                // Clear from user_state so pool finder doesn't restore them
                import('/js/storage.js').then(({ setLocal, getLocal }) => {
                    getLocal('user_state').then(s => {
                        if (s) { s.poolFinderPools = []; setLocal('user_state', s); }
                    });
                });
            });
        }
        updateSelectionCount();
    }
    renderPoolTable(rows);
}
