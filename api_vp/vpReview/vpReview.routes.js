const express = require('express');
const router = express.Router();
const service = require('./vpReview.service');
const routes = require('../_helpers/routes');
const convert = require('json-2-csv');
const { scrubEmails } = require('../_helpers/scrub');

// routes NOTE: routes with names for same method (ie. GET) must be above routes
// for things like /:id, or they are missed/skipped.
router.get('/geojson', getGeoJson);
router.get('/csv', getCsv);
router.get('/columns', getColumns);
router.get('/routes', getRoutes);
router.get('/count', getCount);
router.get('/', getAll);
router.get('/:id', getById);
router.post('/', create);
router.post('/:id/reassign', reassign);
router.put('/:id', update);
router.delete('/:id', _delete);

module.exports = router;

function getColumns(req, res, next) {
    service.getColumns()
        .then(columns => res.json(columns))
        .catch(err => next(err));
}

function getRoutes(req, res, next) {
    res.json(routes(router));
}

function getCount(req, res, next) {
    service.getCount(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getAll(req, res, next) {
    service.getAll(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

// CSV variant of getAll — same JOIN + columns, json2csv'd. Used by the
// admin Download dialog (download_dialog.js). Mirrors the pattern in
// vpMapped / vpVisit routes.
function getCsv(req, res, next) {
    console.log('vpReview.routes | getCsv', req.query);
    service.getAll(req.query)
        .then(items => {
            if (items.rows) {
                convert.json2csv(items.rows, (err, csv) => {
                    if (err) return next(err);
                    if (req.query.download) {
                        res.setHeader('Content-disposition', 'attachment; filename=vp_review.csv');
                        res.setHeader('Content-type', 'text/csv');
                        res.send(csv);
                    } else {
                        res.send(csv);
                    }
                });
            } else { res.json(items); }
        })
        .catch(err => next(err));
}

function getById(req, res, next) {
    service.getById(req.params.id)
        .then(item => item ? res.json(item) : res.sendStatus(404))
        .catch(err => next(err));
}

function getGeoJson(req, res, next) {
    console.log('vpReview.routes | getGeoJson', req.query);
    service.getGeoJson(req.query)
        .then(items => {
            if (items.rows && items.rows[0].geojson) {
              // Public endpoint — strip any email-shaped value from every
              // feature's properties (reviewUserName when populated with
              // an email-as-username, or any other email leakage).
              scrubEmails(items.rows[0].geojson);
              if (req.query.download) {
                    var file = JSON.stringify(items.rows[0].geojson);
                    res.setHeader('Content-disposition', 'attachment; filename=vpreview.geojson');
                    res.setHeader('Content-type', 'application/json');
                    res.send(file); //res.send not res.json
              } else {res.json(items.rows[0].geojson);}
            }
            else {res.json(items);}
        })
        .catch(err => next(err));
}

function create(req, res, next) {
    console.log(`create req.body:`);
    console.dir(req.body);
    service.create(req.body)
        .then((item) => {res.json(item);})
        .catch(err => {
            console.log('vpReview.routes.create | error: ' , err);
            if (err.code == 23505 && err.constraint == 'vpreview_pkey') {
                err.name = 'UniquenessConstraintViolation';
                err.message = `Review ID '${req.body.reviewId}' is already taken. Please choose a different Review ID.`;
            }
            next(err);
        });
}

function update(req, res, next) {
    console.log('vpReview.routes.update', req.body);
    service.update(req.params.id, req.body)
        .then((item) => {res.json(item);})
        .catch(err => {
            console.log('vpReview.routes.update | error: ' , err);
            if (err.code == 23505 && err.constraint == 'vpreview_pkey') {
                err.name = 'UniquenessConstraintViolation';
                err.message = `Review ID '${req.body.reviewId}' is already taken. Please choose a different Review ID.`;
            }
            next(err);
        });
}

function _delete(req, res, next) {
    service.delete(req.params.id)
        .then(() => res.json({}))
        .catch(err => next(err));
}

// Admin-only. Reassign the visit attached to this review (and the review itself)
// to a different mapped pool, optionally setting the old pool to Duplicate or
// deleting it. See service.reassign() for the transaction body.
function reassign(req, res, next) {
    let isAdmin = (req.user && req.user.role === 'admin')
               || (req.dbUser && req.dbUser.userrole === 'admin');
    if (!isAdmin) return res.status(403).json({ message: 'Admin required for reassign.' });
    service.reassign(req.params.id, req.body)
        .then(result => res.json(result))
        .catch(err => {
            if (err && err.status) return res.status(err.status).json({ message: err.message });
            next(err);
        });
}
