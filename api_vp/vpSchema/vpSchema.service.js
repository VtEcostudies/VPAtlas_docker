/*
  vpSchema.service.js — publish the field dictionary in the shapes different
  consumers need.

  The OGC endpoint was assumed to already document these datasets. It does not:
  pg_featureserv's collection metadata lists a field name and a coarse type with
  an empty description (mapped_pools reports all 13 of its fields as "string",
  including three dates), its OpenAPI document ships an empty
  components.schemas, and this build serves no /schema or /queryables resource
  at all. So the definitions have to come from us, and they have to cover all
  three formats rather than only the two that lacked them.

  Everything here is projected from _schema/{group}.json, which is generated
  from information_schema, pg_enum and measured column lengths. Nothing is
  asserted by hand.
*/

require('rootpath')();
const { dictionary } = require('_schema/select_list');
const { VOCABULARIES, EQUIVALENTS } = require('_helpers/normalize_values');

const GROUPS = {
    mapped: { collection: 'ogc.mapped_pools', title: 'Mapped vernal pools',
              geojson: '/mapped/geojson', shapefile: '/mapped/shapefile' },
    visit:  { collection: 'ogc.pool_visits', title: 'Vernal pool visits',
              geojson: '/visit/geojson', shapefile: '/visit/shapefile' },
};

function groups() { return Object.keys(GROUPS); }
function known(group) { return Object.prototype.hasOwnProperty.call(GROUPS, group); }

/*
  JSON Schema for a feature's properties object. Draft 2020-12, which is what
  OGC API - Features Part 5 uses for its own schema resource, so a client that
  can read one can read this.
*/
function jsonSchema(group) {
    const dict = dictionary(group);
    const props = {};
    for (const f of dict.fields) {
        const p = { type: [f.jsonType, 'null'] };
        if (f.jsonType === 'string' && f.maxLength) p.maxLength = f.maxLength;
        if (f.format) p.format = f.format;
        if (f.domain) p.enum = f.domain.concat([null]);
        if (f.description) p.description = f.description;
        if (f.conversion) p.$comment = f.conversion;
        props[f.name] = p;
    }
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: `https://api.vpatlas.org/schema/${group}`,
        title: `${GROUPS[group].title} — feature properties`,
        description: `Canonical published field set, identical across ${GROUPS[group].geojson}, ${GROUPS[group].shapefile} and the OGC API - Features collection ${GROUPS[group].collection}. Generated from the database, not hand-maintained.`,
        type: 'object',
        properties: props,
        additionalProperties: false,
        'x-fieldCount': dict.fields.length,
        'x-generatedAt': dict.generatedAt,
    };
}

/*
  The DBF contract. Shapefile is the one format that cannot carry the canonical
  names -- DBF caps them at 10 characters and writes them uppercase -- so the
  mapping has to be published rather than left for consumers to guess.
*/
function shapefileSchema(group) {
    const dict = dictionary(group);
    return {
        group,
        endpoint: GROUPS[group].shapefile,
        note: 'DBF field names are capped at 10 characters and written uppercase. Names are stable once assigned and equal the canonical name wherever it already fits.',
        limits: { maxFieldNameLength: 10, maxCharacterFieldWidth: 254, dateFieldsCarryNoTime: true },
        fields: dict.fields.map(f => ({
            name: f.name,
            dbfName: f.shapefileName,
            dbfType: f.dbfType,
            width: f.dbfType === 'C' ? f.maxLength : f.dbfWidth,
            decimals: f.dbfDecimals,
            truncatedInShapefile: f.shapefileTruncation || false,
            note: f.conversion,
        })),
    };
}

/*
  esriFieldType per field, so the ArcGIS Data Pipelines "Update fields" step can
  be configured from a machine-readable list rather than a table in an email.
  This is the direct answer to the VCGI schema review, which found types drifting
  because the publishing step was inferring them instead of being told.
*/
function arcgisSchema(group) {
    const dict = dictionary(group);
    return {
        group,
        note: 'Set these types in the Data Pipelines "Update fields" tool before writing the feature layer. Lengths are measured from live data, not the 4000-character default, which is what inflates layer storage and credit consumption.',
        fields: dict.fields.map(f => {
            const e = { name: f.name, type: f.esriType, alias: f.name, nullable: f.nullable };
            if (f.esriType === 'esriFieldTypeString') e.length = f.maxLength;
            if (f.domain) e.codedValues = f.domain;
            return e;
        }),
    };
}

/*
  Controlled vocabularies enforced in application code rather than by a Postgres
  enum, plus the pairs of stored values that are equivalent to one form control.

  Published because the visit form needs the same equivalence map and would
  otherwise keep a second, silently diverging copy -- test_stack.sh compares the
  two against this endpoint.
*/
function vocabularies() {
    return {
        note: 'Allowed values for controlled-vocabulary fields. equivalents maps a stored value to the form control that represents it; both spellings are valid and neither is rewritten.',
        vocabularies: VOCABULARIES,
        equivalents: EQUIVALENTS,
    };
}

function index() {
    return {
        title: 'VPAtlas published field dictionaries',
        description: 'Each group is published in three formats carrying an identical field set and identical types: GeoJSON, Esri shapefile, and an OGC API - Features collection.',
        groups: groups().map(g => ({
            group: g,
            title: GROUPS[g].title,
            fieldCount: dictionary(g).fields.length,
            formats: {
                geojson: GROUPS[g].geojson,
                shapefile: GROUPS[g].shapefile,
                ogc: `/ogc/collections/${GROUPS[g].collection}/items`,
            },
            schema: {
                properties: `/schema/${g}`,
                shapefile: `/schema/${g}/shapefile`,
                arcgis: `/schema/${g}/arcgis`,
            },
        })),
        vocabularies: '/schema/vocabularies',
        openapi: '/openapi.json',
        docs: '/docs',
    };
}

module.exports = { groups, known, jsonSchema, shapefileSchema, arcgisSchema, vocabularies, index, GROUPS };
