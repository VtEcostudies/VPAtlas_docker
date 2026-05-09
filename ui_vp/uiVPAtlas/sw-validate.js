/*
  sw-validate.js — verify every dep of every precached HTML page is itself
  precached. Run standalone:

      node ui_vp/uiVPAtlas/sw-validate.js

  Exits 0 if the cache list is complete, 1 with a clear list otherwise.

  Used in three places:
    - sw-build.js calls validatePrecache() before bumping the version,
      so a bad cache list never produces a sw.js.
    - The ui_vp Dockerfile runs this in the image build, so a bad cache
      list never ships even if someone forgot sw-build.js.
    - .githooks/pre-commit runs this when ui_vp/uiVPAtlas/** is staged,
      so a bad cache list never gets committed.

  Why this matters: when a precached HTML page imports a file that ISN'T
  precached, the page works online but blanks offline — the SW returns 503
  for the missing module, the browser tries to parse the JSON error as JS,
  the script crashes, the page never renders. We learned this the hard way.
*/

const fs = require('fs');
const path = require('path');

function validatePrecache(rootDir) {
    const ROOT = rootDir || __dirname;
    let cacheTxt = fs.readFileSync(path.join(ROOT, 'urlsToCache.js'), 'utf8');
    // Strip JS comments before parsing — an apostrophe inside a comment
    // ("doesn't") otherwise opens a fake string literal and the regex
    // happily eats everything up to the next quote in actual code,
    // silently truncating the parsed URL list.
    cacheTxt = cacheTxt
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    const cacheUrls = new Set();
    for (const m of cacheTxt.matchAll(/['"]([^'"]+)['"]/g)) {
        if (m[1].startsWith('/')) cacheUrls.add(m[1]);
    }

    function urlOnDisk(url) {
        let p = url.replace(/^\//, '');
        if (p.endsWith('/')) p += 'index.html';
        return path.join(ROOT, p);
    }
    function isCached(url) {
        if (cacheUrls.has(url)) return true;
        if (url.endsWith('/index.html')) {
            return cacheUrls.has(url.replace(/index\.html$/, ''));
        }
        return false;
    }
    function resolveRef(basePath, ref) {
        if (/^(https?:|\/\/|mailto:|javascript:|#|data:)/.test(ref)) return null;
        if (ref.includes('${')) return null;
        let abs;
        if (ref.startsWith('/')) abs = path.join(ROOT, ref);
        else abs = path.resolve(path.dirname(basePath), ref);
        if (!abs.startsWith(ROOT)) return null;
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
        return '/' + path.relative(ROOT, abs).split(path.sep).join('/');
    }
    function walk(filePath, seen) {
        if (seen.has(filePath)) return;
        seen.add(filePath);
        let txt;
        try { txt = fs.readFileSync(filePath, 'utf8'); } catch (_) { return; }
        const refs = [];
        for (const m of txt.matchAll(/(?:^|\s)from\s+['"]([^'"]+)['"]/g)) refs.push(m[1]);
        for (const m of txt.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi)) refs.push(m[1]);
        for (const m of txt.matchAll(/<link\b[^>]*\bhref\s*=\s*['"]([^'"]+)['"]/gi)) refs.push(m[1]);
        for (const m of txt.matchAll(/<img\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi)) refs.push(m[1]);
        for (const m of txt.matchAll(/<source\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi)) refs.push(m[1]);
        for (const ref of refs) {
            const url = resolveRef(filePath, ref);
            if (!url) continue;
            walk(path.join(ROOT, url), seen);
        }
    }

    const htmlPages = [];
    for (const url of cacheUrls) {
        if (url.endsWith('.html') || url.endsWith('/')) {
            const abs = urlOnDisk(url);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) htmlPages.push(abs);
        }
    }

    let totalMissing = 0;
    const report = {};
    for (const page of htmlPages) {
        const pageUrl = '/' + path.relative(ROOT, page).split(path.sep).join('/');
        const seen = new Set();
        walk(page, seen);
        const missing = [];
        for (const f of seen) {
            const rel = '/' + path.relative(ROOT, f).split(path.sep).join('/');
            if (!isCached(rel)) missing.push(rel);
        }
        if (missing.length) {
            report[pageUrl] = missing;
            totalMissing += missing.length;
        }
    }

    return { totalMissing, report };
}

function reportAndExit({ totalMissing, report }) {
    if (totalMissing === 0) {
        console.log('Precache validator: OK (every dep of every cached HTML page is also in the cache)');
        return 0;
    }
    console.error('\n❌ Precache validator FAILED — these pages import files that are NOT in urlsToCache.js.');
    console.error('   Offline = blank screen. Add the missing entries to urlsToCache.js.\n');
    for (const [page, miss] of Object.entries(report)) {
        console.error(`  ${page}:`);
        for (const m of miss) console.error(`    - ${m}`);
    }
    console.error('');
    return 1;
}

if (require.main === module) {
    const result = validatePrecache();
    process.exit(reportAndExit(result));
}

module.exports = { validatePrecache, reportAndExit };
