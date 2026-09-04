/*
  openapi.js — assemble an OpenAPI 3.1 description of the public feature and
  schema endpoints, with the response schemas projected from the field
  dictionary rather than written out by hand.

  Why 3.1 specifically: it is the first version whose schema dialect is plain
  JSON Schema 2020-12, so the per-group schemas served at /schema/{group} drop
  in unmodified instead of needing an OpenAPI-flavoured rewrite.
*/

require('rootpath')();
const service = require('./vpSchema.service');

function featureCollectionSchema(group) {
    return {
        type: 'object',
        properties: {
            type: { const: 'FeatureCollection' },
            name: { type: 'string' },
            filter: { type: 'string', description: 'Echo of the WHERE clause the query parameters produced.' },
            features: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: { const: 'Feature' },
                        geometry: { type: ['object', 'null'], description: 'GeoJSON Point in WGS84 (CRS84), per RFC 7946.' },
                        properties: { $ref: `#/components/schemas/${group}Properties` },
                    },
                },
            },
        },
    };
}

function build() {
    const schemas = {};
    for (const g of service.groups()) {
        const s = service.jsonSchema(g);
        delete s.$schema; delete s.$id;
        schemas[`${g}Properties`] = s;
        schemas[`${g}FeatureCollection`] = featureCollectionSchema(g);
    }

    const paths = {};
    for (const g of service.groups()) {
        const meta = service.GROUPS[g];
        paths[meta.geojson] = {
            get: {
                summary: `${meta.title} as GeoJSON`,
                description: `Returns every published field for this group. The field set and types are identical to ${meta.shapefile} and to the OGC API - Features collection ${meta.collection}.`,
                tags: [g],
                parameters: [{
                    name: 'Any published field name',
                    in: 'query',
                    required: false,
                    description: 'Filter on any column, optionally with a pipe operator: ?mappedPoolStatus=Confirmed, ?mappedPoolId|ILIKE=%NEW%, ?townName=Stowe&townName=Duxbury (repeated parameters become IN). Eliminated and Duplicate pools are excluded for unauthenticated callers.',
                    schema: { type: 'string' },
                }],
                responses: {
                    200: {
                        description: 'A GeoJSON FeatureCollection.',
                        content: { 'application/json': { schema: { $ref: `#/components/schemas/${g}FeatureCollection` } } },
                    },
                },
            },
        };
        paths[meta.shapefile] = {
            get: {
                summary: `${meta.title} as an Esri shapefile`,
                description: 'Returns a gzipped tar carrying the .shp/.shx/.dbf/.prj/.cpg set. Same fields and values as the GeoJSON endpoint; DBF caps field names at 10 characters and writes them uppercase, so see /schema/' + g + '/shapefile for the name mapping.',
                tags: [g],
                responses: { 200: { description: 'application/gzip', content: { 'application/gzip': {} } } },
            },
        };
        paths[`/schema/${g}`] = { get: { summary: `JSON Schema for ${meta.title} properties`, tags: ['schema'], responses: { 200: { description: 'JSON Schema 2020-12.', content: { 'application/json': {} } } } } };
        paths[`/schema/${g}/shapefile`] = { get: { summary: `DBF field mapping for ${meta.title}`, tags: ['schema'], responses: { 200: { description: 'Canonical name to DBF name, type, width.', content: { 'application/json': {} } } } } };
        paths[`/schema/${g}/arcgis`] = { get: { summary: `esriFieldType list for ${meta.title}`, tags: ['schema'], responses: { 200: { description: 'Field types for the ArcGIS Data Pipelines Update fields step.', content: { 'application/json': {} } } } } };
    }
    paths['/schema'] = { get: { summary: 'Index of published groups and their formats', tags: ['schema'], responses: { 200: { description: 'Group index.', content: { 'application/json': {} } } } } };

    return {
        openapi: '3.1.0',
        info: {
            title: 'VPAtlas public feature API',
            version: '1.0.0',
            description: [
                'Public, unauthenticated access to Vermont Vernal Pool Atlas data.',
                '',
                'Each dataset is published in three formats that carry an identical field set and identical types: GeoJSON, Esri shapefile, and an OGC API - Features collection served at /ogc. All three are generated from one field dictionary per group, which is itself derived from the database, so they cannot drift apart.',
                '',
                'Published data excludes landowner personally identifying information, contributor identity, and internal system identifiers.',
            ].join('\n'),
            contact: { name: 'Vermont Center for Ecostudies', url: 'https://vtecostudies.org' },
            license: { name: 'Contact VCE for terms of use', url: 'https://vpatlas.org' },
        },
        servers: [{ url: 'https://api.vpatlas.org', description: 'Production' }],
        tags: [
            { name: 'mapped', description: 'Mapped vernal pool locations.' },
            { name: 'visit', description: 'Field visits to mapped pools.' },
            { name: 'schema', description: 'Data definitions for the published formats.' },
        ],
        paths,
        components: { schemas },
    };
}

module.exports = { build };
