# Changelog — Snapshot 2026-05-11 (partial)

## v3.5.240 – v3.5.247

Partial day's work; additional changes may land later under a follow-up
2026-05-11 changelog.

### App-wide — single source of truth for fonts and colors

- **The drift.** Globals (color palette + body font) lived in [explore/css/common.css](ui_vp/uiVPAtlas/explore/css/common.css), with every survey/admin/docs page pulling it via an awkward `/explore/css/common.css` absolute path. On top of that [survey/css/survey.css](ui_vp/uiVPAtlas/survey/css/survey.css) redeclared the entire palette as a 1:1 duplicate (drift risk) and [survey/css/visit_queue.css](ui_vp/uiVPAtlas/survey/css/visit_queue.css) embedded the hex codes as `var(--c, #hex)` defensive fallbacks (more drift risk).
- **The fix.** New top-level [css/common.css](ui_vp/uiVPAtlas/css/common.css) is now the single source of truth. It declares `@font-face` for two self-hosted variable fonts, the full `:root` palette, named typography variables (`--font-title`, `--font-body`), and base font-family rules on `html, body` and `h1–h6`. The `:root` block + body font-family rules were removed from `explore/css/common.css` and `survey/css/survey.css`; both files retain their non-global rules (Leaflet divIcon hack, layout fixes, survey-specific header styles). The `var(--c, #hex)` fallbacks in `visit_queue.css` are left alone — harmless now that `:root` is guaranteed to be defined for every page.

### App-wide — typography refresh

- **New typography roles.** [css/common.css](ui_vp/uiVPAtlas/css/common.css) defines `--font-title: 'Lora', serif` and `--font-body: 'Noto Sans', sans-serif`. Headings (h1–h6) render in Lora; body text in Noto Sans. The previous app-wide Georgia is gone.
- **Self-hosted variable fonts.** Both fonts are SIL Open Font License, downloaded from Google Fonts' static CDN once and committed: [webfonts/lora-latin.woff2](ui_vp/uiVPAtlas/webfonts/lora-latin.woff2) (~37 KB) and [webfonts/noto-sans-latin.woff2](ui_vp/uiVPAtlas/webfonts/noto-sans-latin.woff2) (~36 KB). Each is a variable-font woff2 with the wght axis, so one file covers both regular (400) and bold (700) via a single `font-weight: 400 700` `@font-face` declaration. Latin subset only — Vermont volunteers don't need Cyrillic/Devanagari. Both precached in [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) so the field-offline experience renders correctly.
- **Calluna was the original ask.** It isn't on Google Fonts and Font Squirrel's CDN blocks automated downloads (Cloudflare 403). User chose Lora as the substitute — closest free-licensed stylistic match (same humanist warmth, similar transitional contrast). Easy to swap to a different serif later by replacing the woff2 file and updating one `@font-face` block.

### App-wide — every page loads `/css/common.css` first

- **25 HTML pages updated.** Each public-facing page across [explore/](ui_vp/uiVPAtlas/explore/) (13), [survey/](ui_vp/uiVPAtlas/survey/) (4), [admin/](ui_vp/uiVPAtlas/admin/) (7), and [docs/](ui_vp/uiVPAtlas/docs/) (1) now loads `<link rel="stylesheet" href="/css/common.css">` after the library sheets (bootstrap / font-awesome / leaflet) and before any route-local sheet. Variables are defined before any downstream rule consumes them.
- **`survey/survey_main.html`** is the special case that had been pulling `css/survey.css` only — relying on the now-removed duplicate palette. Adding `/css/common.css` covers it.
- **Path inconsistency unchanged.** Explore pages still keep their pre-existing `./css/common.css` (resolves to `/explore/css/common.css`); survey/admin keep `/explore/css/common.css`. Both pull the same residual file. The new `/css/common.css` runs first either way.

### Home page — VPAtlas title is now an actual heading

- **Was a span.** [explore/index.html](ui_vp/uiVPAtlas/explore/index.html) had the "VPAtlas" header logo text as `<span class="header-app-name">`, leaving it on the body font (now Noto Sans) instead of picking up the new title serif. Every other page in the app already uses `<h3 class="header-name">` for its title.
- **Promoted to `<h3>`** for consistency with the rest of the header pattern. The existing `.header-app-name` class already declares `margin: 0` and `line-height: 1`, so browser default heading margins don't break the flex header layout. The global `h1–h6 { font-family: var(--font-title) }` rule in [css/common.css](ui_vp/uiVPAtlas/css/common.css) now gives the title Lora serif automatically.

### Pool Finder — drop dead `.pf-header h3` rule

- **The rule.** [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html) had `.pf-header h3 { font-size: 15px; margin: 0; white-space: nowrap; }`. After the typography refactor brought Lora in with its own heading margins, the `margin: 0` half of that rule started visibly squeezing the "Pool / Finder" two-line title in the header.
- **The fix.** Deleted the rule entirely. The `<h3>` already carries an inline `style="margin-right:6px; white-space:normal; line-height:1.1; font-size:16px; max-width:6em;"` that overrode every property the rule set except for the top/left/bottom edges of `margin: 0`. So the only thing the rule was actually contributing was a vertical squeeze — and now that's gone, the title sits where its natural metrics put it.

### Auth — login no longer poisons back-button history

- **The bug.** Tap a link to a data-entry form (e.g. *+ New Pool*, *Edit Visit*) while signed out → `requireAuth()` redirected to `/explore/login.html?returnUrl=…` via `location.href`, which pushed login onto history. After signing in, `login.html` then navigated to the form via `location.href` too, pushing the form on top. So the back stack looked like: *home → login → form*. Tapping back from the form landed on login, then back again to home — two taps to escape, and worse, briefly re-rendering a signed-in login page.
- **The fix.** Two `location.href` → `location.replace()` swaps. [js/auth.js](ui_vp/uiVPAtlas/js/auth.js) `requireAuth()` now replaces the would-be-form entry with the login URL (so the form attempt isn't stuck in history under a redirect). [explore/login.html](ui_vp/uiVPAtlas/explore/login.html) post-submit replaces login with the destination, not pushes on top. Net history after the round-trip: *home → form*. Back from the form goes straight home, login is invisible in the back stack.

### Atlas Visit — drop forced bold on header title

- **`.visit-header h3`** in [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) had `font-weight: 700` baked in, forcing the "Atlas Visit" header title to a heavier weight than the rest of the app's headings. After the Lora switch, the disparity stood out.
- **Removed only the `font-weight` line.** The rest of the rule (flex sizing, truncation, font-size, `margin: 0`) is still doing real work — without `margin: 0` Lora's natural h3 margins would push the header bar's height out. Title now renders in Lora regular like every other heading. Quick scan confirmed `.survey-header h3` and the other header titles don't have the same forced weight, so this is a one-off cleanup, not a class of issue.

### Pool Finder — `+ Atlas Visit` button bumped to thumb-sized

- **The ask.** The `+ Atlas Visit` per-pool action in the Pool Finder nav list was the same 14-px / weight-600 size as `+ Monitor Survey` and the other secondary actions, but it's the single most-tapped control on the page when a volunteer is at a pool. Easy to miss under wet-glove conditions.
- **The change.** New `.pf-visit-btn` class on the visit anchor only (Monitor Survey untouched) bumps it to `font-size: 21px` (~50% larger), `padding: 9px 24px`, `font-weight: 700`. CSS rule sits next to the existing `.pf-nav-actions a.near` rule in [survey/find_pool.html](ui_vp/uiVPAtlas/survey/find_pool.html); the JS template that emits the anchor now writes `class="pf-visit-btn${nearClass}"` so the `near` highlight still composes on top.

### Service worker / build

- **Eight patch versions** — `manifest.json` 3.5.239 → 3.5.247 via `node sw-build.js` (typography refactor + Pool Finder header fix + home title promoted to h3 + login back-history fix + Atlas Visit forced-bold drop + intermediate bumps + Pool Finder visit-button enlarged).
- **`urlsToCache.js` grew by 3 entries** — `/css/common.css` (Shared CSS block) and the two woff2 files (Webfonts block). Precache validator still passes.
