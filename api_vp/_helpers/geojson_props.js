/*
  geojson_props.js — build the `properties` expression for the public GeoJSON
  endpoints so the payload types cleanly in ArcGIS Online and other flat
  GeoJSON readers.

  WHY THIS EXISTS

  GeoJSON carries JSON types only, and ArcGIS Data Pipelines infers a hosted
  feature layer's field types from what it sees. Three of our shapes infer
  badly, and a VCGI schema review of the published layers flagged all three:

    1. Postgres `boolean` serialises as JSON true/false, and per Esri's
       ADP_102064 "Boolean fields are converted to string since Boolean is not
       a supported field type for feature layers." That turned ~19 flag fields
       (visitFish, visitDisturb*, visitHabitat*, mappedLandownerPermission,
       reviewPoolLocator, ...) into String(4000), breaking every renderer,
       definition query and Arcade expression treating them as 0/1. They are
       emitted as smallint 0/1 instead, which is what the older published
       layers carried.

    2. Date and timestamp columns serialise as strings, and the naive
       `2019-07-25T17:28:21.024616` form (microseconds, no zone) is awkward to
       convert downstream. They are normalised to a single unambiguous
       ISO-8601 UTC form, `YYYY-MM-DDTHH:MM:SS.mmmZ`. Date-only columns come
       out at midnight UTC rather than as a bare date, so the AGOL side can
       type them as Date rather than Date Only. Postgres runs in Etc/UTC and
       every one of these columns defaults to now(), so the Z is accurate and
       not a relabelling of local time.

    3. Nested objects have no flat-table equivalent. mappedPoolLocation is
       pure redundancy — the same point is already the feature geometry — and
       visitLandowner is landowner PII that has no business on an
       unauthenticated endpoint. Both are dropped.

  Deliberately NOT converted: visitFishCount, visitMaxDepth, visitFishSize and
  visitLocationUncertainty are `text` in Postgres and genuinely hold prose
  ("knee deep", "> 10", "high"). Casting them to a numeric type would null out
  every such row. They stay strings.

  The boolean rewrite walks the assembled object rather than naming columns, so
  a boolean column added to vpmapped/vpvisit/vpreview later is handled without
  touching this file, and a column that exists in one environment but not
  another cannot break the query.
*/

// Columns whose string values get normalised to ISO-8601 UTC. Listed by key
// name because the assembled row has three ambiguous "createdAt"/"updatedAt"
// columns (one per joined table) that cannot be referenced directly.
const DATE_KEYS = [
    'createdAt',
    'updatedAt',
    'lastEditedAt',
    'visitDate',
    'reviewQADate',
    'mappedDateText',
];

// Nested objects dropped from every public GeoJSON payload. See note 3 above.
const DROP_KEYS = [
    'mappedPoolLocation',
    'visitLandowner',
];

const ISO_UTC = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

/*
  Returns the full `(SELECT ...) AS properties` expression.

    innerSelect  SQL for the column list feeding row_to_json, WITHOUT the
                 enclosing SELECT/parens — e.g. `vpmapped.*, vpvisit.*`.
    overlay      optional jsonb expression merged over the row before
                 normalisation, for values that need rebuilding in SQL (the
                 visit endpoint uses it to flatten the reviewReasons array).
*/
function propertiesSql(innerSelect, overlay) {
    const drops = DROP_KEYS.map(k => ` - '${k}'::text`).join('');
    const merge = overlay ? `\n                        || ${overlay}` : '';
    const dateKeys = DATE_KEYS.map(k => `'${k}'`).join(', ');

    return `(SELECT jsonb_object_agg(
                      k,
                      CASE
                        WHEN jsonb_typeof(v) = 'boolean'
                          THEN to_jsonb((v = 'true'::jsonb)::int)
                        WHEN jsonb_typeof(v) = 'string' AND k IN (${dateKeys})
                          THEN to_jsonb(to_char((v #>> '{}')::timestamp, '${ISO_UTC}'))
                        ELSE v
                      END)
              FROM jsonb_each(
                     (SELECT (row_to_json(p)::jsonb${drops})${merge}
                      FROM (SELECT
${innerSelect}
                           ) AS p)
                   ) AS e(k, v))`;
}

module.exports = { propertiesSql, DATE_KEYS, DROP_KEYS };
