/*
    map_common.js - Shared map setup for all VPAtlas pages
    ES6 module. Provides base layers, boundary overlays (radio-button),
    consistent pool marker styles, and persisted map preferences.

    Usage:
        import { createMap, addPoolMarker, getPoolColor } from './map_common.js';
        let map = createMap('map', { center: [lat, lng], zoom: 16 });
*/
import { getLocal, setLocal } from './storage.js';

// Vermont center and bounds
export const stateCenter = [43.858297, -72.446594];
export const stateZoom = 8;
const stateBounds = [[42.726853, -73.43774], [45.016659, -71.464555]];

// Settings keys
const SETTINGS_KEY = 'map_settings';

async function loadSettings() {
    try { return (await getLocal(SETTINGS_KEY)) || {}; } catch(e) { return {}; }
}

async function saveSettings(settings) {
    try {
        let current = await loadSettings();
        Object.assign(current, settings);
        await setLocal(SETTINGS_KEY, current);
    } catch(e) {}
}

// Pool status colors (consistent across all views)
export function getPoolColor(status) {
    switch(status) {
        case 'Confirmed': return '#00008B';
        case 'Probable':  return '#00BFFF';
        case 'Potential': return '#DAA520';
        case 'Duplicate': return '#95a5a6';
        case 'Eliminated': return '#e74c3c';
        default: return '#DAA520';
    }
}

// Survey level: monitored > visited > potential
export function getSurveyLevel(row) {
    if (row.surveyId)  return 'monitored';
    if (row.visitId)   return 'visited';
    return 'potential';
}

// Build SVG icon: circle (potential), triangle (visited), diamond (monitored)
export function buildShapeIcon(fillColor, surveyLevel, size) {
    let svg;
    switch (surveyLevel) {
        case 'monitored':
            svg = `<svg width="${size}" height="${size}" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
                <polygon points="7,1 13,7 7,13 1,7" fill="${fillColor}" stroke="#333" stroke-width="1" opacity="0.85"/>
            </svg>`;
            break;
        case 'visited':
            svg = `<svg width="${size}" height="${size}" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
                <polygon points="7,1 13,13 1,13" fill="${fillColor}" stroke="#333" stroke-width="1" opacity="0.85"/>
            </svg>`;
            break;
        default:
            svg = `<svg width="${size}" height="${size}" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
                <circle cx="7" cy="7" r="6" fill="${fillColor}" stroke="#333" stroke-width="1" opacity="0.85"/>
            </svg>`;
    }
    return L.divIcon({
        html: svg,
        className: 'pool-shape-icon',
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
    });
}

// =============================================================================
// MARKER TOOLTIP (brief) AND POPUP (detailed with links)
// =============================================================================

// Brief tooltip for mouseover
export function poolTooltipText(row) {
    let poolId = row.poolId || row.mappedPoolId || '';
    let status = row.poolStatus || row.mappedPoolStatus || '';
    let town = row.townName || '';
    return `${poolId} — ${status}${town ? ', ' + town : ''}`;
}

// Detailed popup for click — includes links
export function poolPopupHtml(row) {
    let poolId = row.poolId || row.mappedPoolId || '';
    let status = row.poolStatus || row.mappedPoolStatus || '';
    let town = row.townName || '';
    let county = row.countyName || '';
    let observer = row.mappedObserverUserName || '';

    let html = `<div style="font-size:14px; min-width:180px;">`;
    html += `<strong><a href="pool_view.html?poolId=${poolId}">${poolId}</a></strong>`;
    html += ` — ${status}`;
    if (town) html += `<br>${town}${county ? ' (' + county + ')' : ''}`;
    if (observer) html += `<br>Mapped by ${observer}`;
    html += `<div style="margin-top:6px; display:flex; gap:8px;">`;
    html += `<a href="visit_create.html?poolId=${poolId}" style="font-size:13px;">Atlas Visit</a>`;
    html += `<a href="/explore/survey_create.html?poolId=${poolId}" style="font-size:13px;">Monitor Survey</a>`;
    html += `<a href="/survey/survey_start.html?poolId=${poolId}" style="font-size:13px;">Find Pool</a>`;
    html += `</div></div>`;
    return html;
}

// Create a marker with the standard pool shape/color (for single-pool detail pages)
export function addPoolMarker(map, latlng, opts = {}) {
    let color = opts.color || getPoolColor(opts.status || 'Potential');
    let level = opts.surveyLevel || 'potential';
    let size = opts.size || 18;
    let icon = buildShapeIcon(color, level, size);
    let marker = L.marker(latlng, { icon: icon });
    if (opts.popup) marker.bindPopup(opts.popup);
    if (opts.tooltip) marker.bindTooltip(opts.tooltip, {
        permanent: false, sticky: true, direction: 'top', offset: [0, -10], opacity: 0.9
    });
    marker.addTo(map);
    return marker;
}

// =============================================================================
// BASE LAYERS
// =============================================================================
export function createBaseLayers() {
    let layers = {};

    layers['Esri Topo'] = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: '&copy; Esri' }
    );
    layers['Street Map'] = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    });
    layers['Satellite'] = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: '&copy; Esri' }
    );
    layers['Open Topo'] = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17, attribution: '&copy; OpenTopoMap'
    });
    layers['VCGI CIR'] = L.tileLayer(
        'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_CIR_WM_CACHE/ImageServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, attribution: 'VCGI CIR' }
    );
    layers['VCGI Leaf-Off'] = L.tileLayer(
        'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_CLR_WM_CACHE/ImageServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, attribution: 'VCGI Leaf-Off Imagery' }
    );

    if (typeof L.esri !== 'undefined') {
        layers['VCGI Lidar DEM'] = L.esri.imageMapLayer({
            url: 'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_LIDARHILLSHD_WM_CACHE_v1/ImageServer',
            maxZoom: 20, attribution: 'VCGI Lidar'
        });
        layers['VCGI Lidar DSM'] = L.esri.imageMapLayer({
            url: 'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_LIDARDSMHILLSHD_SP_CACHE_v1/ImageServer/',
            maxZoom: 20, attribution: 'VCGI Lidar'
        });
        layers['VCGI Lidar Slope'] = L.esri.imageMapLayer({
            url: 'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_LIDARSLOPESYM_SP_NOCACHE_v1/ImageServer/',
            maxZoom: 20, attribution: 'VCGI Lidar'
        });
    }

    return layers;
}

// =============================================================================
// BOUNDARY OVERLAYS (radio-button: only one at a time)
// =============================================================================
export async function loadBoundaryOverlays(map) {
    let boundaries = {};

    try {
        let res = await fetch('/geojson/Polygon_VT_State_Boundary.geo.json');
        boundaries.state = L.geoJSON(await res.json(), {
            style: { color: '#333', weight: 2, fillOpacity: 0, dashArray: '5,5' },
            onEachFeature: function(feature, layer) {
                layer.on('click', function() { map.fitBounds(stateBounds, { padding: [30, 30] }); });
            }
        });
    } catch(e) {}

    try {
        let res = await fetch('/geojson/Polygon_VT_County_Boundaries.geo.json');
        boundaries.county = L.geoJSON(await res.json(), {
            style: { color: '#8B4513', weight: 1.5, fillOpacity: 0, dashArray: '3,3' },
            onEachFeature: function(feature, layer) {
                let name = feature.properties.CNTYNAME || feature.properties.countyName || feature.properties.NAME || '';
                if (name) layer.bindTooltip(name, { sticky: true, direction: 'top', offset: [0, -20], className: 'boundary-tooltip' });
                layer.on('click', function() {
                    map.fitBounds(layer.getBounds(), { padding: [30, 30] });
                    if (name) document.dispatchEvent(new CustomEvent('map:county-click', { detail: { name } }));
                });
            }
        });
    } catch(e) {}

    try {
        let res = await fetch('/geojson/Polygon_VT_Town_Boundaries.geo.json');
        boundaries.town = L.geoJSON(await res.json(), {
            style: { color: '#4682B4', weight: 1, fillOpacity: 0 },
            onEachFeature: function(feature, layer) {
                let name = feature.properties.TOWNNAME || feature.properties.townName || feature.properties.NAME || '';
                if (name) layer.bindTooltip(name, { sticky: true, direction: 'top', offset: [0, -20], className: 'boundary-tooltip' });
                layer.on('click', function() {
                    map.fitBounds(layer.getBounds(), { padding: [30, 30] });
                    if (name) document.dispatchEvent(new CustomEvent('map:town-click', { detail: { name } }));
                });
            }
        });
    } catch(e) {}

    return boundaries;
}

// Add boundary overlays to an existing L.control.layers as overlay checkboxes.
// Enforces mutual exclusivity: only one boundary visible at a time.
export function addBoundaryOverlays(map, layerControl, boundaries, savedBoundary = 'none') {
    let boundaryNames = {
        state: 'State Boundary',
        county: 'County Boundaries',
        town: 'Town Boundaries'
    };
    let boundaryLayers = {};

    ['state', 'county', 'town'].forEach(key => {
        if (!boundaries[key]) return;
        let name = boundaryNames[key];
        boundaryLayers[name] = boundaries[key];
        layerControl.addOverlay(boundaries[key], name);
        if (key === savedBoundary) boundaries[key].addTo(map);
    });

    map.on('overlayadd', function(e) {
        if (!boundaryLayers[e.name]) return;
        let boundaryKey = Object.keys(boundaryNames).find(k => boundaryNames[k] === e.name);
        Object.entries(boundaryLayers).forEach(([name, layer]) => {
            if (name !== e.name && map.hasLayer(layer)) map.removeLayer(layer);
        });
        if (boundaryKey) saveSettings({ boundary: boundaryKey });
    });

    map.on('overlayremove', function(e) {
        if (!boundaryLayers[e.name]) return;
        let anyActive = Object.values(boundaryLayers).some(l => map.hasLayer(l));
        if (!anyActive) saveSettings({ boundary: 'none' });
    });
}

// =============================================================================
// LEGEND — pool status colors + survey level shapes
// =============================================================================
export function addLegend(map, position = 'bottomleft') {
    let ctl = L.Control.extend({
        options: { position: position },
        onAdd: function() {
            let div = L.DomUtil.create('div', 'leaflet-control pool-legend');
            L.DomEvent.disableClickPropagation(div);
            div.innerHTML = `
                <div class="pool-legend-title">Pool Status</div>
                <div class="pool-legend-item"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#DAA520" stroke="#333" stroke-width="1"/></svg> Potential</div>
                <div class="pool-legend-item"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#00BFFF" stroke="#333" stroke-width="1"/></svg> Probable</div>
                <div class="pool-legend-item"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#00008B" stroke="#333" stroke-width="1"/></svg> Confirmed</div>
                <div class="pool-legend-item"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#95a5a6" stroke="#333" stroke-width="1"/></svg> Duplicate</div>
                <div class="pool-legend-item"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#e74c3c" stroke="#333" stroke-width="1"/></svg> Eliminated</div>
                <div class="pool-legend-title" style="margin-top:6px;">Survey Level</div>
                <div class="pool-legend-item"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#ccc" stroke="#333" stroke-width="1"/></svg> Mapped</div>
                <div class="pool-legend-item"><svg width="12" height="12"><polygon points="6,1 11,11 1,11" fill="#ccc" stroke="#333" stroke-width="1"/></svg> Visited</div>
                <div class="pool-legend-item"><svg width="12" height="12"><polygon points="6,1 11,6 6,11 1,6" fill="#ccc" stroke="#333" stroke-width="1"/></svg> Monitored</div>
            `;
            return div;
        }
    });
    new ctl().addTo(map);
}

// =============================================================================
// CREATE MAP (full-featured, for any page)
// =============================================================================
export async function createMap(elementId, opts = {}) {
    let settings = await loadSettings();
    let center = opts.center || stateCenter;
    let zoom = opts.zoom || stateZoom;

    let map = L.map(elementId, {
        zoomControl: false,
        center: center,
        zoom: zoom
    });

    // Base layers — restore saved selection
    let baseLayers = createBaseLayers();
    let savedBase = settings.baseLayer || 'Esri Topo';
    if (baseLayers[savedBase]) {
        baseLayers[savedBase].addTo(map);
    } else {
        baseLayers['Esri Topo'].addTo(map);
    }

    // Persist base layer changes
    map.on('baselayerchange', function(e) {
        saveSettings({ baseLayer: e.name });
    });

    // Controls
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    let layerControl = L.control.layers(baseLayers, {}, { position: 'topright', collapsed: true }).addTo(map);

    // Boundary overlays — added to the same layer control
    let boundaries = await loadBoundaryOverlays(map);
    if (Object.keys(boundaries).length) {
        let savedBoundary = settings.boundary || 'none';
        addBoundaryOverlays(map, layerControl, boundaries, savedBoundary);
    }

    // Legend
    addLegend(map, 'bottomleft');

    return map;
}
