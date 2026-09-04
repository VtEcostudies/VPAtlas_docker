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

/*
  OGC API - Features Part 5 schema resource. nginx routes
  /ogc/collections/{id}/schema here instead of to pg_featureserv, which serves
  no such resource and publishes no field lengths of its own.
*/
router.get('/ogc/:collectionId', ogcSchema);
router.get('/:group', groupSchema);
router.get('/:group/shapefile', shapefileSchema);
router.get('/:group/arcgis', arcgisSchema);

module.exports = router;

function index(req, res) { res.json(service.index()); }

function ogcSchema(req, res) {
    const id = String(req.params.collectionId).replace(/\.json$/, '');
    if (!service.ogcCollectionGroup(id)) {
        return res.status(404).json({
            name: 'NotFound',
            message: `Unknown collection '${id}'. Known collections: ${Object.keys(service.OGC_COLLECTIONS).join(', ')}.`,
        });
    }
    res.type('application/schema+json').json(service.ogcSchema(id));
}

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
