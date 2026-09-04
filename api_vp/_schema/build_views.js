/*
  build_views.js — emit the canonical publication views from the field
  dictionary. Run it to regenerate the migration body when the dictionary
  changes:

      docker exec api_vp node /opt/api/_schema/build_views.js > /tmp/022.sql

  The views it writes are the single source every public format reads:

      ogc.mapped_pools -> /mapped/geojson, /mapped/shapefile, OGC items
      ogc.pool_visits  -> /visit/geojson,  /visit/shapefile,  OGC items

  Generating them rather than hand-writing them is the point. A hand-maintained
  column list is exactly how the six outputs drifted to 36 / 37 / 13 and
  163 / 117 / 63 fields with landowner PII in four of them.

  TYPE HANDLING

    boolean   -> smallint 0/1, since ArcGIS has no boolean field type and would
                 otherwise publish the column as String(4000).
    enum      -> text, so the view has no dependency on enum type definitions.
                 Allowed values survive in the dictionary's domain entry.
    date/ts   -> left in their native Postgres types. The view is the type
                 contract; each format then serialises per the dictionary --
                 ISO-8601 UTC in JSON, a real DBF Date in the shapefile. Casting
                 them to text here would make the three serialisations
                 byte-identical but would cost the shapefile its Date type and
                 the OGC endpoint its date filtering, which is a bad trade.
*/

require('rootpath')();
const fs = require('fs');
const path = require('path');

const { columnExpr } = require('_schema/column_expr');

/*
  Constraint text appended to each column comment.

  pg_featureserv publishes a column comment verbatim as that field's description
  and publishes nothing else -- no length, no allowed values, no format. A client
  reading the OGC collection therefore has no way to size a string field, and
  will guess; guessed sizes are how the published ArcGIS layers ended up with
  String(4000) fields inflating layer storage.

  Appending the constraint to the prose is inelegant, but it is the only channel
  that reaches EVERY OGC client, including a person reading the collection page.
  The structured form is served separately at /collections/{id}/schema.

  Authored description text stays clean; this is added at generation time.
*/
function constraintText(f) {
    const bits = [];
    if (f.format === 'date-time') {
        bits.push('ISO-8601 UTC (YYYY-MM-DDTHH:MM:SS.mmmZ)');
    } else if (f.jsonType === 'string') {
        if (f.maxLength) bits.push(`max ${f.maxLength} characters`);
    } else if (f.jsonType === 'integer' || f.jsonType === 'number') {
        if (f.conversion && f.conversion.startsWith('boolean')) bits.push('0 or 1');
        else if (f.dbfDecimals) bits.push(`decimal, ${f.dbfWidth} digits with ${f.dbfDecimals} decimal places`);
        else bits.push('whole number');
    }
    if (f.domain) bits.push(`allowed values: ${f.domain.join(', ')}`);
    return bits.length ? ` [${bits.join('; ')}]` : '';
}

function buildView(group, viewName, fields, from, where, comment) {
    const cols = fields.map(f => {
        const expr = columnExpr(f);
        const pad = ' '.repeat(Math.max(1, 62 - expr.length));
        return `    ${expr}${pad}AS "${f.name}"`;
    });
    cols.push(`    m."mappedPoolLocation"                                        AS geom`);

    /*
      Field descriptions become real column comments. pg_featureserv reads them
      and publishes each as the "description" of that field in the OGC
      collection -- previously empty on all 76 fields. They are generated here
      rather than written onto the view by hand because the view is dropped and
      recreated on every regeneration, which would take any hand-written comment
      with it. Authored text lives in _schema/{group}.json.
    */
    const comments = fields
        .filter(f => f.description && f.description.trim())
        .map(f => `COMMENT ON COLUMN ogc.${viewName}."${f.name}" IS\n  '${(f.description + constraintText(f)).replace(/'/g, "''")}';`);

    return `-- ── Collection: ${viewName} (${fields.length} published fields + geom) ${'─'.repeat(Math.max(0, 20))}
DROP VIEW IF EXISTS ogc.${viewName} CASCADE;
CREATE VIEW ogc.${viewName} AS
SELECT
${cols.join(',\n')}
${from}
${where};

COMMENT ON VIEW ogc.${viewName} IS
  '${comment.replace(/'/g, "''")}';

-- Field descriptions, published by pg_featureserv as each field's description.
${comments.join('\n')}
`;
}

function main() {
    const mapped = JSON.parse(fs.readFileSync(path.join(__dirname, 'mapped.json'), 'utf8'));
    const visit = JSON.parse(fs.readFileSync(path.join(__dirname, 'visit.json'), 'utf8'));

    const mappedFrom = `FROM vpmapped m
LEFT JOIN vptown   t ON m."mappedTownId"  = t."townId"
LEFT JOIN vpcounty c ON t."townCountyId"  = c."govCountyId"`;

    const visitFrom = `FROM vpvisit v
INNER JOIN vpmapped m ON v."visitPoolId"   = m."mappedPoolId"
LEFT  JOIN vptown   t ON m."mappedTownId"  = t."townId"
LEFT  JOIN vpcounty c ON t."townCountyId"  = c."govCountyId"
LEFT  JOIN vpreview r ON v."visitId"       = r."reviewVisitId"`;

    // Mirrors the public route filter: Eliminated and Duplicate pools are
    // hidden from unauthenticated callers.
    const statusWhere = `WHERE m."mappedPoolLocation" IS NOT NULL
  AND (m."mappedPoolStatus" IS NULL
       OR m."mappedPoolStatus" NOT IN ('Eliminated', 'Duplicate'))`;

    const out = [];
    out.push(buildView('mapped', 'mapped_pools', mapped.fields, mappedFrom, statusWhere,
        'Canonical publication view for mapped vernal pools. Generated from _schema/mapped.json; do not hand-edit. Feeds /mapped/geojson, /mapped/shapefile and the OGC API - Features collection identically. Excludes landowner PII, contributor identity and internal system identifiers.'));
    out.push(buildView('visit', 'pool_visits', visit.fields, visitFrom, statusWhere,
        'Canonical publication view for pool visits. Generated from _schema/visit.json; do not hand-edit. Feeds /visit/geojson, /visit/shapefile and the OGC API - Features collection identically. Excludes landowner PII, contributor identity and internal system identifiers.'));

    process.stdout.write(out.join('\n'));
}

main();
