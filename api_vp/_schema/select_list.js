/*
  select_list.js — build the canonical SQL column list for a published group,
  at runtime, straight from the field dictionary.

  WHY THE API READS THE DICTIONARY RATHER THAN THE VIEW

  The obvious way to make /mapped/geojson and ogc.mapped_pools agree is to have
  the endpoint select from the view. It does not work here: callers filter these
  endpoints on arbitrary base-table columns via the pipe-operator query syntax
  (?mappedTownId=5, ?visitHasIndicator=1), and the canonical views deliberately
  exclude the internal columns some of those filters use. Selecting from the
  view would silently break every such query.

  So the API keeps the full join in its FROM clause -- filters keep working --
  and derives its SELECT list from the same _schema/*.json the views are
  generated from. One source, two consumers, no drift. _schema/schema.test.js
  asserts the live view's columns still match the dictionary, so the two cannot
  separate unnoticed.
*/

require('rootpath')();
const fs = require('fs');
const path = require('path');
const { columnExpr } = require('_schema/column_expr');

const cache = {};

function dictionary(group) {
    if (!cache[group]) {
        cache[group] = JSON.parse(fs.readFileSync(path.join(__dirname, `${group}.json`), 'utf8'));
    }
    return cache[group];
}

/*
  Column list for the GeoJSON endpoints: canonical camelCase names, matching the
  view and the OGC collection exactly.
*/
function geojsonSelect(group) {
    return dictionary(group).fields
        .map(f => `                    ${columnExpr(f)} AS "${f.name}"`)
        .join(',\n');
}

/*
  Column list for the shapefile endpoints. DBF caps field names at 10
  characters, so each field carries a generated shapefileName -- stable once
  assigned, and equal to the canonical name wherever that already fits. Without
  this, pgsql2shp truncates blind and visitHabitatAgriculture,
  visitHabitatLightDev, visitHabitatHeavyDev, visitHabitatPavedRd,
  visitHabitatDirtRd and visitHabitatPowerline all collapse to "visitHabit".
*/
function shapefileSelect(group) {
    return dictionary(group).fields
        .map(f => `  ${columnExpr(f)} AS "${f.shapefileName}"`)
        .join(',\n');
}

function fieldNames(group) {
    return dictionary(group).fields.map(f => f.name);
}

module.exports = { geojsonSelect, shapefileSelect, fieldNames, dictionary };
