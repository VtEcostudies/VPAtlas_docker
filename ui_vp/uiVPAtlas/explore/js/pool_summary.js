/*
    pool_summary.js - Right tri-pane: scope-aware summary + pool detail

    Behavior mirrors LoonWeb summary.js:
    - No pool selected: show summary for current scope (state / county / town)
    - Pool selected: show pool detail with visits and surveys

    Scope is determined by active filters:
      filters.townNames.length  => town-level summary
      filters.countyNames.length => county-level summary
      else                       => state-level summary
*/
import { fetchMappedPoolById, fetchMappedPoolStats, fetchVisitsByPool, fetchSurveysByPool, fetchPools } from './api.js';
import { formatDate } from './utils.js';
import { filters, getCurrentScope, buildSearchTerm } from './url_state.js';

var summaryContainer = null;
var summaryTitle = null;

export function initSummary(containerId, titleId) {
    summaryContainer = document.getElementById(containerId);
    summaryTitle = document.getElementById(titleId);
}

// =============================================================================
// SCOPE SUMMARY (no pool selected — show stats for current filter scope)
// =============================================================================
export async function showScopeSummary(poolRows) {
    if (!summaryContainer) return;
    let scope = getCurrentScope();

    switch (scope.type) {
        case 'town':
            showGeoSummary('Town', scope.value, poolRows);
            break;
        case 'county':
            showGeoSummary('County', scope.value, poolRows);
            break;
        case 'state':
        default:
            showStateSummary(poolRows);
            break;
    }
}

// State-level summary with global stats
async function showStateSummary(poolRows) {
    if (summaryTitle) summaryTitle.innerHTML = '<h5>Vermont Vernal Pools</h5>';

    let html = `<div class="pool-summary-card">
        <p>Select a pool from the list or map to view details.</p>`;

    // Try global stats endpoint first
    try {
        let stats = await fetchMappedPoolStats();
        if (stats.rows && stats.rows[0]) {
            let s = stats.rows[0];
            html += renderStatsTable({
                'Total Pools': s.total_data,
                'Potential': s.potential,
                'Probable': s.probable,
                'Confirmed': s.confirmed,
                'Visited': s.visited,
                'Monitored': s.monitored,
                'Eliminated': s.eliminated,
                'Duplicate': s.duplicate
            });
        }
    } catch(err) {
        // Fall back to counting from loaded rows
        if (poolRows) {
            html += renderStatsFromRows('All Pools', poolRows);
        }
    }

    html += `</div>`;
    summaryContainer.innerHTML = html;
}

// Town/County summary computed from filtered pool list
function showGeoSummary(geoType, geoNames, poolRows) {
    let label = Array.isArray(geoNames) ? geoNames.join(', ') : geoNames;
    if (summaryTitle) summaryTitle.innerHTML = `<h5>${label}</h5>`;

    let html = `<div class="pool-summary-card">
        <p>${geoType}: <strong>${label}</strong></p>
        <p>Select a pool for details.</p>`;

    if (poolRows && poolRows.length) {
        html += renderStatsFromRows(label, poolRows);
    } else {
        html += `<p style="color:var(--text-muted);">No pools in current view.</p>`;
    }

    html += `</div>`;
    summaryContainer.innerHTML = html;
}

// Compute stats from an array of pool rows
function renderStatsFromRows(label, rows) {
    let counts = { Potential: 0, Probable: 0, Confirmed: 0, Duplicate: 0, Eliminated: 0 };
    let visited = 0;
    let monitored = 0;

    rows.forEach(r => {
        let status = r.poolStatus || r.mappedPoolStatus || '';
        if (counts[status] !== undefined) counts[status]++;
        if (r.visitId) visited++;
        if (r.surveyId) monitored++;
    });

    return renderStatsTable({
        'Total Pools': rows.length,
        'Potential': counts.Potential,
        'Probable': counts.Probable,
        'Confirmed': counts.Confirmed,
        'Visited': visited,
        'Monitored': monitored
    });
}

function renderStatsTable(stats) {
    let html = `<table class="summary-stats-table">`;
    for (let [label, value] of Object.entries(stats)) {
        if (value === undefined || value === null) continue;
        let val = Number(value);
        if (val === 0 && (label === 'Duplicate' || label === 'Eliminated')) continue;
        html += `<tr><td class="stat-label">${label}</td><td class="stat-value">${val.toLocaleString()}</td></tr>`;
    }
    html += `</table>`;
    return html;
}

// =============================================================================
// POOL DETAIL (pool selected — show full detail with visits/surveys)
// =============================================================================
export async function showPoolSummary(poolId) {
    if (!summaryContainer) return;

    if (summaryTitle) summaryTitle.innerHTML = `<h5>Pool ${poolId}</h5>`;
    summaryContainer.innerHTML = '<div style="padding:10px;"><i class="fa fa-spinner fa-spin"></i> Loading...</div>';

    try {
        let data = await fetchMappedPoolById(poolId);
        let pool = data.rows ? data.rows[0] : data;

        if (!pool) {
            summaryContainer.innerHTML = '<div style="padding:10px;">Pool not found.</div>';
            return;
        }

        let html = `<div class="pool-summary-card">`;

        // Pool info table
        html += `<table class="summary-stats-table">
            <tr><td class="stat-label">Pool ID</td><td class="stat-value">${pool.mappedPoolId || poolId}</td></tr>
            <tr><td class="stat-label">Status</td><td class="stat-value">${pool.poolStatus || pool.mappedPoolStatus || ''}</td></tr>
            <tr><td class="stat-label">Town</td><td class="stat-value">${pool.townName || pool.mappedTownName || ''}</td></tr>
            <tr><td class="stat-label">County</td><td class="stat-value">${pool.countyName || pool.mappedCountyName || ''}</td></tr>
            <tr><td class="stat-label">Method</td><td class="stat-value">${pool.mappedMethod || ''}</td></tr>
            <tr><td class="stat-label">Confidence</td><td class="stat-value">${pool.mappedConfidence || ''}</td></tr>
            <tr><td class="stat-label">Observer</td><td class="stat-value">${pool.mappedObserverUserName || ''}</td></tr>
            <tr><td class="stat-label">Date</td><td class="stat-value">${formatDate(pool.mappedDateText || pool.mappedDate)}</td></tr>`;
        if (pool.mappedLatitude && pool.mappedLongitude) {
            html += `<tr><td class="stat-label">Location</td><td class="stat-value">${Number(pool.mappedLatitude).toFixed(5)}, ${Number(pool.mappedLongitude).toFixed(5)}</td></tr>`;
        }
        if (pool.mappedComments) {
            html += `<tr><td class="stat-label">Comments</td><td class="stat-value">${pool.mappedComments}</td></tr>`;
        }
        html += `</table>`;

        // Action links
        html += `<div style="margin:8px 0; display:flex; gap:8px; flex-wrap:wrap;">
            <a href="pool_view.html?poolId=${poolId}" class="summary-link">Full Detail</a>
            <a href="visit_create.html?poolId=${poolId}" class="summary-link">Add Visit</a>
            <a href="pool_create.html?poolId=${poolId}" class="summary-link">Edit Pool</a>
        </div>`;

        html += `</div>`;

        // Visits
        try {
            let visits = await fetchVisitsByPool(poolId);
            if (visits.rows && visits.rows.length) {
                html += `<div class="summary-section"><h6>Visits (${visits.rows.length})</h6>`;
                visits.rows.slice(0, 10).forEach(v => {
                    html += `<div class="summary-list-item">
                        <span>${formatDate(v.visitDate)}</span>
                        <span>${v.visitObserverUserName || v.visitUserName || ''}</span>
                    </div>`;
                });
                if (visits.rows.length > 10) {
                    html += `<div class="summary-list-item" style="color:var(--text-muted);">+${visits.rows.length - 10} more</div>`;
                }
                html += `</div>`;
            }
        } catch(err) {}

        // Surveys
        try {
            let surveys = await fetchSurveysByPool(poolId);
            if (surveys.rows && surveys.rows.length) {
                html += `<div class="summary-section"><h6>Surveys (${surveys.rows.length})</h6>`;
                surveys.rows.slice(0, 10).forEach(s => {
                    html += `<div class="summary-list-item">
                        <span>${formatDate(s.surveyDate)}</span>
                        <span>${s.surveyTypeName || ''}</span>
                    </div>`;
                });
                html += `</div>`;
            }
        } catch(err) {}

        summaryContainer.innerHTML = html;

    } catch(err) {
        summaryContainer.innerHTML = `<div style="padding:10px; color:var(--danger-color);">
            Error loading pool: ${err.message || 'Unknown error'}</div>`;
    }
}
