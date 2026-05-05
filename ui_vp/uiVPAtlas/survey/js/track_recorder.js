/*
    track_recorder.js — local-first GPS track recording for PoolFinder.

    Tracks are buffered in memory while recording and persisted to IndexedDB
    after each point so an in-progress track survives a page reload. Tracks
    are NOT auto-uploaded; the user uploads them on demand from the
    "My Visits and Tracks" page (see /admin/profile.html or wherever the
    track tab lives — the upload helper hits POST /tracks).

    IDB keys
    --------
    "track_recorder.active"   → in-progress track or null
    "track_recorder.queue"    → array of saved-but-not-yet-uploaded tracks

    Track shape
    -----------
    {
        localId:    'tr_<rand>' | 'sv_<remoteId>',  // 'tr_' = recorded here, 'sv_' = stub from server
        source:     'local' | 'server',  // 'local' = recorded on this device; 'server' = stub synced from DB
        name:        string|null,
        notes:       string|null,
        startedAt:   ISO,
        endedAt:     ISO | null,        // null while active
        points:      [[lng, lat, elev|null, ts]...] | null,  // null on a server stub until lazy-fetched
        pointCount:  number | null,     // server-reported count (used when points is null)
        lengthM:     number | null,
        remoteId:    number | null,     // server "trackId" once uploaded or for server stubs
        uploadedAt:  ISO | null,
        accuracyMinM: number | null     // best (smallest) horizontal accuracy seen
    }
*/

import { getLocal, setLocal } from '/js/storage.js';
import { fetchTracks, fetchTrackById } from '/js/api.js';

const ACTIVE_KEY = 'track_recorder.active';
const QUEUE_KEY  = 'track_recorder.queue';

// Don't burn battery storing every fix when the user is stationary or has
// a poor fix. These thresholds are conservative — tune from field testing.
const MIN_MOVE_M = 3;        // skip points within this distance of the previous one
const MAX_ACCURACY_M = 30;   // skip points worse than this (meters of HDOP)

// Listeners for UI updates (e.g. map polyline, status pill)
const listeners = new Set();
function notify(event) {
    for (let l of listeners) {
        try { l(event); } catch(_) {}
    }
}

let active = null;       // in-memory copy, kept in sync with IDB

export function onTrackEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export async function init() {
    active = (await getLocal(ACTIVE_KEY)) || null;
    notify({ type: active ? 'resumed' : 'idle', track: active });
    return active;
}

export function getActive() { return active; }

export async function startTrack({ name = null } = {}) {
    if (active) return active;
    let now = new Date().toISOString();
    active = {
        localId: 'tr_' + Math.random().toString(36).slice(2, 10),
        source: 'local',
        name,
        notes: null,
        startedAt: now,
        endedAt: null,
        points: [],
        pointCount: null,
        lengthM: null,
        remoteId: null,
        uploadedAt: null,
        accuracyMinM: null
    };
    await setLocal(ACTIVE_KEY, active);
    notify({ type: 'started', track: active });
    return active;
}

// Returns true if the point was kept (and stored), false if filtered out.
export async function addPoint(lat, lng, elev = null, accuracyM = null, tsMs = Date.now()) {
    if (!active) return false;
    if (typeof lat !== 'number' || typeof lng !== 'number' ||
        Number.isNaN(lat) || Number.isNaN(lng)) return false;
    if (accuracyM != null && accuracyM > MAX_ACCURACY_M) return false;

    let prev = active.points[active.points.length - 1];
    if (prev) {
        let d = haversineM(prev[1], prev[0], lat, lng);
        if (d < MIN_MOVE_M) {
            // Stationary — refresh accuracy stat but don't add a duplicate point.
            if (accuracyM != null && (active.accuracyMinM == null || accuracyM < active.accuracyMinM)) {
                active.accuracyMinM = accuracyM;
                await setLocal(ACTIVE_KEY, active);
            }
            return false;
        }
    }

    active.points.push([lng, lat, elev, tsMs]);
    if (accuracyM != null && (active.accuracyMinM == null || accuracyM < active.accuracyMinM)) {
        active.accuracyMinM = accuracyM;
    }
    await setLocal(ACTIVE_KEY, active);
    notify({ type: 'point', track: active, point: [lng, lat, elev, tsMs] });
    return true;
}

// End the current track and move it to the local upload queue.
// Returns the saved track or null if nothing to save.
export async function stopTrack({ name = null, notes = null } = {}) {
    if (!active) return null;
    if (active.points.length < 2) {
        await discardTrack();
        return null;
    }
    active.endedAt = new Date().toISOString();
    if (name) active.name = name;
    if (notes) active.notes = notes;

    let queue = (await getLocal(QUEUE_KEY)) || [];
    queue.push(active);
    await setLocal(QUEUE_KEY, queue);
    let saved = active;
    active = null;
    await setLocal(ACTIVE_KEY, null);
    notify({ type: 'stopped', track: saved });
    return saved;
}

export async function discardTrack() {
    if (!active) return;
    let dropped = active;
    active = null;
    await setLocal(ACTIVE_KEY, null);
    notify({ type: 'discarded', track: dropped });
}

export async function listQueue() {
    return (await getLocal(QUEUE_KEY)) || [];
}

export async function deleteLocal(localId) {
    let queue = (await getLocal(QUEUE_KEY)) || [];
    queue = queue.filter(t => t.localId !== localId);
    await setLocal(QUEUE_KEY, queue);
}

// Mark a queued track as uploaded — leaves it in the queue so the user can
// see what's been pushed; UI may filter or auto-purge after N days.
export async function markUploaded(localId, remoteId) {
    let queue = (await getLocal(QUEUE_KEY)) || [];
    let updated = false;
    queue = queue.map(t => {
        if (t.localId === localId) {
            updated = true;
            return { ...t, remoteId, uploadedAt: new Date().toISOString() };
        }
        return t;
    });
    if (updated) await setLocal(QUEUE_KEY, queue);
}

// Pull the user's server-side tracks into the local queue. Stubs (no points)
// are added for tracks that exist on the server but not locally; existing
// local entries with a matching remoteId have their server-mutable metadata
// (name/notes/uploadedAt/lengthM) refreshed without losing their points.
//
// Returns { ok, added, updated, error? }. Failures (offline, 401) are swallowed
// — the caller should not block on this. Geometry is fetched lazily by
// getTrackPoints() unless fetchGeometry: true is passed.
const SYNCED_AT_KEY = 'track_recorder.lastSync';
let _syncing = false;

export async function syncFromServer({ fetchGeometry = false } = {}) {
    if (_syncing) return { ok: false, error: 'already syncing' };
    _syncing = true;
    try {
        let resp;
        try {
            resp = await fetchTracks();
        } catch (err) {
            return { ok: false, error: err };
        }
        let serverRows = (resp && resp.rows) || [];
        let queue = (await getLocal(QUEUE_KEY)) || [];

        const byRemote = new Map();
        for (let t of queue) if (t.remoteId != null) byRemote.set(t.remoteId, t);

        let added = 0, updated = 0;
        for (let r of serverRows) {
            const existing = byRemote.get(r.trackId);
            if (existing) {
                existing.name = r.name;
                existing.notes = r.notes;
                existing.uploadedAt = r.uploadedAt || existing.uploadedAt;
                existing.lengthM = r.lengthM;
                if (existing.pointCount == null) existing.pointCount = r.pointCount;
                updated++;
            } else {
                const stub = {
                    localId: 'sv_' + r.trackId,
                    source: 'server',
                    name: r.name,
                    notes: r.notes,
                    startedAt: r.startedAt,
                    endedAt: r.endedAt,
                    points: null,
                    pointCount: r.pointCount,
                    lengthM: r.lengthM,
                    remoteId: r.trackId,
                    uploadedAt: r.uploadedAt,
                    accuracyMinM: null
                };
                if (fetchGeometry) {
                    try {
                        const detail = await fetchTrackById(r.trackId);
                        const geo = parseGeom(detail && detail.geomJson);
                        if (geo) stub.points = geo.map(c => [c[0], c[1], null, null]);
                    } catch (_) { /* leave null; lazy-fetch later */ }
                }
                queue.push(stub);
                added++;
            }
        }

        await setLocal(QUEUE_KEY, queue);
        await setLocal(SYNCED_AT_KEY, new Date().toISOString());
        notify({ type: 'synced', added, updated, total: queue.length });
        return { ok: true, added, updated };
    } finally {
        _syncing = false;
    }
}

export async function getLastSyncedAt() {
    return await getLocal(SYNCED_AT_KEY);
}

// Resolve points for a track in the queue, fetching geometry from the server
// the first time a server stub is opened. Subsequent calls hit local IDB.
export async function getTrackPoints(localId) {
    let queue = (await getLocal(QUEUE_KEY)) || [];
    const t = queue.find(x => x.localId === localId);
    if (!t) return null;
    if (Array.isArray(t.points) && t.points.length) return t.points;
    if (t.remoteId == null) return [];
    try {
        const detail = await fetchTrackById(t.remoteId);
        const geo = parseGeom(detail && detail.geomJson);
        if (!geo) return null;
        t.points = geo.map(c => [c[0], c[1], null, null]);
        // Persist the hydrated points so the next viewer is offline-capable
        const idx = queue.findIndex(x => x.localId === localId);
        if (idx >= 0) {
            queue[idx] = t;
            await setLocal(QUEUE_KEY, queue);
        }
        return t.points;
    } catch (_) {
        return null;
    }
}

// Drop server-stub tracks from local. Useful on logout to clear another user's
// data from this device — local-recorded tracks are kept (they may not have
// uploaded yet) so we never destroy field data.
export async function clearServerStubs() {
    let queue = (await getLocal(QUEUE_KEY)) || [];
    const before = queue.length;
    queue = queue.filter(t => t.source !== 'server');
    await setLocal(QUEUE_KEY, queue);
    await setLocal(SYNCED_AT_KEY, null);
    return before - queue.length;
}

function parseGeom(geomJson) {
    if (!geomJson) return null;
    let parsed;
    try { parsed = typeof geomJson === 'string' ? JSON.parse(geomJson) : geomJson; }
    catch (_) { return null; }
    if (!parsed || !Array.isArray(parsed.coordinates)) return null;
    return parsed.coordinates;
}

// Helper: meters between two lat/lng points.
function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    let dLat = toRad(lat2 - lat1);
    let dLng = toRad(lng2 - lng1);
    let a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
