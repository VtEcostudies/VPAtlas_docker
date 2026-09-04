/*
  field_rules.js — the publication contract for the public VPAtlas feature
  endpoints. Pure functions, no database access, so the rules can be read and
  reasoned about on their own.

  WHAT THIS DECIDES

  Six public outputs have to agree field-for-field and type-for-type:

      /mapped/geojson    /mapped/shapefile    ogc.mapped_pools
      /visit/geojson     /visit/shapefile     ogc.pool_visits

  Before this file they shared almost nothing -- 36 / 37 / 13 fields on the
  mapped side and 163 / 117 / 63 on the visit side, with landowner PII in four
  of the six. The fix is structural: one canonical view per group, generated
  from these rules, feeding all three formats. Fields are identical because
  there is one list; types are identical because there is one set of Postgres
  types underneath.

  SCOPE: "option B" -- everything except personally identifying data, contributor
  identity, and internal system plumbing. Measured against the current payloads
  that is 20 fields for mapped and 108 for visits, versus 13 / 63 if we had
  adopted the narrow OGC sets. The wide set is what lets the existing published
  ArcGIS Online layers be re-pointed at these endpoints instead of rebuilt.

  NAMING: canonical names are the existing camelCase column names, NOT the
  snake_case the first OGC views used. The whole point of the wide set is
  drop-in compatibility with layers that already carry these field names; a
  rename would defeat it. The OGC views are days old and not yet consumed, so
  they are the side that moves.
*/

// ── Exclusions ──────────────────────────────────────────────────────────────

/*
  Personally identifying data, contributor identity, and free-text fields that
  routinely contain both. The free-text exclusions are not squeamishness: these
  endpoints are unauthenticated, and a comment reading "call Jane at 802-555-
  0100 before entering" is landowner PII sitting in a notes column. That is the
  same reasoning behind the value-based sweep in _helpers/scrub.js.
*/
const PII = /Landowner|Comments|Directions|Notes|UserName|QAPerson|ByUser|UserId|ObserverUser/;

/*
  Kept despite matching PII above. These are yes/no flags asserting that
  permission exists or that the visitor was the landowner. They name nobody and
  identify nobody, and they are ecologically and administratively useful.
*/
const PII_EXCEPTIONS = new Set([
    'visitLandownerPermission',
    'visitUserIsLandowner',
    'mappedLandownerPermission',
]);

/*
  Internal plumbing: Survey123 / AGOL sync identifiers, legacy key columns,
  foreign keys whose human-readable form is already published (townName), the
  raw geometry duplicates, and per-observation photo / iNaturalist reference
  columns that point at storage rather than carrying data.
*/
const INTERNAL = /GlobalId|ObjectId|ServiceId|DataUrl|Legacy|TownId|mappedShape|PoolBorder|Photo$|iNat$/;

/*
  Nested values with no flat-table equivalent, dropped everywhere. Both are
  redundant or prohibited on their own terms: mappedPoolLocation repeats the
  feature geometry verbatim, and visitLandowner is a JSONB blob of landowner
  name / address / phone / email.
*/
const NESTED = new Set(['mappedPoolLocation', 'visitLandowner']);

function isPublishable(name) {
    if (NESTED.has(name)) return false;
    if (INTERNAL.test(name)) return false;
    if (PII_EXCEPTIONS.has(name)) return true;
    if (PII.test(name)) return false;
    return true;
}

function excludedBecause(name) {
    if (NESTED.has(name)) return 'nested';
    if (INTERNAL.test(name)) return 'internal';
    if (PII_EXCEPTIONS.has(name)) return null;
    if (PII.test(name)) return 'pii';
    return null;
}

// ── Type mapping ────────────────────────────────────────────────────────────

/*
  One Postgres type resolves to one representation in each published format.
  This table IS the type contract; everything downstream reads it rather than
  making its own decision.

  Two deliberate conversions, both driven by ArcGIS Online's field-type set:

    boolean -> smallint 0/1. Esri's ADP_102064: "Boolean fields are converted
    to string since Boolean is not a supported field type for feature layers."
    Left alone, roughly 30 flag fields land as String(4000) and every renderer,
    definition query and Arcade expression treating them as 0/1 breaks. The
    older published layers carried them as SmallInteger.

    date / timestamp -> ISO-8601 UTC text in JSON, real Date in DBF. GeoJSON
    has no date type at all, so a string is the only option there; the DBF side
    can carry a true date and does. Note DBF Date holds no time component, so
    timestamps lose their time in the shapefile -- documented per field rather
    than silently dropped.

  bigint maps to Double rather than esriFieldTypeBigInteger on purpose: the VCGI
  schema review called BigInteger out as a problem in most GIS clients, and no
  column in either group actually needs 64 bits.
*/
const TYPE_MAP = {
    'text':                        { json: 'string',  dbf: 'C', esri: 'esriFieldTypeString' },
    'character varying':           { json: 'string',  dbf: 'C', esri: 'esriFieldTypeString' },
    'character':                   { json: 'string',  dbf: 'C', esri: 'esriFieldTypeString' },
    'uuid':                        { json: 'string',  dbf: 'C', esri: 'esriFieldTypeString' },
    'USER-DEFINED':                { json: 'string',  dbf: 'C', esri: 'esriFieldTypeString' },
    'ARRAY':                       { json: 'string',  dbf: 'C', esri: 'esriFieldTypeString' },
    'boolean':                     { json: 'integer', dbf: 'N', esri: 'esriFieldTypeSmallInteger' },
    'smallint':                    { json: 'integer', dbf: 'N', esri: 'esriFieldTypeSmallInteger' },
    'integer':                     { json: 'integer', dbf: 'N', esri: 'esriFieldTypeInteger' },
    'bigint':                      { json: 'integer', dbf: 'N', esri: 'esriFieldTypeDouble' },
    'numeric':                     { json: 'number',  dbf: 'N', esri: 'esriFieldTypeDouble' },
    'real':                        { json: 'number',  dbf: 'N', esri: 'esriFieldTypeDouble' },
    'double precision':            { json: 'number',  dbf: 'N', esri: 'esriFieldTypeDouble' },
    // dbf 'C', not 'D': these are published as ISO-8601 UTC text rather than a
    // native date, because that is the only representation pg_featureserv emits
    // in a machine-readable form. DBF Date carries no time component anyway, so
    // a 24-character ISO string preserves strictly more than it costs. esri stays
    // Date so the AGOL side still types the field as a date.
    'date':                        { json: 'string',  dbf: 'C', esri: 'esriFieldTypeDate' },
    'timestamp without time zone': { json: 'string',  dbf: 'C', esri: 'esriFieldTypeDate' },
    'timestamp with time zone':    { json: 'string',  dbf: 'C', esri: 'esriFieldTypeDate' },
};

// DBF caps character fields at 254 bytes. Anything measured wider is published
// at 254 and flagged, rather than silently truncated at export time.
const DBF_MAX_CHAR = 254;

/*
  Published string length, rounded up from the longest value actually present in
  the column. Rounding keeps the number stable as data grows -- a single new row
  one character longer should not change the published schema -- while staying
  far below the 4000-character default that the VCGI review flagged as
  needlessly inflating layer storage and credits.
*/
const LENGTH_STEPS = [10, 20, 25, 50, 75, 100, 150, 254];

function publishedLength(measuredMax) {
    const m = measuredMax || 0;
    for (const step of LENGTH_STEPS) {
        if (m <= step) return step;
    }
    return DBF_MAX_CHAR;
}

module.exports = {
    isPublishable,
    excludedBecause,
    TYPE_MAP,
    LENGTH_STEPS,
    DBF_MAX_CHAR,
    publishedLength,
    PII,
    PII_EXCEPTIONS,
    INTERNAL,
    NESTED,
};
