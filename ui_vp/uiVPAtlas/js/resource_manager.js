/**
 * Resource Manager - Tracks and cleans up browser resources to prevent memory leaks.
 *
 * Provides managed wrappers for setInterval, setTimeout, addEventListener, and
 * URL.createObjectURL. All tracked resources are automatically cleaned up on
 * page unload (pagehide). A periodic health check can flush console buffers
 * and log resource stats for long-running sessions.
 *
 * Usage:
 *   var id = resourceManager.setInterval(fn, ms);
 *   resourceManager.clearInterval(id);
 *
 *   var id = resourceManager.setTimeout(fn, ms);
 *   resourceManager.clearTimeout(id);
 *
 *   var id = resourceManager.addEventListener(element, 'click', handler);
 *   resourceManager.removeEventListener(id);
 *
 *   var url = resourceManager.createObjectURL(blob);
 *   resourceManager.revokeObjectURL(url);
 *
 *   resourceManager.cleanup();         // Tear down everything
 *   resourceManager.stats();           // Show active resource counts
 *   resourceManager.startHealthCheck(10); // Every 10 minutes
 */
(function(window) {
    'use strict';

    var _intervals = {};    // id -> native intervalId
    var _timeouts = {};     // id -> native timeoutId
    var _listeners = {};    // id -> {target, event, handler, options}
    var _objectURLs = {};   // url -> true
    var _nextId = 1;
    var _healthInterval = null;

    var rm = {

        // --- Intervals ---

        setInterval: function(fn, ms) {
            var id = _nextId++;
            _intervals[id] = setInterval(fn, ms);
            return id;
        },

        clearInterval: function(id) {
            if (_intervals[id] !== undefined) {
                clearInterval(_intervals[id]);
                delete _intervals[id];
            }
        },

        // --- Timeouts ---

        setTimeout: function(fn, ms) {
            var id = _nextId++;
            var tid = setTimeout(function() {
                delete _timeouts[id];
                fn();
            }, ms);
            _timeouts[id] = tid;
            return id;
        },

        clearTimeout: function(id) {
            if (_timeouts[id] !== undefined) {
                clearTimeout(_timeouts[id]);
                delete _timeouts[id];
            }
        },

        // --- Event Listeners ---

        addEventListener: function(target, event, handler, options) {
            var id = _nextId++;
            target.addEventListener(event, handler, options);
            _listeners[id] = {
                target: target,
                event: event,
                handler: handler,
                options: options
            };
            return id;
        },

        removeEventListener: function(id) {
            var entry = _listeners[id];
            if (entry) {
                entry.target.removeEventListener(entry.event, entry.handler, entry.options);
                delete _listeners[id];
            }
        },

        // --- Object URLs ---

        createObjectURL: function(blob) {
            var url = URL.createObjectURL(blob);
            _objectURLs[url] = true;
            return url;
        },

        revokeObjectURL: function(url) {
            if (_objectURLs[url]) {
                URL.revokeObjectURL(url);
                delete _objectURLs[url];
            }
        },

        revokeAllObjectURLs: function() {
            for (var url in _objectURLs) {
                if (_objectURLs.hasOwnProperty(url)) {
                    URL.revokeObjectURL(url);
                }
            }
            _objectURLs = {};
        },

        // --- Full Cleanup ---

        cleanup: function() {
            // Clear all intervals
            for (var iid in _intervals) {
                if (_intervals.hasOwnProperty(iid)) {
                    clearInterval(_intervals[iid]);
                }
            }
            _intervals = {};

            // Clear all timeouts
            for (var tid in _timeouts) {
                if (_timeouts.hasOwnProperty(tid)) {
                    clearTimeout(_timeouts[tid]);
                }
            }
            _timeouts = {};

            // Remove all event listeners
            for (var lid in _listeners) {
                if (_listeners.hasOwnProperty(lid)) {
                    var entry = _listeners[lid];
                    try {
                        entry.target.removeEventListener(entry.event, entry.handler, entry.options);
                    } catch (e) {
                        // Target may have been removed from DOM
                    }
                }
            }
            _listeners = {};

            // Revoke all object URLs
            for (var url in _objectURLs) {
                if (_objectURLs.hasOwnProperty(url)) {
                    URL.revokeObjectURL(url);
                }
            }
            _objectURLs = {};

            // Stop health check
            if (_healthInterval) {
                clearInterval(_healthInterval);
                _healthInterval = null;
            }

            console.log('resourceManager: cleanup complete');
        },

        // --- Diagnostics ---

        stats: function() {
            var s = {
                intervals: Object.keys(_intervals).length,
                timeouts: Object.keys(_timeouts).length,
                listeners: Object.keys(_listeners).length,
                objectURLs: Object.keys(_objectURLs).length
            };
            // Use orig console if consoleManager is available to bypass suppression
            var log = (window.consoleManager && window.consoleManager.orig)
                ? window.consoleManager.orig.log
                : console.log;
            log('resourceManager stats:', s);
            return s;
        },

        // --- Health Check for Long-Running Pages ---

        startHealthCheck: function(intervalMinutes) {
            if (_healthInterval) return; // Already running
            var ms = (intervalMinutes || 10) * 60 * 1000;

            _healthInterval = setInterval(function() {
                // Flush console buffer to free memory
                if (window.consoleManager) {
                    window.consoleManager.clearBuffer();
                }

                // Log resource stats
                rm.stats();
            }, ms);

            console.log('resourceManager: health check started (' + (intervalMinutes || 10) + 'min interval)');
        },

        stopHealthCheck: function() {
            if (_healthInterval) {
                clearInterval(_healthInterval);
                _healthInterval = null;
            }
        }
    };

    // Auto-cleanup on page unload
    window.addEventListener('pagehide', function() {
        rm.cleanup();
    });

    window.resourceManager = rm;
})(window);
