# Changelog — Snapshot 2026-05-03

## v3.5.82 – v3.5.99

### Docs

- **`/docs/` page** — new in-app documentation viewer with a sidebar listing of changelog snapshots and a content pane that fetches and renders the selected `.md` file via a small custom Markdown→HTML converter (no external library, works offline). Hash-based deep-linking (`#CHANGELOG-2026-05-02.md`).
- **Hamburger menu** — added "Changelog" entry between *My Visits* and *About VPAtlas*, links to `/docs/`.
- **Profile modal CSS** — `modal.css` added to `/docs/index.html` so the profile dialog opens as a true overlay there (was inline-appending content like other pages where the stylesheet was missing).

### Offline assets

- **Photo identification aids cached** — added all 19 species ID images and 8 vegetation reference images to `urlsToCache.js`, plus the two VCE logos. Pre-cached on SW install so they're available in the field without a connection.

### Visit form — touch targets and labels

- **? help icons enlarged across the board** — `.help-label` ? icon: 12px → 22px; species-card title icon: 13px → 24px; section-title ? icon: 12px → 22px; inline labels (Egg Masses, Notes, "Tap a species name…"): 18px → 22px. Inline label text also bumped from 14px → readable size.
- **Voice mic button 2× larger** — `.voice-btn` font-size 14px → 28px, padding 2×6 → 6×10, with min 44×44px tap area (Apple HIG standard).
- **"Notes" labels** — switched from `<label>` to `<span class="help-label-inline" onclick="showHelp('voice')">` so they share the same size and ? icon as other inline help titles, and the icon opens the voice/microphone help overlay.

### Species tab redesign

- **Vertical stacking** — `.species-counts` changed from a 3-column grid to a single column. Adults / Egg Masses / Tadpoles-or-Larvae each on their own row, count inputs capped at 170px so all rows align.
- **Est/Count toggle** — moved to the *right* of the Egg Masses count. Same 38px height as the count inputs.
- **Egg Masses ? help** — labels are clickable; new `eggmasses` help topic explains *Estimate* (scanned a cluster, judged ~N) vs *Count* (counted each individually) and why VPAtlas reviewers care about the distinction.
- **2-up card grid** — all 7 species cards (Wood Frog, Spotted, Jefferson, Blue-spotted, Fairy Shrimp, Fingernail Clams, Other Species) wrap in `.species-grid` with `repeat(auto-fit, minmax(360px, 1fr))`. Wide screens show two cards side by side; narrow screens collapse to one column. No JS, no media queries — auto-fit handles both.
- **"Add Photos" title** — every species card's photo button now has a `help-label-inline` title above it that opens the Photos help overlay. Fairy Shrimp and Fingernail Clams cards restructured so the photo button sits in its own row, separate from the presence toggle.
- **Photos help overlay** — new `photos` help topic covering what to shoot (Pool wide-shot, Vegetation close-ups, Species), how many ("Photos are unnecessary for VPAtlas data purposes but good to have when there are questions or unusual situations. If you do include photos, aim for 1 good photo per category"), how Stage 1/Stage 2 upload works, and tips.
- **Title sizes consistent** — Fingernail Clams and Other Species titles now match the other species card titles (18px / 24px ? icon).
- **Notes textareas, expandable** — all 7 Notes inputs converted from `<input type="text">` to `<textarea rows="2" class="notes-textarea">` with `resize: vertical`. Drag the corner; the textarea grows and the species card grows with it. `width: 100%` so it always fills the card.
- **Other Species count layout** — Species Name input on its own line full-width; Count drops to a new line at the standard 170px width matching the other cards.
- **Stepper buttons rebalanced** — minus button decrements by **1**, plus button still increments by **5**. Tap +5 to get into range, then dial in with -1. Applied to all 11 minus buttons (Adults / Egg Masses / Tadpoles-Larvae / Width / Length / Other Species count).

### Visit form — submission flow

- **Save → Upload** — bottom-right button label changed; click opens a confirmation overlay: *"Are you sure the information is complete? Uploaded Atlas Visits are queued for VPAtlas review."* with Cancel / Upload buttons. Cancel, Esc, and backdrop-click all dismiss without uploading.
- **Page title** — "Pool Visit" → "Atlas Visit". Dynamic title format: `New Atlas Visit to Pool ${poolId}` (was `New Pool Visit to ${poolId}`).
- **Mobile `⋮` overflow** — Draft/Upload buttons wrapped in `.detail-actions`; below 900px viewport the inline buttons hide and a `⋮` ellipsis opens a panel with "Save Draft" and "Upload" items. The menu items call `.click()` on the underlying buttons so all auto-save, validation, and confirmation logic stays unchanged.

### Layout

- **Edge-to-edge below 420px** — `.visit-tab` padding `10px` → `4px 0`; `.form-section` and `.species-card` lose left/right borders & border-radius, get `margin: 0 -4px` to extend to the viewport edges, padding `10px` → `8px`. Species grid forced to a single column with `gap: 0` and thin separator borders. Mirrors the LoonWeb small-screen treatment so a 360px viewport doesn't horizontally overflow.

### Photo upload — production fix

- **413 Request Entity Too Large** — nginx on `api.dev.vpatlas.org` had no `client_max_body_size` and was rejecting all photo POSTs (default 1MB; photos commonly exceed that). The client's `catch` block silently logged to `console.warn`, so users never saw the failure. **Fix:**
  - **Live nginx patched** to `client_max_body_size 25M;` and reloaded.
  - **Source config updated** at `deploy/nginx-api.dev.vpatlas.org.conf` so future `setup` runs preserve the limit.
- **Photo upload errors now surfaced** — `visit_create.html` upload loop tracks ok/fail counts. If any photo fails, the user sees a red status banner: *"Visit saved. 2 of 5 photos uploaded — 3 failed: WoodFrog (413: Request Entity Too Large); …"* (first 3 reasons), and `currentVisitState.photos_uploaded` is set to `false` so the visit can be retried.

### Build & deploy

- **`.claude/settings.json` allowlist** — added rebuild/restart commands (`node sw-build.js patch`, `docker compose ... build/up/restart/ps/logs`), prod debug commands (`ssh ... ubuntu@vpatlas.org *`, `docker exec db_vp psql ...`, `docker exec api_vp/ui_vp *`, `docker logs *`), and curl patterns for `https://api.dev.vpatlas.org/*` and `https://dev.vpatlas.org/*`. Saves dozens of permission prompts per session.
