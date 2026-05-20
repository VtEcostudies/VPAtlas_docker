/*
    map.js - Leaflet map management for VPAtlas explore app
    ES6 module, singleton map instance.
    Uses map_common.js for base layers, overlays, and marker styles.
    Pool markers rendered on Canvas for performance (13.5K+ markers).
*/
import {
    createBaseLayers, loadBoundaryOverlays, addBoundaryOverlays, wireCombinedTooltip,
    getPoolColor, getSurveyLevel,
    poolTooltipText, poolPopupHtml,
    stateBounds,
    createUserLocationMarker, createPoolHaloMarker
} from '/js/map_common.js';
import { getLocal, setLocal } from '/js/storage.js';
import { initParcelLayer, showParcels, hideParcels, parcelsEnabled, parcelMinZoom, findParcelAt, prefetchParcelsNear } from '/js/parcels.js';
import { GPSMonitor } from '/survey/js/gps_monitor.js';

// =============================================================================
// CANVAS SHAPE MARKERS — extend L.CircleMarker for triangle & diamond shapes
// =============================================================================
const DiamondMarker = L.CircleMarker.extend({
    _updatePath() {
        let p = this._point, r = this._radius, ctx = this._renderer._ctx;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        this._renderer._fillStroke(ctx, this);
    }
});

const TriangleMarker = L.CircleMarker.extend({
    _updatePath() {
        let p = this._point, r = this._radius, ctx = this._renderer._ctx;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y + r * 0.75);
        ctx.lineTo(p.x - r, p.y + r * 0.75);
        ctx.closePath();
        this._renderer._fillStroke(ctx, this);
    }
});

const SETTINGS_KEY = 'map_settings';
async function loadSettings() { try { return (await getLocal(SETTINGS_KEY)) || {}; } catch(e) { return {}; } }
async function saveSettings(s) { try { let c = await loadSettings(); Object.assign(c, s); await setLocal(SETTINGS_KEY, c); } catch(e) {} }

// Asymmetric padding: extra left padding shifts VT rightward to clear the legend control
const statePadding = { paddingTopLeft: [100, 20], paddingBottomRight: [20, 20] };

var map = false;
var markers = {};             // { poolId: marker }
var allMarkers = [];          // all marker refs for filter toggling
var allRows = [];             // full row data for client-side list filtering
var poolLayer = null;         // single FeatureGroup holding visible markers
var statusVisible = {};       // { 'Potential': true, ... } — persisted
var levelVisible = {};        // { 'potential': true, ... } — persisted

// Layer controls
var baseLayerControl = null;
var statusControl = null;
var isAdmin = false;

// GPS state for the "zoom to my location" button
var gps = null;
var userMarker = null;
var accuracyCircle = null;
var gpsBtn = null;            // anchor element of the leaflet control
var gpsHasFix = false;

// Halo marker for the currently pinned pool (single-select).
var haloMarker = null;

// Home button callback
var homeCallback = null;
export function setHomeCallback(cb) { homeCallback = cb; }

var mapReadyResolve;
export var mapReady = new Promise(resolve => { mapReadyResolve = resolve; });

const tooltipOptions = {
    permanent: false,
    sticky: true,
    direction: 'top',
    offset: [0, -10],
    opacity: 0.9
};

// =============================================================================
// INITIALIZE MAP
// =============================================================================
export async function initMap(opts = {}) {
    if (map) return map;
    isAdmin = !!opts.isAdmin;

    let settings = await loadSettings();

    map = L.map('map', {
        zoomControl: false,
        preferCanvas: true
    });
    map.fitBounds(stateBounds, statePadding);

    // Base layers — restore saved selection
    let baseLayers = createBaseLayers();
    let savedBase = settings.baseLayer || 'Google Satellite +';
    (baseLayers[savedBase] || baseLayers['Google Satellite +']).addTo(map);

    // Persist base layer changes
    map.on('baselayerchange', function(e) { saveSettings({ baseLayer: e.name }); });

    // Controls
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Home button
    var homeCtl = new L.Control({ position: 'bottomright' });
    homeCtl.onAdd = function() {
        var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-home');
        var btn = document.createElement('a');
        btn.href = '#';
        btn.title = 'Zoom to state';
        btn.innerHTML = '<svg width="14" height="22" viewBox="0 0 16 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M16.0,0.0L1.1,0.1L0.6,3.1L1.0,6.6L0.1,9.8L0.5,13.5L1.1,14.7L1.4,20.7L7.5,23.6L7.2,22.6L7.3,21.6L8.0,21.0L8.1,19.8L8.0,19.7L8.1,18.7L8.4,17.4L8.5,16.3L8.6,15.4L9.0,14.6L9.2,14.0L9.9,13.1L10.2,12.1L10.7,11.3L10.9,10.5L11.1,10.1L11.4,9.6L11.3,9.0L11.2,8.5L11.2,7.8L11.7,7.2L13.3,6.6L14.2,6.2L14.7,5.6L15.0,5.2L15.3,4.7L15.3,4.4L15.2,4.0L15.0,3.6L14.8,3.1L14.9,2.6L15.1,2.1L15.5,1.5L15.7,1.0L15.6,0.6L15.4,0.2Z"/></svg>';
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:30px;height:30px;font-size:16px;';
        btn.addEventListener('click', function(e) {
            L.DomEvent.preventDefault(e);
            L.DomEvent.stopPropagation(e);
            if (homeCallback) { homeCallback(); }
            else { map.fitBounds(stateBounds, statePadding); }
        });
        div.appendChild(btn);
        return div;
    };
    homeCtl.addTo(map);

    // Base layer control + boundary overlays in same control
    baseLayerControl = L.control.layers(baseLayers, {}, { position: 'topright', collapsed: true }).addTo(map);

    let boundaries = await loadBoundaryOverlays(map);
    if (Object.keys(boundaries).length) {
        let savedBoundary = settings.boundary || 'none';
        addBoundaryOverlays(map, baseLayerControl, boundaries, savedBoundary);
    }

    // Resize pool markers on zoom change
    map.on('zoomend', onZoomResizeMarkers);

    // Parcel overlay (VCGI landowner parcels)
    await initParcelLayer(map);
    let savedParcels = settings.parcelsVisible !== undefined ? settings.parcelsVisible : false;
    if (savedParcels) showParcels();

    // Status layer control (interactive legend + toggle)
    await initStatusControl();

    // Hide legend counts when map is narrow
    let mapEl = document.getElementById('map');
    if (mapEl && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            mapEl.classList.toggle('map-narrow', mapEl.clientWidth < 600);
        }).observe(mapEl);
        mapEl.classList.toggle('map-narrow', mapEl.clientWidth < 600);
    }

    // Combined tooltip: when 2+ markers/boundaries overlap under the cursor,
    // show a single panel listing all of them rather than just the topmost.
    wireCombinedTooltip(map);

    mapReadyResolve(map);
    return map;
}

// =============================================================================
// POOL MARKERS — Canvas-rendered, filterable by status + survey level
// =============================================================================

function getMarkerRadius() {
    if (!map) return 7;
    let z = map.getZoom();
    if (z >= 17) return 14;
    if (z >= 15) return 11;
    if (z >= 13) return 9;
    if (z >= 11) return 7;
    return 5;
}

const shapeStyle = { weight: 1, color: '#333', opacity: 0.85, fillOpacity: 0.85 };

const STATUS_ORDER = ['Potential', 'Probable', 'Confirmed', 'Duplicate', 'Eliminated'];
// Survey-level keys are mutually exclusive per row (a pool is exactly one
// of potential/visited/monitored). 'reviewed' is an *additional* level
// that ORs with the others — a monitored-and-reviewed pool is visible if
// EITHER "Monitored" OR "Reviewed" is on. Admin-only.
const LEVEL_ORDER  = ['potential', 'visited', 'monitored'];
const LEVEL_LABELS = { potential: 'Mapped', visited: 'Visited', monitored: 'Monitored', reviewed: 'Reviewed' };

export function plotPoolRows(rows, onPoolClick=null) {
    clearPoolMarkers();
    if (!rows || !rows.length) return;

    allRows = rows;
    poolLayer = L.featureGroup();
    let radius = getMarkerRadius();

    rows.forEach(row => {
        let lat = parseFloat(row.latitude || row.mappedLatitude);
        let lng = parseFloat(row.longitude || row.mappedLongitude);
        if (isNaN(lat) || isNaN(lng)) return;

        let poolId = row.poolId || row.mappedPoolId || '';
        let status = row.poolStatus || row.mappedPoolStatus || '';
        let fillColor = getPoolColor(status);
        let surveyLevel = getSurveyLevel(row);
        let opts = Object.assign({}, shapeStyle, { fillColor, radius });

        let marker;
        switch (surveyLevel) {
            case 'monitored': marker = new DiamondMarker([lat, lng], opts); break;
            case 'visited':   marker = new TriangleMarker([lat, lng], opts); break;
            default:          marker = L.circleMarker([lat, lng], opts);
        }

        marker.bindTooltip(poolTooltipText(row), tooltipOptions);
        // Defer the popup HTML build until the popup actually opens so the
        // landowner-from-parcel lookup runs against the freshest in-memory
        // parcel cache (parcels stream in as the user pans/zooms).
        marker.bindPopup(() => poolPopupHtml(row, findParcelAt), { maxWidth: 360 });

        // If no parcel is cached at the pool's location when the popup opens,
        // fetch the parcel for that point on demand (small bbox around the
        // pool, single VCGI request) and then refresh the popup content so
        // the landowner block appears without the user having to zoom/pan.
        marker.on('popupopen', async () => {
            if (findParcelAt({ lat, lng })) return;          // already have it
            try {
                await prefetchParcelsNear(lat, lng);
            } catch (_) { return; }
            if (marker.isPopupOpen()) {
                marker.setPopupContent(poolPopupHtml(row, findParcelAt));
            }
        });

        if (onPoolClick) {
            marker.on('click', function() { onPoolClick(row); });
        }

        // Tag for filtering. _vpHasReview lets the OR-style "Reviewed"
        // level chip keep reviewed pools visible even when their mutex
        // survey level (potential/visited/monitored) is unchecked.
        marker._vpStatus = status;
        marker._vpLevel = surveyLevel;
        marker._vpHasReview = !!(row.reviewId || row._hasReview);

        markers[poolId] = marker;
        allMarkers.push(marker);

        if (statusVisible[status] !== false && isLevelVisible(surveyLevel, marker._vpHasReview)) {
            poolLayer.addLayer(marker);
        }
    });

    poolLayer.addTo(map);
    updateFilterCounts();
}

export function clearPoolMarkers() {
    if (poolLayer) { map.removeLayer(poolLayer); poolLayer = null; }
    markers = {};
    allMarkers = [];
    allRows = [];
}

function onZoomResizeMarkers() {
    let r = getMarkerRadius();
    Object.values(markers).forEach(m => m.setRadius(r));
}

// =============================================================================
// GPS — "zoom to my location" — first click starts tracking, subsequent
// clicks recenter on the current fix. Wired up by index.html via wireGpsButton().
// =============================================================================
// Tracks "both" button so we can show/hide it as GPS state changes.
let bothBtnRef = null;

export function wireGpsButton(btn, opts = {}) {
    if (!btn) return;
    let onFirstFix = opts.onFirstFix; // optional override for the very first fix
    btn.addEventListener('click', () => {
        if (gps && gps.position && gpsHasFix) {
            map.setView([gps.position.lat, gps.position.lng], Math.max(map.getZoom(), 14));
            return;
        }
        if (!gps) {
            gps = new GPSMonitor();
            gps.on('position', (pos) => {
                updateUserMarker(pos);
                if (!gpsHasFix) {
                    gpsHasFix = true;
                    btn.classList.remove('gps-acquiring');
                    btn.classList.add('gps-tracking');
                    btn.title = 'Recenter on my location';
                    if (onFirstFix) {
                        // Defer so other position listeners (e.g. filter_bar's
                        // own GPSMonitor that may also re-render and zoom) finish
                        // first; the override gets the last word on the zoom.
                        setTimeout(() => onFirstFix(pos), 0);
                    } else {
                        map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 14));
                    }
                    if (bothBtnRef) bothBtnRef.style.display = '';
                }
            });
            gps.on('status', (s) => {
                if (s.denied) {
                    btn.classList.remove('gps-acquiring', 'gps-tracking');
                    btn.classList.add('gps-denied');
                    btn.title = 'GPS permission denied';
                }
            });
            gps.on('error', (err) => console.warn('GPS error:', err.message));
        }
        btn.classList.add('gps-acquiring');
        btn.title = 'Acquiring GPS…';
        gps.start();
    });
}

// Zoom to fit both the filtered pool markers AND the user GPS marker.
// Exported so callers (e.g. cold-load auto-zoom with near-me on) can
// invoke without simulating a button click.
//
// Uses poolLayer (visible markers only), NOT the `markers` dict — the dict
// includes everything plotted, even rows hidden by status/level chips. With
// Eliminated/Duplicate hidden by default and the occasional bad-coords row,
// iterating `markers` would blow the bounds out to the Atlantic.
export function zoomToBoth() {
    if (!map) return;
    let layers = [];
    if (poolLayer) layers.push(...poolLayer.getLayers());
    if (userMarker) layers.push(userMarker);
    if (!layers.length) return;
    let group = L.featureGroup(layers);
    let b = group.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
}

// Zoom-both button — stays hidden until GPS has a fix.
export function wireBothButton(btn) {
    if (!btn) return;
    bothBtnRef = btn;
    btn.style.display = (gps && gpsHasFix) ? '' : 'none';
    btn.addEventListener('click', zoomToBoth);
}

function updateUserMarker(pos) {
    let ll = [pos.lat, pos.lng];
    if (!userMarker) {
        userMarker = createUserLocationMarker(ll).addTo(map);
        accuracyCircle = L.circle(ll, {
            radius: pos.accuracy, color: '#4285F4', fillColor: '#4285F4',
            fillOpacity: 0.1, weight: 1, interactive: false
        }).addTo(map);
    } else {
        userMarker.setLatLng(ll);
        accuracyCircle.setLatLng(ll).setRadius(pos.accuracy);
    }
}

// =============================================================================
// PULSING GREEN HALO — single-select highlight for the pinned pool
// =============================================================================
// Drawn beneath the pool marker; CSS handles the pulse animation. Setting on
// a poolId that isn't currently plotted is a no-op (e.g. filtered out).
export function setPoolHalo(poolId) {
    if (!map) return;
    clearPoolHalo();
    let m = markers[poolId];
    if (!m) return;
    haloMarker = createPoolHaloMarker(m.getLatLng()).addTo(map);
}

export function clearPoolHalo() {
    if (haloMarker) {
        map.removeLayer(haloMarker);
        haloMarker = null;
    }
}

// OR-style level visibility: a pool is "visible by level" if its mutex
// surveyLevel chip is on, OR (if it has a review) the "Reviewed" chip is
// on. levelVisible['reviewed'] defaults to true via the !== false check,
// so non-admins (who never see the Reviewed chip) get unchanged behavior.
function isLevelVisible(level, hasReview) {
    if (levelVisible[level] !== false) return true;
    if (hasReview && levelVisible['reviewed'] !== false) return true;
    return false;
}

// Recompute which markers are on the map based on status + level visibility
function applyFilters() {
    if (!poolLayer) return;
    poolLayer.clearLayers();
    allMarkers.forEach(m => {
        if (statusVisible[m._vpStatus] !== false && isLevelVisible(m._vpLevel, m._vpHasReview)) {
            poolLayer.addLayer(m);
        }
    });
    updateFilterCounts();

    // Dispatch filtered rows so the list + summary can update without a DB fetch
    let visibleRows = allRows.filter(row => {
        let status = row.poolStatus || row.mappedPoolStatus || '';
        let level = getSurveyLevel(row);
        let hasReview = !!(row.reviewId || row._hasReview);
        return statusVisible[status] !== false && isLevelVisible(level, hasReview);
    });
    document.dispatchEvent(new CustomEvent('map:layer-filter', { detail: { rows: visibleRows } }));
}

// =============================================================================
// LAYER CONTROL — status + survey level toggles with shape swatches
// =============================================================================

const shapeSwatch = {
    potential:  '<svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="#ccc" stroke="#333" stroke-width="1"/></svg>',
    visited:    '<svg width="14" height="14"><polygon points="7,1.5 12.5,12 1.5,12" fill="#ccc" stroke="#333" stroke-width="1"/></svg>',
    monitored:  '<svg width="14" height="14"><polygon points="7,1.5 12.5,7 7,12.5 1.5,7" fill="#ccc" stroke="#333" stroke-width="1"/></svg>',
    // Reviewed isn't a map shape — reviewed pools render as their
    // underlying surveyLevel marker. The swatch is just a check mark to
    // hint at "QA'd by admin".
    reviewed:   '<svg width="14" height="14" viewBox="0 0 14 14"><polyline points="2.5,7.5 5.5,10.5 11.5,3.5" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const ADMIN_STATUSES = ['Duplicate', 'Eliminated'];

async function initStatusControl() {
    let settings = await loadSettings();
    let savedStatus = settings.statusVisible || {};
    let savedLevel  = settings.levelVisible || {};
    STATUS_ORDER.forEach(s => { statusVisible[s] = savedStatus[s] !== undefined ? savedStatus[s] : true; });
    LEVEL_ORDER.forEach(l => { levelVisible[l]  = savedLevel[l]  !== undefined ? savedLevel[l]  : true; });
    // Init the "reviewed" OR-level toggle (admin-only chip; for non-admins
    // it stays true so it never hides anything).
    levelVisible['reviewed'] = savedLevel['reviewed'] !== undefined ? savedLevel['reviewed'] : true;

    // Non-admins: force Duplicate/Eliminated hidden
    if (!isAdmin) {
        ADMIN_STATUSES.forEach(s => { statusVisible[s] = false; });
    }

    let visibleStatuses = isAdmin ? STATUS_ORDER : STATUS_ORDER.filter(s => !ADMIN_STATUSES.includes(s));

    statusControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function() {
            let div = L.DomUtil.create('div', 'leaflet-control pool-legend pool-legend-collapsible');
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            // Restore collapsed state from shared settings
            if (settings.legendCollapsed) div.classList.add('collapsed');

            // Collapse toggle header
            let toggle = L.DomUtil.create('div', 'pool-legend-toggle-header', div);
            toggle.innerHTML = '<span>Legend</span><span class="pool-legend-arrow">&#9660;</span>';
            toggle.addEventListener('click', () => {
                div.classList.toggle('collapsed');
                saveSettings({ legendCollapsed: div.classList.contains('collapsed') });
            });

            let body = L.DomUtil.create('div', 'pool-legend-body', div);

            // ── Status checkboxes ──
            L.DomUtil.create('div', 'pool-legend-title', body).textContent = 'Pool Status';

            visibleStatuses.forEach(status => {
                let item = L.DomUtil.create('label', 'pool-legend-item pool-legend-toggle', body);

                let cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = statusVisible[status] !== false;
                cb.style.cssText = 'margin:0 5px 0 0; accent-color:' + getPoolColor(status);
                item.appendChild(cb);

                item.appendChild(document.createTextNode(status));

                let count = document.createElement('span');
                count.className = 'pool-legend-count';
                count.id = `status_count_${status}`;
                item.appendChild(count);

                cb.addEventListener('change', () => {
                    statusVisible[status] = cb.checked;
                    applyFilters();
                    saveSettings({ statusVisible: Object.assign({}, statusVisible) });
                });
            });

            // ── Survey level checkboxes with shape swatches ──
            let title2 = L.DomUtil.create('div', 'pool-legend-title', body);
            title2.style.marginTop = '6px';
            title2.textContent = 'Survey Level';

            // Mutex survey levels followed by the OR-style "Reviewed"
            // toggle (admin-only). The admin gate keeps the legend lean
            // for the public-facing volunteer flow.
            let legendLevels = isAdmin ? [...LEVEL_ORDER, 'reviewed'] : LEVEL_ORDER;
            legendLevels.forEach(level => {
                let item = L.DomUtil.create('label', 'pool-legend-item pool-legend-toggle', body);

                let cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = levelVisible[level] !== false;
                cb.style.cssText = 'margin:0 4px 0 0;';
                item.appendChild(cb);

                let swatch = document.createElement('span');
                swatch.innerHTML = shapeSwatch[level];
                swatch.style.cssText = 'display:inline-flex; align-items:center; margin-right:3px;';
                item.appendChild(swatch);

                item.appendChild(document.createTextNode(LEVEL_LABELS[level]));

                let count = document.createElement('span');
                count.className = 'pool-legend-count';
                count.id = `level_count_${level}`;
                item.appendChild(count);

                cb.addEventListener('change', () => {
                    levelVisible[level] = cb.checked;
                    applyFilters();
                    saveSettings({ levelVisible: Object.assign({}, levelVisible) });
                });
            });

            // ── Parcel overlay toggle (placed last to match the simple legend) ──
            let parcelSection = L.DomUtil.create('div', 'pool-legend-title', body);
            parcelSection.style.marginTop = '6px';
            parcelSection.textContent = 'Overlays';

            let parcelItem = L.DomUtil.create('label', 'pool-legend-item pool-legend-toggle', body);
            let parcelCb = document.createElement('input');
            parcelCb.type = 'checkbox';
            parcelCb.checked = parcelsEnabled();
            parcelCb.style.cssText = 'margin:0 5px 0 0; accent-color:#8B0000;';
            parcelItem.appendChild(parcelCb);

            let parcelIcon = document.createElement('span');
            parcelIcon.innerHTML = '<svg width="14" height="14"><rect x="1" y="1" width="12" height="12" fill="none" stroke="#8B0000" stroke-width="1.5" opacity="0.7"/></svg>';
            parcelIcon.style.cssText = 'display:inline-flex; align-items:center; margin-right:3px;';
            parcelItem.appendChild(parcelIcon);

            parcelItem.appendChild(document.createTextNode('Parcels'));

            let parcelStatus = document.createElement('span');
            parcelStatus.className = 'pool-legend-count';
            parcelStatus.id = 'parcel_status';
            parcelItem.appendChild(parcelStatus);

            parcelCb.addEventListener('change', () => {
                if (parcelCb.checked) {
                    showParcels();
                    if (map.getZoom() < parcelMinZoom()) {
                        parcelStatus.textContent = ' (zoom in)';
                    }
                } else {
                    hideParcels();
                    parcelStatus.textContent = '';
                }
                saveSettings({ parcelsVisible: parcelCb.checked });
            });

            // Listen for parcel status events
            document.addEventListener('parcels:status', (e) => {
                let { state, count } = e.detail;
                if (!parcelCb.checked) { parcelStatus.textContent = ''; return; }
                if (state === 'loading') parcelStatus.textContent = ' (loading…)';
                else if (state === 'zoom-in') parcelStatus.textContent = ' (zoom in)';
                else if (state === 'error') parcelStatus.textContent = count ? ` (${count} cached)` : ' (error)';
                else if (count) parcelStatus.textContent = ` (${count.toLocaleString()})`;
                else parcelStatus.textContent = '';
            });

            return div;
        }
    });

    new statusControl().addTo(map);
}

function updateFilterCounts() {
    // Count totals from allMarkers (not just visible)
    let sCounts = {}, lCounts = {};
    let reviewedCount = 0;
    allMarkers.forEach(m => {
        sCounts[m._vpStatus] = (sCounts[m._vpStatus] || 0) + 1;
        lCounts[m._vpLevel]  = (lCounts[m._vpLevel]  || 0) + 1;
        if (m._vpHasReview) reviewedCount++;
    });
    lCounts['reviewed'] = reviewedCount;
    STATUS_ORDER.forEach(s => {
        let el = document.getElementById(`status_count_${s}`);
        if (el) el.textContent = sCounts[s] ? ` (${sCounts[s].toLocaleString()})` : '';
    });
    [...LEVEL_ORDER, 'reviewed'].forEach(l => {
        let el = document.getElementById(`level_count_${l}`);
        if (el) el.textContent = lCounts[l] ? ` (${lCounts[l].toLocaleString()})` : '';
    });
}

// =============================================================================
// MAP UTILITIES
// =============================================================================
export function zoomToPool(poolId) {
    if (markers[poolId]) {
        let latlng = markers[poolId].getLatLng();
        map.setView(latlng, 16);
        markers[poolId].openTooltip();
    }
}

export function zoomToState() {
    if (map) map.fitBounds(stateBounds, statePadding);
}

export function zoomToFilteredPools() {
    if (poolLayer && map) {
        let bounds = poolLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
    }
}

export function fitBounds(bounds) {
    if (map && bounds) map.fitBounds(bounds);
}

export function getMap() {
    return map;
}

// Expose map layer visibility so the list can filter to match
export function getMapFilters() {
    return { statusVisible, levelVisible };
}

// Toggle status/level visibility from outside (e.g. mobile status chips)
export function setStatusVisible(status, visible) {
    statusVisible[status] = visible;
    applyFilters();
    saveSettings({ statusVisible: Object.assign({}, statusVisible) });
    // Sync map legend checkbox
    let ctrl = document.querySelector('.pool-legend');
    if (ctrl) {
        ctrl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            let label = cb.parentElement;
            if (label && label.textContent.trim().startsWith(status)) cb.checked = visible;
        });
    }
}

export function setLevelVisible(level, visible) {
    levelVisible[level] = visible;
    applyFilters();
    saveSettings({ levelVisible: Object.assign({}, levelVisible) });
    let ctrl = document.querySelector('.pool-legend');
    if (ctrl) {
        ctrl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            let label = cb.parentElement;
            if (label && label.textContent.trim().includes(LEVEL_LABELS[level])) cb.checked = visible;
        });
    }
}
