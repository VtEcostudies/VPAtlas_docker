# Changelog — Snapshot 2026-05-28

## v3.5.339 – v3.5.341

### Visit form — Pool Disturbance section restored (4g on the original datasheet)

- **The gap.** The original paper datasheet's section **4g) Pool Disturbance** never made it back into the docker rewrite of [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html). The DB columns were carried over from the legacy schema (`visitDisturbSiltation`, `visitDisturbDumping`, `visitDisturbVehicleRuts`, `visitDisturbRunoff`, `visitDisturbDitching`, `visitDisturbOther`) and the read-only visit card already rendered all six in its **Disturbances** row, but the form had no inputs — so volunteers couldn't enter the values in the first place.
- **The fix.** New **Pool Disturbance** form-section in the Verify tab, immediately after Surrounding Habitat. Five checkboxes for *Siltation*, *Dumping*, *Vehicle Ruts*, *Agriculture Runoff*, *Ditching/Draining* plus a free-text *Other* field, wired into the existing load (populate from row on edit) and save (post body) field lists. No API or DB change — the columns were already there waiting; visit_card.js's render lines 149-186 already cover the display side.

### Documentation

- Finalized [CHANGELOG-2026-05-27.md](CHANGELOG-2026-05-27.md) (was `-partial`) per the daily roll-over rule — dropped the `(partial)` qualifier from the H1 and removed the boilerplate paragraph. Moved the Pool Disturbance entry above (and its SW/build bullet) here, where it belongs, since both the local sw-build patch (3.5.339) and the prod deploy bump (3.5.340) actually happened on 2026-05-28. Updated [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) precache block and the [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) DOCS array to drop the old partial path, add the finalized 2026-05-27 path, and add today's 2026-05-28 partial.

### Service worker / build

- `manifest.json` 3.5.338 → 3.5.340 — Pool Disturbance entry was first written at 3.5.339 (local sw-build patch) but the actual deploy ran sw-build a second time as part of `deploy-prod.sh ui`, shipping at 3.5.340. UI rebuild only; no API or DB change.
- `manifest.json` 3.5.340 → 3.5.341 — changelog roll-over (split 2026-05-27 partial into finalized 27 + new 28 partial). UI rebuild only; precache list updated to match the new file paths.
