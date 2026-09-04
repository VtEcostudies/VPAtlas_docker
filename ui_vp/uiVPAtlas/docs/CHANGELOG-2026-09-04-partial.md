# Changelog — Snapshot 2026-09-04 (partial)

Partial day's work; additional changes may land later under a follow-up 2026-09-04 changelog.

## v3.5.379 – v3.5.380

### Shipped to production

Migrations 022–025 applied cleanly to prod (298 ms, 1115 ms, 49 ms, 220 ms), after a full 220 MB database backup to local disk and S3. Verified live: `/mapped/geojson` 13,485 features / 20 fields, `/visit/geojson` 2,215 / 108, both OGC collections returning everything with no `?limit=`, dates as ISO-8601 UTC, and the substrate variants — `Leaflitter` and every JSON-array form — reconciled.

### One row the cleanup should have caught

- **`visitPoolType` was still stored as `["Artificial"]` on prod.** Migration 023's generator only emits an UPDATE when the normalised result lands on a canonical value — deliberate, so an unanticipated answer is preserved for a human rather than guessed at. But it conflated resolving a value to a vocabulary (a judgement) with unwrapping a JSON array (a format fix). "Artificial" is not a pool type anyone has decided on, so the whole value was left alone, wrapper included.
- **[Migration 026](db_migrate/migrations/026_unwrap_remaining_json_arrays.sql)** unwraps any remaining array-shaped value regardless of what is inside it, and [build_normalize_sql.js](api_vp/_schema/build_normalize_sql.js) now emits that pass unconditionally so the class cannot recur.
- **The published output was never wrong** — the canonical views unwrap array-shaped strings on the way out, so all three formats already showed `Artificial`. This corrects the value at rest.

### Four values on production still need a decision

Reported as warnings by the schema contract test, deliberately not guessed at:

| Field | Value | Rows |
|---|---|---|
| `visitPoolType` | `Artificial` | 1 |
| `visitForestUpland` | `Forest` | 1 |
| `visitForestCondition` | `Uncut` | 1 |
| `visitHydroPeriod` | `Dries some years` | 3 |

`Artificial` is plausibly `Manmade` and `Uncut` plausibly `Undisturbed`, but both are guesses about what an observer meant, and `Dries some years` sits between `Dries annually` and `Dries every 5 years` with no obvious home.

### Service worker / build

- `manifest.json` → 3.5.380 via `node sw-build.js patch`. Migration 026 runs automatically; `ogc_vp` restarted after deploy so pg_featureserv picks up the rebuilt collection metadata.

## v3.5.378

### Migration 023 would not have cleaned production

Checking production's actual values before deploying found that **dev and prod diverge**, and the cleanup migration — whose UPDATE statements were generated from dev alone — would have run clean on prod and silently left every prod-only variant behind.

| Field | In prod, not in dev |
|---|---|
| `visitSubstrate` | multi-member arrays: `["Leaf litter","Bedrock"]`, `["Leaf litter","Mud"]`, `["Leaf litter","Sand/Gravel"]`, and 63 rows of `["Leaf litter"]` against dev's 1 |
| `visitPoolType` | `Associated with wetland complex` (2), `["Artificial"]` (1) |
| `visitForestUpland` | `Forest` (1); `Hardwood` is 40 rows, not 2 |
| `visitForestCondition` | `Uncut` (1) |
| `visitHydroPeriod` | `Dries some years` (3) |
| `visitInletType` / `visitOutletType` | bare `Ephemeral` — **55 and 31 rows**, against dev's 1 |
| `visit*EggHow` | `Count` (6 and 25) |

- **The generator now merges values from both environments.** [build_normalize_sql.js](api_vp/_schema/build_normalize_sql.js) takes an optional JSON of values gathered elsewhere and merges them with what it reads locally, so [migration 023](db_migrate/migrations/023_normalize_visit_values.sql) covers dev and prod together.
- **`visitSubstrate` is a multi-select, not a single value.** `Leaf litter, Bedrock` is a legitimate answer, not a variant. The normaliser now resolves each member independently and rejoins them, and `isCanonical` validates per member.
- **New alias:** `Associated with wetland complex` → `Pool associated with larger wetland complex`.

### Migration replay bug

- **Migration 023 embedded its own copy of the canonical views.** Migration 025 later changed how dates are published, so any re-run of 023 silently reverted the views to the older definition — while 025, already recorded as applied, never ran again to put them back. Caught by replaying the sequence locally: the contract test reported the views had gone back to native date types.
- **The fix.** 023 now only *drops* the views, which is all the `ALTER COLUMN TYPE` statements require, and **025 is their sole definition**. Grants moved there too, since the views do not exist at 023's point in the sequence. A migration that carries its own copy of a generated artefact cannot be replayed safely.

### Schema contract test — regression versus open question

The test conflated two different things, which made it useless against production data. It now distinguishes them:

- A value the normaliser **can** resolve is a regression — the ingest guard let a known variant through, or a migration was skipped. **Fails.**
- A value the normaliser **cannot** resolve is a question nobody has answered. **Warns**, so it stays visible without blocking a deploy.

**Four values on prod need a decision** and are deliberately left alone: `visitPoolType` `["Artificial"]`, `visitForestUpland` `Forest`, `visitForestCondition` `Uncut`, `visitHydroPeriod` `Dries some years`.

### Service worker / build

- `manifest.json` 3.5.377 → 3.5.378 via `node sw-build.js patch`. **API rebuild required.** Migrations 023 and 025 replay cleanly in sequence; `ogc_vp` must be restarted afterwards.

## v3.5.377

### OGC collections return everything by default

- **`PGFS_PAGING_LIMITDEFAULT` raised from 1000 to 50000**, matching `LIMITMAX`, in [docker-compose-vpatlas.yml](docker-compose-vpatlas.yml). A request with no `?limit=` now returns the whole collection — 13,465 mapped pools, 2,069 visits — instead of the first 1,000. `docker-compose-prod.yml` is an override and inherits this, so prod picks it up on its next deploy.
- **Why the default matters more here than usual.** This build of pg_featureserv emits neither `numberMatched` nor a `next` link, so a truncated response is indistinguishable from a complete one. A client that forgot `?limit=` would quietly publish a fraction of the data and believe it had all of it — which already happened once at the earlier 10,000 ceiling. These collections exist to be consumed whole by ArcGIS Online and QGIS, so a partial default was the worst of both worlds.
- **The cost.** The human-browsable HTML view now loads everything too. Append `?limit=50` when browsing by hand. Full payloads are ~10 MB and ~6 MB, served in well under a second.

### Service worker / build

- `manifest.json` 3.5.376 → 3.5.377 via `node sw-build.js patch`. No API or migration change; `ogc_vp` restarted to pick up the new paging config.

## v3.5.376

### Dates are now machine-readable everywhere, and identical across all three formats

- **The problem.** The canonical views kept native `date` and `timestamp` types so the shapefile could carry a real DBF Date, leaving each format to serialise its own way. Measuring what pg_featureserv actually emits showed that reasoning was wrong — it publishes nothing a date parser will accept:

  | View column type | OGC output | Parseable |
  |---|---|---|
  | `timestamp` | `2019-06-22 14:03:33.953599` | no — space instead of `T`, no zone |
  | `timestamptz` | `2019-06-22 14:03:33.953599+00` | no — still a space |
  | `date` | `2014-04-27` | yes, but differs from the GeoJSON |
  | ISO-8601 text | `2019-06-22T14:03:33.953Z` | **yes** |

  Casting to `timestamptz` does not help, and pg_featureserv exposes no formatting control, so the value has to arrive already formatted.

- **The fix.** [Migration 025](db_migrate/migrations/025_iso_dates_in_publication_views.sql) rebuilds both views with every date and timestamp formatted as ISO-8601 UTC text in the view itself. All six columns — `visitDate`, `reviewQADate`, `mappedDateText`, `createdAt`, `updatedAt`, `lastEditedAt` — now come out **byte-identical** from the GeoJSON endpoint, the shapefile and the OGC collection. A bare date becomes midnight UTC, so date-only and timestamp columns are indistinguishable in shape, which is what lets the ArcGIS side type them all as **Date** rather than Date Only.
- **What it costs, and why that is acceptable.** The shapefile carries these as `Character(24)` rather than DBF Date. DBF Date stores `YYYYMMDD` with no time component at all, so every timestamp was already losing its time there — a 24-character ISO string preserves strictly more than it gives up. `esriFieldType` stays `esriFieldTypeDate`, so the AGOL side still types the field as a date.
- **OGC filtering still works.** Range filters on these columns become string comparisons, and ISO-8601 UTC sorts lexicographically in chronological order, so they behave correctly.

### Operational note

- **pg_featureserv caches collection metadata at startup.** After any migration that changes a published view, `ogc_vp` must be restarted or the OGC collection keeps reporting the previous field types. This has now bitten twice during development; it is called out in migration 025's header.
- Also worth recording for anyone testing the OGC endpoint: **bare property filters are silently ignored**. `?poolId=NEW454` returns the first row rather than erroring. Use CQL: `?filter=poolId%3D%27NEW454%27`.

### Service worker / build

- `manifest.json` 3.5.375 → 3.5.376 via `node sw-build.js patch`. **API rebuild required**; migration 025 runs automatically, and `ogc_vp` needs a restart afterwards.

## v3.5.375

### Forest condition — 596 more visits stopped opening blank

The same mismatch as Forest/Upland, resolved the same way. [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) offers `Undisturbed / Recently Logged / Old Growth` while the data holds **Minor logging (526 rows)** and **Major logging (70)**, so those 596 visits opened with no forest condition selected and re-saving one dropped the answer.

- **Both levels tick the one control.** `Minor logging` and `Major logging` are declared equivalent to `Recently Logged` in [_helpers/normalize_values.js](api_vp/_helpers/normalize_values.js). No rows are rewritten — this is a display mapping, not a migration.
- **The distinction survives editing.** `preserveEquivalent` keeps whichever level was stored when the record is saved unchanged, so a Major logging visit stays Major logging after every edit that does not actually change the answer. Only a real change to Undisturbed or Old Growth writes a new value.
- **Lossy in one direction, deliberately.** A brand-new record chosen as `Recently Logged` stores exactly that, because the form cannot express which level was meant. Historical precision is kept; future precision is not invented. `Recently Logged` therefore joins the published vocabulary alongside both logging levels.
- Together with the Forest/Upland fix in v3.5.374, **1,235 visits** across the two fields no longer open with a silently missing answer.

### Service worker / build

- `manifest.json` 3.5.374 → 3.5.375 via `node sw-build.js patch`. **API rebuild required**; migration 023 was regenerated with the updated field description. No data migration — the stored values are deliberately left alone.

## v3.5.374

### Forest type — 639 visits stopped opening blank

- **The bug, and it is the big one.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) offers Forest/Upland radios labelled **Hardwood / Softwood / Mixed**, but the database holds **Deciduous (590 rows)** and **Coniferous (49)** from the legacy vocabulary. The restore code matches on the exact value, so all **639** of those visits opened with no forest type selected — and re-saving one silently dropped the answer. Same failure as `Leaflitter`, seven times larger.
- **The fix keeps both spellings.** Rather than rewriting 639 rows to today's labels, the pairs are declared equivalent in [_helpers/normalize_values.js](api_vp/_helpers/normalize_values.js): Deciduous ≡ Hardwood, Coniferous ≡ Softwood. A stored value resolves to the control it should activate, so a Deciduous visit now opens with Hardwood selected.
- **And it does not rewrite history on save.** When a submitted control is merely the equivalent of what was already stored, the original spelling is kept. Opening a Deciduous visit and saving it unchanged leaves it Deciduous; only a genuine change to a different type writes a new value.
- **`Softwood` joins the published vocabulary**, so all four terms plus Mixed, Open/Field and Other appear as `codedValues` in `/schema/visit/arcgis` and as an `enum` in the JSON Schema.

### Inlet and outlet "Yes" resolved

- [Migration 024](db_migrate/migrations/024_resolve_inlet_outlet_yes.sql) resolves the two rows 023 deliberately left alone: an inlet or outlet recorded only as present, with no permanence noted, is the **Ephemeral** case. The matching alias is in the normaliser so the Survey123 ingest resolves it identically, and the known-exception entries are removed from [schema.test.js](api_vp/_schema/schema.test.js) — a `Yes` appearing again is now a genuine failure. The schema contract reports clean with no warnings.

### The visit form was writing JSON arrays too

- **Survey123 was not the only source.** The form's own save built `body.visitSubstrate = JSON.stringify(substrates)` — so every multi-substrate visit saved through VPAtlas stored `["Leaf litter","Mud"]`, the exact shape migration 023 had to clean up. It now writes a comma-delimited string.
- **Normalisation moved to every writer, not just the sync.** `create` and `update` in [vpVisit.service.js](api_vp/vpVisit/vpVisit.service.js) now normalise before writing, so the form, the sync and any future client are covered by one rule.

### New endpoint, and a guard against the copy diverging

- **`/schema/vocabularies`** publishes the controlled vocabularies and the equivalence map. The visit form runs in the browser and cannot require the server module, so it necessarily keeps its own copy — [test_stack.sh](test_stack.sh) now fetches both and fails if they disagree, which is the exact failure mode this whole cleanup exists to prevent.

### Still unresolved

- **`visitForestCondition` has the same mismatch and is not fixed here.** The form offers `Undisturbed / Recently Logged / Old Growth`; the data holds `Minor logging` (526) and `Major logging` (70). Mapping both to "Recently Logged" would work for restoring the control but would collapse the minor/major distinction on save. That needs a decision about whether the form should carry both levels.

### Service worker / build

- `manifest.json` 3.5.373 → 3.5.374 via `node sw-build.js patch`. **API rebuild required**; migration 024 runs automatically, and 023 was regenerated with updated field descriptions.

## v3.5.373

### Visit data — controlled vocabularies reconciled, three columns retyped

Several visit fields are controlled vocabularies in the VPAtlas form but plain text in the database, fed from three directions — the form, the Survey123 sync, and years of legacy imports — with nothing reconciling them.

- **This was silently destroying answers.** [survey/visit_create.html](ui_vp/uiVPAtlas/survey/visit_create.html) restores its checkboxes with an exact string match (`.visitSubstrate[value="${s}"]`). "Leaf litter" was stored 1,074 times and **"Leaflitter" 94 times** — so those 94 visits opened with no substrate ticked, and re-saving one dropped the answer entirely. The same mismatch breaks GIS symbology, definition queries and any group-by.
- **What was reconciled.** `visitSubstrate` (`Leaflitter`→`Leaf litter`, 94 rows), `visitVernalPool` (`DontKnow` 67 and `Dont Know` 61 → `Don't Know`), `visitNavMethod` (`Prior knowledge of site` 60, `other` 31, `Map and compass` 1, plus 300 empty strings → null), `visitPoolType`, `visitCertainty` (318 empty → null), `visitInletType`/`visitOutletType`, and `Estimate`→`Estimated` across all four `*EggHow` fields. 21 UPDATE statements, ~700 rows.
- **`visitLocatePool` is now a nullable boolean.** It held seven spellings of three states as text: `1`/`true`/`Yes` (836 rows) → true, `0`/`false`/`No` (1,432) → false, and `-1`/empty/null (251) → null. **`-1` is the Survey123 no-data sentinel and maps to null, not false** — a pool nobody tried to find is not a pool that could not be found.
- **`visitSubmergedVeg` is now a percentage** (`real`), matching its four siblings `visitPoolTrees`/`Shrubs`/`Emergents`/`FloatingVeg`. One row carries data.
- **`visitFishSize` is constrained to Small / Medium / Large or null.** All 2,519 rows were already null, so there was nothing to convert — only a constraint to add so the column can hold what it is meant to hold.
- **`visit_shapefile` dropped.** The 117-column view behind the old `/visit/shapefile`, carrying `visitLandowner` and `visitDirections`. Dead since that endpoint was rewired, and it blocked the column retype.

### One rule, enforced in three places

- **[_helpers/normalize_values.js](api_vp/_helpers/normalize_values.js)** holds one canonical vocabulary per field. Matching folds case, whitespace, punctuation and JSON-array wrapping, so `Leaflitter`, `leaf litter` and `["Leaf litter"]` all resolve without being enumerated; explicit aliases cover only genuinely different wordings. Unrecognised values are **preserved, not discarded** — guessing at an unanticipated answer is worse than storing an odd one.
- **[migration 023](db_migrate/migrations/023_normalize_visit_values.sql)** cleans the existing rows. Its UPDATE statements are *generated* by [build_normalize_sql.js](api_vp/_schema/build_normalize_sql.js), which reads every DISTINCT value present and resolves it through that same module — so the cleanup and the guard are one rule, not two that can drift. The type changes are guarded by `information_schema` checks, making the migration safe to re-run.
- **The Survey123 ingest normalises before writing** ([vpVisit.s123.service.js](api_vp/vpVisit/vpVisit.s123.service.js)), so new data cannot reintroduce a variant. Survey123 is the origin of most of the drift: it sends multi-selects JSON-array-wrapped and its option labels have diverged from the form's.
- **[schema.test.js](api_vp/_schema/schema.test.js)** fails the build if a non-canonical value reappears, and separately checks no column holds a JSON-array-shaped string.

### Allowed values now published

The vocabularies appear as `codedValues` in `/schema/{group}/arcgis` and as `enum` in the JSON Schema, so a consumer can build a domain from them without asking. That covers the vocabularies enforced in application code, alongside the Postgres enums already published.

### About the JSON-array-shaped strings

Worth being precise, since this was conflated with the earlier `reviewReasons` breakage. A **genuine JSON array** in a GeoJSON property breaks an ArcGIS feature layer outright — no field type can hold one, which is what `reviewReasons` did. A **string that merely looks like an array** breaks nothing structurally; it is still a string. It renders as literal `["Other"]` and quietly fails every filter and symbology rule expecting `Other`, which is worse in practice because nothing reports an error. Only 7 rows were affected, all now clean, with an output-side unwrap in [column_expr.js](api_vp/_schema/column_expr.js) as a net in case the sync starts sending them again.

### Left for a human decision

- `visitInletType` and `visitOutletType` each hold one row reading **"Yes"** — from an older form asking whether an inlet existed rather than what type it was. It cannot be resolved to Ephemeral or Permanent without knowing which, so both rows are preserved and reported as a warning by the schema test rather than guessed at.
- `visitForestUpland` holds `Hardwood` (2 rows) alongside `Deciduous` (590). They may well mean the same thing, but that is an ecological judgement.

### Service worker / build

- `manifest.json` 3.5.372 → 3.5.373 via `node sw-build.js patch`. **API rebuild required**; migration 023 runs automatically and rebuilds both canonical views, since the columns behind `visitLocatePool` and `visitSubmergedVeg` changed type.

## v3.5.372

### Field descriptions — every published field now documented

All **128 published fields** (20 mapped, 108 visit) carry a description, up from 11. They reach consumers through four channels at once, all generated from one authored source.

- **Where the text lives.** Authored in [_schema/mapped.json](api_vp/_schema/mapped.json) and [_schema/visit.json](api_vp/_schema/visit.json), then [build_views.js](api_vp/_schema/build_views.js) emits a `COMMENT ON COLUMN` for each into [migration 022](db_migrate/migrations/022_canonical_publication_views.sql). **The text does become real database column comments** — it just isn't authored there, because the canonical views are dropped and recreated on every regeneration and a comment written by hand onto a view would go with it.
- **Where it surfaces.** pg_featureserv publishes each comment as that field's `description` in the OGC collection — previously empty on all 76 fields. The same text fills `description` in the JSON Schema at `/schema/{group}`, the field descriptions in `/openapi.json` and the Swagger UI, and the notes column of `/schema/{group}/shapefile`. Note pg_featureserv caches collection metadata at startup, so `ogc_vp` needs a restart before new text appears.
- **New authoring tool.** [_schema/describe.js](api_vp/_schema/describe.js) — `stats`, `list [group] [--missing]`, `export`, `import` and `set`. The CSV round trip is the practical path for a domain expert: export, fill in the description column, import, regenerate. It has no dependencies and touches no database, so it runs on the host with plain `node`.
- **Semantics verified against the data, not assumed.** `visitPoolTrees` and its siblings range 0–100 and are described as percent cover; `visitFairyShrimp` reaches 100,000 and is described as a count rather than a flag; `visitMaxDepth` holds prose like "Knee-deep" alongside "12-24 Inches", which is why it stays a string.

### OGC endpoint — recovers on its own after a database restore

- **The failure.** `ogc_vp` was down locally with `SASL auth failed for user "pgfs_reader"`. Migration 021 sets that password once and is skipped forever after — but `db_restore.sh` restores `schema_migrations` along with everything else, so after any restore the role carries whatever password came out of the dump while the container still connects with `PGFS_PASSWORD` from the environment. The container then restart-loops and the OGC endpoint is simply down, with the deploy having reported success.
- **The fix.** [db_migrate/migrate_internal.sh](db_migrate/migrate_internal.sh) now syncs the `pgfs_reader` password from `PGFS_PASSWORD` on **every** run, deliberately untracked rather than as a migration, since the whole problem is that tracked migrations do not re-run. Idempotent and cheap. Verified by setting the password to a wrong value, running `up -d`, and watching the endpoint come back.

### Correction to the 2026-09-04 v3.5.371 notes

- The claim that the migration runner records failed migrations and thereby blocks a re-run was **wrong**. It records failures with `success = false`, and its skip check is `AND success = true`, so a failed migration re-runs on the next attempt. No prod trap exists.

### Service worker / build

- `manifest.json` 3.5.371 → 3.5.372 via `node sw-build.js patch`. **API rebuild required**; migration 022 was regenerated with the 128 `COMMENT ON COLUMN` statements, so its checksum changed — dev needed its ledger row cleared to re-apply. Prod has never seen 022 and gets the complete version on first run.

## v3.5.371

### Public feature endpoints — one canonical schema across all six outputs

The same data was being published six ways that shared almost nothing: `/mapped/geojson` 36 fields, `/mapped/shapefile` 37 and `ogc.mapped_pools` 13; `/visit/geojson` 163, `/visit/shapefile` 117 and `ogc.pool_visits` 63. Four of the six carried landowner PII. Within each group the three formats now publish an **identical field set with identical types** — 20 fields for mapped, 108 for visits — because all three are generated from one dictionary rather than kept in step by hand.

- **The field dictionary is derived from the database, not asserted.** [api_vp/_schema/build_dictionary.js](api_vp/_schema/build_dictionary.js) reads `information_schema` for types, nullability and numeric precision, `pg_enum` for allowed values, and measures `max(length(...))` over live data for every string column — including the computed aliases and deep links. It writes [_schema/mapped.json](api_vp/_schema/mapped.json) and [_schema/visit.json](api_vp/_schema/visit.json).
- **Everything downstream is generated from those two files.** The canonical `ogc.mapped_pools` and `ogc.pool_visits` views come from [build_views.js](api_vp/_schema/build_views.js) via [migration 022](db_migrate/migrations/022_canonical_publication_views.sql); the GeoJSON and shapefile SELECT lists come from [select_list.js](api_vp/_schema/select_list.js) at runtime; and one shared [column_expr.js](api_vp/_schema/column_expr.js) is the only place a field becomes SQL, so the view and the API cannot express the same field two different ways.
- **Scope — the wide set.** Everything except landowner PII, contributor identity and internal system identifiers. `mappedLandownerPermission`, `visitLandownerPermission` and `visitUserIsLandowner` are deliberately kept: they are yes/no flags asserting that permission exists and identify nobody. The narrow alternative (13 / 63 fields) would have forced the published ArcGIS Online layers to be rebuilt rather than re-pointed.
- **Measured string lengths replace `String(4000)`.** Published lengths are now 10 to 254, rounded up from the longest value actually stored. The VCGI schema review flagged the 4000-character default as needlessly inflating layer storage and credit consumption; this answers it with numbers from the data.
- **Shapefile field names are deterministic instead of blind truncations.** DBF caps names at 10 characters, and pgsql2shp was collapsing `visitHabitatAgriculture`, `visitHabitatLightDev`, `visitHabitatHeavyDev`, `visitHabitatPavedRd`, `visitHabitatDirtRd` and `visitHabitatPowerline` all to `visitHabit`. Each field now carries a stable, unique, published DBF name, equal to the canonical name wherever it already fits.

### Landowner PII removed from the shapefile downloads

- **The exposure.** `/mapped/shapefile` and `/visit/shapefile` are on the unauthenticated allowlist in [api_vp/_helpers/jwt.js](api_vp/_helpers/jwt.js), and both published landowner data. `/mapped/shapefile` selected `vpmapped.*`; the 117-column `visit_shapefile` view carried `visitLandowner` and `visitDirections` outright. This is the same exposure closed on the GeoJSON endpoints on 2026-09-02, which had never been applied to the other format.
- **The fix.** Both shapefile endpoints now select the canonical dictionary list. No landowner name, address, phone, email or access directions are published in any of the six outputs, and [schema.test.js](api_vp/_schema/schema.test.js) asserts it on every deploy.

### Visit createdAt / updatedAt now belong to the visit

- **The bug.** `/visit/geojson` emitted the *review's* `createdAt` and `updatedAt` — a last-wins accident of JSON key de-duplication across three joined tables — which is why both were NULL on all 31 visits with no review. They now resolve to the visit's own timestamps. **Values change** for consumers that read these fields.

### Data definitions — new published interface

The OGC endpoint was assumed to already document these datasets. It does not: pg_featureserv reports all 13 `mapped_pools` fields as `"string"` including three dates, ships an empty `components.schemas` in its OpenAPI document, has an empty description on all 76 fields, and serves no `/schema` or `/queryables` resource in this build. So the definitions are published for all three formats:

| Endpoint | Returns |
|---|---|
| `/schema` | Index of published groups and their three formats |
| `/schema/{group}` | JSON Schema 2020-12 for the feature properties — types, lengths, nullability, enum domains |
| `/schema/{group}/shapefile` | The DBF contract: canonical name to uppercase 10-character name, type, width, decimals |
| `/schema/{group}/arcgis` | `esriFieldType` per field, for the Data Pipelines "Update fields" step |
| `/openapi.json` | OpenAPI 3.1 for the public feature and schema endpoints |
| `/docs` | Swagger UI over that document |

All are public, since they describe already-public data. New modules under [api_vp/vpSchema/](api_vp/vpSchema/).

### Service worker / build

- `manifest.json` 3.5.370 → 3.5.371 via `node sw-build.js patch`. **API rebuild required** (`api_vp/**` changed) and migration 022 runs automatically on stack up.
- No `urlsToCache.js` changes — `/docs` is served by the API, not the PWA, and has no offline use.
- [test_stack.sh](test_stack.sh) gains a **Published schema contract** section: it runs `schema.test.js` in the api container, checks the GeoJSON field count against the dictionary for both groups, and confirms all six data-definition endpoints return 200.

## v3.5.370

### Public GeoJSON — schema parity for ArcGIS Online hosted layers

A schema review by VCGI compared the pipeline-built `*_API_Pipe_Output` services against the older published VPAtlas layers and returned a "do not swap as a drop-in replacement" verdict. Field *names* were ~95% stable, which masked the real problem: a large share of the field *types* underneath had changed, which silently breaks symbology, definition queries, dashboards, joins and any Arcade date or numeric expression. The type drift traced to three distinct causes, all now fixed at the source rather than per-pipeline.

- **Boolean flag fields were arriving as `String(4000)`.** Roughly 30 fields the review flagged — `visitFish`, `visitDisturbDitching` / `Dumping` / `Runoff` / `Siltation` / `VehicleRuts`, the `visitHabitat*` set, `visitLandownerPermission`, `visitPoolMapped`, `visitUserIsLandowner`, `mappedLandownerPermission`, `reviewPoolLocator` — are Postgres `boolean`, and per Esri's [ADP_102064](https://doc.arcgis.com/en/data-pipelines/latest/get-started/adp-102064.htm) "Boolean fields are converted to string since Boolean is not a supported field type for feature layers." The older layers carried them as SmallInteger 0/1. All 19 boolean columns across `vpmapped` / `vpvisit` / `vpreview` now emit smallint `0` / `1`, restoring numeric parity. NULL stays NULL.
- **Date and timestamp fields were arriving as `String(4000)`.** GeoJSON has no date type, so the value can only be a string — but the emitted form was a naive `2019-07-25T17:28:21.024616` with microseconds and no zone. `createdAt`, `updatedAt`, `lastEditedAt`, `visitDate`, `reviewQADate` and `mappedDateText` are now normalised to a single unambiguous ISO-8601 UTC form, `2019-07-25T17:28:21.024Z`. Date-only columns come out at midnight UTC (`2014-04-27T00:00:00.000Z`) rather than as a bare date, so the AGOL side can type them as **Date** rather than **Date Only**, which is what the review asked for. Postgres runs in `Etc/UTC` and all six columns default to `now()`, so the `Z` is accurate rather than a relabelling of local time.
- **`mappedPoolLocation` is dropped from properties.** It was the last nested object in either payload and pure redundancy — the identical point is already the feature geometry. It was also the cause of that field widening from `String(120)` to `String(4000)` in the comparison, since the nested object was being stringified. No UI code reads it.
- **Deliberately left as strings.** `visitFishCount`, `visitMaxDepth`, `visitFishSize` and `visitLocationUncertainty` are `text` in Postgres and genuinely hold prose — "knee deep", "> 10", "high". The old layers typed them as Integer; casting them numerically would null out every such row, so they stay strings.
- **Shared between both endpoints, so they cannot drift again.** The normalisation lives in one new module, [api_vp/_helpers/geojson_props.js](api_vp/_helpers/geojson_props.js), used by both [vpMapped.service.js](api_vp/vpMapped/vpMapped.service.js) and [vpVisit.service.js](api_vp/vpVisit/vpVisit.service.js). The boolean rewrite walks the assembled object rather than naming columns, so a boolean added to any of the three tables later is handled with no code change, and a column present in one environment but not another cannot break the query.
- **Verified.** Both payloads now contain zero nested objects, zero JSON booleans, and all six date keys in ISO-8601 UTC. `/mapped/geojson` 13,465 features / 36 property keys in 2.2 s; `/visit/geojson` 2,069 features / 163 keys in 1.2 s.

### Notes for the AGOL side (not code changes)

Three of the review's findings are pipeline configuration rather than source data, and are not addressed by this release:

- **`String(4000)` lengths inflating layer storage and credits** — the Feature layer output element's **String field length** parameter is at its 4000 default; setting it to 255 addresses this directly.
- **Integers inferring as BigInteger** — JSON numbers carry no width, so this can only be set on the AGOL side, with the [Update fields](https://doc.arcgis.com/en/data-pipelines/latest/process/update-field.htm) tool (its type list includes Small integer and Integer).
- **Date typing** — the normalised ISO-8601 strings still need Update fields to be typed as Date.

Two further findings need no action: the source spatial reference reads 4326 rather than 3857 because RFC 7946 mandates WGS84 for GeoJSON and `mappedPoolLocation` is already `geometry(Geometry,4326)` — no reprojection happens anywhere — and the record-count differences (+21 mapped, +122 visits) are simply the older layers being stale snapshots. Prod returned exactly 13,485 and 2,215 on 2026-09-04, matching the new services.

### Service worker / build

- `manifest.json` 3.5.369 → 3.5.370 via `node sw-build.js patch`. **API rebuild required** (`api_vp/**` changed): `docker compose -f docker-compose-vpatlas.yml up -d --build api_vp`.
- [urlsToCache.js](ui_vp/uiVPAtlas/urlsToCache.js) and the [docs/index.html](ui_vp/uiVPAtlas/docs/index.html) `DOCS` array: added `/docs/CHANGELOG-2026-09-04-partial.md`; the 2026-09-02 entry was finalized from `-partial`.

### Documentation

- **Daily roll-over.** `CHANGELOG-2026-09-02-partial.md` was finalized as `CHANGELOG-2026-09-02.md` (H1 qualifier and partial-day boilerplate dropped) per the roll-over rule. All 2026-09-02 work was already recorded, including the actual v3.5.369 prod ship; nothing landed on 2026-09-03.
