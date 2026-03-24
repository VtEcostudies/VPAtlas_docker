/*
  app.js - Service worker registration and update handling.
  
  Shared by /explore and /survey apps. Place in parent directory (/js/app.js or root).
  
  FLOW:
  1. On page load, check if a new SW is waiting
  2. If waiting → tell it to activate → SW sends RELOAD after activation complete → reload
  3. If not → register/check for updates → if update found → wait for install → activate → RELOAD
  4. Only run initApp() when we're certain we have the latest version
  
  The page ONLY reloads via SW's RELOAD BroadcastChannel message - this ensures activation
  (claim + cache cleanup) is fully complete before the page reloads.

  Pages that include this script must define an initApp() function to start the app logic.
*/

// Derive paths from current location
const APP_BASE = '/' + window.location.pathname.split('/').filter(Boolean)[0]; // '/explore' or '/survey'
const SW_PATH = `${APP_BASE}/sw.js`;

let updateInProgress = false;

console.log(`app.js: APP_BASE=${APP_BASE}, SW_PATH=${SW_PATH}`);

// =============================================================================
// MAIN ENTRY POINT - Runs immediately on script load
// =============================================================================
(async function() {
  // Check if service worker is disabled in config
  if (typeof appConfig !== 'undefined' && appConfig.useServiceWorker === false) {
    console.log('app.js: Service Worker disabled in config');
    // Unregister any existing SW
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      if (reg) {
        await reg.unregister();
        console.log('app.js: Unregistered existing SW');
      }
    }
    // Init app directly
    document.addEventListener('DOMContentLoaded', () => callInitApp());
    if (document.readyState !== 'loading') callInitApp();
    return;
  }

  if (!('serviceWorker' in navigator)) {
    console.log('app.js: ServiceWorker not supported');
    document.addEventListener('DOMContentLoaded', () => callInitApp());
    return;
  }

  // Set up the controllerchange listener - log only, reload is handled by SW's RELOAD message
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('app.js: controllerchange - new SW took control');
  });

  // Set up BroadcastChannel listener for SW messages
  setupSwMessageListener();

  // Check for waiting SW BEFORE anything else
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  
  if (registration?.waiting) {
    // A new SW is already waiting - activate it immediately
    console.log('app.js: Found waiting SW, activating...');
    showUpdateUI('Activating update...');
    activateWaitingSW(registration.waiting);
    // Page will reload via SW's RELOAD message - don't continue
    return;
  }

  // No waiting SW - register/update and check for new versions
  await registerAndCheckForUpdates();
  
  // If we reach here, no update is in progress - safe to init app
  if (!updateInProgress) {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('app.js: DOMContentLoaded - initializing app');
      callInitApp();
    });
    // If DOM already loaded
    if (document.readyState !== 'loading') {
      console.log('app.js: DOM already loaded - initializing app');
      callInitApp();
    }
  }
})();

// =============================================================================
// INIT APP WRAPPER (handles module timing)
// =============================================================================
function callInitApp() {
  if (typeof window.initApp === 'function') {
    window.initApp();
  } else {
    // Pages using ES module top-level await (users_signups, etc.) don't define initApp.
    // Their logic runs independently. app.js only needed for SW update checks on those pages.
    console.log('app.js: no initApp defined — page uses module-based startup');
  }
}

// =============================================================================
// REGISTRATION AND UPDATE CHECK
// =============================================================================
async function registerAndCheckForUpdates() {
  try {
    // Register (or re-register to ensure updateViaCache is set)
    // updateViaCache:'none' ensures browsers (esp. Firefox) bypass HTTP cache for sw.js
    let registration = await navigator.serviceWorker.register(SW_PATH, { updateViaCache: 'none' });
    console.log('app.js: SW registered', registration);

    // Listen for updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      console.log('app.js: updatefound - new SW installing...');
      showUpdateUI('Downloading update...');
      updateInProgress = true;

      newWorker.addEventListener('statechange', () => {
        console.log('app.js: SW state changed to:', newWorker.state);
        
        if (newWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // There's an existing SW - the new one is waiting
            console.log('app.js: New SW installed and waiting, activating...');
            showUpdateUI('Activating update...');
            activateWaitingSW(newWorker);
          } else {
            // First install - no existing SW
            console.log('app.js: First install complete');
            updateInProgress = false;
            hideUpdateUI();
            // The SW will activate automatically, then we init
            callInitApp();
          }
        }
      });
    });

    // Check for updates (only fetches if SW file changed)
    // Skip update on slow connections — prefer navigator.connection, fall back to download test
    if (navigator.serviceWorker.controller) {
      let bandwidthKbps = null;
      if (navigator.connection?.downlink) {
        bandwidthKbps = navigator.connection.downlink * 1000; // Mbps → kbps
        console.log(`app.js: bandwidth via connection API: ${bandwidthKbps} kbps`);
      } else if (window.bandwidthMonitor) {
        bandwidthKbps = await window.bandwidthMonitor.measureBandwidth(); // kbps or null
        console.log(`app.js: bandwidth via download test: ${bandwidthKbps} kbps`);
      }

      if (bandwidthKbps === null) {
        console.log('app.js: Skipping update check - bandwidth unknown (offline?)');
      } else if (bandwidthKbps < 1500) {
        console.log(`app.js: Skipping update check - bandwidth too low (${Math.round(bandwidthKbps)} kbps < 1500 kbps)`);
        if (typeof showToast === 'function') {
          showToast(`Update skipped: slow connection (${Math.round(bandwidthKbps)} kbps)`, 'warning');
        }
      } else {
        console.log(`app.js: Bandwidth OK (${Math.round(bandwidthKbps)} kbps), checking for SW updates...`);
        registration.update().catch(err => {
          console.warn('app.js: Update check failed:', err);
        });
      }
    }

  } catch (error) {
    console.error('app.js: SW registration failed:', error);
    updateInProgress = false;
    hideUpdateUI();
    // Still try to run the app
    callInitApp();
  }
}

// =============================================================================
// ACTIVATE WAITING SERVICE WORKER
// =============================================================================
function activateWaitingSW(worker) {
  // Tell the waiting SW to skip waiting and take control
  worker.postMessage({ type: 'SKIP_WAITING' });
  // Page will reload via SW's RELOAD BroadcastChannel message
  
  // Safety timeout: if RELOAD message doesn't arrive within 5s, recover
  setTimeout(() => {
    console.warn('app.js: Activation timeout - RELOAD message not received');
    hideUpdateUI();
    updateInProgress = false;
    callInitApp();
  }, 5000);
}

// =============================================================================
// UPDATE UI FEEDBACK
// =============================================================================
function showUpdateUI(message) {
  // Always use a dedicated overlay for SW update messages.
  // We cannot use showWait/hideWait because:
  //  - Survey's showWait has an early-return guard that blocks message updates
  //  - Survey's hideWait has a 300ms fade delay that swallows rapid wait/done cycles
  //  - Explore's showWait is an ES module export (not on window)
  // The SW sends rapid wait/done messages during install that need immediate text updates.
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
  if (overlay) {
    overlay.style.display = 'none';
  }
}

// =============================================================================
// BROADCAST CHANNEL LISTENER (for SW messages)
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
      console.log('sw-messages: RELOAD - SW activation complete, reloading...');
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
// UTILITY FUNCTIONS (for debugging/manual control)
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
