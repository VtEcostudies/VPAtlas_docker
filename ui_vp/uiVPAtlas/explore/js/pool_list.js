/*
    pool_list.js - Pool list rendering and interaction for VPAtlas explore page
    ES6 module. Manages the left tri-pane with pool list table.
    Pattern from LoonWeb explore/js/signup_table.js
*/
import { fetchPools, fetchPoolPage, fetchMappedPoolStats } from './api.js';
import { showWait, hideWait } from './utils.js';
import { filters, buildSearchTerm, putUserState, filterRowsByDataType } from './url_state.js';

var onPoolSelect = null;
var listContainer = null;
var titleContainer = null;
var currentUsername = null;
var zoomToFilteredCallback = null;

// =============================================================================
// INITIALIZE
// =============================================================================
export function initPoolList(containerId, titleId, poolSelectCallback, username=null, zoomCallback=null) {
    listContainer = document.getElementById(containerId);
    titleContainer = document.getElementById(titleId);
    onPoolSelect = poolSelectCallback;
    currentUsername = username;
    zoomToFilteredCallback = zoomCallback;
}

// =============================================================================
// LOAD AND RENDER POOL LIST
// =============================================================================
export async function loadPools() {
    if (!listContainer) return [];

    showWait();
    try {
        let searchTerm = buildSearchTerm();
        let data = await fetchPools(searchTerm);
        let rawRows = data.rows || [];

        // Deduplicate: the JOIN query returns multiple rows per pool (one per visit/survey).
        // Keep one row per poolId, merging visitId/surveyId/reviewId presence from all rows.
        let rows = deduplicateByPoolId(rawRows);

        // Apply client-side data-type filter (Visited, Monitored, Mine, Review)
        rows = filterRowsByDataType(rows, currentUsername);

        if (titleContainer) {
            titleContainer.innerHTML = `<div style="display:flex; align-items:center; justify-content:space-between;">
                <h5 style="margin:0;">Vernal Pools (${rows.length})</h5>
                <button id="zoom-to-items-btn" title="Zoom map to filtered pools"
                    style="background:none; border:1px solid var(--border-color,#ccc); border-radius:4px; cursor:pointer; padding:2px 6px; font-size:14px; color:var(--text-secondary,#555);">
                    <i class="fa fa-crosshairs"></i>
                </button>
            </div>`;
            let zoomBtn = document.getElementById('zoom-to-items-btn');
            if (zoomBtn && zoomToFilteredCallback) {
                zoomBtn.addEventListener('click', zoomToFilteredCallback);
            }
        }

        renderPoolTable(rows);
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

        html += `<tr class="pool-row" data-pool-id="${poolId}">
            <td>${poolId}</td>
            <td>${town}</td>
            <td><span class="status-badge ${statusClass}">${status}</span></td>
            <td>${visits || ''}</td>
            <td>${surveys || ''}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    listContainer.innerHTML = html;

    // Add click handlers
    listContainer.querySelectorAll('.pool-row').forEach(tr => {
        tr.addEventListener('click', function() {
            let poolId = this.dataset.poolId;
            // Highlight selected row
            listContainer.querySelectorAll('.pool-row').forEach(r => r.classList.remove('selected'));
            this.classList.add('selected');
            if (onPoolSelect) onPoolSelect(poolId);
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
        let va = (a[col] || '').toString().toLowerCase();
        let vb = (b[col] || '').toString().toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    });

    renderPoolTable(rows);
}
