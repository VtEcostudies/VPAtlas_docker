/*
    gps_monitor.js - GPS position tracking for VPAtlas field apps
    ES6 module. Provides live position, accuracy, distance/bearing calculations.

    Usage:
        import { GPSMonitor } from './gps_monitor.js';
        const gps = new GPSMonitor();
        gps.on('position', (pos) => { ... });
        gps.start();
*/

export class GPSMonitor {
    constructor() {
        this.watchId = null;
        this.position = null;      // { lat, lng, accuracy, altitude, heading, speed, timestamp }
        this.isTracking = false;
        this.listeners = {};
        this.positionHistory = [];  // last 10 positions
    }

    // Event system
    on(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    off(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }

    emit(event, data) {
        (this.listeners[event] || []).forEach(fn => fn(data));
    }

    // Start watching position
    start() {
        if (this.isTracking) return;
        if (!('geolocation' in navigator)) {
            this.emit('error', { code: 0, message: 'Geolocation not supported' });
            return;
        }

        this.isTracking = true;
        this.emit('status', { tracking: true, acquiring: true });

        this.watchId = navigator.geolocation.watchPosition(
            (pos) => this._onPosition(pos),
            (err) => this._onError(err),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    }

    // Stop watching
    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        this.isTracking = false;
        this.emit('status', { tracking: false, acquiring: false });
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
        this.emit('status', { tracking: true, acquiring: false, accuracy: p.accuracy });
    }

    _onError(err) {
        this.emit('error', { code: err.code, message: err.message });
        if (err.code === 1) { // PERMISSION_DENIED
            this.stop();
            this.emit('status', { tracking: false, acquiring: false, denied: true });
        }
    }

    // Get current position (or null)
    getPosition() { return this.position; }

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
