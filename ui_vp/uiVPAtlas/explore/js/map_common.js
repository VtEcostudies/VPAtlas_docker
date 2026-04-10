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

// Add a custom radio-button boundary control to the map, with persistence
export function addBoundaryControl(map, boundaries, position = 'topright', savedBoundary = 'none') {
    let currentBoundary = null;

    let ctl = L.Control.extend({
        options: { position: position },
        onAdd: function() {
            let div = L.DomUtil.create('div', 'leaflet-bar leaflet-control boundary-radio-control');
            div.style.cssText = 'background:white; font-size:13px; line-height:1.6; cursor:pointer;';
            L.DomEvent.disableClickPropagation(div);

            // Collapsed toggle header
            let header = document.createElement('div');
            header.innerHTML = '<i class="fa fa-layer-group" style="margin-right:4px;"></i> Bounds';
            header.style.cssText = 'padding:4px 8px; font-weight:600; color:#333; white-space:nowrap;';
            div.appendChild(header);

            // Expandable body
            let body = document.createElement('div');
            body.style.cssText = 'display:none; padding:2px 10px 6px;';
            div.appendChild(body);

            header.addEventListener('click', function() {
                body.style.display = body.style.display === 'none' ? 'block' : 'none';
            });

            let items = [
                { key: 'none', label: 'None' },
                { key: 'state', label: 'State' },
                { key: 'county', label: 'Counties' },
                { key: 'town', label: 'Towns' }
            ];

            items.forEach(item => {
                if (item.key !== 'none' && !boundaries[item.key]) return;
                let isChecked = item.key === savedBoundary;
                let label = createRadioLabel('boundary_radio', item.key, item.label, isChecked);
                body.appendChild(label);
            });

            // Apply saved selection
            if (savedBoundary !== 'none' && boundaries[savedBoundary]) {
                boundaries[savedBoundary].addTo(map);
                currentBoundary = boundaries[savedBoundary];
            }

            // Wire radio change
            body.addEventListener('change', function(e) {
                if (e.target.name !== 'boundary_radio') return;
                if (currentBoundary) { map.removeLayer(currentBoundary); currentBoundary = null; }
                let val = e.target.value;
                if (val !== 'none' && boundaries[val]) {
                    boundaries[val].addTo(map);
                    currentBoundary = boundaries[val];
                }
                saveSettings({ boundary: val });
            });

            return div;
        }
    });

    new ctl().addTo(map);
}

function createRadioLabel(name, value, text, checked) {
    let label = document.createElement('label');
    label.style.cssText = 'display:block; cursor:pointer; white-space:nowrap;';
    let radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = value;
    radio.checked = checked;
    radio.style.marginRight = '4px';
    label.appendChild(radio);
    label.appendChild(document.createTextNode(text));
    return label;
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
    L.control.layers(baseLayers, {}, { position: 'topright', collapsed: true }).addTo(map);

    // Boundary overlays (radio-button) — restore saved selection
    let boundaries = await loadBoundaryOverlays(map);
    if (Object.keys(boundaries).length) {
        let savedBoundary = settings.boundary || 'none';
        addBoundaryControl(map, boundaries, 'topright', savedBoundary);
    }

    return map;
}
