require('rootpath')();
const compression = require('compression');
const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('_helpers/jwt');
const errorHandler = require('_helpers/error-handler');
const process = require('process');
const config = require('./config');

const serverPort = config.api.port;

console.log('NODE_ENV |', process.env.NODE_ENV);
console.log('API port |', serverPort);
console.log('DB host  |', config.db.host);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

// Request logging middleware
app.use(function (req, res, next) {
  console.log('req.method:', req.method,
    '| req.origUrl:', req.originalUrl,
    '| req.params:', req.params,
    '| req.query', req.query);
  next();
});

// Serve uploaded photos as static files (before JWT — photos are public)
const path = require('path');
app.use('/photos', express.static(path.join(__dirname, 'photos')));

// JWT auth
app.use(jwt());

app.use(compression());

try {
  const db = require('_helpers/db_postgres');
  // API routes
  app.use('/users', require('./users/vpUser.routes.pg'));
  app.use('/vtinfo', require('./vtInfo/vtInfo.routes'));
  app.use('/pools/mapped', require('./vpMapped/vpMapped.routes'));
  app.use('/pools/visit', require('./vpVisit/vpVisit.routes'));
  app.use('/mapped', require('./vpMapped/vpMapped.routes'));
  app.use('/visit', require('./vpVisit/vpVisit.routes'));
  app.use('/pools', require('./vpPools/vpPools.routes'));
  app.use('/review', require('./vpReview/vpReview.routes'));
  app.use('/survey/field', require('./vpSurvey/vpSurvey.field.routes'));
  app.use('/survey', require('./vpSurvey/vpSurvey.routes'));
  app.use('/aws/s3', require('./vpUtil/vp_s3_info.routes'));
  app.use('/parcel', require('./vcgiMapData/vcgiParcel.routes'));
  app.use('/tracks', require('./vpTrack/vpTrack.routes'));
  app.use('/utils', require('./vpUtil/vpUtils.routes'));
} catch(err) {
  console.log('attempt to open db failed |', err);
  process.exit();
}

// Global error handler
app.use(errorHandler);

// HTTP server only (TLS handled by reverse proxy in Docker)
app.listen(serverPort, () => {
  console.log(`http server listening on ${serverPort}`);
});
