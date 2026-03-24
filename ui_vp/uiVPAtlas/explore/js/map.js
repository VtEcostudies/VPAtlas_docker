/*
    map.js - Leaflet map management for VPAtlas explore app
    ES6 module, singleton map instance.

    Base layers: OSM, Satellite, Topo, VCGI CIR, VCGI Leaf-Off, VCGI Lidar DEM/DSM/Slope
    Overlays: State boundary, County boundaries, Town boundaries, Parcel boundaries, Pool markers
*/
import { showWait, hideWait } from './utils.js';
import { fetchMappedPoolGeoJson, fetchTowns, fetchCounties } from './api.js';
import { filters, putUserState } from './url_state.js';

const eleMap = document.getElementById('map');
var map = false;
var markers = {};
var poolLayer = null;

// Overlay layers
var stateBoundary = null;
var countyBoundary = null;
var townBoundary = null;

// Layer controls
var baseLayerControl = null;
var overlayControl = null;

// Home button callback
var homeCallback = null;
export function setHomeCallback(cb) { homeCallback = cb; }

var mapReadyResolve;
export var mapReady = new Promise(resolve => { mapReadyResolve = resolve; });

// Vermont center
var stateCenter = [43.858297, -72.446594];
var stateZoom = 8;

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
export function initMap() {
    if (map) return map;

    map = L.map('map', {
        zoomControl: false,
        center: stateCenter,
        zoom: stateZoom
    });

    // --- BASE LAYERS ---
    var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    });

    var satelliteLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: '&copy; Esri' }
    );

    var topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '&copy; OpenTopoMap'
    });

    var esriTopo = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: '&copy; Esri' }
    );

    // VCGI tile layers
    var vcgiCIR = L.tileLayer(
        'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_CIR_WM_CACHE/ImageServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, attribution: 'VCGI CIR' }
    );

    var vcgiCLR = L.tileLayer(
        'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_CLR_WM_CACHE/ImageServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, attribution: 'VCGI Leaf-Off Imagery' }
    );

    // VCGI Lidar layers (use esri-leaflet imageMapLayer)
    var vcgiLidarDEM = null;
    var vcgiLidarDSM = null;
    var vcgiLidarSlope = null;

    if (typeof L.esri !== 'undefined') {
        vcgiLidarDEM = L.esri.imageMapLayer({
            url: 'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_LIDARHILLSHD_WM_CACHE_v1/ImageServer',
            maxZoom: 20, attribution: 'VCGI Lidar'
        });
        vcgiLidarDSM = L.esri.imageMapLayer({
            url: 'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_LIDARDSMHILLSHD_SP_CACHE_v1/ImageServer/',
            maxZoom: 20, attribution: 'VCGI Lidar'
        });
        vcgiLidarSlope = L.esri.imageMapLayer({
            url: 'https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/IMG_VCGI_LIDARSLOPESYM_SP_NOCACHE_v1/ImageServer/',
            maxZoom: 20, attribution: 'VCGI Lidar'
        });
    }

    // Default base layer
    esriTopo.addTo(map);

    // Build base layers object
    var baseLayers = {
        'Esri Topo': esriTopo,
        'Street Map': osmLayer,
        'Satellite': satelliteLayer,
        'Open Topo': topoLayer,
        'VCGI CIR': vcgiCIR,
        'VCGI Leaf-Off': vcgiCLR,
    };
    if (vcgiLidarDEM) baseLayers['VCGI Lidar DEM Hill Shade'] = vcgiLidarDEM;
    if (vcgiLidarDSM) baseLayers['VCGI Lidar DSM Hill Shade'] = vcgiLidarDSM;
    if (vcgiLidarSlope) baseLayers['VCGI Lidar Slope Sym'] = vcgiLidarSlope;

    // --- OVERLAYS ---
    var overlays = {};

    // Load boundary GeoJSON
    loadBoundaryOverlays(overlays);

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

    // Layer controls
    baseLayerControl = L.control.layers(baseLayers, overlays, { position: 'topright', collapsed: true }).addTo(map);

    mapReadyResolve(map);
    return map;
}

// =============================================================================
// BOUNDARY OVERLAYS
// =============================================================================
async function loadBoundaryOverlays(overlays) {
    try {
        // State boundary
        let stateRes = await fetch('/geojson/Polygon_VT_State_Boundary.geo.json');
        let stateGeo = await stateRes.json();
        stateBoundary = L.geoJSON(stateGeo, {
            style: { color: '#333', weight: 2, fillOpacity: 0, dashArray: '5,5' }
        });
        if (baseLayerControl) baseLayerControl.addOverlay(stateBoundary, 'State Boundary');
    } catch(err) { console.warn('map.js: state boundary load failed', err); }

    try {
        // County boundaries
        let countyRes = await fetch('/geojson/Polygon_VT_County_Boundaries.geo.json');
        let countyGeo = await countyRes.json();
        countyBoundary = L.geoJSON(countyGeo, {
            style: { color: '#8B4513', weight: 1.5, fillOpacity: 0, dashArray: '3,3' },
            onEachFeature: function(feature, layer) {
                let name = feature.properties.CNTYNAME || feature.properties.countyName || feature.properties.NAME || '';
                if (name) layer.bindTooltip(name, { sticky: true, direction: 'center', className: 'boundary-tooltip' });
            }
        });
        if (baseLayerControl) baseLayerControl.addOverlay(countyBoundary, 'County Boundaries');
    } catch(err) { console.warn('map.js: county boundary load failed', err); }

    try {
        // Town boundaries (larger file — only load on demand via layer control)
        let townRes = await fetch('/geojson/Polygon_VT_Town_Boundaries.geo.json');
        let townGeo = await townRes.json();
        townBoundary = L.geoJSON(townGeo, {
            style: { color: '#4682B4', weight: 1, fillOpacity: 0 },
            onEachFeature: function(feature, layer) {
                let name = feature.properties.TOWNNAME || feature.properties.townName || feature.properties.NAME || '';
                if (name) layer.bindTooltip(name, { sticky: true, direction: 'center', className: 'boundary-tooltip' });
            }
        });
        if (baseLayerControl) baseLayerControl.addOverlay(townBoundary, 'Town Boundaries');
    } catch(err) { console.warn('map.js: town boundary load failed', err); }
}

// =============================================================================
// POOL MARKERS
// =============================================================================
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
                        radius: 6,
                        fillColor: color,
                        color: '#333',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8
                    });
                },
                onEachFeature: function(feature, layer) {
                    let props = feature.properties;
                    let poolId = props.mappedPoolId || props.poolId || '';
                    let status = props.poolStatus || props.mappedPoolStatus || '';
                    let town = props.townName || props.mappedTownName || '';
                    layer.bindTooltip(`${poolId} - ${town}<br>${status}`, tooltipOptions);

                    if (onPoolClick) {
                        layer.on('click', function() {
                            onPoolClick(props);
                        });
                    }

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
    if (poolLayer) {
        map.removeLayer(poolLayer);
        poolLayer = null;
    }
    markers = {};
}

function getPoolColor(status) {
    switch(status) {
        case 'Confirmed': return '#27ae60';
        case 'Probable': return '#2ecc71';
        case 'Potential': return '#f39c12';
        case 'Duplicate': return '#95a5a6';
        case 'Eliminated': return '#e74c3c';
        default: return '#3498db';
    }
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

export function fitBounds(bounds) {
    if (map && bounds) map.fitBounds(bounds);
}

export function getMap() {
    return map;
}
