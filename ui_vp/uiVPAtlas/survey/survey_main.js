// survey_main.js - Page orchestration for VPAtlas active survey
// Plain script (not module). Global variables accessed by HTML and app.js.

// Global variables
let surveyState = null;
let surveyMap = null;
let wakeLock = null;
let keepAliveAudio = null;
let trackPolyline = null;
let observationMarkers = [];
let gpsWatchId = null;
let elapsedInterval = null;
let simulateInterval = null;
var vtCtr = [43.858297, -72.446594]; // Vermont center for default map view
let exit_url = '/survey/find_pool.html?tab_id=previous';

// ---- Screen Wake Lock ----
async function requestWakeLock() {
    // Standard Wake Lock API (Chrome, Android)
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock acquired');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released');
                wakeLock = null;
            });
        } catch (err) {
            console.warn('Wake Lock request failed:', err.message);
        }
    }
    // Silent audio keep-alive (iOS Safari fallback)
    startKeepAliveAudio();
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
    stopKeepAliveAudio();
}

// Silent audio loop keeps iOS from suspending the page during GPS tracking.
function startKeepAliveAudio() {
    if (keepAliveAudio) return;
    try {
        keepAliveAudio = new Audio('/survey/silence.wav');
        keepAliveAudio.loop = true;
        keepAliveAudio.volume = 0.01;
        keepAliveAudio.play().then(() => {
            console.log('Keep-alive audio started');
        }).catch(err => {
            console.warn('Keep-alive audio failed:', err.message);
            keepAliveAudio = null;
        });
    } catch(err) {
        console.warn('Keep-alive audio not supported:', err.message);
    }
}

function stopKeepAliveAudio() {
    if (keepAliveAudio) {
        keepAliveAudio.pause();
        keepAliveAudio.src = '';
        keepAliveAudio = null;
        console.log('Keep-alive audio stopped');
    }
}

// iOS requires a user gesture to start audio.
let keepAliveGestureSetup = false;
function setupKeepAliveOnGesture() {
    if (keepAliveGestureSetup) return;
    keepAliveGestureSetup = true;
    function onFirstGesture() {
        if (!keepAliveAudio && surveyState?.state?.gpsTracking?.enabled &&
            surveyState.state.status !== 'complete' && surveyState.state.status !== 'uploaded') {
            startKeepAliveAudio();
        }
        document.removeEventListener('touchstart', onFirstGesture);
        document.removeEventListener('click', onFirstGesture);
    }
    document.addEventListener('touchstart', onFirstGesture, {once: true});
    document.addEventListener('click', onFirstGesture, {once: true});
}

// ---- GPS Tracking ----
function startGpsTracking() {
    if (!surveyState || !surveyState.state.gpsTracking.enabled) return;

    const gpsOpts = {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
    };

    // Simulated GPS for testing
    if (surveyState.state.gpsTracking.simulate) {
        console.log('GPS: Starting simulated tracking');
        let simLat = vtCtr[0];
        let simLng = vtCtr[1];
        const drift = surveyState.state.gpsTracking.simulate;
        simulateInterval = setInterval(() => {
            simLat += (Math.random() - 0.5) * drift[0] * 2;
            simLng += (Math.random() - 0.5) * drift[1] * 2;
            onGpsPosition({
                coords: { latitude: simLat, longitude: simLng, accuracy: 5 + Math.random() * 10 },
                timestamp: Date.now()
            });
        }, surveyState.state.gpsTracking.interval);
        updateGpsIndicator(true);
        return;
    }

    // Real GPS
    gpsWatchId = navigator.geolocation.watchPosition(
        onGpsPosition,
        onGpsError,
        gpsOpts
    );
    updateGpsIndicator(true);
    console.log('GPS: watchPosition started, id:', gpsWatchId);
}

function stopGpsTracking() {
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
    if (simulateInterval) {
        clearInterval(simulateInterval);
        simulateInterval = null;
    }
    updateGpsIndicator(false);
    console.log('GPS: tracking stopped');
}

function onGpsPosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const acc = position.coords.accuracy;
    const threshold = surveyState.state.gpsTracking.accuracy_threshold;

    // Reject low-accuracy points
    if (acc > threshold) {
        console.log(`GPS: rejected point, accuracy ${acc.toFixed(1)}m > ${threshold}m`);
        return;
    }

    // Check minimum distance threshold
    const last = surveyState.state.gpsTracking.lastLocation;
    if (last) {
        const dist = surveyState.haversineDistance(last.lat, last.lng, lat, lng);
        if (dist < surveyState.state.gpsTracking.threshold_meters) {
            return; // too close to last point
        }
    }

    const point = surveyState.addTrackPoint(lat, lng, acc);
    updateTrackPolyline(lat, lng);
    updateGpsMonitorDisplay(position);
}

function onGpsError(err) {
    console.warn('GPS error:', err.code, err.message);
    updateGpsIndicator(false);
}

// ---- Map / Track Rendering ----
function initMap() {
    surveyMap = L.map('surveyMap').setView(vtCtr, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(surveyMap);

    trackPolyline = L.polyline([], {
        color: '#2c5530',
        weight: 3,
        opacity: 0.8
    }).addTo(surveyMap);
}

function updateTrackPolyline(lat, lng) {
    if (!trackPolyline) return;
    trackPolyline.addLatLng([lat, lng]);
    surveyMap.panTo([lat, lng]);
}

function addObservationMarker(obs) {
    if (!obs.lat || !obs.lng || !surveyMap) return;
    const marker = L.circleMarker([obs.lat, obs.lng], {
        radius: 8,
        fillColor: '#c44100',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
    }).addTo(surveyMap);
    marker.bindPopup(`<b>${obs.label || 'Observation'}</b><br>${obs.time || ''}`);
    observationMarkers.push(marker);
}

// ---- GPS Indicator ----
function updateGpsIndicator(active) {
    const dot = document.getElementById('gpsIndicator');
    if (!dot) return;
    dot.classList.toggle('gps-active', active);
    dot.classList.toggle('gps-inactive', !active);
}

// ---- GPS Monitor Overlay ----
function updateGpsMonitorDisplay(position) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    if (position && position.coords) {
        setVal('gpsLatitude', position.coords.latitude.toFixed(6));
        setVal('gpsLongitude', position.coords.longitude.toFixed(6));
        setVal('gpsHAccuracy', (position.coords.accuracy || 0).toFixed(1) + ' m');
        setVal('signalQuality', position.coords.accuracy < 10 ? 'GOOD' : position.coords.accuracy < 25 ? 'FAIR' : 'POOR');
        setVal('gpsDataSource', surveyState.state.gpsTracking.simulate ? 'Simulated' : 'Device GPS');
    }
    setVal('pointCount', surveyState.state.gpsTracking.trackPoints.length);
    setVal('trackingStatus', surveyState.state.gpsTracking.enabled ? 'Active' : 'Stopped');
    setVal('gpsWakeLock', wakeLock ? 'Active' : 'None');
    setVal('gpsKeepAlive', keepAliveAudio ? 'Playing' : 'None');

    // Update monitor dot color
    const monitorDot = document.getElementById('monitorDot');
    if (monitorDot) {
        monitorDot.className = 'gps-dot ' + (surveyState.state.gpsTracking.enabled ? 'gps-dot-active' : '');
    }
}

// ---- Elapsed Time ----
function startElapsedTimer() {
    elapsedInterval = setInterval(() => {
        if (!surveyState) return;
        surveyState.updateElapsedTime();
        const el = document.getElementById('elapsedTime');
        if (el) el.textContent = surveyState.getElapsedTimeFormatted();
    }, 1000);
}

function stopElapsedTimer() {
    if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
    }
}

// ---- UI: Show correct fields for survey type ----
function showSurveyTypeFields(type) {
    const visitFields = document.getElementById('visitFields');
    const monitorFields = document.getElementById('monitorFields');
    if (visitFields) visitFields.style.display = type === 'visit' ? 'block' : 'none';
    if (monitorFields) monitorFields.style.display = type === 'monitor' ? 'block' : 'none';
}

// ---- UI: Render observation list ----
function renderObservationList() {
    const listEl = document.getElementById('observationList');
    if (!listEl || !surveyState) return;
    const obs = surveyState.state.observations;
    if (obs.length === 0) {
        listEl.innerHTML = '<p class="text-muted">No point observations yet.</p>';
        return;
    }
    let html = '';
    for (const o of obs) {
        html += `<div class="observation-list-item">
            <span><strong>${o.label || 'Observation'}</strong> - ${o.time || ''}</span>
            <button class="btn btn-sm btn-outline-danger" onclick="removeObservation('${o.id}')">X</button>
        </div>`;
    }
    listEl.innerHTML = html;
}

function removeObservation(obsId) {
    if (!surveyState) return;
    surveyState.removeObservation(obsId);
    // Remove marker
    // (simplified: re-render all markers)
    renderObservationList();
}

// ---- End Survey ----
function endSurvey() {
    if (!surveyState) return;
    if (!confirm('End this survey? Data will be saved locally.')) return;

    surveyState.state.stop_time = new Date().toTimeString().slice(0, 5);
    surveyState.state.status = 'complete';

    // Capture form data into state
    captureFormData();

    stopGpsTracking();
    stopElapsedTimer();
    releaseWakeLock();
    surveyState.saveState().then(() => {
        console.log('Survey ended and saved');
        window.location.href = exit_url;
    });
}

function captureFormData() {
    if (!surveyState) return;
    const s = surveyState.state;

    s.survey_notes = document.getElementById('surveyNotes')?.value || null;

    if (s.surveyType === 'visit') {
        s.visit_data.waterLevel = document.getElementById('waterLevel')?.value || null;
        s.visit_data.canopyCover = parseInt(document.getElementById('canopyCover')?.value) || null;
        // Species checklist
        const species = [];
        if (document.getElementById('spWoodFrog')?.checked) species.push('wood_frog');
        if (document.getElementById('spSpottedSalamander')?.checked) species.push('spotted_salamander');
        if (document.getElementById('spJeffersonSalamander')?.checked) species.push('jefferson_salamander');
        if (document.getElementById('spFairyShrimp')?.checked) species.push('fairy_shrimp');
        if (document.getElementById('spFingernailClam')?.checked) species.push('fingernail_clam');
        s.visit_data.speciesPresent = species;
    }

    if (s.surveyType === 'monitor') {
        s.monitor_data.equipment.dipNetSweeps = parseInt(document.getElementById('equipDipNet')?.value) || 0;
        s.monitor_data.equipment.trapCount = parseInt(document.getElementById('equipTrapCount')?.value) || 0;
        s.monitor_data.amphibians.eggMasses = parseInt(document.getElementById('amphibEggMass')?.value) || 0;
        s.monitor_data.amphibians.larvae = parseInt(document.getElementById('amphibLarvae')?.value) || 0;
        s.monitor_data.amphibians.adults = parseInt(document.getElementById('amphibAdults')?.value) || 0;
        s.monitor_data.macroinvertebrates.fairyShrimp = parseInt(document.getElementById('macroFairyShrimp')?.value) || 0;
        s.monitor_data.macroinvertebrates.caddisflyLarvae = parseInt(document.getElementById('macroCaddisfly')?.value) || 0;
    }
}

// ---- Add Point Observation ----
function addPointObservation() {
    const lastLoc = surveyState?.state?.gpsTracking?.lastLocation;
    const label = prompt('Observation label (e.g. "egg mass cluster"):');
    if (!label) return;

    const obs = {
        label: label,
        lat: lastLoc?.lat ?? null,
        lng: lastLoc?.lng ?? null,
        notes: ''
    };
    const saved = surveyState.addObservation(obs);
    addObservationMarker(saved);
    renderObservationList();
}

// ---- initApp: called by app.js after resources are loaded ----
async function initApp() {
    console.log('survey_main.js => initApp()');

    const params = new URLSearchParams(window.location.search);
    let survey_init = {};

    if (params.get('survey_uuid')) {
        // Resume existing survey
        survey_init.survey_uuid = params.get('survey_uuid');
    } else {
        // New survey from start page params
        survey_init.pool_id = params.get('pool_id');
        survey_init.survey_type = params.get('survey_type');
        survey_init.date = params.get('date');
        survey_init.time = params.get('time');
        survey_init.gps_track = params.get('gps_track');
        survey_init.gps_simulate = params.get('gps_simulate');
    }

    try {
        surveyState = await new SurveyState(survey_init);
    } catch (err) {
        console.error('Failed to initialize survey state:', err);
        alert('Failed to load survey: ' + err.message);
        window.location.href = exit_url;
        return;
    }

    const state = surveyState.state;

    // Update header
    document.getElementById('location_label').textContent = state.poolId || 'Unknown Pool';
    document.getElementById('survey_type_label').textContent =
        state.surveyType === 'visit' ? 'Visit' : state.surveyType === 'monitor' ? 'Monitoring' : '';

    // Show appropriate form fields
    showSurveyTypeFields(state.surveyType);

    // Initialize map
    initMap();

    // Render existing track points (for resumed surveys)
    if (state.gpsTracking.trackPoints.length > 0) {
        const latlngs = state.gpsTracking.trackPoints.map(p => [p.lat, p.lng]);
        trackPolyline.setLatLngs(latlngs);
        surveyMap.fitBounds(trackPolyline.getBounds().pad(0.1));
    }

    // Render existing observations
    for (const obs of state.observations) {
        addObservationMarker(obs);
    }
    renderObservationList();

    // Start elapsed timer
    startElapsedTimer();

    // Start GPS tracking if enabled
    if (state.gpsTracking.enabled && state.status !== 'complete' && state.status !== 'uploaded') {
        await requestWakeLock();
        setupKeepAliveOnGesture();
        startGpsTracking();
    }

    // Wire up UI events
    document.getElementById('exitBtn')?.addEventListener('click', function(e) {
        e.preventDefault();
        if (state.status !== 'complete') {
            captureFormData();
            surveyState.saveState();
        }
        stopGpsTracking();
        stopElapsedTimer();
        releaseWakeLock();
        window.location.href = exit_url;
    });

    document.getElementById('endSurveyBtn')?.addEventListener('click', endSurvey);
    document.getElementById('addObservationBtn')?.addEventListener('click', addPointObservation);

    // GPS monitor overlay toggle
    document.getElementById('openGpsMonitor')?.addEventListener('click', () => {
        document.getElementById('gpsMonitorOverlay').style.display = 'block';
    });
    document.getElementById('closeGpsMonitor')?.addEventListener('click', () => {
        document.getElementById('gpsMonitorOverlay').style.display = 'none';
    });

    // Disable inputs if survey is already complete
    if (state.status === 'complete' || state.status === 'uploaded') {
        document.getElementById('endSurveyBtn').disabled = true;
        document.getElementById('endSurveyBtn').textContent = 'Survey Complete';
        document.getElementById('addObservationBtn').disabled = true;
    }

    console.log('survey_main.js => initApp() complete, survey_uuid:', state.survey_uuid);
}
