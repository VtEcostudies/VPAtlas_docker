/*
  ogc_proxy.js — sit in front of pg_featureserv's metadata resources and add
  what it cannot say for itself.

  WHY

  Migration 027 and the /schema endpoints gave the OGC service a Part 5 schema
  resource and field constraints, but nothing advertised either. A collection
  published only three links:

      self       /collections/ogc.mapped_pools
      alternate  /collections/ogc.mapped_pools.html
      items      /collections/ogc.mapped_pools/items

  OGC API - Features Part 5 says a client discovers the schema through a link
  with rel="http://www.opengis.net/def/rel/ogc/1.0/schema". Without one, a
  conforming client has no reason to believe a schema exists, so the resource
  was reachable only by someone who had been told the URL. /conformance likewise
  never declared the Part 5 class.

  pg_featureserv generates those documents and offers no hook to extend them, so
  nginx routes the metadata resources here instead. /items is deliberately NOT
  proxied -- that is the heavy path, and it needs nothing added.

  CONTENT NEGOTIATION IS PRESERVED
  pg_featureserv serves HTML or JSON from the same path depending on Accept, and
  its HTML browse view is genuinely useful. This forwards the client's Accept
  header and only touches the response when it comes back as JSON; HTML passes
  through untouched.

  FAILURE MODE, STATED PLAINLY
  This puts the Node API in front of the collection listing, which previously
  depended only on pg_featureserv. If the API is down, collection metadata goes
  with it. That was an accepted trade for standards-correct discovery; /items
  keeps working either way.
*/

require('rootpath')();
const fetch = require('node-fetch');
const service = require('./vpSchema.service');

// Compose service name resolves on the shared network in both dev and prod,
// where the container is renamed but the service is not.
const UPSTREAM = process.env.PGFS_UPSTREAM || 'http://ogc_vp:9000';

// Part 5 link relation and conformance class.
const REL_SCHEMA = 'http://www.opengis.net/def/rel/ogc/1.0/schema';
const CONFORMS_SCHEMAS = 'http://www.opengis.net/spec/ogcapi-features-5/1.0/conf/schemas';

// Public origin, so injected links match the ones pg_featureserv emits rather
// than pointing at an internal host.
function publicBase(req) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}/ogc`;
}

function schemaLink(base, collectionId) {
    return {
        rel: REL_SCHEMA,
        type: 'application/schema+json',
        title: 'Schema of the features in this collection',
        href: `${base}/collections/${collectionId}/schema`,
    };
}

function addSchemaLink(collection, base) {
    if (!collection || !collection.id) return collection;
    if (!service.ogcCollectionGroup(collection.id)) return collection;
    const links = Array.isArray(collection.links) ? collection.links.slice() : [];
    if (!links.some(l => l.rel === REL_SCHEMA)) links.push(schemaLink(base, collection.id));
    return Object.assign({}, collection, { links });
}

const AUGMENT = {
    collection: (doc, req) => addSchemaLink(doc, publicBase(req)),

    collections: (doc, req) => {
        if (!Array.isArray(doc.collections)) return doc;
        const base = publicBase(req);
        return Object.assign({}, doc, {
            collections: doc.collections.map(c => addSchemaLink(c, base)),
        });
    },

    conformance: (doc) => {
        const list = Array.isArray(doc.conformsTo) ? doc.conformsTo.slice() : [];
        if (!list.includes(CONFORMS_SCHEMAS)) list.push(CONFORMS_SCHEMAS);
        return Object.assign({}, doc, { conformsTo: list });
    },
};

/*
  Fetch the upstream resource and augment it when it is JSON. Anything else --
  HTML, an error page -- is passed through byte for byte.
*/
async function proxy(upstreamPath, kind, req, res, next) {
    try {
        const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        const upstream = await fetch(`${UPSTREAM}${upstreamPath}${qs}`, {
            headers: { Accept: req.headers.accept || 'application/json' },
        });

        const type = upstream.headers.get('content-type') || '';
        if (!type.includes('json')) {
            const body = await upstream.buffer();
            res.status(upstream.status);
            if (type) res.type(type);
            return res.send(body);
        }

        const doc = await upstream.json();
        res.status(upstream.status).type(type).json(AUGMENT[kind](doc, req));
    } catch (err) {
        // A proxy that fails silently is worse than one that says so.
        console.log(`ogc_proxy | ${upstreamPath} | ${err.message}`);
        next(err);
    }
}

module.exports = { proxy, UPSTREAM, REL_SCHEMA, CONFORMS_SCHEMAS };
