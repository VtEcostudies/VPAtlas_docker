# VPAtlas v3 Design Review — Proposed Changes Summary

**Source:** [Design Review Google Doc](https://docs.google.com/document/d/1JHLm_CyD9Zb18sAGAee2K6CNXGgah4N2A18hPYlDstM/edit?tab=t.0)
**Date:** 2026-04-14

---

## Overview

Four categories of changes simplify the Atlas Visit form, improve volunteer accessibility, and modernize pool characterization. All changes are **UI-only** — existing DB columns and API responses remain intact, preserving historical data.

---

## 1. REMOVE: Certainty, Navigation Method, Directions

**Rationale:** Vestigial fields from the pre-GPS era. With modern GPS devices, certainty self-assessments, navigation method tracking, and written turn-by-turn directions no longer add value.

**Fields removed:**
- `visitCertainty` — radio: Certain / Pretty Sure / Not Sure
- `visitNavMethod` — radio: GPS / Map / Prior Knowledge / Other
- `visitNavMethodOther` — freetext for "Other"
- `visitDirections` — textarea for turn-by-turn directions
- `mappedConfidence` — display-only confidence on pool view

**Pages affected:**

| Page | File | Change |
|------|------|--------|
| Visit Create (form) | `survey/visit_create.html` | Remove 3 fields from Location tab + JS collection arrays |
| Visit View (display) | `explore/visit_view.html` | Remove display rows |
| Pool View (display) | `explore/pool_view.html` | Remove mappedConfidence row |
| Review Create (admin) | `admin/review_create.html` | Remove from read-only visit detail pane |
| Review View (admin) | `admin/review_view.html` | Remove from display |

---

## 2. REMOVE: Landowner Manual Collection

**Rationale:** Landowner permission is a significant barrier to volunteer participation. Landowner info will be auto-populated from parcel data in a future phase rather than collected during field surveys.

**Fields removed:**
- `visitUserIsLandowner` — checkbox: "I am the landowner"
- `visitLandownerPermission` — checkbox: "Permission obtained"
- `visitLandownerName`, `visitLandownerPhone`, `visitLandownerEmail`, `visitLandownerAddress`
- `mappedLandownerPermission`, `mappedLandownerName`, `mappedLandownerPhone`, `mappedLandownerAddress`

**Pages affected:**

| Page | File | Change |
|------|------|--------|
| Visit Create (form) | `survey/visit_create.html` | Remove entire Landowner tab (tab 6) |
| Visit View (display) | `explore/visit_view.html` | Remove Landowner section |
| Pool Create (form) | `explore/pool_create.html` | Remove landowner checkbox + conditional section |
| Review Create (admin) | `admin/review_create.html` | Remove renderLandowner() call |

**Future work:** Parcel-data auto-population service (separate effort).

---

## 3. CHANGE: Pool Type — Single Select to Multi-Select Checklist

**Rationale:** Pools can exhibit multiple characteristics simultaneously (e.g., both a forest depression and man-made). Single-choice selection forces an artificial constraint.

**Current:** Single radio — Forest Depression / Floodplain / Manmade / Other
**Proposed:** Multi-select checkboxes — same options, multiple can be selected

**DB storage:** JSON array string in existing `text` column (e.g. `["Forest Depression","Manmade"]`). No schema migration needed. Old single-value data treated as single-item arrays for backward compatibility.

**Pages affected:**

| Page | File | Change |
|------|------|--------|
| Visit Create (form) | `survey/visit_create.html` | Radio buttons → checkboxes, JS collects as array |
| Visit View (display) | `explore/visit_view.html` | Display as comma-separated list |
| Review Create (admin) | `admin/review_create.html` | Update read-only display for multiple values |

**Note:** `mappedPoolStatus` in pool_create.html is pool *status* (Potential/Probable/Confirmed/Duplicate/Eliminated), NOT pool *type* — no change needed there.

---

## 4. CHANGE: Inlet/Outlet — Classification to Yes/No

**Rationale:** Distinguishing ephemeral vs. permanent inlet/outlet requires expertise most volunteers don't have. Simple "Is water flowing in/out?" is observable and objective.

**Current:** Single radio — No Inlet / Ephemeral / Permanent (same for Outlet)
**Proposed:** Simple Yes/No — "Is water flowing in?" / "Is water flowing out?"

**DB storage:** Store "Yes"/"No" in existing `text` columns. Old values ("Ephemeral", "Permanent", "No Inlet", "No Outlet") remain in DB for historical visits. Display pages handle both old and new values.

**Pages affected:**

| Page | File | Change |
|------|------|--------|
| Visit Create (form) | `survey/visit_create.html` | 3-option radio → Yes/No radio |
| Visit View (display) | `explore/visit_view.html` | Display Yes/No (handle old values gracefully) |
| Review Create (admin) | `admin/review_create.html` | Update read-only display |

---

## Files Summary

| # | File | All Changes |
|---|------|-------------|
| 1 | `survey/visit_create.html` | Remove certainty/navMethod/directions, remove landowner tab, pool type → multi-select, inlet/outlet → Yes/No |
| 2 | `explore/visit_view.html` | Remove display of removed fields, update pool type + inlet/outlet display |
| 3 | `explore/pool_view.html` | Remove mappedConfidence display |
| 4 | `explore/pool_create.html` | Remove landowner section |
| 5 | `admin/review_create.html` | Update visit detail pane for all changes |
| 6 | `admin/review_view.html` | Update display for all changes |

**Not affected:** `survey_create.html` (monitoring survey), `survey_start.html` (PoolFinder), `index.html` (explore filters), `survey_view.html`, `survey_list.html`, `users_admin.html`, `profile.html`.

---

## Technical Notes

- All removed/changed DB columns are nullable `text` type — no schema migrations required
- Old data preserved in DB and API responses; changes are UI-only
- Display pages must handle both legacy values and new values for backward compatibility
- No API route changes needed
