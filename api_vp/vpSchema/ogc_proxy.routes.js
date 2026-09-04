/*
  ogc_proxy.routes.js — the metadata resources nginx redirects away from
  pg_featureserv so the Part 5 schema link and conformance class can be added.
  See ogc_proxy.js for why.
*/

require('rootpath')();
const express = require('express');
const router = express.Router();
const { proxy } = require('./ogc_proxy');

router.get('/collections', (req, res, next) => proxy('/collections', 'collections', req, res, next));
router.get('/conformance', (req, res, next) => proxy('/conformance', 'conformance', req, res, next));
router.get('/collections/:collectionId', (req, res, next) => {
    const id = String(req.params.collectionId).replace(/\.json$/, '');
    proxy(`/collections/${encodeURIComponent(id)}`, 'collection', req, res, next);
});

module.exports = router;
