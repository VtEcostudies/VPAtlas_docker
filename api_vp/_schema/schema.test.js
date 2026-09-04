/*
  schema.test.js — assert the published contract still holds.

  Run it from the api container; it exits non-zero on any failure so test_stack.sh
  can gate a deploy on it:

      docker exec api_vp node /opt/api/_schema/schema.test.js

  WHAT IT GUARDS

  The six public outputs agree only because they are all generated from one
  dictionary per group. Three things can quietly break that:

    - Someone edits a canonical ogc.* view by hand instead of regenerating it.
    - A column is added to or dropped from a base table and the dictionary is
      not rebuilt, so the view and the API's SELECT list disagree.
    - A shapefile name is edited into a collision or past DBF's 10-character
      limit, which pgsql2shp would then silently resolve on its own.

  None of those fail loudly at runtime. They surface months later as a schema
  review telling you the layers no longer match -- which is exactly how this
  work started.
*/

require('rootpath')();
const { query } = require('_helpers/db_postgres');
const { dictionary } = require('_schema/select_list');
const { VOCABULARIES, normalizeField, isCanonical } = require('_helpers/normalize_values');

const VIEWS = { mapped: 'mapped_pools', visit: 'pool_visits' };

// What each dictionary pgType must become in the canonical view, after the
// conversions in _schema/column_expr.js.
const EXPECTED_VIEW_TYPE = {
    'boolean': 'smallint',
    'ARRAY': 'text',
    // Formatted to ISO-8601 UTC text in the view, because that is the only
    // representation pg_featureserv publishes in a machine-readable form.
    'date': 'text',
    'timestamp without time zone': 'text',
    'timestamp with time zone': 'text',
};
function expectedViewType(field) {
    if (EXPECTED_VIEW_TYPE[field.pgType]) return EXPECTED_VIEW_TYPE[field.pgType];
    if (String(field.pgType).startsWith('enum:')) return 'text';
    if (field.source === 'computed' || /^\(?[mtvcr]\./.test(field.source)) return null; // computed: not asserted
    return field.pgType;
}

let failures = 0;
let warnings = 0;
function warn(name, detail) {
    console.log(`  WARN  ${name}${detail ? ' — ' + detail : ''}`);
    warnings++;
}
function check(name, ok, detail) {
    if (ok) { console.log(`  PASS  ${name}`); }
    else { console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); failures++; }
}

(async () => {
    console.log('--- Published schema contract ---');

    for (const [group, view] of Object.entries(VIEWS)) {
        const dict = dictionary(group);
        const res = await query(`
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'ogc' AND table_name = $1 AND column_name <> 'geom'`, [view]);

        const live = new Map(res.rows.map(r => [r.column_name, r.data_type]));
        const want = dict.fields.map(f => f.name);

        const missing = want.filter(n => !live.has(n));
        const extra = [...live.keys()].filter(n => !want.includes(n));
        check(`ogc.${view} has exactly the ${want.length} dictionary fields`,
              missing.length === 0 && extra.length === 0,
              `missing=[${missing.slice(0, 5)}] extra=[${extra.slice(0, 5)}]`);

        const wrong = [];
        for (const f of dict.fields) {
            const want_t = expectedViewType(f);
            if (!want_t) continue;
            const got = live.get(f.name);
            if (got && got !== want_t) wrong.push(`${f.name}: view ${got} != dictionary ${want_t}`);
        }
        check(`ogc.${view} column types match the dictionary`, wrong.length === 0, wrong.slice(0, 4).join('; '));

        const names = dict.fields.map(f => f.shapefileName);
        const over = names.filter(n => n.length > 10);
        check(`${group} shapefile names within DBF's 10-character limit`, over.length === 0, over.slice(0, 5).join(', '));

        const seen = new Set(); const dupes = [];
        for (const n of names) { const k = n.toLowerCase(); if (seen.has(k)) dupes.push(n); seen.add(k); }
        check(`${group} shapefile names unique`, dupes.length === 0, dupes.slice(0, 5).join(', '));

        const noPii = dict.fields.filter(f => /Landowner(Name|Address|Phone|Email|Zip5|Town|Info)/.test(f.name));
        check(`${group} publishes no landowner contact fields`, noPii.length === 0, noPii.map(f => f.name).join(', '));
    }

    /*
      Controlled vocabularies. Migration 023 reconciled the stored values and the
      Survey123 ingest normalises before writing, but the sync is an external
      system -- this is what notices if a variant starts arriving again, instead
      of it being found months later in a schema review.
    */
    for (const [field, vocab] of Object.entries(VOCABULARIES)) {
        const res = await query(
            `SELECT "${field}" AS v, count(*) AS n FROM vpvisit WHERE "${field}" IS NOT NULL GROUP BY 1`);
        /*
          Two very different kinds of non-canonical value, and conflating them
          made this test useless on production data.

          A value the normaliser CAN resolve is a regression: the ingest guard
          let a known variant through, or a migration was skipped. That fails.

          A value the normaliser cannot resolve is a question nobody has answered
          yet -- prod holds "Forest", "Uncut", "Dries some years" and an
          "Artificial" pool type, none of which map to anything by design, since
          guessing at an unanticipated answer is worse than storing an odd one.
          Those warn, so they stay visible without blocking a deploy.
        */
        const nonCanonical = res.rows.filter(r => !isCanonical(field, r.v));
        const fixable = nonCanonical.filter(r => {
            const after = normalizeField(field, r.v);
            return after !== r.v && isCanonical(field, after);
        });
        const unmappable = nonCanonical.filter(r => !fixable.includes(r));

        check(`vpvisit.${field} free of known variants`, fixable.length === 0,
              fixable.slice(0, 3).map(b => `${JSON.stringify(b.v)} (${b.n} rows) should be ${JSON.stringify(normalizeField(field, b.v))}`).join(', '));
        if (unmappable.length) {
            warn(`vpvisit.${field} holds values no vocabulary covers`,
                 unmappable.slice(0, 4).map(b => `${JSON.stringify(b.v)} (${b.n} rows)`).join(', ') + ' — needs a decision');
        }
    }

    // Nothing array-shaped should survive to the published output.
    for (const field of Object.keys(VOCABULARIES)) {
        const res = await query(`SELECT count(*) AS n FROM vpvisit WHERE "${field}" ~ '^\\s*\\['`);
        const n = Number(res.rows[0].n);
        check(`vpvisit.${field} free of JSON-array-shaped strings`, n === 0, `${n} rows`);
    }

    const suffix = warnings ? ` (${warnings} known exception${warnings === 1 ? '' : 's'})` : '';
    console.log(failures ? `\n  ${failures} schema contract failure(s)${suffix}`
                         : `\n  Schema contract intact${suffix}`);
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error('schema.test.js error:', e.message); process.exit(1); });
