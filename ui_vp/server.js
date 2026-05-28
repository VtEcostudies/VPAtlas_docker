/*
  ExpressJs UI server for VPAtlas.
  Serves explore and survey sub-apps under /explore and /survey routes.
  Shared content (js, css, images) served from the root.
*/
const dotenv = require('dotenv').config();
const config = require('./express_config');
const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const port = config.ui.port;

console.log('server.js=>config', config);

// Allow all origins (API handles auth)
app.use(cors({ origin: '*' }));

// Cache-Control policy. Set BEFORE the static handlers so the static
// middleware preserves these headers when sending the file.
//
// - /sw.js: max-age=86400 (24h). Pairs with the page-side
//   `register('/sw.js', { updateViaCache: 'all' })` to throttle the
//   browser's own automatic SW update check to ~once per day per device.
//   Previously the page registered with updateViaCache:'none' and we set
//   no header here, so every navigation re-fetched sw.js — defeating the
//   bandwidth-based update gate on slow cellular.
// - /manifest.json: no-cache. Carries the user-visible version number;
//   must always be fresh so the top-bar version reflects what's actually
//   installed.
// - HTML pages: no-cache. The SW serves them from precache via the
//   cache-fallback handler; this ensures the browser's own cache layer
//   doesn't stash an old HTML page above the SW.
app.use((req, res, next) => {
    if (req.path === '/sw.js') {
        res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    } else if (req.path === '/manifest.json' || req.path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    next();
});

// Serve common content (shared images, js, css)
app.use('/', express.static(path.join(__dirname, 'uiVPAtlas')));

// Serve explore app at /explore
app.use('/explore', express.static(path.join(__dirname, 'uiVPAtlas/explore')));

// Serve survey app at /survey
app.use('/survey', express.static(path.join(__dirname, 'uiVPAtlas/survey')));

// Serve admin app at /admin
app.use('/admin', express.static(path.join(__dirname, 'uiVPAtlas/admin')));

// Redirect root to explore
app.get('/', (req, res) => res.redirect('/explore/'));

// Redirects for moved pages (bookmarks, cached links)
app.get('/explore/survey_create.html', (req, res) =>
    res.redirect(301, '/survey/survey_create.html?' + new URLSearchParams(req.query)));
app.get('/explore/visit_create.html', (req, res) =>
    res.redirect(301, '/survey/visit_create.html?' + new URLSearchParams(req.query)));
app.get('/explore/review_view.html', (req, res) =>
    res.redirect(301, '/admin/review_view.html?' + new URLSearchParams(req.query)));
app.get('/explore/review_list.html', (req, res) =>
    res.redirect(301, '/admin/review_list.html?' + new URLSearchParams(req.query)));
app.get('/explore/users_admin.html', (req, res) =>
    res.redirect(301, '/admin/users_admin.html?' + new URLSearchParams(req.query)));
app.get('/explore/profile.html', (req, res) =>
    res.redirect(301, '/admin/profile.html?' + new URLSearchParams(req.query)));

// Catch-all for legacy Angular SPA routes (e.g. /pools/list, /pool/123, /visit/N)
// that users still have bookmarked or in browser history after the cutover from
// the legacy app to this docker rewrite. Without this they'd hit Express's
// default "Cannot GET /<path>" 404. Redirects only GETs without a file
// extension, so asset 404s (missing .js/.css/.png) stay as real 404s for
// proper debugging. Preserves the query string in case any of it maps to
// a filter the new app understands.
app.use((req, res, next) => {
    if (req.method === 'GET' && !path.extname(req.path)) {
        const qs = req.originalUrl.includes('?')
            ? '?' + req.originalUrl.split('?').slice(1).join('?')
            : '';
        return res.redirect(302, '/explore/' + qs);
    }
    next();
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
