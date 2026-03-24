/**
 * Console Manager - Suppresses console output in production to prevent memory leaks.
 *
 * In long-running browser sessions, console.log retains references to every logged object
 * in the DevTools console buffer, preventing garbage collection. Over hours this causes
 * significant memory growth and browser slowdown.
 *
 * By default, all console output except console.error is suppressed. A small circular
 * buffer of string-only summaries is kept for debugging.
 *
 * Usage:
 *   consoleManager.enable()      // Turn on console output (for debugging)
 *   consoleManager.disable()     // Suppress console output (default)
 *   consoleManager.getBuffer()   // Get recent log entries
 *   consoleManager.clearBuffer() // Flush the buffer
 *   consoleManager.stats()       // Show buffer size and config
 */
(function(window) {
    'use strict';

    var _orig = {
        log:   console.log.bind(console),
        warn:  console.warn.bind(console),
        error: console.error.bind(console),
        info:  console.info.bind(console),
        debug: console.debug.bind(console)
    };

    var config = {
        enabled: false,       // false = production (suppress), true = development (pass through)
        maxBuffer: 200,       // circular buffer size
        errorAlways: true,    // always pass console.error through
        warnAlways: false     // optionally pass console.warn through
    };

    var buffer = [];

    // Summarize an argument to a short string — never retain object references
    function summarize(arg) {
        if (arg === null || arg === undefined) return String(arg);
        if (typeof arg === 'string') return arg.length > 200 ? arg.slice(0, 200) + '...' : arg;
        if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
        if (arg instanceof Error) return arg.message || String(arg);
        try {
            var s = JSON.stringify(arg);
            if (s && s.length > 200) return s.slice(0, 200) + '...';
            return s || '[Object]';
        } catch (e) {
            return '[Object]';
        }
    }

    function addToBuffer(level, args) {
        var entry = {
            ts: Date.now(),
            level: level,
            msg: []
        };
        for (var i = 0; i < args.length; i++) {
            entry.msg.push(summarize(args[i]));
        }
        buffer.push(entry);
        if (buffer.length > config.maxBuffer) {
            buffer.shift();
        }
    }

    // Wrap log, info, debug
    console.log = function() {
        addToBuffer('log', arguments);
        if (config.enabled) _orig.log.apply(console, arguments);
    };
    console.info = function() {
        addToBuffer('info', arguments);
        if (config.enabled) _orig.info.apply(console, arguments);
    };
    console.debug = function() {
        addToBuffer('debug', arguments);
        if (config.enabled) _orig.debug.apply(console, arguments);
    };

    // Wrap warn — optionally always pass through
    console.warn = function() {
        addToBuffer('warn', arguments);
        if (config.enabled || config.warnAlways) _orig.warn.apply(console, arguments);
    };

    // Wrap error — always passes through by default
    console.error = function() {
        addToBuffer('error', arguments);
        if (config.enabled || config.errorAlways) _orig.error.apply(console, arguments);
    };

    // Public API
    window.consoleManager = {
        enable: function() {
            config.enabled = true;
            _orig.log('consoleManager: output enabled');
        },
        disable: function() {
            _orig.log('consoleManager: output disabled');
            config.enabled = false;
        },
        getBuffer: function() {
            return buffer.slice();
        },
        clearBuffer: function() {
            buffer.length = 0;
        },
        stats: function() {
            var s = {
                enabled: config.enabled,
                bufferSize: buffer.length,
                maxBuffer: config.maxBuffer,
                errorAlways: config.errorAlways,
                warnAlways: config.warnAlways
            };
            _orig.log('consoleManager stats:', s);
            return s;
        },
        setConfig: function(opts) {
            if (opts) {
                for (var key in opts) {
                    if (opts.hasOwnProperty(key) && config.hasOwnProperty(key)) {
                        config[key] = opts[key];
                    }
                }
            }
        },
        // Access original console methods directly (bypasses suppression)
        orig: _orig
    };
})(window);
