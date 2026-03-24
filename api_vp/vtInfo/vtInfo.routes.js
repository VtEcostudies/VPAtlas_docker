const express = require('express');
const router = express.Router();
const routes = require('../_helpers/routes');
const vtInfoService = require('./vtInfo.service');

// routes
router.get('/routes', getRoutes);
router.get('/counties', getCounties);
router.get('/county/:id', getCounty);
router.get('/towns', getTowns);
router.get('/town/:id', getTown);

module.exports = router;

function getRoutes(req, res, next) {
    res.json(routes(router));
}

function getCounties(req, res, next) {
    vtInfoService.getCounties()
        .then(data => res.json(data))
        .catch(err => next(err));
}

function getCounty(req, res, next) {
    vtInfoService.getCount(req.params.id)
        .then(data => res.json(data))
        .catch(err => next(err));
}

function getTowns(req, res, next) {
	console.log('getTowns');
    vtInfoService.getTowns()
        .then(data => res.json(data))
        .catch(err => next(err));
}

function getTown(req, res, next) {
    vtInfoService.getCount(req.params.id)
        .then(data => res.json(data))
        .catch(err => next(err));
}
