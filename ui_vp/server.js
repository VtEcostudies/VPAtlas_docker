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
