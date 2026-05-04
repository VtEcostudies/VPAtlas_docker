/*
    bandwidth_monitor.js — VPAtlas bandwidth monitor (pattern from LoonWeb).

    Exposes window.bandwidthMonitor with:
      .measureBandwidth({ size }) → kbps
          size: 'small' (~35 KB pool photo, default) — fast field probe,
                used by the SW update gate. Cheap on cellular, ~1.6s at
                threshold (1.5 Mbps), ~6s at 50 kbps before timing out.
          size: 'large' (~210 KB) — higher-accuracy probe used by the
                manual "Run bandwidth test" button on /explore/system.html.
      .getStatus()       → object snapshot (connection info + last sample)
      .currentBandwidth  → kbps (most recent sample, or null)

    Both /images/speed-test.jpg and /images/speed-test-small.jpg are
    excluded from the service worker's static cache, so every measurement
    hits the network.
*/
(function() {
    const TEST_FILES = {
        small: { url: '/images/speed-test-small.jpg', bytes: 35523 },
        large: { url: '/images/speed-test.jpg',       bytes: 209636 },
    };
    const MAX_SAMPLES = 5;

    function BandwidthMonitor() {
        this.currentBandwidth = null;   // kbps
        this.samples = [];              // [{ ts, kbps }]
        if ('connection' in navigator && navigator.connection) {
            this._readConnection();
            try {
                navigator.connection.addEventListener('change', () => this._readConnection());
            } catch(_) {}
        }
    }

    BandwidthMonitor.prototype._readConnection = function() {
        let conn = navigator.connection;
        if (!conn) return;
        if (conn.downlink) {
            // downlink is in Mbps; convert to kbps for consistency
            let kbps = conn.downlink * 1000;
            this.currentBandwidth = kbps;
            this._addSample(kbps);
        }
    };

    BandwidthMonitor.prototype._addSample = function(kbps) {
        this.samples.push({ ts: Date.now(), kbps });
        if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    };

    BandwidthMonitor.prototype.measureBandwidth = async function(opts) {
        opts = opts || {};
        let key = opts.size === 'large' ? 'large' : 'small';
        let file = TEST_FILES[key];
        // Cache-bust query string + cache: 'no-store' + the SW pattern exemption
        // ensures we always go to the network.
        let url = file.url + '?_bw=' + Date.now();
        let started = performance.now();
        try {
            let res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            let blob = await res.blob();
            let elapsedMs = performance.now() - started;
            let bytes = blob.size || file.bytes;
            let kbps = (bytes * 8) / Math.max(elapsedMs, 1); // bits per ms == kbps
            this.currentBandwidth = kbps;
            this._addSample(kbps);
            return kbps;
        } catch (err) {
            console.warn('bandwidth_monitor: measurement failed', err);
            return null;
        }
    };

    BandwidthMonitor.prototype.getAverageBandwidth = function() {
        if (!this.samples.length) return null;
        let sum = this.samples.reduce((a, s) => a + s.kbps, 0);
        return sum / this.samples.length;
    };

    BandwidthMonitor.prototype.getStatus = function() {
        let conn = navigator.connection || null;
        return {
            currentBandwidthKbps: this.currentBandwidth,
            averageBandwidthKbps: this.getAverageBandwidth(),
            samples: this.samples.slice(),
            connectionType: conn?.type || null,
            effectiveType: conn?.effectiveType || null,
            downlinkMbps: conn?.downlink ?? null,
            rtt: conn?.rtt ?? null,
            saveData: conn?.saveData ?? null,
            online: navigator.onLine
        };
    };

    window.bandwidthMonitor = new BandwidthMonitor();
})();
