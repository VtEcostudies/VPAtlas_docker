const express = require('express');
const router = express.Router();
const vcgiParcelService = require('./vcgiParcel.service');

// routes
router.get('/townId/:id', getParcelByTownId);
router.get('/townName/:name', getParcelByTownName);

module.exports = router;

function getParcelByTownId(req, res, next) {
    vcgiParcelService.getTownParcelByTownId({"column":"vcgiTownId", "value":req.params.id})
        .then(data => res.json(data))
        .catch(err => next(err));
}

function getParcelByTownName(req, res, next) {
    vcgiParcelService.getTownParcelByTownName({"column":"vcgiTownName", "value":req.params.name.toUpperCase()})
        .then(data => res.json(data))
        .catch(err => next(err));
}
