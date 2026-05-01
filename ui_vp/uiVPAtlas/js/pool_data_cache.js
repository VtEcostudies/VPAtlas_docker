/*
    pool_data_cache.js - Offline-first pool data access layer

    Caches pool detail, visit summaries, and survey summaries in IndexedDB
    for complete offline use. Same pattern as pool_list.js pool_cache.

    Usage:
      import { getPoolById, getVisitsByPoolId, getSurveysByPoolId, ensureCachesLoaded } from '/js/pool_data_cache.js';

      // On startup (fire-and-forget):
      ensureCachesLoaded();

      // When showing pool detail (offline-safe):
      let pool = await getPoolById(poolId);         // { rows: [pool] }
      let visits = await getVisitsByPoolId(poolId);  // { rows: [...] }
      let surveys = await getSurveysByPoolId(poolId); // { rows: [...] }
*/
import { getLocal, setLocal } from './storage.js';
import { fetchVisitSummary, fetchSurveySummary, fetchMappedPoolStats } from './api.js';

const VISIT_CACHE_KEY = 'visit_cache';
const SURVEY_CACHE_KEY = 'survey_cache';
const POOL_CACHE_KEY = 'pool_cache';   // read-only — written by pool_list.js
const STALE_MS = 60 * 1000;

// In-memory indexes (built on first access)
let poolIndex = null;    // Map<poolId, row>
let visitIndex = null;   // Map<poolId, [rows]>
let surveyIndex = null;  // Map<poolId, [rows]>

// =============================================================================
// PUBLIC API
// =============================================================================

// Look up a single pool from the pool_cache (already populated by pool_list.js)
export async function getPoolById(poolId) {
    if (!poolIndex) await buildPoolIndex();
    let row = poolIndex.get(poolId);
    if (!row) return { rows: [] };
    // Normalize field names so consumers get both aliased and original forms
    return { rows: [{
        ...row,
        mappedPoolId: row.mappedPoolId || row.poolId,
        mappedLatitude: row.latitude || row.mappedLatitude,
        mappedLongitude: row.longitude || row.mappedLongitude,
        mappedPoolStatus: row.poolStatus || row.mappedPoolStatus,
    }]};
}

// Look up visits for a pool from the visit_cache
export async function getVisitsByPoolId(poolId) {
    if (!visitIndex) await buildVisitIndex();
    let rows = visitIndex.get(poolId) || [];
    return { rowCount: rows.length, rows };
}

// Look up surveys for a pool from the survey_cache
export async function getSurveysByPoolId(poolId) {
    if (!surveyIndex) await buildSurveyIndex();
    let rows = surveyIndex.get(poolId) || [];
    return { rowCount: rows.length, rows };
}

// Ensure visit and survey caches are populated. Call on app startup (fire-and-forget).
export async function ensureCachesLoaded() {
    try {
        let [vc, sc] = await Promise.all([getLocal(VISIT_CACHE_KEY), getLocal(SURVEY_CACHE_KEY)]);
        if (!vc || !vc.rows || !vc.rows.length) {
            await fetchAndCacheVisits();
        } else {
            checkFreshness(vc, VISIT_CACHE_KEY, fetchAndCacheVisits);
        }
        if (!sc || !sc.rows || !sc.rows.length) {
            await fetchAndCacheSurveys();
        } else {
            checkFreshness(sc, SURVEY_CACHE_KEY, fetchAndCacheSurveys);
        }
    } catch(err) {
        console.warn('pool_data_cache: ensureCachesLoaded failed', err);
    }
}

// Force re-fetch all caches
export async function refreshCaches() {
    await Promise.all([fetchAndCacheVisits(), fetchAndCacheSurveys()]);
}

// =============================================================================
// INTERNAL: Fetch and cache
// =============================================================================

async function fetchAndCacheVisits() {
    try {
        let data = await fetchVisitSummary();
        let rows = data.rows || [];
        let fingerprint = await getFingerprint();
        await setLocal(VISIT_CACHE_KEY, { rows, fingerprint, ts: Date.now() });
        visitIndex = null; // invalidate in-memory index
        console.log(`pool_data_cache: cached ${rows.length} visit summaries`);
    } catch(err) {
        console.warn('pool_data_cache: fetchAndCacheVisits failed', err);
    }
}

async function fetchAndCacheSurveys() {
    try {
        let data = await fetchSurveySummary();
        let rows = data.rows || [];
        let fingerprint = await getFingerprint();
        await setLocal(SURVEY_CACHE_KEY, { rows, fingerprint, ts: Date.now() });
        surveyIndex = null; // invalidate in-memory index
        console.log(`pool_data_cache: cached ${rows.length} survey summaries`);
    } catch(err) {
        console.warn('pool_data_cache: fetchAndCacheSurveys failed', err);
    }
}

async function getFingerprint() {
    try {
        let stats = await fetchMappedPoolStats();
        if (stats.rows && stats.rows[0]) {
            let s = stats.rows[0];
            return [s.total_data, s.total, s.visited, s.monitored, s.review,
                    s.potential, s.probable, s.confirmed, s.duplicate, s.eliminated].join(':');
        }
    } catch(e) {}
    return null;
}

async function checkFreshness(cache, cacheKey, refreshFn) {
    if (cache.ts && (Date.now() - cache.ts) < STALE_MS) return;
    try {
        let fp = await getFingerprint();
        if (fp === null) return;
        if (fp !== cache.fingerprint) {
            console.log(`pool_data_cache: ${cacheKey} stale — refreshing`);
            await refreshFn();
        } else {
            cache.ts = Date.now();
            await setLocal(cacheKey, cache);
        }
    } catch(err) {
        console.warn(`pool_data_cache: freshness check failed for ${cacheKey}`, err);
    }
}

// =============================================================================
// INTERNAL: Build in-memory indexes from IndexedDB
// =============================================================================

async function buildPoolIndex() {
    poolIndex = new Map();
    let cache = await getLocal(POOL_CACHE_KEY);
    if (!cache || !cache.rows) return;
    for (let row of cache.rows) {
        let pid = row.poolId || row.mappedPoolId || '';
        if (pid) poolIndex.set(pid, row);
    }
}

async function buildVisitIndex() {
    visitIndex = new Map();
    let cache = await getLocal(VISIT_CACHE_KEY);
    if (!cache || !cache.rows) return;
    for (let row of cache.rows) {
        let pid = row.visitPoolId || '';
        if (!pid) continue;
        if (!visitIndex.has(pid)) visitIndex.set(pid, []);
        visitIndex.get(pid).push(row);
    }
}

async function buildSurveyIndex() {
    surveyIndex = new Map();
    let cache = await getLocal(SURVEY_CACHE_KEY);
    if (!cache || !cache.rows) return;
    for (let row of cache.rows) {
        let pid = row.surveyPoolId || '';
        if (!pid) continue;
        if (!surveyIndex.has(pid)) surveyIndex.set(pid, []);
        surveyIndex.get(pid).push(row);
    }
}
