/*
  app.js - Service worker registration and update handling for VPAtlas.

  Single unified PWA with root-level /sw.js serving all pages (/explore, /survey, /admin).

  FLOW:
  1. On page load, check if a new SW is waiting
  2. If waiting → tell it to activate → SW sends RELOAD after activation complete → reload
  3. If not → register/check for updates → if update found → wait for install → activate → RELOAD
  4. Only run initApp() when we're certain we have the latest version

  The page ONLY reloads via SW's RELOAD BroadcastChannel message - this ensures activation
  (claim + cache cleanup) is fully complete before the page reloads.

  Pages that include this script must define an initApp() function to start the app logic.
*/

const SW_PATH = '/sw.js';

let updateInProgress = false;

console.log(`app.js: SW_PATH=${SW_PATH}`);

// =============================================================================
// LEGACY KILL-SWITCH CLEANUP
// -----------------------------------------------------------------------------
// app.js < 3.5.224 had a "?nosw=1" kill switch that persisted a localStorage
// flag (`vpa_disable_sw`) and, on every subsequent load, unregistered every
// SW and wiped every cache. It was meant for the install-loop bug but ended
// up silently disabling offline support for any user who tripped it once —
// the SW was never re-registered, so cache-first fallback never ran and
// every offline open hit the browser's network-failure page. The cooldown
// fix in 3.5.222 made the kill switch unnecessary; we now always register
// the SW. Defensively scrub the flag here so any device that still has it
// set unsticks itself the moment it loads this build.
// =============================================================================
try { localStorage.removeItem('vpa_disable_sw'); } catch(_) {}

// =============================================================================
// AUTO-RELOAD LOOP CAP
// -----------------------------------------------------------------------------
// We auto-reload after a SW activates so the page picks up new code. If the
// new SW *also* immediately triggers another install (e.g. /sw.js bytes
// change per request from a misbehaving CDN), that loops forever. Cap auto-
// reload at once per cooldown window: an actual loop fires reloads sub-
// second, so 30s is more than enough to break it, while normal user-driven
// updates (deploy + reopen) sail through.
//
// Why a timestamp instead of a session flag: an iOS PWA in standalone mode
// keeps the same `sessionStorage` across backgrounding/foregrounding only
// for as long as iOS keeps the WebKit process alive. A session flag locked
// users on their first auto-reloaded version forever (or until force-quit),
// blocking every subsequent deploy. A short cooldown is the right tool —
// long enough to stop pathological loops, short enough to never feel sticky.
//
// Why `localStorage` (not `sessionStorage`): iOS aggressively evicts the
// standalone PWA's WebKit process under memory pressure (common on field
// iPhones with poor cell). Each eviction wipes sessionStorage, which means
// the next cold open starts with a clean cooldown — and the auto-reload
// fires unconditionally. If the served sw.js is byte-unstable in any way,
// that becomes a visible reload loop on close/reopen. localStorage
// survives process eviction so the cooldown actually defends the user.
// The stored value is just a Date.now() timestamp — no PII.
// =============================================================================
const RELOAD_TS_KEY = 'vpa_sw_last_reload_ts';
const RELOAD_COOLDOWN_MS = 30 * 1000;

// Hard cap on auto-reloads in a sliding window. The 30 s cooldown above
// catches the obvious "second reload one second after the first" case, but
// it doesn't stop a user who's been on cell for a few minutes from
// experiencing a 1 Hz reload-every-cycle pattern if something keeps firing
// RELOAD broadcasts past the cooldown. The cap is the second brake: at
// most RELOAD_CAP_COUNT reloads in any RELOAD_CAP_WINDOW_MS window, after
// which auto-reload is suppressed entirely until the oldest entry ages
// out. Stored as a JSON array of timestamps in localStorage so it survives
// iOS PWA process eviction (same reason as RELOAD_TS_KEY).
const RELOAD_CAP_KEY = 'vpa_sw_reload_events';
const RELOAD_CAP_COUNT = 3;
const RELOAD_CAP_WINDOW_MS = 5 * 60 * 1000;

// Diagnostic ring buffer — last 10 reload-decision events captured in
// localStorage so a field user can paste it back if a flashing report
// recurs. ~1 KB total. Surface via System Info in a follow-up if useful.
const RELOAD_LOG_KEY = 'vpa_sw_reload_log';

function alreadyReloadedRecently() {
  try {
    let ts = Number(localStorage.getItem(RELOAD_TS_KEY) || 0);
    return ts > 0 && (Date.now() - ts) < RELOAD_COOLDOWN_MS;
  } catch(_) { return false; }
}
function markReloadedNow() {
  try { localStorage.setItem(RELOAD_TS_KEY, String(Date.now())); } catch(_) {}
}

function recordReloadForCap() {
  try {
    let arr = JSON.parse(localStorage.getItem(RELOAD_CAP_KEY) || '[]');
    let cutoff = Date.now() - RELOAD_CAP_WINDOW_MS;
    arr = arr.filter(t => t > cutoff);
    arr.push(Date.now());
    localStorage.setItem(RELOAD_CAP_KEY, JSON.stringify(arr));
  } catch(_) {}
}
function reloadCapExceeded() {
  try {
    let arr = JSON.parse(localStorage.getItem(RELOAD_CAP_KEY) || '[]');
    let cutoff = Date.now() - RELOAD_CAP_WINDOW_MS;
    arr = arr.filter(t => t > cutoff);
    return arr.length >= RELOAD_CAP_COUNT;
  } catch(_) { return false; }
}

function logReloadEvent(reason, extra) {
  try {
    let arr = JSON.parse(localStorage.getItem(RELOAD_LOG_KEY) || '[]');
    let entry = { t: new Date().toISOString(), reason };
    if (extra && typeof extra === 'object') Object.assign(entry, extra);
    arr.push(entry);
    if (arr.length > 10) arr = arr.slice(-10);
    localStorage.setItem(RELOAD_LOG_KEY, JSON.stringify(arr));
  } catch(_) {}
}

// Clean up the legacy session-lock flag from app.js < 3.5.222 in case
// IndexedDB/sessionStorage on an existing PWA install still has it. With
// the flag still set, the new logic would never let an auto-reload run.
try { sessionStorage.removeItem('vpa_sw_reloaded_this_session'); } catch(_) {}
// The cooldown timestamp lived in sessionStorage between 3.5.222 and the
// localStorage migration. Drop the now-stale key so it doesn't linger.
try { sessionStorage.removeItem(RELOAD_TS_KEY); } catch(_) {}

// =============================================================================
// MAIN ENTRY POINT - Runs immediately on script load
// =============================================================================
(async function() {
  // Per-page opt-out: a few pages historically set
  // `appConfig.useServiceWorker = false` to skip the SW update check on
  // their own load. We honor that by skipping the update check here, BUT
  // we never unregister the existing SW — doing so killed offline support
  // for every other page on the device, which broke find_pool, the home
  // page, and everything else as soon as the user touched one of those
  // pages. The SW already serves admin API endpoints network-first via
  // DATA_NO_CACHE_PATTERNS / isApiRequest, so leaving it registered does
  // not introduce stale-data issues for the opting-out page.
  if (typeof appConfig !== 'undefined' && appConfig.useServiceWorker === false) {
    console.log('app.js: SW update check skipped on this page (config opt-out); existing registration left intact');
    document.addEventListener('DOMContentLoaded', () => callInitApp());
    if (document.readyState !== 'loading') callInitApp();
    return;
  }

  if (!('serviceWorker' in navigator)) {
    console.log('app.js: ServiceWorker not supported');
    document.addEventListener('DOMContentLoaded', () => callInitApp());
    return;
  }

  // Clean up old per-app SWs (scoped to /explore/ or /survey/) from before unified PWA
  await cleanupLegacySWs();

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('app.js: controllerchange - new SW took control');
  });

  setupSwMessageListener();

  // Check for waiting SW BEFORE anything else
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);

  if (registration?.waiting) {
    if (alreadyReloadedRecently()) {
      console.warn('app.js: SW is waiting but we auto-reloaded within the last ' + (RELOAD_COOLDOWN_MS/1000) + 's — leaving in waiting state to prevent install loop. Will pick up on next page load after the cooldown.');
      logReloadEvent('waiting-skipped', { why: 'cooldown' });
    } else if (reloadCapExceeded()) {
      console.warn('app.js: SW is waiting but reload cap exceeded (' + RELOAD_CAP_COUNT + ' in ' + (RELOAD_CAP_WINDOW_MS/60000) + ' min) — leaving in waiting state. Will pick up on a later launch outside the cap window.');
      logReloadEvent('waiting-skipped', { why: 'cap' });
    } else {
      console.log('app.js: Found waiting SW, activating...');
      logReloadEvent('waiting-activating');
      showUpdateUI('Activating update...');
      activateWaitingSW(registration.waiting);
      return;
    }
  }

  await registerAndCheckForUpdates();

  if (!updateInProgress) {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('app.js: DOMContentLoaded - initializing app');
      callInitApp();
    });
    if (document.readyState !== 'loading') {
      console.log('app.js: DOM already loaded - initializing app');
      callInitApp();
    }
  }
})();

// =============================================================================
// INIT APP WRAPPER
// =============================================================================
let initAppCalled = false;
function callInitApp() {
  if (initAppCalled) return;
  if (typeof window.initApp === 'function') {
    initAppCalled = true;
    window.initApp();
  } else {
    // Pages using ES module top-level await don't define initApp.
    // Their logic runs independently. app.js only needed for SW update checks.
    console.log('app.js: no initApp defined — page uses module-based startup');
  }
}

// =============================================================================
// REGISTRATION AND UPDATE CHECK
// =============================================================================
async function registerAndCheckForUpdates() {
  try {
    // updateViaCache:'none' ensures browsers bypass HTTP cache for sw.js
    let registration = await navigator.serviceWorker.register(SW_PATH, { updateViaCache: 'none' });
    console.log('app.js: SW registered', registration);

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      console.log('app.js: updatefound - new SW installing...');
      showUpdateUI('Downloading update...');
      updateInProgress = true;

      newWorker.addEventListener('statechange', () => {
        console.log('app.js: SW state changed to:', newWorker.state);

        if (newWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            if (alreadyReloadedRecently()) {
              // We auto-reloaded within the cooldown window — don't loop.
              // Leave the new SW in `waiting`; the NEXT page load past the
              // cooldown will pick it up automatically.
              console.warn('app.js: New SW installed but we auto-reloaded within the last ' + (RELOAD_COOLDOWN_MS/1000) + 's — staying on current version to prevent loop. Will activate on next page load after the cooldown.');
              logReloadEvent('install-skipped', { why: 'cooldown' });
              updateInProgress = false;
              hideUpdateUI();
              callInitApp();
            } else if (reloadCapExceeded()) {
              // Hard cap tripped: we've auto-reloaded RELOAD_CAP_COUNT
              // times in the last RELOAD_CAP_WINDOW_MS. Something is
              // wrong (or the user keeps hitting an iOS edge case).
              // Stop auto-reloading entirely until the cap window clears.
              console.warn('app.js: New SW installed but reload cap exceeded (' + RELOAD_CAP_COUNT + ' in ' + (RELOAD_CAP_WINDOW_MS/60000) + ' min) — staying on current version. Will activate naturally on a later launch outside the cap window.');
              logReloadEvent('install-skipped', { why: 'cap' });
              updateInProgress = false;
              hideUpdateUI();
              callInitApp();
            } else {
              console.log('app.js: New SW installed and waiting, activating...');
              logReloadEvent('install-activating');
              showUpdateUI('Activating update...');
              activateWaitingSW(newWorker);
            }
          } else {
            console.log('app.js: First install complete');
            updateInProgress = false;
            hideUpdateUI();
            callInitApp();
          }
        }
      });
    });

    // Skip update check on slow connections.
    //
    // navigator.connection.downlink (Network Information API) is bucketed and
    // notoriously unreliable on cold tabs — Chrome can report 1.5 Mbps on a
    // 50 Mbps WiFi connection until it has accumulated enough recent traffic
    // to recompute. We use it only as a fast YES path: when it reports
    // safely above the threshold, accept it and skip the probe. When it
    // reports at/below the threshold (or is unavailable), fall through to
    // the real ResourceTiming-based bandwidth_monitor probe before deciding
    // to throttle.
    if (navigator.serviceWorker.controller) {
      const GATE_KBPS = 1500;
      let bandwidthKbps = null;
      let bandwidthSource = null;

      let connKbps = navigator.connection?.downlink ? navigator.connection.downlink * 1000 : null;
      if (window.bandwidthMonitor) {
        // Always run the real probe, even when connection-api reports
        // above the gate. On iOS Safari standalone PWA,
        // navigator.connection.downlink is bucketed and notoriously
        // stale — it can carry a "WiFi" reading into a fresh cell-only
        // session and let a no-update-needed cell session run an SW
        // update check that triggers the install/activate cycle the
        // user sees as the flashing loop. Take MIN of the two so a
        // false fast-yes from the API can't sneak past the gate.
        let probeKbps = await window.bandwidthMonitor.measureBandwidth();
        if (probeKbps == null) {
          bandwidthKbps = connKbps;
          bandwidthSource = connKbps != null ? 'connection-api-probe-null' : null;
        } else if (connKbps != null) {
          bandwidthKbps = Math.min(connKbps, probeKbps);
          bandwidthSource = (bandwidthKbps === probeKbps) ? 'download-test' : 'connection-api';
          if (connKbps > GATE_KBPS && probeKbps <= GATE_KBPS) {
            console.log(`app.js: connection API reported ${connKbps} kbps (>${GATE_KBPS} gate) but probe = ${Math.round(probeKbps)} kbps — trusting probe`);
          } else {
            console.log(`app.js: bandwidth conn=${connKbps} kbps probe=${Math.round(probeKbps)} kbps → using ${Math.round(bandwidthKbps)} kbps (${bandwidthSource})`);
          }
        } else {
          bandwidthKbps = probeKbps;
          bandwidthSource = 'download-test';
        }
      } else if (connKbps != null) {
        // No probe module available — trust the API as before. Rare
        // path (the bandwidth monitor is in urlsToCache so should
        // always load), kept for graceful degradation.
        bandwidthKbps = connKbps;
        bandwidthSource = connKbps > GATE_KBPS ? 'connection-api' : 'connection-api-low';
      }

      if (bandwidthKbps === null) {
        console.log('app.js: Skipping update check - bandwidth unknown (offline?)');
      } else if (bandwidthKbps < GATE_KBPS) {
        // Bandwidth probe caches in sessionStorage for 5 min. If we surfaced a
        // toast here, it would re-fire on every navigation for the whole TTL —
        // which is what users actually see in the field. Console only.
        console.log(`app.js: Skipping update check - bandwidth too low (${Math.round(bandwidthKbps)} kbps < ${GATE_KBPS} kbps; source=${bandwidthSource})`);
      } else {
        console.log(`app.js: Bandwidth OK (${Math.round(bandwidthKbps)} kbps; source=${bandwidthSource}), checking for SW updates...`);
        registration.update().catch(err => {
          console.warn('app.js: Update check failed:', err);
        });
      }
    }

  } catch (error) {
    console.error('app.js: SW registration failed:', error);
    updateInProgress = false;
    hideUpdateUI();
    callInitApp();
  }
}

// =============================================================================
// ACTIVATE WAITING SERVICE WORKER
// =============================================================================
function activateWaitingSW(worker) {
  // Stamp the cooldown BEFORE posting skipWaiting. If the activation triggers
  // another install + reload race, the post-reload code will see the recent
  // timestamp and refuse to cycle again until the cooldown expires.
  markReloadedNow();
  worker.postMessage({ type: 'SKIP_WAITING' });
  // Safety timeout: if RELOAD message doesn't arrive within 5s, recover
  setTimeout(() => {
    console.warn('app.js: Activation timeout - RELOAD message not received');
    hideUpdateUI();
    updateInProgress = false;
    callInitApp();
  }, 5000);
}

// =============================================================================
// UPDATE UI
// =============================================================================
function showUpdateUI(message) {
  let overlay = document.getElementById('sw-update-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sw-update-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8); color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; z-index: 99999;
    `;
    document.body.appendChild(overlay);
  }
  overlay.textContent = message;
  overlay.style.display = 'flex';
}

function hideUpdateUI() {
  const overlay = document.getElementById('sw-update-overlay');
  if (overlay) overlay.style.display = 'none';
}

// =============================================================================
// BROADCAST CHANNEL LISTENER
// =============================================================================
function setupSwMessageListener() {
  try {
    const channel = new BroadcastChannel('sw-messages');
    channel.addEventListener('message', (event) => {
      handleSwMessage(event.data);
    });
  } catch (e) {
    console.warn('app.js: BroadcastChannel not supported:', e);
  }
}

function handleSwMessage(msg) {
  if (!msg) return;
  switch (msg.type) {
    case 'RELOAD':
      // Defense in depth — the cooldown was previously checked only at
      // the SKIP_WAITING decision point (statechange === 'installed').
      // A RELOAD message that reaches the page from any other source
      // (queued waiting SW from a previous session, SW restart, multi-
      // tab race, iOS replaying a broadcast on foreground) would
      // otherwise unconditionally reload. Both brakes apply here too.
      if (alreadyReloadedRecently()) {
        console.warn('sw-messages: RELOAD ignored — auto-reloaded within the last ' + (RELOAD_COOLDOWN_MS/1000) + 's');
        logReloadEvent('broadcast-skipped', { why: 'cooldown' });
        break;
      }
      if (reloadCapExceeded()) {
        console.warn('sw-messages: RELOAD ignored — reload cap exceeded (' + RELOAD_CAP_COUNT + ' in ' + (RELOAD_CAP_WINDOW_MS/60000) + ' min); new SW left active, no auto-reload');
        logReloadEvent('broadcast-skipped', { why: 'cap' });
        break;
      }
      console.log('sw-messages: RELOAD - SW activation complete, reloading...');
      // Stamp BEFORE reload so the post-reload code sees the cooldown
      // and the next launch's cap counter includes this event.
      markReloadedNow();
      recordReloadForCap();
      logReloadEvent('broadcast-reload');
      window.location.reload();
      break;
    case 'wait':
      console.log('sw-messages: WAIT', msg.text);
      showUpdateUI(msg.text || 'Loading...');
      break;
    case 'done':
      console.log('sw-messages: DONE', msg.text);
      hideUpdateUI();
      break;
    case 'info':
      console.log('sw-messages: INFO', msg.text, msg.data);
      break;
    case 'warn':
      console.warn('sw-messages: WARNING', msg.text, msg.data);
      break;
    case 'error':
      console.error('sw-messages: ERROR', msg.text, msg.data);
      break;
    default:
      console.log('sw-messages:', msg.type, msg.text, msg.data);
  }
}

// =============================================================================
// LEGACY CLEANUP — unregister old per-app SWs (can remove after all users update)
// =============================================================================
async function cleanupLegacySWs() {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const reg of regs) {
    const scope = new URL(reg.scope).pathname;
    if (scope !== '/') {
      await reg.unregister();
      console.log(`app.js: Unregistered legacy SW (scope: ${scope})`);
    }
  }
}

// =============================================================================
// UTILITY FUNCTIONS (console debugging)
// =============================================================================
async function unregisterSW() {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (reg) {
    const result = await reg.unregister();
    console.log('app.js: SW unregistered:', result);
    return result;
  }
  console.log('app.js: No SW to unregister');
  return false;
}

async function unregisterAllSW() {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const reg of regs) {
    await reg.unregister();
    console.log('app.js: Unregistered:', reg.scope);
  }
}

async function forceSWUpdate() {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (reg) {
    await reg.update();
    console.log('app.js: Update check triggered');
  }
}

async function getSWStatus() {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  return {
    controller: navigator.serviceWorker.controller?.scriptURL,
    installing: reg?.installing?.state,
    waiting: reg?.waiting?.state,
    active: reg?.active?.state
  };
}
