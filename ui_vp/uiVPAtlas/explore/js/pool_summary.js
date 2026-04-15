/*
    pool_summary.js - Right tri-pane: scope-aware + data-type-aware summary

    Shows context-appropriate summary based on:
    1. Data type: All, Visited, Monitored, Mine, Review
    2. Geo scope: State, County, Town (from filter tokens)
    3. Pool selection: full detail when a specific pool is clicked

    All summaries are computed from the same filtered rows that drive the
    pool list and map — ensuring all three panes always agree.
*/
import { fetchMappedPoolById, fetchMappedPoolStats, fetchVisitsByPool, fetchSurveysByPool } from '/js/api.js';
import { getUser } from '/js/auth.js';
import { formatDate } from './utils.js';
import { filters, getCurrentScope } from './url_state.js';

var summaryContainer = null;
var summaryTitle = null;

export function initSummary(containerId, titleId) {
    summaryContainer = document.getElementById(containerId);
    summaryTitle = document.getElementById(titleId);
}

// =============================================================================
// SCOPE + DATA-TYPE SUMMARY (no pool selected)
// =============================================================================
export async function showScopeSummary(poolRows) {
    if (!summaryContainer) return;
    let scope = getCurrentScope();
    let dataType = filters.dataType || 'All';

    // Build title from scope + data type
    let scopeLabel;
    switch (scope.type) {
        case 'town': scopeLabel = Array.isArray(scope.value) ? scope.value.join(', ') : scope.value; break;
        case 'county': scopeLabel = Array.isArray(scope.value) ? scope.value.join(', ') : scope.value; break;
        default: scopeLabel = 'Vermont';
    }
    let dataLabel = dataType !== 'All' ? ` — ${dataType}` : '';

    if (summaryTitle) {
        summaryTitle.innerHTML = `<h5>${scopeLabel}${dataLabel}</h5>`;
    }

    let html = `<div class="pool-summary-card">`;

    // Description of what's being shown
    let desc = describeCurrentView(scope, dataType, poolRows);
    html += `<p style="font-size:14px; color:var(--text-secondary);">${desc}</p>`;

    // Stats from the filtered rows (these match the list exactly)
    if (poolRows && poolRows.length) {
        html += renderStatsFromRows(poolRows, dataType);
    } else {
        html += `<p style="color:var(--text-muted);">No pools match the current filters.</p>`;
    }

    // If state-level "All" view, also show global stats from the API
    if (scope.type === 'state' && dataType === 'All') {
        try {
            let stats = await fetchMappedPoolStats();
            if (stats.rows && stats.rows[0]) {
                let s = stats.rows[0];
                html += `<div style="margin-top:10px; padding-top:8px; border-top:1px solid #eee;">
                    <h6 style="font-size:13px; color:var(--text-secondary);">Database Totals</h6>`;
                html += renderStatsTable({
                    'All Pools (incl. Dup/Elim)': s.total_data,
                    'Potential': s.potential,
                    'Probable': s.probable,
                    'Confirmed': s.confirmed,
                    'Visited': s.visited,
                    'Monitored': s.monitored,
                });
                html += `</div>`;
            }
        } catch(err) {}
    }

    html += `<p style="margin-top:10px; font-size:13px; color:var(--text-muted);">Select a pool from the list or map for details.</p>`;

    // "+ New Pool" button for logged-in users
    let user = await getUser();
    if (user) {
        html += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid #eee;">
            <a href="/survey/visit_create.html" class="summary-link" style="font-size:14px; padding:6px 14px;">
                <i class="fa fa-plus" style="margin-right:4px;"></i> New Pool
            </a>
        </div>`;
    }

    html += `</div>`;
    summaryContainer.innerHTML = html;
}

function describeCurrentView(scope, dataType, rows) {
    let count = rows ? rows.length : 0;

    // Geographic scope
    let geoDesc = scope.type === 'state' ? 'Statewide'
        : `in ${Array.isArray(scope.value) ? scope.value.join(', ') : scope.value}`;

    // Status — derived from rows actually present
    let statusDesc = '';
    let allStatuses = ['Potential', 'Probable', 'Confirmed', 'Duplicate', 'Eliminated'];
    if (rows && rows.length) {
        let present = new Set();
        rows.forEach(r => { let s = r.poolStatus || r.mappedPoolStatus || ''; if (s) present.add(s); });
        let activeStatuses = allStatuses.filter(s => present.has(s));
        if (activeStatuses.length && activeStatuses.length < allStatuses.length) {
            statusDesc = activeStatuses.join(', ');
        }
    }

    // Survey level — derived from rows actually present
    let levelDesc = '';
    if (rows && rows.length) {
        let hasVisit = false, hasSurvey = false, hasMapped = false;
        rows.forEach(r => {
            if (r.surveyId || r._hasSurvey) hasSurvey = true;
            else if (r.visitId || r._hasVisit) hasVisit = true;
            else hasMapped = true;
        });
        let levels = [];
        if (hasMapped) levels.push('Mapped');
        if (hasVisit) levels.push('Visited');
        if (hasSurvey) levels.push('Monitored');
        if (levels.length && levels.length < 3) {
            levelDesc = levels.join(', ');
        }
    }

    // Data type qualifier
    let typeDesc = '';
    switch (dataType) {
        case 'Visited':   typeDesc = 'with Atlas Visits'; break;
        case 'Monitored': typeDesc = 'with Monitoring Surveys'; break;
        case 'Mine':      typeDesc = 'associated with your account'; break;
        case 'Review':    typeDesc = 'needing review'; break;
    }

    // Build: "114 Potential pools Statewide with Atlas Visits"
    // Parts: count + [status] + "pools" + geo + [level] + [type]
    let parts = [count.toLocaleString()];
    if (statusDesc) parts.push(statusDesc);
    parts.push('pools');
    parts.push(geoDesc);
    if (levelDesc) parts.push(`(${levelDesc})`);
    if (typeDesc) parts.push(typeDesc);

    return parts.join(' ');
}

// Compute summary stats from the filtered rows
function renderStatsFromRows(rows, dataType) {
    let counts = { Potential: 0, Probable: 0, Confirmed: 0, Duplicate: 0, Eliminated: 0 };
    let withVisits = 0;
    let withSurveys = 0;
    let withReviews = 0;

    rows.forEach(r => {
        let status = r.poolStatus || r.mappedPoolStatus || '';
        if (counts[status] !== undefined) counts[status]++;
        if (r.visitId || r._hasVisit) withVisits++;
        if (r.surveyId || r._hasSurvey) withSurveys++;
        if (r.reviewId || r._hasReview) withReviews++;
    });

    let stats = { 'Pools Shown': rows.length };

    // Always show status breakdown
    if (counts.Confirmed) stats['Confirmed'] = counts.Confirmed;
    if (counts.Probable) stats['Probable'] = counts.Probable;
    if (counts.Potential) stats['Potential'] = counts.Potential;
    if (counts.Duplicate) stats['Duplicate'] = counts.Duplicate;
    if (counts.Eliminated) stats['Eliminated'] = counts.Eliminated;

    // Show cross-cutting counts depending on data type
    if (dataType === 'All') {
        stats['With Visits'] = withVisits;
        stats['With Surveys'] = withSurveys;
    } else if (dataType === 'Visited') {
        stats['Also Monitored'] = withSurveys;
        stats['Reviewed'] = withReviews;
    } else if (dataType === 'Monitored') {
        stats['Also Visited'] = withVisits;
    } else if (dataType === 'Review') {
        stats['Visited (no review)'] = rows.length;
    }

    return renderStatsTable(stats);
}

function renderStatsTable(stats) {
    let html = `<table class="summary-stats-table">`;
    for (let [label, value] of Object.entries(stats)) {
        if (value === undefined || value === null) continue;
        let val = Number(value);
        html += `<tr><td class="stat-label">${label}</td><td class="stat-value">${val.toLocaleString()}</td></tr>`;
    }
    html += `</table>`;
    return html;
}

// =============================================================================
// POOL DETAIL (pool selected)
// =============================================================================
export async function showPoolSummary(poolId, onBack = null) {
    if (!summaryContainer) return;

    if (summaryTitle) {
        summaryTitle.innerHTML = `<a href="#" id="summary_back" title="Back to summary" style="display:flex; align-items:center; gap:8px; text-decoration:none; color:inherit; cursor:pointer;">
            <i class="fa fa-arrow-left" style="font-size:14px; color:var(--primary-color);"></i>
            <h5 style="margin:0;">Pool ${poolId}</h5>
        </a>`;
        let backBtn = document.getElementById('summary_back');
        if (backBtn) backBtn.addEventListener('click', (e) => { e.preventDefault(); if (onBack) onBack(); });
    }
    summaryContainer.innerHTML = '<div style="padding:10px;"><i class="fa fa-spinner fa-spin"></i> Loading...</div>';

    try {
        let data = await fetchMappedPoolById(poolId);
        let pool = data.rows ? data.rows[0] : data;

        if (!pool) {
            summaryContainer.innerHTML = '<div style="padding:10px;">Pool not found.</div>';
            return;
        }

        let html = `<div class="pool-summary-card">`;

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

        html += `<div style="margin:8px 0; display:flex; gap:8px; flex-wrap:wrap;">
            <a href="pool_view.html?poolId=${poolId}" class="summary-link">Full Detail</a>
            <a href="/survey/survey_start.html?poolId=${poolId}" class="summary-link">Find Pool</a>
            <a href="/survey/visit_create.html?poolId=${poolId}" class="summary-link">+ Atlas Visit</a>
            <a href="/survey/survey_create.html?poolId=${poolId}" class="summary-link">+ Monitoring Survey</a>
        </div>`;
        html += `</div>`;

        // Visits
        try {
            let visits = await fetchVisitsByPool(poolId);
            let visitRows = visits.rows || (Array.isArray(visits) ? visits : []);
            if (visitRows.length) {
                html += `<div class="summary-section"><h6>Visits (${visitRows.length})</h6>`;
                visitRows.slice(0, 10).forEach(v => {
                    html += `<a href="visit_view.html?visitId=${v.visitId}" class="summary-list-item" style="text-decoration:none; color:inherit;">
                        <span>${formatDate(v.visitDate)}</span>
                        <span>${v.visitObserverUserName || v.visitUserName || ''}</span>
                    </a>`;
                });
                if (visitRows.length > 10) {
                    html += `<div class="summary-list-item" style="color:var(--text-muted);">+${visitRows.length - 10} more</div>`;
                }
                html += `</div>`;
            }
        } catch(err) {}

        // Surveys
        try {
            let surveys = await fetchSurveysByPool(poolId);
            let surveyRows = surveys.rows || (Array.isArray(surveys) ? surveys : []);
            if (surveyRows.length) {
                html += `<div class="summary-section"><h6>Surveys (${surveyRows.length})</h6>`;
                surveyRows.slice(0, 10).forEach(s => {
                    html += `<a href="survey_view.html?surveyId=${s.surveyId}" class="summary-list-item" style="text-decoration:none; color:inherit;">
                        <span>${formatDate(s.surveyDate)}</span>
                        <span>${s.surveyTypeName || ''}</span>
                        <span>${s.surveyUserLogin || ''}</span>
                    </a>`;
                });
                if (surveyRows.length > 10) {
                    html += `<div class="summary-list-item" style="color:var(--text-muted);">+${surveyRows.length - 10} more</div>`;
                }
                html += `</div>`;
            }
        } catch(err) {}

        summaryContainer.innerHTML = html;

    } catch(err) {
        summaryContainer.innerHTML = `<div style="padding:10px; color:var(--danger-color);">
            Error loading pool: ${err.message || 'Unknown error'}</div>`;
    }
}
