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
    poolIdSearch: '',                       // pool ID — matched per poolIdExact
    poolIdExact: false,                     // true → exact equality match (set when user picks from typeahead suggestions); false → substring/ILIKE (free-text)
    townNames: [],                          // multi-select town names
    countyNames: [],                        // multi-select county names
    poolStatuses: [...DEFAULT_STATUSES],    // status checkboxes
    hasIndicator: false,                    // require an indicator species
    nearMeKm: 0,                            // 0 = off; otherwise client-side radius filter (km)
    nearMeOrigin: null,                     // { lat, lng } — origin captured when toggle activates
    showFilters: false,                    // filter bar visibility
    page: 1,
    map_layers: { towns: false, counties: false, pools: true, baseLayer: 'Street Map' }
};

// Persist + URL
export function putUserState(fromUser=1, updates={}) {
    Object.assign(filters, updates);
    setLocal('user_state', filters).catch(err => console.error('putUserState ERROR', err));

    var params = new URLSearchParams();
    if (filters.dataType !== 'All') params.set('dataType', filters.dataType);
    if (filters.poolIdSearch) {
        params.set('poolId', filters.poolIdSearch);
        if (filters.poolIdExact) params.set('poolIdExact', '1');
    }
    filters.townNames.forEach(t => params.append('town', t));
    filters.countyNames.forEach(c => params.append('county', c));
    if (filters.poolStatuses.length < 5) params.set('status', filters.poolStatuses.join(','));
    if (filters.nearMeKm > 0 && filters.nearMeOrigin) {
        params.set('nearMeKm', String(filters.nearMeKm));
        params.set('nearMeOrigin', `${filters.nearMeOrigin.lat.toFixed(6)},${filters.nearMeOrigin.lng.toFixed(6)}`);
    }

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
    filters.poolIdExact = p.get('poolIdExact') === '1';
    if (p.getAll('town').length) filters.townNames = p.getAll('town');
    if (p.getAll('county').length) filters.countyNames = p.getAll('county');
    if (p.get('status')) filters.poolStatuses = p.get('status').split(',');
    if (p.get('nearMeKm') && p.get('nearMeOrigin')) {
        let km = parseFloat(p.get('nearMeKm'));
        let parts = p.get('nearMeOrigin').split(',').map(parseFloat);
        if (km > 0 && parts.length === 2 && parts.every(Number.isFinite)) {
            filters.nearMeKm = km;
            filters.nearMeOrigin = { lat: parts[0], lng: parts[1] };
        }
    }
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

function titleCase(s) {
    return s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase());
}

// Build API query string from filters
export function buildSearchTerm() {
    let parts = [];

    if (filters.poolIdSearch) {
        parts.push(`mappedPoolId|ILIKE=%${filters.poolIdSearch}%`);
    }

    // Multiple towns/counties: normalize case to match DB
    // Towns are mixed-case in DB (e.g. "Addison"), counties are uppercase (e.g. "ADDISON")
    filters.townNames.forEach(t => parts.push(`townName=${titleCase(t)}`));
    filters.countyNames.forEach(c => parts.push(`countyName=${c.toUpperCase()}`));

    // Status and indicator species filtering handled client-side

    return parts.join('&') || false;
}

// Client-side filter for data type (applied after API returns rows)
// The overview query includes userId columns — match on integer IDs, not names.
// `userInfo` can be a username string (legacy) or { id, username, ... } object.
export function filterRowsByDataType(rows, userInfo=null) {
    switch (filters.dataType) {
        case 'Visited':
            return rows.filter(r => r.visitId);
        case 'Monitored':
            return rows.filter(r => r.surveyId);
        case 'Mine': {
            if (!userInfo) return [];
            // Support both userId (integer) and username (string) matching
            let userId = typeof userInfo === 'object' ? userInfo.id : null;
            let username = typeof userInfo === 'object' ? (userInfo.handle || userInfo.username) : userInfo;
            return rows.filter(r => {
                // Prefer integer userId matching (reliable)
                if (userId) {
                    if (r.visitUserId === userId || r.mappedUserId === userId || r.surveyUserId === userId) return true;
                }
                // Fallback to string matching for legacy rows without userId
                if (username) {
                    if (r.mappedUserName === username || r.visitUserName === username ||
                        r.visitObserverUserName === username || r.surveyUserName === username) return true;
                }
                return false;
            });
        }
        case 'Review':
            // A pool needs review iff ANY of its visits needs (re)review.
            // Per-visit, because reviews are tied to a specific visit
            // (vpreview.reviewVisitId = vpvisit.visitId). pool_list.js
            // dedupe builds r._visitMap[visitId] =
            //   { lastEditedAt, hasReview, maxReviewUpdatedAt, maxReviewQADate }.
            // A visit needs (re)review when:
            //   * it has NO review at all  → first review needed; OR
            //   * it WAS user-edited (lastEditedAt set) AND that edit is
            //     newer than its newest review's actual timestamp → re-review.
            //
            // Use `maxReviewUpdatedAt` (precise ISO timestamp the review
            // row was last touched), NOT `maxReviewQADate`. The QA date is
            // user-entered as a date string ("2026-06-04"), and parsing it
            // through new Date() resolves to MIDNIGHT UTC of that day —
            // which makes every same-day edit-then-review pair look like
            // "edited after the review" (edit at 19:42 > review at 00:00).
            // reviewUpdatedAt is set by the DB on insert/update and carries
            // sub-second precision, so the same-day comparison is correct.
            // maxReviewQADate is retained for legacy cached pools whose
            // dedupe pre-dated this fix.
            //
            // lastEditedAt is NULL until a user edits the visit through the
            // app (no DEFAULT, no trigger — migration 016), so legacy /
            // imported / never-touched reviewed visits are NOT flagged
            // regardless of any migration-tainted updatedAt. reviewQADate
            // is NOT NULL after migration 015; reviewUpdatedAt is set by
            // the row's INSERT/UPDATE.
            //
            // Cache compatibility: rows written by an older dedupe have no
            // _visitMap. Fall back to "visit exists but no review" using
            // the legacy booleans so the queue isn't silently empty before
            // the freshness refetch heals the cache (policy: no
            // POOL_CACHE_KEY bump — see cache_keys.js).
            return rows.filter(r => {
                if (!r.visitId && !r._hasVisit) return false;
                let vm = r._visitMap;
                if (!vm || typeof vm !== 'object' || !Object.keys(vm).length) {
                    // Legacy cached row: best-effort — a visit with no
                    // review is the unambiguous "needs review" case.
                    return !!(r.visitId || r._hasVisit) && !(r.reviewId || r._hasReview);
                }
                let toMs = (d) => {
                    if (!d) return null;
                    let t = new Date(d).getTime();
                    return Number.isFinite(t) ? t : null;
                };
                return Object.values(vm).some(v => {
                    if (!v.hasReview) return true;                 // never reviewed
                    let edited = toMs(v.lastEditedAt);
                    if (edited == null) return false;              // not user-edited since baseline
                    // Prefer the precise timestamp. Legacy cached visits
                    // dedupe-d before this fix only have maxReviewQADate;
                    // fall back to it so the queue isn't broken until the
                    // freshness refetch heals the cache.
                    let reviewedAt = toMs(v.maxReviewUpdatedAt) ?? toMs(v.maxReviewQADate) ?? -8.64e15;
                    return edited > reviewedAt;                    // edited after the review
                });
            });
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
