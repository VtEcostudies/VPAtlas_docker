/*
  build_dictionary.js — generate the published field dictionary for the public
  feature endpoints, verified against the live database.

  Run it inside the api container:

      docker exec api_vp node /opt/api/_schema/build_dictionary.js

  It writes _schema/mapped.json and _schema/visit.json. Those two files are the
  single source of truth downstream: the canonical ogc.* views, the shapefile
  alias list, the /schema/* endpoints and the OpenAPI document are all built
  from them, so the six public outputs cannot drift apart on field names or
  types the way they had.

  NOTHING HERE IS HAND-ASSERTED. Types, nullability and numeric precision come
  from information_schema; enum domains come from pg_enum; published string
  lengths are measured with max(length(...)) over the real data and rounded up.
  That last one matters commercially as well as descriptively -- the VCGI schema
  review flagged every string field arriving as String(4000) as needless layer
  storage and credit spend, and a measured 25 or 50 replaces a guessed 4000.

  Shapefile names, once assigned, are preserved from the existing dictionary on
  re-run. A DBF field name may not exceed 10 characters, so they are generated
  rather than natural, and a name that shifted between runs would silently break
  every downstream consumer keyed to it.
*/

require('rootpath')();
const fs = require('fs');
const path = require('path');
const { query } = require('_helpers/db_postgres');
const rules = require('_schema/field_rules');
const { VOCABULARIES } = require('_helpers/normalize_values');

/*
  Per group: which tables contribute columns, in precedence order, plus the
  columns the view computes rather than selects.

  Precedence resolves duplicate column names. createdAt and updatedAt exist on
  all three visit-group tables, and the current /visit/geojson emits the
  REVIEW's values -- a last-wins accident of jsonb key de-duplication, which is
  why they are NULL on all 31 visits that have no review. Listing vpvisit first
  resolves them to the visit's own timestamps, which is what the field name
  claims and what consumers assume.
*/
const GROUPS = {
    mapped: {
        tables: ['vpmapped'],
        computed: [
            { name: 'poolId',           pgType: 'text', expr: 'm."mappedPoolId"',     measureFrom: ['vpmapped', 'mappedPoolId'],     note: 'Alias of mappedPoolId, retained for compatibility.' },
            { name: 'poolStatus',       pgType: 'text', expr: '(m."mappedPoolStatus")::text', measureFrom: ['vpmapped', 'mappedPoolStatus'], note: 'Alias of mappedPoolStatus, retained for compatibility.' },
            { name: 'townName',         pgType: 'text', expr: 't."townName"',         measureFrom: ['vptown', 'townName'],           note: 'Town containing the pool.' },
            { name: 'countyName',       pgType: 'text', expr: 'c."countyName"',       measureFrom: ['vpcounty', 'countyName'],       note: 'County containing the pool. Stored uppercase.' },
            { name: 'vpatlas_pool_url', pgType: 'text', expr: null, urlPrefix: 'https://vpatlas.org/pools/list?poolId=&zoomFilter=false', measureFrom: ['vpmapped', 'mappedPoolId'], note: 'Deep link to the pool on vpatlas.org.' },
        ],
    },
    visit: {
        tables: ['vpvisit', 'vpmapped', 'vpreview'],
        computed: [
            { name: 'poolId',            pgType: 'text', expr: 'm."mappedPoolId"',     measureFrom: ['vpmapped', 'mappedPoolId'],     note: 'Alias of mappedPoolId, retained for compatibility.' },
            { name: 'poolStatus',        pgType: 'text', expr: '(m."mappedPoolStatus")::text', measureFrom: ['vpmapped', 'mappedPoolStatus'], note: 'Alias of mappedPoolStatus, retained for compatibility.' },
            { name: 'townName',          pgType: 'text', expr: 't."townName"',         measureFrom: ['vptown', 'townName'],           note: 'Town containing the pool.' },
            { name: 'countyName',        pgType: 'text', expr: 'c."countyName"',       measureFrom: ['vpcounty', 'countyName'],       note: 'County containing the pool. Stored uppercase.' },
            { name: 'vpatlas_pool_url',  pgType: 'text', expr: null, urlPrefix: 'https://vpatlas.org/pools/list?poolId=&zoomFilter=false', measureFrom: ['vpmapped', 'mappedPoolId'], note: 'Deep link to the pool on vpatlas.org.' },
            { name: 'vpatlas_visit_url', pgType: 'text', expr: null, urlPrefix: 'https://vpatlas.org/pools/visit/view/', measureFrom: ['vpvisit', 'visitId'], note: 'Deep link to the visit on vpatlas.org.' },
        ],
    },
};

const TABLE_PREFIX = { vpmapped: 'map', vpvisit: 'vis', vpreview: 'rev' };

// ── Shapefile name allocation ───────────────────────────────────────────────

/*
  DBF field names are capped at 10 characters. pgsql2shp currently truncates
  blind, which is not merely ugly but wrong: visitHabitatAgriculture,
  visitHabitatLightDev, visitHabitatHeavyDev, visitHabitatPavedRd,
  visitHabitatDirtRd and visitHabitatPowerline all collapse to "visitHabit".
  This allocates a readable, unique, stable name instead -- a 3-character table
  prefix plus the remaining camelCase words truncated to share what is left.
*/
function splitWords(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_]+/g, ' ').split(/\s+/).filter(Boolean);
}

function proposeShapefileName(name) {
    // A name that already fits keeps its canonical spelling. Shapefile parity
    // is best when the DBF name IS the published name; abbreviating something
    // that fits would create a needless second vocabulary.
    if (name.length <= 10) return name;

    let words = splitWords(name);
    let prefix = '';
    const lead = (words[0] || '').toLowerCase();
    if (lead === 'mapped') { prefix = 'map'; words = words.slice(1); }
    else if (lead === 'visit') { prefix = 'vis'; words = words.slice(1); }
    else if (lead === 'review') { prefix = 'rev'; words = words.slice(1); }

    if (!words.length) return (prefix || name).slice(0, 10);

    let budget = 10 - prefix.length;
    const per = Math.max(1, Math.floor(budget / words.length));
    const parts = [];
    for (let i = 0; i < words.length; i++) {
        const remainingWords = words.length - i;
        const take = (remainingWords === 1) ? budget : Math.min(per, budget - (remainingWords - 1));
        if (take <= 0) break;
        const w = words[i];
        parts.push(prefix || i > 0 ? w.charAt(0).toUpperCase() + w.slice(1, take).toLowerCase() : w.slice(0, take));
        budget -= take;
    }
    return (prefix + parts.join('')).slice(0, 10);
}

function allocateShapefileNames(fields, existing) {
    const taken = new Set();
    // Names already published keep their assignment, unconditionally.
    for (const f of fields) {
        const prior = existing[f.name];
        if (prior) { f.shapefileName = prior; taken.add(prior.toLowerCase()); }
    }
    for (const f of fields) {
        if (f.shapefileName) continue;
        let base = proposeShapefileName(f.name);
        let candidate = base;
        let n = 2;
        while (taken.has(candidate.toLowerCase())) {
            const suffix = String(n++);
            candidate = base.slice(0, 10 - suffix.length) + suffix;
        }
        // DBF field names are uppercase by convention and pgsql2shp writes them
        // that way regardless. The dictionary records what is actually published.
        f.shapefileName = candidate.toUpperCase();
        taken.add(candidate.toLowerCase());
    }
}

// ── Introspection ───────────────────────────────────────────────────────────

async function columnMetadata(tables) {
    const res = await query(`
        SELECT table_name, column_name, ordinal_position, data_type, udt_name,
               character_maximum_length, numeric_precision, numeric_scale, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
        ORDER BY array_position($1::text[], table_name), ordinal_position`, [tables]);
    return res.rows;
}

async function enumDomains() {
    const res = await query(`
        SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        GROUP BY t.typname`);
    const out = {};
    for (const r of res.rows) out[r.typname] = r.labels;
    return out;
}

/*
  Longest value actually stored in each string-ish column. One query per table
  rather than one per column; casting to text covers enums and arrays too.
*/
async function measureLengths(table, columns) {
    if (!columns.length) return {};
    const exprs = columns.map((c, i) => `max(length("${c}"::text)) AS c${i}`).join(', ');
    const res = await query(`SELECT ${exprs} FROM ${table}`);
    const row = res.rows[0] || {};
    const out = {};
    columns.forEach((c, i) => { out[c] = row['c' + i] === null ? 0 : Number(row['c' + i]); });
    return out;
}

function describeType(col, domains, measured) {
    const pgType = col.data_type;
    const map = rules.TYPE_MAP[pgType];
    if (!map) return null;

    const entry = {
        jsonType: map.json,
        dbfType: map.dbf,
        esriType: map.esri,
        pgType: pgType === 'USER-DEFINED' ? `enum:${col.udt_name}` : pgType,
    };

    const DATE_TYPES = ['date', 'timestamp without time zone', 'timestamp with time zone'];
    if (DATE_TYPES.includes(pgType)) {
        // Published as ISO-8601 UTC text: exactly 'YYYY-MM-DDTHH:MM:SS.mmmZ'.
        entry.maxLength = 24;
        entry.measuredMaxLength = 24;
        entry.format = 'date-time';
        entry.conversion = 'formatted as ISO-8601 UTC text in every published format, identically';
        return entry;
    }

    if (map.dbf === 'C') {
        const declared = col.character_maximum_length || 0;
        const seen = measured || 0;
        entry.measuredMaxLength = seen;
        entry.maxLength = declared
            ? Math.min(declared, rules.DBF_MAX_CHAR)
            : rules.publishedLength(seen);
        if (seen > rules.DBF_MAX_CHAR) entry.shapefileTruncation = true;
        const labels = domains[col.udt_name];
        if (labels) entry.domain = labels;
        // Controlled vocabularies enforced in application code rather than by a
        // Postgres enum still have allowed values worth publishing -- they become
        // codedValues in the ArcGIS field list and an enum in the JSON Schema.
        if (VOCABULARIES[col.column_name]) entry.domain = VOCABULARIES[col.column_name];
    } else if (map.dbf === 'N') {
        if (pgType === 'boolean') {
            entry.dbfWidth = 1; entry.dbfDecimals = 0;
            entry.conversion = 'boolean emitted as smallint 0/1 (ArcGIS has no boolean field type)';
        } else {
            entry.dbfWidth = col.numeric_precision || 10;
            entry.dbfDecimals = col.numeric_scale || 0;
        }
    }
    if (pgType === 'ARRAY') entry.conversion = 'array flattened to a comma-delimited string';
    return entry;
}

// ── Build ───────────────────────────────────────────────────────────────────

async function buildGroup(groupName, spec, domains) {
    const meta = await columnMetadata(spec.tables);
    const outPath = path.join(__dirname, `${groupName}.json`);
    const existing = {};
    if (fs.existsSync(outPath)) {
        for (const f of JSON.parse(fs.readFileSync(outPath, 'utf8')).fields || []) {
            existing[f.name] = f.shapefileName;
        }
    }

    // Which string-ish columns need measuring, per table.
    const toMeasure = {};
    for (const c of meta) {
        const map = rules.TYPE_MAP[c.data_type];
        if (map && map.dbf === 'C') (toMeasure[c.table_name] = toMeasure[c.table_name] || []).push(c.column_name);
    }
    const measured = {};
    for (const [table, cols] of Object.entries(toMeasure)) {
        measured[table] = await measureLengths(table, cols);
    }

    const fields = [];
    const excluded = [];
    const seen = new Set();

    for (const c of spec.computed) {
        // Measured like every other field: an alias is exactly as wide as the
        // column behind it, and a deep link is its fixed prefix plus the widest
        // id it can carry.
        let seenMax = 0;
        if (c.measureFrom) {
            const [tbl, col] = c.measureFrom;
            const r = await query(`SELECT max(length("${col}"::text)) AS m FROM ${tbl}`);
            seenMax = Number((r.rows[0] || {}).m || 0);
        }
        if (c.urlPrefix) seenMax += c.urlPrefix.length;

        const entry = {
            name: c.name,
            source: c.expr || 'computed',
            pgType: c.pgType, jsonType: 'string', dbfType: 'C', esriType: 'esriFieldTypeString',
            measuredMaxLength: seenMax,
            maxLength: rules.publishedLength(seenMax),
            nullable: true, description: c.note,
        };
        // An alias over an enum column publishes the same allowed values.
        if (c.measureFrom) {
            const [tbl, col] = c.measureFrom;
            const dom = meta.find(x => x.table_name === tbl && x.column_name === col);
            if (dom && domains[dom.udt_name]) entry.domain = domains[dom.udt_name];
        }
        fields.push(entry);
        seen.add(c.name);
    }

    for (const c of meta) {
        const name = c.column_name;
        if (seen.has(name)) continue;                       // table precedence: first wins
        const why = rules.excludedBecause(name);
        if (why) { excluded.push({ name, table: c.table_name, reason: why }); seen.add(name); continue; }
        const t = describeType(c, domains, (measured[c.table_name] || {})[name]);
        if (!t) { excluded.push({ name, table: c.table_name, reason: `unmapped type ${c.data_type}` }); seen.add(name); continue; }
        seen.add(name);
        fields.push(Object.assign({
            name,
            source: `${c.table_name}."${name}"`,
            nullable: c.is_nullable === 'YES',
            description: '',
        }, t));
    }

    allocateShapefileNames(fields, existing);

    const doc = {
        group: groupName,
        generatedFrom: spec.tables,
        generatedAt: new Date().toISOString(),
        fieldCount: fields.length,
        note: 'Generated by _schema/build_dictionary.js from information_schema and measured column lengths. Do not hand-edit except for the description fields, which are preserved on regeneration.',
        fields,
        excluded,
    };

    // Descriptions are the one hand-authored part; carry them across re-runs.
    if (fs.existsSync(outPath)) {
        const prior = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        const priorDesc = {};
        for (const f of prior.fields || []) if (f.description) priorDesc[f.name] = f.description;
        for (const f of doc.fields) if (!f.description && priorDesc[f.name]) f.description = priorDesc[f.name];
    }

    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
    return doc;
}

(async () => {
    try {
        const domains = await enumDomains();
        for (const [name, spec] of Object.entries(GROUPS)) {
            const doc = await buildGroup(name, spec, domains);
            const byReason = {};
            for (const e of doc.excluded) byReason[e.reason] = (byReason[e.reason] || 0) + 1;
            console.log(`${name}: ${doc.fieldCount} published, excluded ${JSON.stringify(byReason)}`);
        }
        process.exit(0);
    } catch (e) {
        console.error('build_dictionary failed:', e.message);
        process.exit(1);
    }
})();
