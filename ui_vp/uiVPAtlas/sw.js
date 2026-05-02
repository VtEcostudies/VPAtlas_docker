// sw.js - Service Worker for VPAtlas (unified app)
// Generated from sw_template.js by sw-build.js — do not edit directly
const APP_VERSION = '3.5.57';
const BUILD_TIMESTAMP = '1777754607426';
const ME = 'sw.js';

const SW_BASE = self.location.pathname.replace(/\/[^\/]*$/, '');

// Broadcast Channel
let channel = null;
let channelReady = false;
let pendingMessages = [];

function getChannel() {
  if (!channel) {
    try {
      channel = new BroadcastChannel('sw-messages');
      channelReady = true;
      pendingMessages.forEach(msg => channel.postMessage(msg));
      pendingMessages = [];
    } catch (e) {}
  }
  return channel;
}

function sendMessage(message) {
  if (typeof message !== 'object') message = { type: 'info', text: message };
  const ch = getChannel();
  if (ch && channelReady) {
    try { ch.postMessage(message); } catch (e) { pendingMessages.push(message); }
  } else {
    pendingMessages.push(message);
  }
}

// Load config and URLs
let swConfig = null;
let configLoadError = null;

try {
  self.importScripts('/js/config.js');
  swConfig = appConfig;
  self.importScripts('/urlsToCache.js');
  sendMessage({ type: 'info', text: `${ME} v${APP_VERSION}: config loaded (${SW_BASE})` });
} catch (error) {
  configLoadError = error;
  sendMessage({ type: 'error', text: `${ME} v${APP_VERSION}: config FAILED`, data: error.message });
}

const USE_APP_CACHE = swConfig?.useAppCache !== false;
const USE_DATA_CACHE = swConfig?.useDataCache !== false;
const USE_TILE_CACHE = swConfig?.useTileCache !== false;
const APP_FETCH_TIMEOUT = swConfig?.appFetchTimeout ?? 5000;
const DATA_FETCH_TIMEOUT = swConfig?.dataFetchTimeout ?? 30000;
const TILE_FETCH_TIMEOUT = swConfig?.tileFetchTimeout ?? 10000;

const URLS_TO_CACHE = swConfig?.urlsToCache || [];

// Cache names
const APP_CACHE_NAME = 'vpAtlas-app';
const DATA_CACHE_NAME = 'vpAtlas-data';
const TILE_CACHE_NAME = 'vpAtlas-map';

const APP_CACHE = `${APP_CACHE_NAME}-${APP_VERSION}`;
const DATA_CACHE = `${DATA_CACHE_NAME}-${APP_VERSION}`;
const TILE_CACHE = TILE_CACHE_NAME; // version-independent — tiles persist across updates

// Data patterns to cache (lookup/reference data)
const DATA_CACHE_PATTERNS = [
  /\/vtinfo\//,
  /\/pools\/mapped\/stats/,
  /\/pools\/visit\/summary$/,
  /\/survey\/summary$/,
];

// Data patterns to never cache (dynamic/user data)
const DATA_NO_CACHE_PATTERNS = [
  /\/users\//,
  /\/pools\/visit$/,
  /\/review$/,
];

// Tile patterns
const TILE_PATTERNS = [
  /^https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/,
  /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/.*\/MapServer\/tile\/\d+\/\d+\/\d+/,
  /^https:\/\/.*\.tile\.opentopomap\.org\/\d+\/\d+\/\d+\.png/,
  /^https:\/\/maps\.vcgi\.vermont\.gov\//,
];

// =============================================================================
// LIFECYCLE
// =============================================================================
self.addEventListener('install', (event) => {
  sendMessage({ type: 'info', text: `${ME} v${APP_VERSION}: install (${SW_BASE})` });
  event.waitUntil((async () => {
    if (configLoadError) {
      sendMessage({ type: 'error', text: `${ME} v${APP_VERSION}: install ABORTED`, data: configLoadError.message });
      throw configLoadError;
    }
    if (USE_APP_CACHE) await precacheApp();
    sendMessage({ type: 'info', text: `${ME} v${APP_VERSION}: install complete` });
  })());
});

let isUpdate = false;

self.addEventListener('activate', (event) => {
  sendMessage({ type: 'info', text: `${ME} v${APP_VERSION}: activate` });
  event.waitUntil((async () => {
    await clients.claim();
    await cleanupOldCaches();
    sendMessage({ type: 'info', text: `${ME} v${APP_VERSION}: activate complete` });
    if (isUpdate) sendMessage({ type: 'RELOAD' });
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg?.type) return;
  switch (msg.type) {
    case 'SKIP_WAITING':
      isUpdate = true;
      self.skipWaiting();
      break;
    case 'CLEAR_CACHE':
      event.waitUntil(clearCache(msg.cacheType));
      break;
    case 'GET_CACHE_STATUS':
      event.waitUntil(getCacheStatus().then(status => event.ports[0].postMessage(status)));
      break;
  }
});

// =============================================================================
// FETCH HANDLER
// =============================================================================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (isNoCacheRequest(url)) {
    event.respondWith(fetchNetwork(event.request, DATA_FETCH_TIMEOUT));
  } else if (USE_DATA_CACHE && isDataRequest(url)) {
    event.respondWith(handleDataRequest(event.request, url));
  } else if (isApiRequest(url)) {
    // API calls that aren't in the explicit cache/no-cache lists: always network-first
    event.respondWith(fetchNetwork(event.request, DATA_FETCH_TIMEOUT));
  } else if (USE_TILE_CACHE && isTileRequest(url)) {
    event.respondWith(handleTileRequest(event.request, url));
  } else if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event.request, url));
  } else if (USE_APP_CACHE) {
    event.respondWith(handleStaticRequest(event.request, url));
  } else {
    event.respondWith(fetchNetwork(event.request));
  }
});

function isNoCacheRequest(url) {
  if (!swConfig) return false;
  if (url.href.includes(swConfig.api.fqdn)) {
    return DATA_NO_CACHE_PATTERNS.some(p => p.test(url.pathname));
  }
  return false;
}

function isApiRequest(url) {
  if (!swConfig) return false;
  return url.href.includes(swConfig.api.fqdn);
}

function isDataRequest(url) {
  if (!swConfig) return false;
  if (url.href.includes(swConfig.api.fqdn)) {
    return DATA_CACHE_PATTERNS.some(p => p.test(url.pathname));
  }
  return false;
}

function isTileRequest(url) {
  return TILE_PATTERNS.some(p => p.test(url.href));
}

// =============================================================================
// FETCH UTILITIES
// =============================================================================
async function fetchNetwork(request, timeout = APP_FETCH_TIMEOUT) {
  try { return await timeoutFetch(request, timeout); }
  catch (error) { return errorResponse(request.url, 'Network error'); }
}

async function timeoutFetch(request, timeout = APP_FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function errorResponse(url, status = 'Unavailable') {
  return new Response(
    JSON.stringify({ error: `${url} ${status}` }),
    { status: 503, statusText: status, headers: { 'Content-Type': 'application/json' } }
  );
}

// =============================================================================
// REQUEST HANDLERS
// =============================================================================
async function handleNavigationRequest(request, url) {
  const cacheKey = url.origin + url.pathname;
  try {
    const response = await timeoutFetch(request);
    if (response.ok && USE_APP_CACHE) {
      const cache = await caches.open(APP_CACHE);
      cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    if (USE_APP_CACHE) {
      const cache = await caches.open(APP_CACHE);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }
    return errorResponse(cacheKey, 'Offline');
  }
}

async function handleStaticRequest(request, url) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await timeoutFetch(request);
    if (response.ok && request.method === 'GET') cache.put(request, response.clone());
    return response;
  } catch (error) { return errorResponse(url.href, 'Offline'); }
}

async function handleDataRequest(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { return await timeoutFetch(request, DATA_FETCH_TIMEOUT); }
    catch (error) { return errorResponse(url.href, 'Offline'); }
  }
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const networkUpdate = timeoutFetch(request, DATA_FETCH_TIMEOUT)
    .then(response => { if (response.ok) cache.put(request, response.clone()); return response; })
    .catch(() => null);
  if (cached) return cached;
  try {
    const response = await networkUpdate;
    if (response) return response;
    return errorResponse(url.href, 'Offline');
  } catch (error) { return errorResponse(url.href, 'Offline'); }
}

async function handleTileRequest(request, url) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await timeoutFetch(request, TILE_FETCH_TIMEOUT);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return new Response('', { status: 204 });
  }
}

// =============================================================================
// PRECACHE
// =============================================================================
async function precacheApp(urls = URLS_TO_CACHE) {
  if (!USE_APP_CACHE || urls.length === 0) return;
  sendMessage({ type: 'wait', text: 'Loading App Cache...' });
  const cache = await caches.open(APP_CACHE);
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) await cache.put(url, response);
    } catch (error) {}
  }));
  sendMessage({ type: 'done', text: 'App Cache Complete' });
}

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================
async function cleanupOldCaches() {
  const cacheNames = await caches.keys();
  const validCaches = [APP_CACHE, DATA_CACHE, TILE_CACHE];
  for (const name of cacheNames) {
    // Migrate old versioned tile caches into the unversioned one
    if (name.startsWith(TILE_CACHE_NAME + '-')) {
      try {
        const oldCache = await caches.open(name);
        const tileCache = await caches.open(TILE_CACHE);
        const keys = await oldCache.keys();
        for (const req of keys) {
          const resp = await oldCache.match(req);
          if (resp) await tileCache.put(req, resp);
        }
      } catch(e) {}
      await caches.delete(name);
      continue;
    }
    if (name.includes('vpAtlas') && !validCaches.includes(name)) {
      await caches.delete(name);
    }
  }
}

async function clearCache(cacheType) {
  switch (cacheType) {
    case 'app': await caches.delete(APP_CACHE); break;
    case 'data': await caches.delete(DATA_CACHE); break;
    case 'tiles': await caches.delete(TILE_CACHE); break;
    case 'all':
      await caches.delete(APP_CACHE);
      await caches.delete(DATA_CACHE);
      await caches.delete(TILE_CACHE);
      break;
  }
}

async function getCacheStatus() {
  const cacheNames = await caches.keys();
  const status = {};
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    status[name] = { count: keys.length };
  }
  return status;
}
