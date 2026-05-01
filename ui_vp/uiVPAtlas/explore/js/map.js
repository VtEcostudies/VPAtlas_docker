/*
    map.js - Leaflet map management for VPAtlas explore app
    ES6 module, singleton map instance.
    Uses map_common.js for base layers, overlays, and marker styles.
    Pool markers rendered on Canvas for performance (13.5K+ markers).
*/
import {
    createBaseLayers, loadBoundaryOverlays, addBoundaryOverlays,
    getPoolColor, getSurveyLevel,
    poolTooltipText, poolPopupHtml,
    stateBounds
} from '/js/map_common.js';
import { getLocal, setLocal } from '/js/storage.js';
import { initParcelLayer, showParcels, hideParcels, parcelsEnabled, parcelMinZoom } from '/js/parcels.js';

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
    let savedBase = settings.baseLayer || 'Esri Topo';
    (baseLayers[savedBase] || baseLayers['Esri Topo']).addTo(map);

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
const LEVEL_ORDER  = ['potential', 'visited', 'monitored'];
const LEVEL_LABELS = { potential: 'Mapped', visited: 'Visited', monitored: 'Monitored' };

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
        marker.bindPopup(poolPopupHtml(row), { maxWidth: 280 });

        if (onPoolClick) {
            marker.on('click', function() { onPoolClick(row); });
        }

        // Tag for filtering
        marker._vpStatus = status;
        marker._vpLevel = surveyLevel;

        markers[poolId] = marker;
        allMarkers.push(marker);

        // Add only if both status and level are visible
        if (statusVisible[status] !== false && levelVisible[surveyLevel] !== false) {
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

// Recompute which markers are on the map based on status + level visibility
function applyFilters() {
    if (!poolLayer) return;
    poolLayer.clearLayers();
    allMarkers.forEach(m => {
        if (statusVisible[m._vpStatus] !== false && levelVisible[m._vpLevel] !== false) {
            poolLayer.addLayer(m);
        }
    });
    updateFilterCounts();

    // Dispatch filtered rows so the list + summary can update without a DB fetch
    let visibleRows = allRows.filter(row => {
        let status = row.poolStatus || row.mappedPoolStatus || '';
        let level = getSurveyLevel(row);
        return statusVisible[status] !== false && levelVisible[level] !== false;
    });
    document.dispatchEvent(new CustomEvent('map:layer-filter', { detail: { rows: visibleRows } }));
}

// =============================================================================
// LAYER CONTROL — status + survey level toggles with shape swatches
// =============================================================================

const shapeSwatch = {
    potential:  '<svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="#ccc" stroke="#333" stroke-width="1"/></svg>',
    visited:    '<svg width="14" height="14"><polygon points="7,1.5 12.5,12 1.5,12" fill="#ccc" stroke="#333" stroke-width="1"/></svg>',
    monitored:  '<svg width="14" height="14"><polygon points="7,1.5 12.5,7 7,12.5 1.5,7" fill="#ccc" stroke="#333" stroke-width="1"/></svg>'
};

const ADMIN_STATUSES = ['Duplicate', 'Eliminated'];

async function initStatusControl() {
    let settings = await loadSettings();
    let savedStatus = settings.statusVisible || {};
    let savedLevel  = settings.levelVisible || {};
    STATUS_ORDER.forEach(s => { statusVisible[s] = savedStatus[s] !== undefined ? savedStatus[s] : true; });
    LEVEL_ORDER.forEach(l => { levelVisible[l]  = savedLevel[l]  !== undefined ? savedLevel[l]  : true; });

    // Non-admins: force Duplicate/Eliminated hidden
    if (!isAdmin) {
        ADMIN_STATUSES.forEach(s => { statusVisible[s] = false; });
    }

    let visibleStatuses = isAdmin ? STATUS_ORDER : STATUS_ORDER.filter(s => !ADMIN_STATUSES.includes(s));

    statusControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function() {
            let div = L.DomUtil.create('div', 'leaflet-control pool-legend');
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            // ── Status checkboxes ──
            L.DomUtil.create('div', 'pool-legend-title', div).textContent = 'Pool Status';

            visibleStatuses.forEach(status => {
                let item = L.DomUtil.create('label', 'pool-legend-item pool-legend-toggle', div);

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

            // ── Parcel overlay toggle ──
            let parcelSection = L.DomUtil.create('div', 'pool-legend-title', div);
            parcelSection.style.marginTop = '6px';
            parcelSection.textContent = 'Overlays';

            let parcelItem = L.DomUtil.create('label', 'pool-legend-item pool-legend-toggle', div);
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

            // ── Survey level checkboxes with shape swatches ──
            let title2 = L.DomUtil.create('div', 'pool-legend-title', div);
            title2.style.marginTop = '6px';
            title2.textContent = 'Survey Level';

            LEVEL_ORDER.forEach(level => {
                let item = L.DomUtil.create('label', 'pool-legend-item pool-legend-toggle', div);

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

            return div;
        }
    });

    new statusControl().addTo(map);
}

function updateFilterCounts() {
    // Count totals from allMarkers (not just visible)
    let sCounts = {}, lCounts = {};
    allMarkers.forEach(m => {
        sCounts[m._vpStatus] = (sCounts[m._vpStatus] || 0) + 1;
        lCounts[m._vpLevel]  = (lCounts[m._vpLevel]  || 0) + 1;
    });
    STATUS_ORDER.forEach(s => {
        let el = document.getElementById(`status_count_${s}`);
        if (el) el.textContent = sCounts[s] ? ` (${sCounts[s].toLocaleString()})` : '';
    });
    LEVEL_ORDER.forEach(l => {
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
