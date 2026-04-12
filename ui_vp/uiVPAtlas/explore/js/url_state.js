/*
    url_state.js - URL parameter and browser history management for VPAtlas

    The VPAtlas API uses actual DB column names as query params with pipe syntax:
      ?mappedPoolId|ILIKE=%NEW%       => WHERE "mappedPoolId" ILIKE '%NEW%'
      ?mappedPoolStatus=Confirmed     => WHERE "mappedPoolStatus" = 'Confirmed'
      ?townName=Stowe                 => WHERE "townName" = 'Stowe'
    Repeated params for the same key become IN(...).
*/
import { setLocal, getLocal } from '/js/storage.js';

export const DEFAULT_STATUSES = ['Potential', 'Probable', 'Confirmed'];

// Primary data-type filters (radio buttons)
export const DATA_TYPES = ['All', 'Visited', 'Monitored', 'Mine', 'Review'];

// Global filters object
export var filters = {
    dataType: 'All',                        // primary pool data filter
    poolIdSearch: '',                       // partial-match pool ID (ILIKE)
    townNames: [],                          // multi-select town names
    countyNames: [],                        // multi-select county names
    poolStatuses: [...DEFAULT_STATUSES],    // status checkboxes
    page: 1,
    map_layers: { towns: false, counties: false, pools: true, baseLayer: 'Street Map' }
};

// Persist + URL
export function putUserState(fromUser=1, updates={}) {
    Object.assign(filters, updates);
    setLocal('user_state', filters).catch(err => console.error('putUserState ERROR', err));

    var params = new URLSearchParams();
    if (filters.dataType !== 'All') params.set('dataType', filters.dataType);
    if (filters.poolIdSearch) params.set('poolId', filters.poolIdSearch);
    filters.townNames.forEach(t => params.append('town', t));
    filters.countyNames.forEach(c => params.append('county', c));
    if (filters.poolStatuses.length < 5) params.set('status', filters.poolStatuses.join(','));

    var href = window.location.origin + window.location.pathname;
    var paramStr = params.toString();
    if (paramStr) href += '?' + paramStr;

    if (fromUser) {
        history.pushState({ href, params: filters }, document.title, new URL(href).toString());
    }
}

// Load from URL
export function loadFromUrl() {
    let p = new URLSearchParams(window.location.search);
    if (p.get('dataType')) filters.dataType = p.get('dataType');
    if (p.get('poolId')) filters.poolIdSearch = p.get('poolId');
    if (p.getAll('town').length) filters.townNames = p.getAll('town');
    if (p.getAll('county').length) filters.countyNames = p.getAll('county');
    if (p.get('status')) filters.poolStatuses = p.get('status').split(',');
    return filters;
}

// Load from IndexedDB
export async function loadFromStorage() {
    try {
        let saved = await getLocal('user_state');
        if (saved) Object.assign(filters, saved);
    } catch(err) {}
    return filters;
}

// Browser back/forward
export function setPopState(callback) {
    window.addEventListener('popstate', function(event) {
        if (event.state && event.state.params) {
            Object.assign(filters, event.state.params);
            if (callback) callback(filters);
        }
    });
}

// Build API query string from filters
export function buildSearchTerm() {
    let parts = [];

    if (filters.poolIdSearch) {
        parts.push(`mappedPoolId|ILIKE=%${filters.poolIdSearch}%`);
    }

    // Multiple towns/counties: repeated params become IN(...)
    filters.townNames.forEach(t => parts.push(`townName=${t}`));
    filters.countyNames.forEach(c => parts.push(`countyName=${c}`));

    if (filters.poolStatuses.length > 0 && filters.poolStatuses.length < 5) {
        filters.poolStatuses.forEach(s => parts.push(`mappedPoolStatus=${s}`));
    }

    return parts.join('&') || false;
}

// Client-side filter for data type (applied after API returns rows)
// The overview query includes visitId, surveyId, mappedByUser — filter locally.
export function filterRowsByDataType(rows, username=null) {
    switch (filters.dataType) {
        case 'Visited':
            return rows.filter(r => r.visitId);
        case 'Monitored':
            return rows.filter(r => r.surveyId);
        case 'Mine':
            if (!username) return [];
            return rows.filter(r =>
                r.mappedUserName === username ||
                r.visitUserName === username ||
                r.visitObserverUserName === username ||
                r.surveyUserName === username
            );
        case 'Review':
            // Pools needing review: visited but no review, or review status pending
            return rows.filter(r => r.visitId && !r.reviewId);
        case 'All':
        default:
            return rows;
    }
}

// Describe current scope for summary panel
export function getCurrentScope() {
    if (filters.poolIdSearch) return { type: 'pool', value: filters.poolIdSearch };
    if (filters.townNames.length) return { type: 'town', value: filters.townNames };
    if (filters.countyNames.length) return { type: 'county', value: filters.countyNames };
    return { type: 'state', value: 'Vermont' };
}
