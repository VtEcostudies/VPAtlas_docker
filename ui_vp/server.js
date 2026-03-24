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

// Redirect root to explore
app.get('/', (req, res) => res.redirect('/explore/'));

// Start the server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
