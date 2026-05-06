/*
    bandwidth_monitor.js — VPAtlas bandwidth monitor (pattern from LoonWeb).

    Exposes window.bandwidthMonitor with:
      .measureBandwidth({ size, force, allowReprobe }) → kbps
          size: 'small' (~35 KB pool photo, default) — fast field probe,
                used by the SW update gate. Cheap on cellular, ~1.6s at
                threshold (1.5 Mbps), ~6s at 50 kbps before timing out.
          size: 'large' (~210 KB) — higher-accuracy probe used by the
                manual "Run bandwidth test" button on /explore/system.html.
          force: skip the sessionStorage cache (default false).
          allowReprobe: run a corroborating second probe when the first
                looks unreliable (default true).
      .getStatus()       → object snapshot (connection info + last sample)
      .currentBandwidth  → kbps (most recent sample, or null)

    Both /images/speed-test.jpg and /images/speed-test-small.jpg are
    excluded from the service worker's static cache, so every measurement
    hits the network.

    Accuracy notes
    --------------
    - We prefer PerformanceResourceTiming (responseEnd − responseStart) to
      strip out DNS, TCP, and TLS setup time. On a cold connection that
      overhead can dwarf the actual transfer of a 35 KB file and make the
      raw wall-clock math read "below threshold" on a fast link.
    - We sessionStorage-cache the result with a TTL so subsequent page
      loads in the same session don't reprobe.
    - If the first probe is suspiciously fast (< MIN_TRANSFER_MS) AND the
      result is below the threshold, we run a second probe and average —
      a too-short transfer means the math is unreliable regardless of
      which clock we use.
*/
(function() {
    const TEST_FILES = {
        small: { url: '/images/speed-test-small.jpg', bytes: 35523 },
        large: { url: '/images/speed-test.jpg',       bytes: 209636 },
    };
    const MAX_SAMPLES = 5;
    const CACHE_KEY = 'bandwidth_monitor_last';
    const CACHE_TTL_MS = 5 * 60 * 1000;       // 5 minutes
    const MIN_TRANSFER_MS = 30;               // below this the math is noisy
    const REPROBE_THRESHOLD_KBPS = 1500;      // only reprobe when result is at/below the gate

    function readCache() {
        try {
            let raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            let obj = JSON.parse(raw);
            if (!obj || typeof obj.kbps !== 'number' || !obj.ts) return null;
            if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
            return obj;
        } catch (_) { return null; }
    }
    function writeCache(kbps) {
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ kbps, ts: Date.now() })); }
        catch (_) {}
    }

    // Returns { kbps, transferMs, source } or null on failure. `source` is
    // 'resource-timing' when we got body-only timing, 'wall-clock' when we
    // had to fall back to fetch start/end.
    async function singleProbe(url, fallbackBytes) {
        let startedWall = performance.now();
        let res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        let blob = await res.blob();
        let endedWall = performance.now();
        let bytes = blob.size || fallbackBytes;

        // Prefer the resource-timing entry — it gives us responseStart →
        // responseEnd, i.e. just the body-transfer window without setup.
        let transferMs = null;
        let source = 'wall-clock';
        try {
            let entries = performance.getEntriesByName(url, 'resource');
            let e = entries && entries[entries.length - 1];
            if (e && e.responseEnd > 0 && e.responseStart > 0 && e.responseEnd > e.responseStart) {
                transferMs = e.responseEnd - e.responseStart;
                source = 'resource-timing';
            }
        } catch (_) {}
        if (transferMs == null) transferMs = endedWall - startedWall;

        let kbps = (bytes * 8) / Math.max(transferMs, 1);
        return { kbps, transferMs, source, bytes };
    }

    function BandwidthMonitor() {
        this.currentBandwidth = null;   // kbps
        this.samples = [];              // [{ ts, kbps }]
        // Hydrate from cache so getStatus reads sensibly before the first probe.
        let cached = readCache();
        if (cached) {
            this.currentBandwidth = cached.kbps;
            this._addSample(cached.kbps);
        }
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
        let allowReprobe = opts.allowReprobe !== false;

        // Cache hit — skip the network probe entirely. The SW gate calls
        // this on every page load; without this every navigation costs a
        // probe.
        if (!opts.force) {
            let cached = readCache();
            if (cached) {
                this.currentBandwidth = cached.kbps;
                return cached.kbps;
            }
        }

        try {
            // Cache-bust + no-store + SW pattern exemption ensure network hit.
            let url = file.url + '?_bw=' + Date.now();
            let first = await singleProbe(url, file.bytes);
            let kbps = first.kbps;

            // Belt-and-braces: if the first transfer was too short for the
            // math to be stable AND the result is below the threshold the SW
            // gate cares about, run a second probe and average. Suspiciously
            // fast first probes are usually an artifact of cold connection
            // overhead being charged against a tiny payload.
            if (allowReprobe &&
                first.transferMs < MIN_TRANSFER_MS &&
                kbps < REPROBE_THRESHOLD_KBPS) {
                try {
                    let url2 = file.url + '?_bw=' + Date.now();
                    let second = await singleProbe(url2, file.bytes);
                    kbps = (first.kbps + second.kbps) / 2;
                } catch (_) { /* keep first */ }
            }

            this.currentBandwidth = kbps;
            this._addSample(kbps);
            writeCache(kbps);
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
        let cached = readCache();
        return {
            currentBandwidthKbps: this.currentBandwidth,
            averageBandwidthKbps: this.getAverageBandwidth(),
            samples: this.samples.slice(),
            cachedAt: cached ? cached.ts : null,
            cachedKbps: cached ? cached.kbps : null,
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
