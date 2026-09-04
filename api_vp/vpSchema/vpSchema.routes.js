/*
  vpSchema.routes.js — the data-definition surface for the public feature
  endpoints, plus an OpenAPI document and a Swagger UI over it.

  Mounted publicly. These are descriptions of already-public data, and a schema
  that needs a login is not much use to the GIS consumers it exists for.
*/

require('rootpath')();
const express = require('express');
const router = express.Router();
const service = require('./vpSchema.service');

router.get('/', index);
router.get('/vocabularies', (req, res) => res.json(service.vocabularies()));
router.get('/:group', groupSchema);
router.get('/:group/shapefile', shapefileSchema);
router.get('/:group/arcgis', arcgisSchema);

module.exports = router;

function index(req, res) { res.json(service.index()); }

function unknown(res, group) {
    return res.status(404).json({
        name: 'NotFound',
        message: `Unknown group '${group}'. Known groups: ${service.groups().join(', ')}.`,
    });
}

function groupSchema(req, res) {
    if (!service.known(req.params.group)) return unknown(res, req.params.group);
    res.json(service.jsonSchema(req.params.group));
}

function shapefileSchema(req, res) {
    if (!service.known(req.params.group)) return unknown(res, req.params.group);
    res.json(service.shapefileSchema(req.params.group));
}

function arcgisSchema(req, res) {
    if (!service.known(req.params.group)) return unknown(res, req.params.group);
    res.json(service.arcgisSchema(req.params.group));
}
