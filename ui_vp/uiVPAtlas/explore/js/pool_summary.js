/*
    pool_summary.js - Right tri-pane: scope-aware + data-type-aware summary

    Shows context-appropriate summary based on:
    1. Data type: All, Visited, Monitored, Mine, Review
    2. Geo scope: State, County, Town (from filter tokens)
    3. Pool selection: full detail when a specific pool is clicked

    All summaries are computed from the same filtered rows that drive the
    pool list and map — ensuring all three panes always agree.
*/
import { fetchMappedPoolById, fetchMappedPoolStats, fetchVisitsByPool, fetchVisitPhotos, fetchSurveysByPool } from '/js/api.js';
import { getPoolById, getVisitsByPoolId, getSurveysByPoolId } from '/js/pool_data_cache.js';
import { getUser } from '/js/auth.js';
import { formatDate } from './utils.js';
import { getLocalVisitCount } from '/survey/js/visit_queue_ui.js';
import { filters, getCurrentScope } from './url_state.js';
import { prefetchParcelsNear, getParcelBySPAN, getCachedParcels } from '/js/parcels.js';

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
        let data;
        try { data = await fetchMappedPoolById(poolId); }
        catch(e) { data = await getPoolById(poolId); }
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

        // Landowner info from parcel layer
        let lat = parseFloat(pool.mappedLatitude || pool.latitude);
        let lng = parseFloat(pool.mappedLongitude || pool.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
            html += await renderParcelInfo(lat, lng);
        }

        // Check if user can add monitoring surveys (admin/monitor + pool already monitored)
        let user = await getUser();
        let isMonitor = user && (user.userrole === 'admin' || user.userrole === 'monitor');
        let surveyData = null;
        try { surveyData = await fetchSurveysByPool(poolId); }
        catch(err) { try { surveyData = await getSurveysByPoolId(poolId); } catch(e) {} }
        let surveyRows = surveyData ? (surveyData.rows || (Array.isArray(surveyData) ? surveyData : [])) : [];
        let canSurvey = isMonitor && surveyRows.length > 0;

        html += `<div style="margin:8px 0; display:flex; gap:8px; flex-wrap:wrap;">
            <a href="pool_view.html?poolId=${poolId}" class="summary-link">Full Detail</a>
            <a href="/survey/find_pool.html?poolId=${poolId}" class="summary-link">Find Pool</a>
            <a href="/survey/visit_create.html?poolId=${poolId}" class="summary-link">+ Atlas Visit</a>
            ${canSurvey ? `<a href="/survey/survey_create.html?poolId=${poolId}" class="summary-link">+ Monitoring Survey</a>` : ''}
        </div>`;
        html += `</div>`;

        // Visits
        let visitRows = [];
        try {
            let visits;
            try { visits = await fetchVisitsByPool(poolId); }
            catch(e) { visits = await getVisitsByPoolId(poolId); }
            visitRows = visits.rows || (Array.isArray(visits) ? visits : []);
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

        // Photo counts by type
        if (visitRows.length) {
            try {
                let results = await Promise.all(
                    visitRows.map(v => fetchVisitPhotos(v.visitId).catch(() => []))
                );
                let allPhotos = results.flat().filter(p => p && p.visitPhotoSpecies);
                if (allPhotos.length) {
                    let byType = {};
                    allPhotos.forEach(p => {
                        let t = p.visitPhotoSpecies;
                        byType[t] = (byType[t] || 0) + 1;
                    });
                    html += `<div class="summary-section"><h6><i class="fa fa-camera" style="margin-right:4px;"></i>Photos (${allPhotos.length})</h6>`;
                    html += `<table class="summary-stats-table">`;
                    for (let [type, count] of Object.entries(byType)) {
                        html += `<tr><td class="stat-label">${type}</td><td class="stat-value">${count}</td></tr>`;
                    }
                    html += `</table></div>`;
                }
            } catch(err) {}
        }

        // Local (unsaved) visits
        try {
            let localCounts = await getLocalVisitCount(poolId);
            if (localCounts.total > 0) {
                let label = localCounts.pending > 0
                    ? `${localCounts.total} local (${localCounts.pending} pending upload)`
                    : `${localCounts.total} local`;
                html += `<div class="summary-section">
                    <div style="display:flex; align-items:center; gap:6px; font-size:13px; color:#e65100;">
                        <i class="fa fa-inbox"></i> ${label}
                    </div>
                    <div id="local_visits_${poolId}" style="margin-top:4px;"></div>
                </div>`;
            }
        } catch(err) {}

        // Surveys (already fetched above for canSurvey check)
        try {
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

        // Render local visit queue into its container (after innerHTML is set)
        let localContainer = document.getElementById(`local_visits_${poolId}`);
        if (localContainer) {
            let { renderVisitQueue } = await import('/survey/js/visit_queue_ui.js');
            await renderVisitQueue(localContainer, { poolId, showHeader: false, compact: true });
        }

    } catch(err) {
        summaryContainer.innerHTML = `<div style="padding:10px; color:var(--danger-color);">
            Error loading pool: ${err.message || 'Unknown error'}</div>`;
    }
}

// =============================================================================
// PARCEL / LANDOWNER INFO
// =============================================================================

/** Find parcel at lat/lng from cache, or fetch nearby parcels first */
async function renderParcelInfo(lat, lng) {
    // Try to find parcel in cache via point-in-polygon
    let parcel = findParcelAtPoint(lng, lat);

    // If not cached, fetch parcels near this pool and try again
    if (!parcel) {
        try {
            await prefetchParcelsNear(lat, lng);
            parcel = findParcelAtPoint(lng, lat);
        } catch (e) {}
    }

    if (!parcel) return '';

    let p = parcel.properties || {};
    let ownerName = [p.OWNER1, p.OWNER2].filter(Boolean).join(', ');
    let html = `<div class="summary-section" style="margin-top:8px; padding-top:8px; border-top:1px solid #eee;">
        <h6 style="font-size:13px; color:var(--text-secondary);"><i class="fa fa-home" style="margin-right:4px;"></i>Landowner</h6>
        <table class="summary-stats-table">`;
    if (ownerName) html += `<tr><td class="stat-label">Owner</td><td class="stat-value">${ownerName}</td></tr>`;
    if (p.E911ADDR) html += `<tr><td class="stat-label">Address</td><td class="stat-value">${p.E911ADDR}</td></tr>`;
    if (p.TNAME || p.TOWN) html += `<tr><td class="stat-label">Town</td><td class="stat-value">${p.TNAME || p.TOWN}</td></tr>`;
    if (p.ACRESGL) html += `<tr><td class="stat-label">Acres</td><td class="stat-value">${p.ACRESGL.toFixed(1)}</td></tr>`;
    html += `</table></div>`;
    return html;
}

/** Ray-casting point-in-polygon against all cached parcels */
function findParcelAtPoint(x, y) {
    let parcels = getCachedParcels();
    for (let feature of parcels) {
        if (pointInFeature(x, y, feature)) return feature;
    }
    return null;
}

function pointInFeature(x, y, feature) {
    let geom = feature.geometry;
    if (!geom) return false;
    if (geom.type === 'Polygon') {
        return pointInRings(x, y, geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
        for (let poly of geom.coordinates) {
            if (pointInRings(x, y, poly)) return true;
        }
    }
    return false;
}

function pointInRings(x, y, rings) {
    let ring = rings[0];
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        let xi = ring[i][0], yi = ring[i][1];
        let xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}
