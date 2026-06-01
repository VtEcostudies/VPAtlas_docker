# Changelog — Snapshot 2026-06-01 (partial)

Partial day's work; additional changes may land later under a follow-up
2026-06-01 changelog.

## v3.5.343 – v3.5.344

### Documentation — finalized stale 2026-05-29 changelog

- Closed out `CHANGELOG-2026-05-29-partial.md` → [CHANGELOG-2026-05-29.md](ui_vp/uiVPAtlas/docs/CHANGELOG-2026-05-29.md) per the daily roll-over rule — dropped `(partial)` from the H1 and removed the boilerplate paragraph. The file had been partial since 2026-05-29 (3 days stale), which the locked rule flags as a missed roll-over. Updated [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) precache block and the [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) DOCS array to drop the old partial path, add the finalized 2026-05-29 path, and add today's 2026-06-01 partial.

### Service worker / build

- `manifest.json` 3.5.342 → 3.5.344 via `node sw-build.js patch` (two bumps: 3.5.343 carried the initial sw-build before the urlsToCache changelog-list edit, 3.5.344 re-built after editing the precache list so the new file paths actually land in the regenerated sw.js). UI rebuild only; no API or DB change.
