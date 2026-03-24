const express = require('express');
const router = express.Router();
const routes = require('../_helpers/routes');
const convert = require('json-2-csv');
const service = require('./vpMapped.service');
const fs = require('fs');

// routes NOTE: routes with names for same method (ie. GET) must be above routes
// for things like /:id, or they are missed/skipped.
router.get('/csv', getCsv);
router.get('/geojson', getGeoJson);
router.get('/shapefile', getShapeFile);
router.get('/columns', getColumns);
router.get('/routes', getRoutes);
router.get('/count', getCount);
router.get('/stats', getStats);
router.get('/overview', getOverview);
router.get('/', getAll);
router.get('/page/:page', getPage);
router.get('/:id', getById);
router.post('/', create);
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
  console.log('vpMapped.routes | getCount');
    service.getCount(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getStats(req, res, next) {
    console.log('vpMapped.routes | getStats');
    service.getStats(req.query)
        .then(stats => res.json(stats))
        .catch(err => next(err));
}

function getOverview(req, res, next) {
    service.getOverview(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getAll(req, res, next) {
    service.getAll(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getPage(req, res, next) {
    console.log('getPage req.query', req.query);
    service.getPage(req.params.page, req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getById(req, res, next) {
    service.getById(req.params.id)
        //.then(item => item ? res.json(item) : res.sendStatus(404))
        .then(item => {
          console.log('vpMapped.routes::getById |', item.rows[0]);
          item ? res.json(item) : res.sendStatus(404)
        })
        .catch(err => next(err));
}

function getCsv(req, res, next) {
    console.log('vpMapped.routes | getCsv', req.query);
    service.getAll(req.query)
        .then(items => {
            if (items.rows) {
              convert.json2csv(items.rows, (err, csv) => {
                if (err) next(err);
                if (req.query.download) {
                      var file = csv;
                      res.setHeader('Content-disposition', 'attachment; filename=vp_mapped.csv');
                      res.setHeader('Content-type', 'text/csv');
                      res.send(file); //res.send not res.json
                } else {
                  res.send(csv);
                }
              });
            }
            else {res.json(items);}
        })
        .catch(err => next(err));
}

/*
  Here's how to use http to query same param for list of values:

  http://localhost:4000/visit/geojson?mappedPoolStatus|NOT IN=Confirmed&mappedPoolStatus|NOT IN=Probable
  http://localhost:4000/visit/geojson?mappedPoolStatus|IN=Confirmed&mappedPoolStatus|IN=Probable
*/
function getGeoJson(req, res, next) {
    console.log('vpMapped.routes::getGeoJson | req.query:', req.query);
    console.log('vpMapped.routes::getGeoJson | req.user:', req.user);

    var statusParam = req.query.mappedPoolStatus || req.query['mappedPoolStatus|IN'] || req.query['mappedPoolStatus|NOT IN'];

    if (!statusParam && (!req.user || (req.user && req.user.userrole != 'admin'))) {
      req.query['mappedPoolStatus|NOT IN'] = [ 'Eliminated', 'Duplicate' ];
    }

    service.getGeoJson(req.query)
        .then(items => {
            if (items.rows && items.rows[0].geojson) {
              if (req.query.download) {
                    var file = JSON.stringify(items.rows[0].geojson);
                    res.setHeader('Content-disposition', 'attachment; filename=vp_mapped.geojson');
                    res.setHeader('Content-type', 'application/json');
                    res.send(file); //res.send not res.json
              } else {res.json(items.rows[0].geojson);}
            }
            else {res.json(items);}
        })
        .catch(err => next(err));
}

function getShapeFile(req, res, next) {
    console.log('vpMapped.routes::getShapeFile | req.query:', req.query);
    //console.log('vpMapped.routes::getShapeFile | req.user:', req.user);
    //console.log('vpMapped.routes::getShapeFile | req.dbUser:', req.dbUser);

    var statusParam = req.query.mappedPoolStatus || req.query['mappedPoolStatus|IN'] || req.query['mappedPoolStatus|NOT IN'];
    var excludeHidden = 0;

    if (!statusParam && (!req.dbUser || (req.dbUser && req.dbUser.userrole != 'admin'))) {
        excludeHidden = 1;
    }

    service.getShapeFile(req.query, excludeHidden)
        .then(shpObj => {
            let fileSpec = `${process.cwd()}/${shpObj.all}`;
            console.log('vpMapped.routes::getShapeFile result', process.cwd(), shpObj.all);
            if (req.query.download) {
                res.setHeader('Content-disposition', `attachment; filename=${shpObj.filename}`);
                res.setHeader('Content-type', 'application/x-tar');
                res.download(fileSpec); //res.sendFile does the same
            } else {
                fs.readFile(fileSpec, (err, data) => {
                    if (err) {next(err);}
                    else {
                        res.setHeader('Content-type', 'application/x-tar');
                        res.send(data);
                    }
                })
            }
        })
        .catch(ret => {
            console.log('vpMapped.routes::getShapeFile ERROR | ret:', ret);
            let errs = ''; Object.keys(ret.error).map(key => {errs += ret.error[key];})
            let err = new Error(errs);
            console.log('vpMapped.routes::getShapeFile ERROR | Constructed error object:', err);
            next(err);
        })
    }

function create(req, res, next) {
    console.log(`create req.body:`);
    console.dir(req.body);
    service.create(req.body)
        .then((item) => res.json(item))
        .catch(err => {
            if (err.code == 23505 && err.constraint == 'vpmapped_pkey') {
                err.name = 'UniquenessConstraintViolation';
                err.message = `Pool ID '${req.body.mappedPoolId}' is already taken. Please choose a different Pool ID.`;
            }
            next(err);
        });
}

function update(req, res, next) {
    service.update(req.params.id, req.body)
        .then((item) => res.json(item))
        .catch(err => {
            if (err.code == 23505 && err.constraint == 'vpmapped_pkey') {
                err.name = 'UniquenessConstraintViolation';
                err.message = `Pool ID '${req.body.mappedPoolId}' is already taken. Please choose a different Pool ID.`;
            }
            next(err);
        });
}

function _delete(req, res, next) {
    service.delete(req.params.id)
        .then(() => res.json({}))
        .catch(err => next(err));
}
