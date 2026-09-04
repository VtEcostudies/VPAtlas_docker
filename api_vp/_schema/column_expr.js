/*
  column_expr.js — the one place a dictionary field turns into SQL.

  Shared by the build-time view generator (_schema/build_views.js) and the
  runtime select-list builder (_schema/select_list.js) so the canonical
  ogc.* views and the API's own queries cannot express the same field two
  different ways. That divergence is precisely what produced six public outputs
  with 36 / 37 / 13 and 163 / 117 / 63 fields.

  The conversions applied here are the type contract:

    boolean -> smallint 0/1  ArcGIS has no boolean field type; left alone the
                             column publishes as String(4000) (Esri ADP_102064).
                             Postgres has no direct boolean->smallint cast, so
                             it goes through int.
    enum    -> text          Keeps the output free of enum type dependencies.
                             Allowed values live in the dictionary's domain.
    text[]  -> text          Comma-delimited; JSON arrays and DBF columns have
                             no array equivalent.

    date/timestamp -> ISO-8601 UTC text, formatted in the view itself.

  That last one reverses an earlier decision, on evidence. The views originally
  kept native date and timestamp types so the shapefile could carry a real DBF
  Date, leaving each format to serialise its own way. pg_featureserv's own way
  turns out not to be machine-readable:

      timestamp                     2019-06-22 14:03:33.953599
      timestamptz                   2019-06-22 14:03:33.953599+00
      ISO-8601 text                 2019-06-22T14:03:33.953Z

  A space instead of a T, and no zone designator -- not ISO-8601, and rejected by
  most date parsers. Casting to timestamptz does not fix it. pg_featureserv
  offers no format control, so the only way to publish a parseable timestamp
  through it is to format the value before it gets there.

  Doing that in the view means all three formats emit the identical string, which
  was the point of the canonical views to begin with. Two consequences worth
  knowing:

    - The shapefile carries these as Character(24) rather than DBF Date. That is
      not the loss it appears to be: DBF Date stores YYYYMMDD and no time at all,
      so every timestamp was already losing its time component there. An ISO
      string keeps it.
    - OGC filtering on these columns becomes a string comparison, which still
      orders correctly -- ISO-8601 UTC sorts lexicographically in chronological
      order, so range filters keep working.
*/
const ISO_UTC = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
const DATE_TYPES = ['date', 'timestamp without time zone', 'timestamp with time zone'];

const { VOCABULARIES } = require('_helpers/normalize_values');

const ALIAS = { vpmapped: 'm', vpvisit: 'v', vpreview: 'r' };

/*
  Output-side net for JSON-array-shaped strings.

  Survey123 sends multi-select answers as '["Leaf litter"]'. Migration 023
  cleaned the rows present and the ingest path now normalises before writing,
  but the sync is an external system and a future release could start sending
  them again. Anything that reaches the published output shaped like an array
  is flattened to a comma-delimited string here.

  To be precise about the risk, since it has been confused with the
  reviewReasons problem: a genuine JSON array in a GeoJSON property breaks an
  ArcGIS feature layer outright, because no field type can hold it -- that is
  what reviewReasons did. A *string* that merely looks like an array breaks
  nothing structurally. It renders as literal ["Other"] and quietly fails every
  filter, symbology rule and group-by that expects "Other", which is worse in
  practice because nothing reports an error.

  Applied only to the controlled-vocabulary columns, the only ones that can
  receive a multi-select answer.
*/
function unwrapArrayLiteral(ref) {
    return `CASE WHEN ${ref} ~ '^\\s*\\[' `
         + `THEN btrim(regexp_replace(${ref}, '[\\[\\]"]', '', 'g')) `
         + `ELSE ${ref} END`;
}

function columnExpr(field) {
    const src = field.source;

    if (src === 'computed') {
        if (field.name === 'vpatlas_pool_url') {
            return `CONCAT('https://vpatlas.org/pools/list?poolId=', m."mappedPoolId", '&zoomFilter=false')`;
        }
        if (field.name === 'vpatlas_visit_url') {
            return `CONCAT('https://vpatlas.org/pools/visit/view/', v."visitId")`;
        }
        throw new Error(`no expression for computed field ${field.name}`);
    }

    // Computed fields carry a ready-made, already-cast expression.
    if (/^\(?[mtvcr]\./.test(src)) return src;

    if (!src.includes('.')) throw new Error(`unparseable source ${src}`);
    const [table, quoted] = src.split(/\.(.+)/);
    const alias = ALIAS[table];
    if (!alias) throw new Error(`no alias for table ${table}`);
    const ref = `${alias}.${quoted}`;

    if (field.pgType === 'boolean') return `(${ref})::int::smallint`;
    if (String(field.pgType).startsWith('enum:')) return `(${ref})::text`;
    if (VOCABULARIES[field.name] && field.pgType === 'text') return unwrapArrayLiteral(ref);
    // A bare date becomes midnight UTC, so date-only and timestamp columns are
    // indistinguishable in shape -- which is what lets the AGOL side type them
    // all as Date rather than Date Only.
    if (DATE_TYPES.includes(field.pgType)) return `to_char(${ref}, '${ISO_UTC}')`;
    if (field.pgType === 'ARRAY') {
        return `NULLIF(array_to_string(COALESCE(${ref}, '{}'::text[]), ', '), '')`;
    }
    return ref;
}

module.exports = { columnExpr, ALIAS };
