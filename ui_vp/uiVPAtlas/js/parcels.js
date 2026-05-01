/*
    parcels.js - VCGI Vermont Parcel overlay with IndexedDB caching
    ES6 module. Fetches parcel polygons from VCGI FeatureServer on demand,
    caches by SPAN in IndexedDB for offline use, renders as clickable
    GeoJSON overlay with landowner info popups.

    Usage:
        import { initParcelLayer, showParcels, hideParcels } from '/js/parcels.js';
        await initParcelLayer(map);
*/
import { getLocal, setLocal } from '/js/storage.js';

// VCGI Parcel FeatureServer — active parcels (layer 1)
const PARCEL_URL = 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_VTPARCELS_WM_NOCACHE_v2/FeatureServer/1/query';

// Fields to fetch (keep payload lean)
const OUT_FIELDS = [
    'SPAN', 'OWNER1', 'OWNER2', 'E911ADDR', 'TOWN', 'TNAME',
    'ACRESGL', 'DESCPROP', 'REAL_FLV', 'LOCAPROP', 'PARCID'
].join(',');

// IndexedDB cache key
const CACHE_KEY = 'parcel_cache';

// Min zoom to fetch/show parcels (too dense at lower zooms)
const MIN_ZOOM = 14;

// Parcel polygon style
const PARCEL_STYLE = {
    color: '#8B0000',
    weight: 1.5,
    fillColor: '#8B0000',
    fillOpacity: 0.06,
    dashArray: null
};

const PARCEL_HIGHLIGHT = {
    color: '#FF4500',
    weight: 2.5,
    fillOpacity: 0.15
};

var parcelLayer = null;     // L.geoJSON layer on the map
var parcelCache = {};       // { SPAN: GeoJSON Feature } — in-memory mirror of IndexedDB
var fetchedExtents = [];    // track fetched bbox to avoid redundant queries
var map = null;
var enabled = false;        // user toggle state
var moveHandler = null;
var loading = false;

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Initialize parcel layer on the map. Call once after map is ready.
 * Does NOT show parcels until showParcels() is called.
 */
export async function initParcelLayer(leafletMap) {
    map = leafletMap;

    // Custom pane below overlayPane — pointer-events:none so pool markers
    // (canvas in overlayPane z-400) remain fully clickable above parcels
    let pane = map.createPane('parcelPane');
    pane.style.zIndex = 350;
    pane.style.pointerEvents = 'none';

    // Load cache from IndexedDB
    try {
        let cached = await getLocal(CACHE_KEY);
        if (cached && typeof cached === 'object') {
            parcelCache = cached;
        }
    } catch (e) {}

    // Create the GeoJSON layer — interactive:false since we handle clicks
    // via map click + point-in-polygon (see below)
    parcelLayer = L.geoJSON(null, {
        pane: 'parcelPane',
        interactive: false,
        style: () => PARCEL_STYLE
    });

    // Handle parcel identification via map click — only fires when no
    // pool marker consumed the click. Uses a short delay so pool marker
    // click handlers run first.
    map.on('click', function (e) {
        if (!enabled) return;
        if (map.getZoom() < MIN_ZOOM) return;

        setTimeout(() => {
            // If a popup is already open (from a pool marker click), skip
            if (map._popup && map._popup.isOpen()) return;

            let hit = findParcelAt(e.latlng);
            if (hit) {
                L.popup({ maxWidth: 300 })
                    .setLatLng(e.latlng)
                    .setContent(parcelPopupHtml(hit.properties))
                    .openOn(map);
            }
        }, 100);
    });
}

/**
 * Enable parcel overlay — adds layer, starts fetching on map move.
 */
export function showParcels() {
    if (!map || !parcelLayer) return;
    enabled = true;

    parcelLayer.addTo(map);

    // Render any cached parcels in current view
    renderCachedInView();

    // Fetch fresh data if zoomed in enough
    if (map.getZoom() >= MIN_ZOOM) {
        fetchParcelsInView();
    }

    // Listen for map moves
    if (!moveHandler) {
        moveHandler = debounce(onMapMove, 400);
        map.on('moveend', moveHandler);
        map.on('zoomend', moveHandler);
    }
}

/**
 * Disable parcel overlay — removes layer, stops fetching.
 */
export function hideParcels() {
    if (!map || !parcelLayer) return;
    enabled = false;

    map.removeLayer(parcelLayer);

    if (moveHandler) {
        map.off('moveend', moveHandler);
        map.off('zoomend', moveHandler);
        moveHandler = null;
    }
}

/** Is the parcel layer currently enabled? */
export function parcelsEnabled() { return enabled; }

/** Min zoom for parcel display */
export function parcelMinZoom() { return MIN_ZOOM; }

/**
 * Pre-fetch parcels around a specific lat/lng (e.g. for offline field use).
 * Fetches a ~500m buffer around the point.
 */
export async function prefetchParcelsNear(lat, lng, bufferDeg = 0.005) {
    let bounds = L.latLngBounds(
        [lat - bufferDeg, lng - bufferDeg],
        [lat + bufferDeg, lng + bufferDeg]
    );
    await fetchParcelsInBounds(bounds);
}

/**
 * Get cached parcel data by SPAN number.
 */
export function getParcelBySPAN(span) {
    return parcelCache[span] || null;
}

/**
 * Get all cached parcels as an array of GeoJSON features.
 */
export function getCachedParcels() {
    return Object.values(parcelCache);
}

/**
 * Clear the parcel cache (IndexedDB + memory).
 */
export async function clearParcelCache() {
    parcelCache = {};
    fetchedExtents = [];
    if (parcelLayer) parcelLayer.clearLayers();
    try { await setLocal(CACHE_KEY, {}); } catch (e) {}
}

// =============================================================================
// FETCHING
// =============================================================================

function onMapMove() {
    if (!enabled) return;
    if (map.getZoom() < MIN_ZOOM) {
        // Too zoomed out — clear rendered parcels but keep cache
        if (parcelLayer) parcelLayer.clearLayers();
        dispatchStatus('zoom-in', 0);
        return;
    }
    renderCachedInView();
    fetchParcelsInView();
}

async function fetchParcelsInView() {
    let bounds = map.getBounds();
    await fetchParcelsInBounds(bounds);
}

async function fetchParcelsInBounds(bounds) {
    // Skip if this extent was already fetched
    if (isExtentFetched(bounds)) return;
    if (loading) return;

    loading = true;
    dispatchStatus('loading', 0);

    try {
        let bbox = toBBox(bounds);
        let params = new URLSearchParams({
            where: '1=1',
            geometry: JSON.stringify({
                xmin: bbox[0], ymin: bbox[1],
                xmax: bbox[2], ymax: bbox[3],
                spatialReference: { wkid: 4326 }
            }),
            geometryType: 'esriGeometryEnvelope',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: OUT_FIELDS,
            returnGeometry: 'true',
            outSR: '4326',
            f: 'geojson',
            resultRecordCount: '2000'
        });

        let resp = await fetch(`${PARCEL_URL}?${params}`);
        if (!resp.ok) throw new Error(`Parcel fetch failed: ${resp.status}`);

        let geojson = await resp.json();
        if (!geojson.features || !geojson.features.length) {
            markExtentFetched(bounds);
            dispatchStatus('ready', Object.keys(parcelCache).length);
            loading = false;
            return;
        }

        // Merge into cache (dedupe by SPAN)
        let newCount = 0;
        geojson.features.forEach(f => {
            let span = f.properties && f.properties.SPAN;
            if (span && !parcelCache[span]) {
                parcelCache[span] = f;
                newCount++;
            }
        });

        markExtentFetched(bounds);

        // Persist to IndexedDB (async, don't block render)
        if (newCount > 0) {
            setLocal(CACHE_KEY, parcelCache).catch(() => {});
        }

        // Render new features
        renderCachedInView();
        dispatchStatus('ready', Object.keys(parcelCache).length);

    } catch (e) {
        console.warn('Parcel fetch error:', e.message);
        // Still render from cache
        renderCachedInView();
        dispatchStatus('error', Object.keys(parcelCache).length);
    }

    loading = false;
}

// =============================================================================
// RENDERING
// =============================================================================

/** Render cached parcels that intersect the current map view */
function renderCachedInView() {
    if (!parcelLayer || !map) return;
    if (map.getZoom() < MIN_ZOOM) return;

    let bounds = map.getBounds();
    parcelLayer.clearLayers();

    let count = 0;
    Object.values(parcelCache).forEach(feature => {
        if (featureInBounds(feature, bounds)) {
            parcelLayer.addData(feature);
            count++;
        }
    });

    dispatchStatus('ready', count);
}

/** Check if a GeoJSON feature intersects the map bounds (any vertex in view, or bounds overlap) */
function featureInBounds(feature, bounds) {
    try {
        let geom = feature.geometry;
        if (!geom) return false;
        let allRings = [];
        if (geom.type === 'Polygon') {
            allRings = geom.coordinates;
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(poly => allRings.push(...poly));
        }
        // Check if any vertex is in view, or if feature bbox overlaps view
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (let ring of allRings) {
            for (let pt of ring) {
                let lng = pt[0], lat = pt[1];
                if (bounds.contains([lat, lng])) return true;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
            }
        }
        // Feature bbox overlaps view bounds (covers case where feature encloses the view)
        let fBounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
        return bounds.intersects(fBounds);
    } catch (e) {
        return false;
    }
}

// =============================================================================
// PARCEL POPUP + POINT-IN-POLYGON HIT TESTING
// =============================================================================

function parcelPopupHtml(p) {
    p = p || {};
    let html = `<div class="parcel-popup" style="font-size:13px; min-width:200px;">`;
    html += `<strong style="font-size:14px;">${p.OWNER1 || 'Unknown Owner'}</strong>`;
    if (p.OWNER2) html += `<br>${p.OWNER2}`;
    html += `<hr style="margin:4px 0;">`;
    if (p.E911ADDR) html += `<div>${p.E911ADDR}</div>`;
    if (p.TOWN || p.TNAME) html += `<div>${p.TNAME || p.TOWN}</div>`;
    if (p.ACRESGL) html += `<div>${p.ACRESGL.toFixed(1)} acres</div>`;
    if (p.DESCPROP) html += `<div style="color:#666; font-size:12px;">${p.DESCPROP}</div>`;
    if (p.REAL_FLV) html += `<div>Assessed: $${p.REAL_FLV.toLocaleString()}</div>`;
    html += `<hr style="margin:4px 0;">`;
    html += `<div style="color:#888; font-size:11px;">`;
    if (p.SPAN) html += `SPAN: ${p.SPAN}`;
    if (p.PARCID) html += ` &nbsp;|&nbsp; Parcel: ${p.PARCID}`;
    html += `</div></div>`;
    return html;
}

/** Find the first cached parcel whose polygon contains the given latlng */
function findParcelAt(latlng) {
    let lng = latlng.lng, lat = latlng.lat;
    for (let feature of Object.values(parcelCache)) {
        if (pointInFeature(lng, lat, feature)) return feature;
    }
    return null;
}

/** Ray-casting point-in-polygon test for a GeoJSON feature */
function pointInFeature(x, y, feature) {
    let geom = feature.geometry;
    if (!geom) return false;
    let rings;
    if (geom.type === 'Polygon') {
        rings = geom.coordinates;
    } else if (geom.type === 'MultiPolygon') {
        for (let poly of geom.coordinates) {
            if (pointInRings(x, y, poly)) return true;
        }
        return false;
    } else {
        return false;
    }
    return pointInRings(x, y, rings);
}

function pointInRings(x, y, rings) {
    // Test outer ring (index 0), skip holes for simplicity
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

// =============================================================================
// EXTENT TRACKING — avoid re-fetching same area
// =============================================================================

function toBBox(bounds) {
    return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function markExtentFetched(bounds) {
    fetchedExtents.push(toBBox(bounds));
    // Keep only last 20 to avoid memory growth
    if (fetchedExtents.length > 20) fetchedExtents.shift();
}

function isExtentFetched(bounds) {
    let [w, s, e, n] = toBBox(bounds);
    return fetchedExtents.some(([fw, fs, fe, fn]) =>
        w >= fw && s >= fs && e <= fe && n <= fn
    );
}

// =============================================================================
// HELPERS
// =============================================================================

function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/** Dispatch status events for UI feedback (loading spinner, counts) */
function dispatchStatus(state, count) {
    document.dispatchEvent(new CustomEvent('parcels:status', {
        detail: { state, count }
    }));
}
