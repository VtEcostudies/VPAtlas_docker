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
export const stateBounds = [[42.726853, -73.43774], [45.016659, -71.464555]];

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
    html += `<a href="/explore/pool_view.html?poolId=${poolId}" style="font-size:13px;">Detail</a>`;
    html += `<a href="/survey/visit_create.html?poolId=${poolId}" style="font-size:13px;">+ Atlas Visit</a>`;
    html += `<a href="/survey/find_pool.html?poolId=${poolId}" style="font-size:13px;">Find Pool</a>`;
    html += `</div></div>`;
    return html;
}

// =============================================================================
// COMBINED TOOLTIP — shows one tooltip listing every map item under the cursor
// =============================================================================
// When the user hovers over a spot where 2+ items overlap (e.g. stacked pool
// markers, or a marker on top of a county boundary), Leaflet's default
// behavior surfaces only the topmost layer's tooltip. This helper replaces
// that with a single tooltip enumerating all hits.
//
// Behavior:
//   - 0 hits: no tooltip.
//   - 1 hit:  let Leaflet's per-layer bindTooltip do its normal thing.
//   - 2+ hits: close per-layer tooltips, show one combined tooltip.
//
// The function consults each layer's existing bindTooltip content so call
// sites don't have to register tooltip text twice. It scans markers
// (L.Marker, L.CircleMarker) and polygon GeoJSON layers (L.Polygon).
//
// Call once after the map is created and after baseline layers/markers are
// added — new layers attached later participate automatically because we
// iterate map.eachLayer on every mousemove.
export function wireCombinedTooltip(map, options = {}) {
    let tooltip = L.tooltip({
        sticky: true,
        direction: options.direction || 'top',
        offset: options.offset || [0, -10],
        opacity: 0.95,
        className: 'combined-tooltip ' + (options.className || '')
    });
    let visible = false;
    let lastFingerprint = '';

    function tooltipContent(layer) {
        let tt = layer.getTooltip && layer.getTooltip();
        if (!tt) return '';
        let c = tt._content;
        if (typeof c === 'function') c = c(layer);
        return c || '';
    }

    function markerHits(mousePoint) {
        let hits = [];
        map.eachLayer(l => {
            if (!(l instanceof L.CircleMarker) && !(l instanceof L.Marker)) return;
            if (!l.getTooltip || !l.getTooltip()) return;
            // The user's GPS dot has no tooltip and is filtered above; defensive.
            let mPt;
            try { mPt = map.latLngToContainerPoint(l.getLatLng()); }
            catch(_) { return; }
            let r;
            if (l instanceof L.CircleMarker) {
                r = (l.getRadius() || 6) + 2;
            } else if (l.options.icon && l.options.icon.options.iconSize) {
                let s = l.options.icon.options.iconSize;
                r = Math.max(s[0], s[1]) / 2;
            } else {
                r = 12;
            }
            if (Math.hypot(mPt.x - mousePoint.x, mPt.y - mousePoint.y) <= r) hits.push(l);
        });
        return hits;
    }

    function polygonHits(latlng) {
        let hits = [];
        map.eachLayer(l => {
            // L.Polygon also covers L.Rectangle; we treat both the same.
            if (!(l instanceof L.Polygon)) return;
            if (!l.getTooltip || !l.getTooltip()) return;
            let bounds;
            try { bounds = l.getBounds(); } catch(_) { return; }
            if (!bounds.contains(latlng)) return;
            if (pointInPolygon(latlng, l.getLatLngs())) hits.push(l);
        });
        return hits;
    }

    // Recursive ray-casting that handles single rings, rings-with-holes, and
    // multi-polygons (Leaflet returns nested arrays for those).
    function pointInPolygon(latlng, latlngs) {
        if (!latlngs || !latlngs.length) return false;
        let first = latlngs[0];
        // Multi-polygon: array of polygons (each is array of rings)
        if (Array.isArray(first) && Array.isArray(first[0]) && Array.isArray(first[0][0])) {
            return latlngs.some(poly => pointInPolygon(latlng, poly));
        }
        // Polygon-with-holes: array of rings. Hit if inside outer and outside any hole.
        if (Array.isArray(first) && first[0] && first[0].lat !== undefined) {
            let outer = first;
            if (!raycast(latlng, outer)) return false;
            for (let i = 1; i < latlngs.length; i++) {
                if (raycast(latlng, latlngs[i])) return false; // inside a hole
            }
            return true;
        }
        // Plain ring: array of LatLng objects
        return raycast(latlng, latlngs);
    }

    function raycast(latlng, ring) {
        let inside = false;
        let x = latlng.lng, y = latlng.lat;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            let xi = ring[i].lng, yi = ring[i].lat;
            let xj = ring[j].lng, yj = ring[j].lat;
            let intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi || 1e-12) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function clear() {
        if (visible) { map.closeTooltip(tooltip); visible = false; lastFingerprint = ''; }
    }

    map.on('mousemove', (e) => {
        let hits = [...markerHits(e.containerPoint), ...polygonHits(e.latlng)];
        if (hits.length < 2) { clear(); return; }
        // Suppress per-layer tooltips so we don't double-display.
        hits.forEach(l => l.closeTooltip && l.closeTooltip());
        let fp = hits.map(l => L.Util.stamp(l)).sort().join(',');
        if (fp !== lastFingerprint) {
            tooltip.setContent(hits.map(l => `<div>${tooltipContent(l)}</div>`).join(''));
            lastFingerprint = fp;
        }
        tooltip.setLatLng(e.latlng);
        if (!visible) { tooltip.addTo(map); visible = true; }
    });
    map.on('mouseout', clear);
    map.on('movestart zoomstart', clear);
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

    layers['Google Satellite +'] = L.tileLayer(
        'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        { maxZoom: 21, subdomains: ['0','1','2','3'], attribution: '&copy; Google' }
    );
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

// Add boundary overlays as radio buttons (only one at a time) in a separate layer control.
// Uses Leaflet's native base-layer radio behavior with an empty "None" layer as default.
export function addBoundaryOverlays(map, layerControl, boundaries, savedBoundary = 'none') {
    let boundaryNames = {
        state: 'State Boundary',
        county: 'County Boundaries',
        town: 'Town Boundaries'
    };

    // "None" is an empty layer group that acts as the default radio selection
    let noneLayer = L.layerGroup();
    let radioLayers = { 'No Boundaries': noneLayer };

    ['state', 'county', 'town'].forEach(key => {
        if (!boundaries[key]) return;
        radioLayers[boundaryNames[key]] = boundaries[key];
    });

    // Add the saved selection (or "None") to the map
    let activeKey = savedBoundary !== 'none' && boundaryNames[savedBoundary]
        ? boundaryNames[savedBoundary] : 'No Boundaries';
    radioLayers[activeKey].addTo(map);

    // Separate layer control for boundaries — radio buttons
    L.control.layers(radioLayers, {}, { position: 'topright', collapsed: true }).addTo(map);

    // Persist selection
    map.on('baselayerchange', function(e) {
        let boundaryKey = Object.keys(boundaryNames).find(k => boundaryNames[k] === e.name);
        saveSettings({ boundary: boundaryKey || 'none' });
    });
}

// =============================================================================
// LEGEND — pool status colors + survey level shapes
// =============================================================================
export async function addLegend(map, position = 'bottomleft') {
    let settings = await loadSettings();
    // Lazy-imported parcels module — present in the SW cache but not always
    // pre-loaded; using dynamic import keeps the legend function decoupled.
    let parcels = null;
    try { parcels = await import('/js/parcels.js'); } catch(e) { /* optional */ }

    let ctl = L.Control.extend({
        options: { position: position },
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
            body.innerHTML = `
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

            // Parcel toggle — only added if the parcels module loaded
            if (parcels) {
                let title = document.createElement('div');
                title.className = 'pool-legend-title';
                title.style.marginTop = '6px';
                title.textContent = 'Overlays';
                body.appendChild(title);

                let item = document.createElement('label');
                item.className = 'pool-legend-item pool-legend-toggle';
                item.style.cursor = 'pointer';
                let cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = !!settings.parcelsVisible;
                cb.style.cssText = 'margin:0 5px 0 0; accent-color:#8B0000;';
                let icon = document.createElement('span');
                icon.innerHTML = '<svg width="14" height="14"><rect x="1" y="1" width="12" height="12" fill="none" stroke="#8B0000" stroke-width="1.5" opacity="0.7"/></svg>';
                icon.style.cssText = 'display:inline-flex; align-items:center; margin-right:3px;';
                item.appendChild(cb);
                item.appendChild(icon);
                item.appendChild(document.createTextNode('Parcels'));
                body.appendChild(item);

                // Init the parcel layer once and wire the checkbox
                parcels.initParcelLayer(map).then(() => {
                    if (cb.checked) parcels.showParcels();
                }).catch(() => {});

                cb.addEventListener('change', () => {
                    if (cb.checked) parcels.showParcels();
                    else parcels.hideParcels();
                    saveSettings({ parcelsVisible: cb.checked });
                });
            }
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

    // Boundary overlays — added to the same layer control as overlays
    let boundaries = await loadBoundaryOverlays(map);
    if (Object.keys(boundaries).length) {
        let savedBoundary = settings.boundary || 'none';
        addBoundaryOverlays(map, layerControl, boundaries, savedBoundary);
    }

    // Legend
    addLegend(map, 'bottomleft');

    return map;
}
