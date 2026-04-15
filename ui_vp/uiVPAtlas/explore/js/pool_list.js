/*
    pool_list.js - Pool list rendering and interaction for VPAtlas explore page
    ES6 module. Manages the left tri-pane with pool list table.
    Pattern from LoonWeb explore/js/signup_table.js
*/
import { fetchPools, fetchMappedPoolStats } from '/js/api.js';
import { showWait, hideWait } from './utils.js';
import { filters, putUserState } from './url_state.js';
import { getLocal, setLocal } from '/js/storage.js';

const CACHE_KEY = 'pool_cache';         // { rows: [...], fingerprint: 'total:visited:monitored:review', ts: epoch }
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
            });
        } else {
            // Merge: mark if any joined row has a visit/survey/review
            if (row.visitId) { existing._hasVisit = true; existing._visitIds.add(row.visitId); }
            if (row.surveyId) { existing._hasSurvey = true; existing._surveyIds.add(row.surveyId); }
            if (row.reviewId) existing._hasReview = true;
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
// RENDER TABLE
// =============================================================================
function renderPoolTable(rows) {
    if (!listContainer) return;

    if (!rows.length) {
        listContainer.innerHTML = '<div style="padding:10px;">No pools found matching filters.</div>';
        return;
    }

    let html = `<table class="pool-table">
        <thead>
            <tr>
                <th style="width:28px; padding:4px;"></th>
                <th class="sortable" data-col="mappedPoolId">Pool ID</th>
                <th class="sortable" data-col="townName">Town</th>
                <th class="sortable" data-col="poolStatus">Status</th>
                <th class="sortable" data-col="_visitCount">Visits</th>
                <th class="sortable" data-col="_surveyCount">Surveys</th>
            </tr>
        </thead>
        <tbody>`;

    rows.forEach(row => {
        let poolId = row.mappedPoolId || row.poolId || '';
        let town = row.townName || row.mappedTownName || '';
        let status = row.poolStatus || row.mappedPoolStatus || '';
        let statusClass = getStatusClass(status);

        let visits = row._visitCount || 0;
        let surveys = row._surveyCount || 0;
        let checked = selectedPoolIds.has(poolId) ? ' checked' : '';

        html += `<tr class="pool-row" data-pool-id="${poolId}">
            <td style="padding:4px; text-align:center;"><input type="checkbox" class="pool-check"${checked}></td>
            <td>${poolId}</td>
            <td>${town}</td>
            <td><span class="status-badge ${statusClass}">${status}</span></td>
            <td>${visits || ''}</td>
            <td>${surveys || ''}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    listContainer.innerHTML = html;

    // Restore multi-select highlighting
    listContainer.querySelectorAll('.pool-row').forEach(tr => {
        if (selectedPoolIds.has(tr.dataset.poolId)) tr.classList.add('selected');
    });

    // Add click handlers — single click selects for summary, checkbox toggles multi-select
    listContainer.querySelectorAll('.pool-row').forEach(tr => {
        tr.addEventListener('click', function(e) {
            let poolId = this.dataset.poolId;
            // Checkbox click → toggle multi-select
            if (e.target.classList.contains('pool-check')) {
                if (selectedPoolIds.has(poolId)) {
                    selectedPoolIds.delete(poolId);
                    this.classList.remove('selected');
                } else {
                    selectedPoolIds.add(poolId);
                    this.classList.add('selected');
                }
                putUserState(0, { poolFinderPools: [...selectedPoolIds] });
                updateSelectionCount();
                return;
            }
            // Row click → toggle focus (click again to deselect)
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

    // Add sort handlers
    listContainer.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', function() {
            sortTable(rows, this.dataset.col);
        });
    });
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

var sortCol = '';
var sortAsc = true;

function sortTable(rows, col) {
    if (sortCol === col) {
        sortAsc = !sortAsc;
    } else {
        sortCol = col;
        sortAsc = true;
    }

    rows.sort((a, b) => {
        let va = a[col] != null ? a[col] : '';
        let vb = b[col] != null ? b[col] : '';
        // Numeric comparison when both values are numbers (or empty)
        if (typeof va === 'number' || typeof vb === 'number') {
            let na = Number(va) || 0;
            let nb = Number(vb) || 0;
            return sortAsc ? na - nb : nb - na;
        }
        va = va.toString().toLowerCase();
        vb = vb.toString().toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    });

    renderPoolTable(rows);
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
            <a id="poolfinder-btn" href="#" title="Open selected pools in Pool Finder"
                style="display:none; font-size:13px; padding:2px 8px; border:1px solid var(--primary-color); border-radius:4px; color:var(--primary-color); text-decoration:none; white-space:nowrap;">
                <i class="fa fa-location-arrow"></i> <span id="poolfinder-count"></span>
            </a>
        </div>`;
        let pfBtn = document.getElementById('poolfinder-btn');
        if (pfBtn) {
            pfBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (selectedPoolIds.size) {
                    window.location.href = `/survey/survey_start.html?pools=${[...selectedPoolIds].join(',')}`;
                }
            });
        }
        updateSelectionCount();
    }
    renderPoolTable(rows);
}
