/*
    Mid-Alpha development, the team decided that 'Mapped Pools' and 'Pool Visits'
    should just be one list of items having different amounts of data. This module
    serves the gets for those joined table queries.
*/
const express = require('express');
const router = express.Router();
const routes = require('../_helpers/routes');
const convert = require('json-2-csv');
const service = require('./vpPools.service');

// routes
router.get('/csv', getCsv);
router.get('/columns', getColumns);
router.get('/routes', getRoutes);
router.get('/count', getCount);
router.get('/overview', getOverview); //minimal dataset to support faster mapping views
router.get('/', getAll);
router.get('/review', getPoolsNeedReview);
router.get('/page/:page', getPage);
router.get('/visitId/:visitId', getByVisitId);
router.get('/poolId/:poolId', getByPoolId);

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

function getOverview(req, res, next) {
    console.log('vpPools.routes.getOverview req.query', req.query);
    service.getOverview(req.query)
        .then(items => {
          console.log('vpPools.routes::getOverview | rows:', items.rowCount);
          res.json({"rowCount":items.rowCount, "rows":items.rows});
        })
        .catch(err => next(err));
}

function getSummary(req, res, next) {
    console.log('vpPools.routes.getSummary req.query', req.query);
    service.getSummary(req.query)
        .then(items => {
          console.log('vpPools.routes::getSummary | rows:', items.rowCount);
          res.json({"rowCount":items.rowCount, "rows":items.rows});
        })
        .catch(err => next(err));
}

function getAll(req, res, next) {
    console.log('vpPools.routes.getAll req.query', req.query);
    service.getAll(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getCsv(req, res, next) {
    console.log('vpPools.routes | getCsv', req.query);
    service.getAll(req.query)
        .then(items => {
            if (items.rows) {
              convert.json2csv(items.rows, (err, csv) => {
                if (err) next(err);
                if (req.query.download) {
                      var file = csv;
                      res.setHeader('Content-disposition', 'attachment; filename=vp_pools.csv');
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

function getPoolsNeedReview(req, res, next) {
    console.log('vpPools.routes.getPoolsNeedReview req.query', req.query);
    service.getPoolsNeedReview(req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getPage(req, res, next) {
    console.log('vpPools.routes.getPage req.query', req.query);
    service.getPage(req.params.page, req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getByVisitId(req, res, next) {
    console.log('vpPools.routes.getByVisitId req.query', req.query);
    service.getByVisitId(req.params.visitId, req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}

function getByPoolId(req, res, next) {
    console.log('vpPools.routes.getByPoolId req.query', req.query);
    service.getByPoolId(req.params.poolId, req.query)
        .then(items => res.json(items))
        .catch(err => next(err));
}
