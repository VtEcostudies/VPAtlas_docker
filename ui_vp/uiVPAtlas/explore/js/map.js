/*
    map.js - Leaflet map management for VPAtlas explore app
    ES6 module, singleton map instance.
    Uses map_common.js for base layers, overlays, and marker styles.
*/
import { showWait, hideWait } from './utils.js';
import { fetchMappedPoolGeoJson } from './api.js';
import {
    createBaseLayers, loadBoundaryOverlays, addBoundaryControl,
    getPoolColor, getSurveyLevel, buildShapeIcon,
    poolTooltipText, poolPopupHtml,
    stateCenter, stateZoom
} from './map_common.js';
import { getLocal, setLocal } from './storage.js';

const SETTINGS_KEY = 'map_settings';
async function loadSettings() { try { return (await getLocal(SETTINGS_KEY)) || {}; } catch(e) { return {}; } }
async function saveSettings(s) { try { let c = await loadSettings(); Object.assign(c, s); await setLocal(SETTINGS_KEY, c); } catch(e) {} }

var map = false;
var markers = {};
var poolLayer = null;

// Layer controls
var baseLayerControl = null;

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
export async function initMap() {
    if (map) return map;

    let settings = await loadSettings();

    map = L.map('map', {
        zoomControl: false,
        center: stateCenter,
        zoom: stateZoom
    });

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
        btn.innerHTML = '<i class="fa fa-home"></i>';
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:30px;height:30px;font-size:16px;';
        btn.addEventListener('click', function(e) {
            L.DomEvent.preventDefault(e);
            L.DomEvent.stopPropagation(e);
            if (homeCallback) { homeCallback(); }
            else { map.setView(stateCenter, stateZoom); }
        });
        div.appendChild(btn);
        return div;
    };
    homeCtl.addTo(map);

    // Base layer control
    baseLayerControl = L.control.layers(baseLayers, {}, { position: 'topright', collapsed: true }).addTo(map);

    // Boundary overlays (radio-button style) — restore saved selection
    let boundaries = await loadBoundaryOverlays(map);
    if (Object.keys(boundaries).length) {
        let savedBoundary = settings.boundary || 'none';
        addBoundaryControl(map, boundaries, 'topright', savedBoundary);
    }

    // Resize pool markers on zoom change
    map.on('zoomend', onZoomResizeMarkers);

    mapReadyResolve(map);
    return map;
}

// =============================================================================
// POOL MARKERS — driven by the same filtered rows as the pool list
// =============================================================================
export function plotPoolRows(rows, onPoolClick=null) {
    clearPoolMarkers();
    if (!rows || !rows.length) return;

    let group = L.featureGroup();

    rows.forEach(row => {
        let lat = parseFloat(row.latitude || row.mappedLatitude);
        let lng = parseFloat(row.longitude || row.mappedLongitude);
        if (isNaN(lat) || isNaN(lng)) return;

        let poolId = row.poolId || row.mappedPoolId || '';
        let status = row.poolStatus || row.mappedPoolStatus || '';
        let color = getPoolColor(status);
        let surveyLevel = getSurveyLevel(row);
        let marker = createShapeMarker([lat, lng], color, surveyLevel);

        // Brief tooltip on hover, detailed popup on click
        marker.bindTooltip(poolTooltipText(row), tooltipOptions);
        marker.bindPopup(poolPopupHtml(row), { maxWidth: 280 });

        if (onPoolClick) {
            marker.on('click', function() { onPoolClick(row); });
        }

        markers[poolId] = marker;
        group.addLayer(marker);
    });

    poolLayer = group.addTo(map);
}

// Legacy GeoJSON loader
export async function loadPoolMarkers(searchTerm=false, onPoolClick=null) {
    try {
        let data = await fetchMappedPoolGeoJson(searchTerm);
        clearPoolMarkers();

        if (data.features) {
            poolLayer = L.geoJSON(data, {
                pointToLayer: function(feature, latlng) {
                    let props = feature.properties;
                    let color = getPoolColor(props.poolStatus || props.mappedPoolStatus);
                    return L.circleMarker(latlng, {
                        radius: 6, fillColor: color, color: '#333',
                        weight: 1, opacity: 1, fillOpacity: 0.8
                    });
                },
                onEachFeature: function(feature, layer) {
                    let props = feature.properties;
                    let poolId = props.mappedPoolId || props.poolId || '';
                    let status = props.poolStatus || props.mappedPoolStatus || '';
                    let town = props.townName || props.mappedTownName || '';
                    layer.bindTooltip(`${poolId} - ${town}<br>${status}`, tooltipOptions);
                    if (onPoolClick) layer.on('click', function() { onPoolClick(props); });
                    markers[poolId] = layer;
                }
            }).addTo(map);
        }
        return data;
    } catch(err) {
        console.error('map.js=>loadPoolMarkers error:', err);
        return null;
    }
}

export function clearPoolMarkers() {
    if (poolLayer) { map.removeLayer(poolLayer); poolLayer = null; }
    markers = {};
}

// Icon size scales with zoom level
function getIconSize() {
    if (!map) return 14;
    let z = map.getZoom();
    if (z >= 17) return 28;
    if (z >= 15) return 22;
    if (z >= 13) return 18;
    if (z >= 11) return 14;
    return 10;
}

function createShapeMarker(latlng, fillColor, surveyLevel) {
    let size = getIconSize();
    let icon = buildShapeIcon(fillColor, surveyLevel, size);
    let marker = L.marker(latlng, { icon: icon });
    marker._vpColor = fillColor;
    marker._vpLevel = surveyLevel;
    return marker;
}

function onZoomResizeMarkers() {
    let size = getIconSize();
    Object.values(markers).forEach(m => {
        if (m._vpColor) m.setIcon(buildShapeIcon(m._vpColor, m._vpLevel, size));
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
    if (map) map.setView(stateCenter, stateZoom);
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
