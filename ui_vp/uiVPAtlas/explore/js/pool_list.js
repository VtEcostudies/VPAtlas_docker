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

// =============================================================================
// INITIALIZE
// =============================================================================
export function initPoolList(containerId, titleId, poolSelectCallback, username=null) {
    listContainer = document.getElementById(containerId);
    titleContainer = document.getElementById(titleId);
    onPoolSelect = poolSelectCallback;
    currentUsername = username;
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
        let rows = data.rows || [];

        // Apply client-side data-type filter (Visited, Monitored, Mine, Review)
        rows = filterRowsByDataType(rows, currentUsername);

        if (titleContainer) {
            titleContainer.innerHTML = `<h5>Vernal Pools (${rows.length})</h5>`;
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
            </tr>
        </thead>
        <tbody>`;

    rows.forEach(row => {
        let poolId = row.mappedPoolId || row.poolId || '';
        let town = row.townName || row.mappedTownName || '';
        let status = row.poolStatus || row.mappedPoolStatus || '';
        let statusClass = getStatusClass(status);

        html += `<tr class="pool-row" data-pool-id="${poolId}">
            <td>${poolId}</td>
            <td>${town}</td>
            <td><span class="status-badge ${statusClass}">${status}</span></td>
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
