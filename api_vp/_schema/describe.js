#!/usr/bin/env node
/*
  describe.js — author and review the field descriptions that get published to
  every consumer of the VPAtlas feature endpoints.

  WHERE DESCRIPTIONS LIVE, AND WHY

  The text is authored here, in _schema/{group}.json, and everything downstream
  is generated from it:

    _schema/{group}.json  (authored text -- the source of truth)
        ├─→ COMMENT ON COLUMN on the canonical ogc.* views, emitted into the
        │   migration by build_views.js. pg_featureserv reads those comments and
        │   publishes them as the "description" on each field of the OGC
        │   collection -- it caches collection metadata at startup, so ogc_vp
        │   needs a restart before new text appears.
        ├─→ "description" in the JSON Schema at /schema/{group}
        ├─→ field descriptions in /openapi.json and the Swagger UI at /docs
        └─→ the notes column of /schema/{group}/shapefile

  So yes: the text does end up as real database column comments. It is not
  AUTHORED there, because the views are dropped and recreated whenever the
  dictionary changes and a comment written directly onto a view would be lost
  with it. Authoring in the dictionary and generating the COMMENT statements
  means the text survives every regeneration.

  This tool deliberately has no dependencies and touches no database, so it runs
  on the host with plain node -- description writing is a documentation task, not
  a deployment.

  USAGE

    node api_vp/_schema/describe.js stats
    node api_vp/_schema/describe.js list [group] [--missing|--described]
    node api_vp/_schema/describe.js export [path.csv]     # for a spreadsheet
    node api_vp/_schema/describe.js import <path.csv>
    node api_vp/_schema/describe.js set <group> <field> "text"

  The export/import round trip is the practical path for a domain expert: send
  the CSV, get it back filled in, import it, regenerate. Import only ever writes
  the description column; every other field is regenerated from the database and
  is ignored on the way back in.
*/

const fs = require('fs');
const path = require('path');

const GROUPS = ['mapped', 'visit'];
const DEFAULT_CSV = path.join(__dirname, 'descriptions.csv');

function file(group) { return path.join(__dirname, `${group}.json`); }
function load(group) { return JSON.parse(fs.readFileSync(file(group), 'utf8')); }
function save(group, doc) { fs.writeFileSync(file(group), JSON.stringify(doc, null, 2) + '\n'); }

// ── CSV, minimal and dependency-free ────────────────────────────────────────

function csvEscape(v) {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvParse(text) {
    const rows = []; let row = []; let cur = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cur += '"'; i++; }
                else quoted = false;
            } else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (ch !== '\r') cur += ch;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
}

// ── Commands ────────────────────────────────────────────────────────────────

function stats() {
    let total = 0, done = 0;
    for (const g of GROUPS) {
        const f = load(g).fields;
        const d = f.filter(x => x.description && x.description.trim()).length;
        total += f.length; done += d;
        const pct = Math.round((d / f.length) * 100);
        console.log(`  ${g.padEnd(8)} ${String(d).padStart(3)} / ${String(f.length).padEnd(4)} described  (${pct}%)`);
    }
    console.log(`  ${'TOTAL'.padEnd(8)} ${String(done).padStart(3)} / ${String(total).padEnd(4)} described  (${Math.round(done / total * 100)}%)`);
}

function list(group, filter) {
    const groups = group ? [group] : GROUPS;
    for (const g of groups) {
        if (!GROUPS.includes(g)) { console.error(`unknown group '${g}'`); process.exit(1); }
        console.log(`\n=== ${g} ===`);
        for (const f of load(g).fields) {
            const has = !!(f.description && f.description.trim());
            if (filter === 'missing' && has) continue;
            if (filter === 'described' && !has) continue;
            const type = String(f.pgType).replace('timestamp without time zone', 'timestamp');
            const dom = f.domain ? `  [${f.domain.join('|')}]` : '';
            console.log(`  ${has ? '✓' : ' '} ${f.name.padEnd(30)} ${type.padEnd(22)}${has ? f.description : '(none)'}${dom}`);
        }
    }
}

function exportCsv(target) {
    const out = [['group', 'field', 'pgType', 'jsonType', 'maxLength', 'domain', 'dbfName', 'description']
        .map(csvEscape).join(',')];
    for (const g of GROUPS) {
        for (const f of load(g).fields) {
            out.push([g, f.name, f.pgType, f.jsonType, f.maxLength || '',
                      f.domain ? f.domain.join('|') : '', f.shapefileName, f.description || '']
                .map(csvEscape).join(','));
        }
    }
    fs.writeFileSync(target, out.join('\n') + '\n');
    console.log(`Wrote ${out.length - 1} rows to ${target}`);
    console.log('Fill in the description column and run: node api_vp/_schema/describe.js import ' + target);
}

function importCsv(source) {
    const rows = csvParse(fs.readFileSync(source, 'utf8'));
    const header = rows.shift().map(h => h.trim());
    const gi = header.indexOf('group'), fi = header.indexOf('field'), di = header.indexOf('description');
    if (gi < 0 || fi < 0 || di < 0) {
        console.error('CSV must have group, field and description columns'); process.exit(1);
    }
    const byGroup = {}; let changed = 0, unknown = 0;
    for (const g of GROUPS) byGroup[g] = load(g);
    for (const r of rows) {
        const g = (r[gi] || '').trim(), name = (r[fi] || '').trim(), desc = (r[di] || '').trim();
        if (!g || !name || !byGroup[g]) { unknown++; continue; }
        const f = byGroup[g].fields.find(x => x.name === name);
        if (!f) { console.warn(`  no such field: ${g}.${name}`); unknown++; continue; }
        if ((f.description || '') !== desc) { f.description = desc; changed++; }
    }
    for (const g of GROUPS) save(g, byGroup[g]);
    console.log(`Updated ${changed} description(s)${unknown ? `, skipped ${unknown} unmatched row(s)` : ''}.`);
    console.log('Now regenerate the views so the COMMENT ON COLUMN statements pick them up.');
}

function set(group, name, text) {
    if (!GROUPS.includes(group)) { console.error(`unknown group '${group}'`); process.exit(1); }
    const doc = load(group);
    const f = doc.fields.find(x => x.name === name);
    if (!f) { console.error(`no such field: ${group}.${name}`); process.exit(1); }
    f.description = text;
    save(group, doc);
    console.log(`${group}.${name} = ${text}`);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
    case 'stats': stats(); break;
    case 'list': {
        const g = args.find(a => !a.startsWith('--'));
        const flag = args.includes('--missing') ? 'missing' : args.includes('--described') ? 'described' : null;
        list(g, flag); break;
    }
    case 'export': exportCsv(args[0] || DEFAULT_CSV); break;
    case 'import':
        if (!args[0]) { console.error('usage: describe.js import <path.csv>'); process.exit(1); }
        importCsv(args[0]); break;
    case 'set':
        if (args.length < 3) { console.error('usage: describe.js set <group> <field> "text"'); process.exit(1); }
        set(args[0], args[1], args.slice(2).join(' ')); break;
    default:
        console.log(fs.readFileSync(__filename, 'utf8').split('  USAGE')[1].split('*/')[0]);
}
