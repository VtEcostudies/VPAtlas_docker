/*
    gps_monitor.js — Cross-page GPS coordination library.

    A reusable, app-agnostic ES6 module that wraps navigator.geolocation
    and adds:

      • Cross-page sharing via BroadcastChannel — only one tab actually calls
        watchPosition; the others receive position broadcasts. Big battery and
        UX win when multiple pages of the same app are open.
      • IndexedDB persistence of the last fix so a freshly-loaded page can
        render a stale-but-useful position immediately while waiting for the
        first live fix.
      • Wake Lock + silent-audio keep-alive so the OS doesn't suspend the
        primary tab when the screen turns off (only the primary holds these).
      • The same simple event API as the original single-page version, so
        existing callers don't need to change.

    Public API:
        const gps = new GPSMonitor(opts?)
        gps.on('position'|'status'|'error'|'mode', fn)
        gps.start()
        gps.stop()
        gps.position   // { lat, lng, accuracy, … } or null
        gps.mode       // 'idle' | 'primary' | 'passive'

    Constructor options (all optional, with sensible defaults):
        channelName        BroadcastChannel name. Pages that share this name
                           coordinate as one app. Default: 'gps-shared'.
        dbName             IndexedDB name for last-known persistence.
                           Default: 'gps-shared-db'.
        keepAliveAudioUrl  Path to a silent WAV/MP3 played on the primary as
                           an iOS Safari keep-alive fallback. Set to null to
                           disable. Default: '/survey/silence.wav'.
        sharedAcrossPages  When false, behaves like a plain single-page
                           GPS monitor (no channel, no IndexedDB). Default: true.
        heartbeatMs        Primary heartbeat interval. Default: 2000.
        aliveTimeoutMs     Passive considers primary dead after this silence.
                           Default: 5500.
        lastKnownMaxAgeMs  Don't surface a stale-from-disk position older than
                           this on construction. Default: 5 * 60 * 1000 (5 min).

    Static helpers (unchanged):
        GPSMonitor.distance(lat1, lng1, lat2, lng2)
        GPSMonitor.bearing(lat1, lng1, lat2, lng2)
        GPSMonitor.compassDir(deg)
        GPSMonitor.formatDistance(meters)
        GPSMonitor.accuracyLabel(meters)
*/

const DEFAULTS = {
    channelName: 'gps-shared',
    dbName: 'gps-shared-db',
    keepAliveAudioUrl: '/survey/silence.wav',
    sharedAcrossPages: true,
    heartbeatMs: 2000,
    aliveTimeoutMs: 5500,
    lastKnownMaxAgeMs: 5 * 60 * 1000
};

export class GPSMonitor {
    constructor(opts = {}) {
        this.opts = Object.assign({}, DEFAULTS, opts);
        this.tabId = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : 't-' + Math.random().toString(36).slice(2);

        this.position = null;
        this.isTracking = false;
        this.mode = 'idle';   // 'idle' | 'primary' | 'passive'
        this.listeners = {};
        this.positionHistory = [];

        // Native watch + keep-alive (primary only)
        this.watchId = null;
        this._wakeLock = null;
        this._keepAliveAudio = null;
        this._onVisibilityChange = null;

        // Cross-page coordination
        this._chan = null;
        this._lastPrimarySeen = 0;
        this._heartbeatTimer = null;
        this._electionTimer = null;
        this._claimedTs = 0;
        this._byeListener = null;

        // Try to surface a recent persisted fix immediately. Listeners
        // registered after construction will still see it because we
        // re-emit on a microtask.
        if (this.opts.sharedAcrossPages) this._loadLastKnown();
    }

    // ─── Event system ───────────────────────────────────────────────
    on(event, fn) { (this.listeners[event] = this.listeners[event] || []).push(fn); }
    off(event, fn) { this.listeners[event] = (this.listeners[event] || []).filter(f => f !== fn); }
    emit(event, data) { (this.listeners[event] || []).forEach(fn => fn(data)); }

    // ─── Lifecycle ──────────────────────────────────────────────────
    start() {
        if (this.isTracking) return;
        if (!('geolocation' in navigator)) {
            this.emit('error', { code: 0, message: 'Geolocation not supported' });
            return;
        }
        this.isTracking = true;

        if (this.opts.sharedAcrossPages && typeof BroadcastChannel !== 'undefined') {
            this._chan = new BroadcastChannel(this.opts.channelName);
            this._chan.onmessage = (e) => this._onChannelMessage(e.data);
            // Election: announce ourselves and wait briefly for an existing
            // primary to identify itself. Default to becoming primary.
            this.emit('status', { tracking: true, acquiring: true, mode: 'idle' });
            this._sendChannel({ type: 'who', tabId: this.tabId, ts: Date.now() });
            this._electionTimer = setTimeout(() => {
                if (this.mode === 'idle') this._becomePrimary();
            }, 350);

            if (!this._byeListener) {
                this._byeListener = () => this._sendBye();
                window.addEventListener('pagehide', this._byeListener);
                window.addEventListener('beforeunload', this._byeListener);
            }
        } else {
            // No cross-page coordination — single-tab fallback (old behavior).
            this._becomePrimary();
        }
    }

    stop() {
        if (!this.isTracking) return;
        this._sendBye();
        this._stopWatch();
        this._stopKeepAlive();
        if (this._chan) { this._chan.close(); this._chan = null; }
        if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
        if (this._electionTimer) { clearTimeout(this._electionTimer); this._electionTimer = null; }
        if (this._byeListener) {
            window.removeEventListener('pagehide', this._byeListener);
            window.removeEventListener('beforeunload', this._byeListener);
            this._byeListener = null;
        }
        this.isTracking = false;
        this._setMode('idle');
        this.emit('status', { tracking: false, acquiring: false });
    }

    getPosition() { return this.position; }

    // ─── Channel coordination ───────────────────────────────────────
    _sendChannel(msg) { if (this._chan) try { this._chan.postMessage(msg); } catch(e) {} }

    _sendBye() {
        if (this.mode === 'primary') this._sendChannel({ type: 'bye', tabId: this.tabId });
    }

    _onChannelMessage(msg) {
        if (!msg || !msg.tabId || msg.tabId === this.tabId) return;
        switch (msg.type) {
            case 'who':
                // Someone is asking who's primary — answer if we are.
                if (this.mode === 'primary') {
                    this._sendChannel({ type: 'iam', tabId: this.tabId, ts: this._claimedTs });
                }
                break;
            case 'iam':
            case 'pos':
            case 'heartbeat':
                this._lastPrimarySeen = Date.now();
                if (this.mode === 'idle') {
                    if (this._electionTimer) { clearTimeout(this._electionTimer); this._electionTimer = null; }
                    this._becomePassive();
                } else if (this.mode === 'primary' && msg.type === 'iam' &&
                           typeof msg.ts === 'number' && msg.ts < this._claimedTs) {
                    // An older primary exists — defer to it.
                    this._stopWatch();
                    this._stopKeepAlive();
                    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
                    this._becomePassive();
                }
                if (msg.type === 'pos' && msg.position) this._handleRemotePosition(msg.position);
                break;
            case 'bye':
                // Primary is leaving. Run a fresh election after small jitter
                // so two passives don't both try to become primary instantly.
                if (this.mode === 'passive' && this.isTracking) {
                    this._setMode('idle');
                    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
                    this._sendChannel({ type: 'who', tabId: this.tabId, ts: Date.now() });
                    this._electionTimer = setTimeout(() => {
                        if (this.mode === 'idle') this._becomePrimary();
                    }, 200 + Math.random() * 300);
                }
                break;
        }
    }

    _becomePrimary() {
        this._setMode('primary');
        this._claimedTs = Date.now();
        this._startWatch();
        this._startKeepAlive();
        // Announce ourselves so any racing electors see us
        this._sendChannel({ type: 'iam', tabId: this.tabId, ts: this._claimedTs });
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = setInterval(() => {
            if (this.mode === 'primary') {
                this._sendChannel({ type: 'heartbeat', tabId: this.tabId, ts: Date.now() });
            }
        }, this.opts.heartbeatMs);
    }

    _becomePassive() {
        this._setMode('passive');
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        // Watch for a dead primary; trigger an election if quiet too long.
        this._heartbeatTimer = setInterval(() => {
            if (this.mode !== 'passive' || !this.isTracking) return;
            if (Date.now() - this._lastPrimarySeen > this.opts.aliveTimeoutMs) {
                clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = null;
                this._setMode('idle');
                this._sendChannel({ type: 'who', tabId: this.tabId, ts: Date.now() });
                if (this._electionTimer) clearTimeout(this._electionTimer);
                this._electionTimer = setTimeout(() => {
                    if (this.mode === 'idle') this._becomePrimary();
                }, 250 + Math.random() * 300);
            }
        }, 1000);
    }

    _setMode(m) {
        if (this.mode === m) return;
        this.mode = m;
        this.emit('mode', m);
    }

    _handleRemotePosition(p) {
        this.position = p;
        this.positionHistory.push(p);
        if (this.positionHistory.length > 10) this.positionHistory.shift();
        this.emit('position', p);
        this.emit('status', { tracking: true, acquiring: false, accuracy: p.accuracy, mode: this.mode });
    }

    // ─── Native geolocation watch (primary only) ────────────────────
    _startWatch() {
        if (this.watchId !== null) return;
        this.emit('status', { tracking: true, acquiring: true, mode: this.mode });
        this.watchId = navigator.geolocation.watchPosition(
            (pos) => this._onPosition(pos),
            (err) => this._onError(err),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    }

    _stopWatch() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }

    _onPosition(pos) {
        let p = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            timestamp: pos.timestamp
        };
        this.position = p;
        this.positionHistory.push(p);
        if (this.positionHistory.length > 10) this.positionHistory.shift();

        this.emit('position', p);
        this.emit('status', { tracking: true, acquiring: false, accuracy: p.accuracy, mode: this.mode });

        // Broadcast and persist (only when we're actually the primary).
        if (this.mode === 'primary' && this.opts.sharedAcrossPages) {
            this._sendChannel({ type: 'pos', tabId: this.tabId, position: p });
            this._persistLastKnown(p);
        }
    }

    _onError(err) {
        this.emit('error', { code: err.code, message: err.message });
        if (err.code === 1) { // PERMISSION_DENIED
            this.stop();
            this.emit('status', { tracking: false, acquiring: false, denied: true });
        }
    }

    // ─── IndexedDB persistence (last known) ─────────────────────────
    _openDb() {
        return new Promise((resolve, reject) => {
            let r = indexedDB.open(this.opts.dbName, 1);
            r.onupgradeneeded = (e) => {
                let db = e.target.result;
                if (!db.objectStoreNames.contains('positions')) {
                    db.createObjectStore('positions', { keyPath: 'id' });
                }
            };
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }

    async _persistLastKnown(p) {
        try {
            let db = await this._openDb();
            let tx = db.transaction('positions', 'readwrite');
            tx.objectStore('positions').put({ id: 'latest', position: p, ts: Date.now() });
            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
            db.close();
        } catch(e) { /* non-fatal */ }
    }

    async _loadLastKnown() {
        try {
            let db = await this._openDb();
            let tx = db.transaction('positions', 'readonly');
            let req = tx.objectStore('positions').get('latest');
            let row = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
            db.close();
            if (row && row.position && (Date.now() - row.ts) < this.opts.lastKnownMaxAgeMs) {
                this.position = row.position;
                // Defer so listeners that subscribe synchronously after the
                // constructor still see the event.
                Promise.resolve().then(() => this.emit('position', row.position));
            }
        } catch(e) {}
    }

    // ─── Keep-alive (primary only) ──────────────────────────────────
    async _startKeepAlive() {
        if ('wakeLock' in navigator) {
            try {
                this._wakeLock = await navigator.wakeLock.request('screen');
                this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
            } catch (err) {
                console.warn('GPSMonitor: wakeLock request failed:', err.message);
            }
        }
        if (!this._onVisibilityChange) {
            this._onVisibilityChange = async () => {
                if (this.mode === 'primary' && document.visibilityState === 'visible' &&
                    'wakeLock' in navigator && !this._wakeLock) {
                    try { this._wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
                }
            };
            document.addEventListener('visibilitychange', this._onVisibilityChange);
        }
        if (this.opts.keepAliveAudioUrl && !this._keepAliveAudio) {
            try {
                let a = new Audio(this.opts.keepAliveAudioUrl);
                a.loop = true;
                a.volume = 0.01;
                a.play().catch(err => {
                    console.warn('GPSMonitor: keep-alive audio play failed:', err.message);
                    this._keepAliveAudio = null;
                });
                this._keepAliveAudio = a;
            } catch(err) {
                console.warn('GPSMonitor: keep-alive audio not supported:', err.message);
            }
        }
    }

    _stopKeepAlive() {
        if (this._wakeLock) {
            this._wakeLock.release().catch(() => {});
            this._wakeLock = null;
        }
        if (this._keepAliveAudio) {
            this._keepAliveAudio.pause();
            this._keepAliveAudio.src = '';
            this._keepAliveAudio = null;
        }
        if (this._onVisibilityChange) {
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            this._onVisibilityChange = null;
        }
    }

    // ─── Static utilities ───────────────────────────────────────────

    // Haversine distance in meters
    static distance(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // Bearing in degrees (0=N, 90=E, 180=S, 270=W)
    static bearing(lat1, lng1, lat2, lng2) {
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
        let deg = Math.atan2(y, x) * 180 / Math.PI;
        return (deg + 360) % 360;
    }

    // Compass direction label
    static compassDir(bearing) {
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        return dirs[Math.round(bearing / 22.5) % 16];
    }

    // Format distance for display
    static formatDistance(meters) {
        if (meters < 100) return `${Math.round(meters)}m`;
        if (meters < 1000) return `${Math.round(meters)}m`;
        return `${(meters/1000).toFixed(1)}km`;
    }

    // Accuracy quality label
    static accuracyLabel(acc) {
        if (acc <= 5) return { label: 'Excellent', color: '#27ae60' };
        if (acc <= 10) return { label: 'Good', color: '#2ecc71' };
        if (acc <= 25) return { label: 'Fair', color: '#f39c12' };
        if (acc <= 50) return { label: 'OK', color: '#e67e22' };
        return { label: 'Poor', color: '#e74c3c' };
    }
}
