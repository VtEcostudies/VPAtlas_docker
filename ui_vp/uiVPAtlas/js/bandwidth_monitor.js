/*
    bandwidth_monitor.js — drop-in browser bandwidth monitor (pattern from LoonWeb).

    Self-contained: no imports, no app dependencies. Uses only standard browser
    APIs (fetch, performance, sessionStorage, navigator.connection).

    Globals exposed:
      window.BandwidthMonitor   — constructor, for apps that want to manage
                                  their own instance.
      window.bandwidthMonitor   — auto-instantiated default instance, configured
                                  from window.bandwidthMonitorConfig if set
                                  BEFORE this script loads.

    Drop-in usage in another app:
      <script>window.bandwidthMonitorConfig = {
        testFiles: { small: { url: '/img/probe-s.jpg', bytes: 12345 },
                     large: { url: '/img/probe.jpg',   bytes: 67890 } },
        cacheKey: 'myapp_bw'
      };</script>
      <script src="/js/bandwidth_monitor.js"></script>

    Instance API:
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

    Config object (all keys optional; defaults shown):
      testFiles:           { small: {url, bytes}, large: {url, bytes} }
      cacheKey:            'bandwidth_monitor_last'
      cacheTtlMs:          5 * 60 * 1000
      reprobeThresholdKbps:1500    // reprobe when first reading is below the gate
      minTransferMs:       30      // (legacy, currently unused) below this the math is noisy
      maxSamples:          5

    Both probe URLs should be excluded from any service-worker static cache so
    every measurement hits the network. In VPAtlas this is handled by
    STATIC_NO_CACHE_PATTERNS in sw_template.js for /images/speed-test*.jpg.

    Accuracy notes
    --------------
    - We prefer PerformanceResourceTiming (responseEnd − responseStart) to
      strip out DNS, TCP, and TLS setup time. On a cold connection that
      overhead can dwarf the actual transfer of a 35 KB file and make the
      raw wall-clock math read "below threshold" on a fast link.
    - We sessionStorage-cache the result with a TTL so subsequent page
      loads in the same session don't reprobe.
    - If the first probe reads below reprobeThresholdKbps, we run a
      second probe and take max(first, second). The 35 KB small-probe
      payload spans ~2.5 TCP congestion windows from cold, so the first
      probe pays slow-start tax and reads systematically low even when
      the underlying link is fast. The second probe runs on a warm TCP
      connection (window already open) and is the honest reading.
      max() rather than average() because slow-start can only depress
      the reading — averaging would let the tainted first probe drag
      the cached value back down. If the link is genuinely slow, both
      probes read similarly low and max stays below the gate.
*/
(function() {
    const DEFAULTS = {
        testFiles: {
            small: { url: '/images/speed-test-small.jpg', bytes: 35523 },
            large: { url: '/images/speed-test.jpg',       bytes: 209636 },
        },
        cacheKey: 'bandwidth_monitor_last',
        cacheTtlMs: 5 * 60 * 1000,
        minTransferMs: 30,
        reprobeThresholdKbps: 1500,
        maxSamples: 5,
    };

    function mergeConfig(user) {
        let c = Object.assign({}, DEFAULTS, user || {});
        // testFiles is an object; if caller passed it, take theirs verbatim
        // rather than half-merging keys (avoids partial small/large mismatch).
        c.testFiles = (user && user.testFiles) ? user.testFiles : DEFAULTS.testFiles;
        return c;
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

    function BandwidthMonitor(config) {
        this.config = mergeConfig(config);
        this.currentBandwidth = null;   // kbps
        this.samples = [];              // [{ ts, kbps }]
        // Hydrate from cache so getStatus reads sensibly before the first probe.
        let cached = this._readCache();
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

    BandwidthMonitor.prototype._readCache = function() {
        try {
            let raw = sessionStorage.getItem(this.config.cacheKey);
            if (!raw) return null;
            let obj = JSON.parse(raw);
            if (!obj || typeof obj.kbps !== 'number' || !obj.ts) return null;
            if (Date.now() - obj.ts > this.config.cacheTtlMs) return null;
            return obj;
        } catch (_) { return null; }
    };

    BandwidthMonitor.prototype._writeCache = function(kbps) {
        try { sessionStorage.setItem(this.config.cacheKey, JSON.stringify({ kbps, ts: Date.now() })); }
        catch (_) {}
    };

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
        if (this.samples.length > this.config.maxSamples) this.samples.shift();
    };

    BandwidthMonitor.prototype.measureBandwidth = async function(opts) {
        opts = opts || {};
        let key = opts.size === 'large' ? 'large' : 'small';
        let file = this.config.testFiles[key];
        if (!file || !file.url) {
            console.warn('bandwidth_monitor: no testFile configured for size=' + key);
            return null;
        }
        let allowReprobe = opts.allowReprobe !== false;

        // Cache hit — skip the network probe entirely. The SW gate calls
        // this on every page load; without this every navigation costs a
        // probe.
        if (!opts.force) {
            let cached = this._readCache();
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

            // Reprobe whenever the first reading is below threshold, on a
            // warm connection. The 35 KB probe spans ~2.5 TCP congestion
            // windows from cold, so the first probe pays slow-start tax
            // and reads systematically low (often ~1.4 Mbps on links that
            // are actually 10+ Mbps). The second probe runs on a warm TCP
            // connection (window already open) and is the honest reading.
            // We take max() rather than average() because slow-start can
            // only depress the measurement — averaging lets the tainted
            // first probe drag the cached value back down. If the link is
            // genuinely slow, both probes read similarly low and max
            // won't lift it above the gate.
            if (allowReprobe && kbps < this.config.reprobeThresholdKbps) {
                try {
                    let url2 = file.url + '?_bw=' + Date.now();
                    let second = await singleProbe(url2, file.bytes);
                    kbps = Math.max(first.kbps, second.kbps);
                } catch (_) { /* keep first */ }
            }

            this.currentBandwidth = kbps;
            this._addSample(kbps);
            this._writeCache(kbps);
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
        let cached = this._readCache();
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

    window.BandwidthMonitor = BandwidthMonitor;
    window.bandwidthMonitor = new BandwidthMonitor(window.bandwidthMonitorConfig || {});
})();
