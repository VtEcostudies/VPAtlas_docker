// urlsToCache.js - URLs to precache for the unified VPAtlas app
// Merged from /explore/urlsToCache.js and /survey/urlsToCache.js
appConfig.urlsToCache = [

// === Root ===
'/manifest.json',

// === Explore pages ===
'/explore/',
'/explore/index.html',
'/explore/pool_view.html',
'/explore/pool_create.html',
'/explore/visit_view.html',
'/explore/visit_list.html',
'/explore/survey_view.html',
'/explore/system.html',
'/explore/login.html',
'/explore/register.html',
'/explore/reset.html',
'/explore/confirm_reset.html',
'/explore/confirm_email.html',

// === Survey pages ===
'/survey/find_pool.html',
'/survey/survey_create.html',
'/survey/visit_create.html',

// === Admin pages ===
// Precached so offline navigation doesn't dump users on a generic
// network-error page. Each page calls ensureOnline() at the top of its
// init and shows a friendly "Unavailable Offline" panel instead of
// trying to fetch.
'/admin/profile.html',
'/admin/users_admin.html',
'/admin/s123_visit_import.html',
'/admin/s123_survey_import.html',

// === Documentation / changelog ===
// The hamburger Changelog link is reachable from any precached page,
// so the docs index + every daily changelog must be precached too.
// When you add a new CHANGELOG-YYYY-MM-DD(-partial).md, add it here.
'/docs/',
'/docs/index.html',
'/docs/CHANGELOG-2026-05-01.md',
'/docs/CHANGELOG-2026-05-02.md',
'/docs/CHANGELOG-2026-05-03.md',
'/docs/CHANGELOG-2026-05-04.md',
'/docs/CHANGELOG-2026-05-05.md',
'/docs/CHANGELOG-2026-05-06.md',
'/docs/CHANGELOG-2026-05-09.md',
'/docs/CHANGELOG-2026-05-10-partial.md',

// === Shared JS ===
'/js/app.js',
'/js/app_messaging.js',
'/js/console_manager.js',
'/js/resource_manager.js',
'/js/config.js',
'/js/bootstrap_5.2.3.min.js',
'/js/leaflet_1.9.4.js',
'/js/esri-leaflet_3.0.12.js',
'/js/idb-keyval_6.esm.js',
'/js/api.js',
'/js/auth.js',
'/js/storage.js',
'/js/map_common.js',
'/js/pool_data_cache.js',
'/js/photo_lightbox.js',
'/js/home_button.js',
'/js/bandwidth_monitor.js',
'/js/visit_card.js',
'/js/profile_icon.js',
'/js/parcels.js',
'/js/cache_keys.js',
'/js/require_online.js',

// === Explore JS modules ===
'/explore/js/utils.js',
'/explore/js/modal.js',
'/explore/js/map.js',
'/explore/js/pool_list.js',
'/explore/js/pool_summary.js',
'/explore/js/filter_bar.js',
'/explore/js/url_state.js',

// === Survey JS modules ===
'/survey/js/gps_monitor.js',
'/survey/js/track_recorder.js',
'/survey/js/visit_queue_ui.js',
'/survey/js/visit_store.js',
'/survey/js/visit_sync.js',

// === GPS keep-alive silent audio (iOS Safari fallback) ===
'/survey/silence.wav',

// === Shared CSS ===
'/css/bootstrap_5.2.3.min.css',
'/css/font-awesome_6.6.0.all.min.css',
'/css/leaflet_1.9.4.css',
'/css/map.css',
'/css/visit_card.css',

// === Explore CSS ===
'/explore/css/common.css',
'/explore/css/auth.css',
'/explore/css/modal.css',
'/explore/css/pool_list.css',
'/explore/css/filter_bar.css',

// === Survey CSS ===
'/survey/css/visit_queue.css',

// === Images ===
'/favicon.ico',
'/favicon-32.png',
'/apple-touch-icon.png',
'/icons/icon-192.png',
'/icons/icon-512.png',
'/css/images/vce_favicon.png',
'/css/images/marker-icon.png',
'/css/images/marker-icon-2x.png',
'/css/images/marker-shadow.png',
'/css/images/layers.png',
'/css/images/layers-2x.png',
'/images/vce_logo_no_tagline.png',
'/images/vce_logo_abbrev.png',
'/images/vce_bird_icon.png',

// === Photo identification aids — species (offline reference) ===
'/images/species/bluespot-adult.jpg',
'/images/species/bluespot-eggs.jpg',
'/images/species/fairy-shrimp-orange.jpg',
'/images/species/fairy-shrimp-side.jpg',
'/images/species/fairy-shrimp-top.jpg',
'/images/species/fingernail-clam-1.jpg',
'/images/species/fingernail-clam-2.jpg',
'/images/species/jefferson-adult.jpg',
'/images/species/jefferson-eggs-hand.jpg',
'/images/species/jefferson-eggs.jpg',
'/images/species/spotted-adult-hand.jpg',
'/images/species/spotted-adult.jpg',
'/images/species/spotted-eggs-hand.jpg',
'/images/species/spotted-eggs-pool.jpg',
'/images/species/spotted-larvae.jpg',
'/images/species/woodfrog-adult-1.jpg',
'/images/species/woodfrog-adult-2.jpg',
'/images/species/woodfrog-eggs-communal.jpg',
'/images/species/woodfrog-eggs-hand.jpg',

// === Photo identification aids — vegetation (offline reference) ===
'/images/vegetation/canopy-closed.jpg',
'/images/vegetation/canopy-open.jpg',
'/images/vegetation/emergent-cattail.jpg',
'/images/vegetation/emergent-sedge.jpg',
'/images/vegetation/floating-duckweed.jpg',
'/images/vegetation/floating-pondlily.jpg',
'/images/vegetation/shrub-buttonbush.jpg',
'/images/vegetation/shrub-winterberry.jpg',
'/images/vegetation/submerged-bladderwort.jpg',
'/images/vegetation/submerged-sphagnum.jpg',

// === Boundary GeoJSON (loaded synchronously by createMap — must be cached or maps freeze offline) ===
'/geojson/Polygon_VT_State_Boundary.geo.json',
'/geojson/Polygon_VT_County_Boundaries.geo.json',
'/geojson/Polygon_VT_Town_Boundaries.geo.json',

// === Webfonts ===
'/webfonts/fa-solid-900.woff2',
'/webfonts/fa-regular-400.woff2',
];
