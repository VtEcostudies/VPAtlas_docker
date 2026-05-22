# Changelog — Snapshot 2026-05-21 (partial)

## v3.5.302

Partial day's work; additional changes may land later under a follow-up
2026-05-21 changelog.

### Visit form — new "Associated with wetland complex" pool type

- **The ask.** The Verify tab's **Pool Type** choices on the "+ Atlas Visit" form ([survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html)) were Forest Depression / Floodplain / Manmade / Other. Added a fifth option, **"Associated with wetland complex"**, placed before "Other".
- **Storage.** Stored in `vpvisit.visitPoolType` (a free-text column — no enum constraint), so the new value needs no API or DB change.

### Service worker / build

- `manifest.json` 3.5.301 → 3.5.302 via `node sw-build.js patch`. UI rebuild only.
