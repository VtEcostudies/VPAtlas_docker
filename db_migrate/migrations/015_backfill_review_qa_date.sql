-- 015_backfill_review_qa_date.sql
--
-- Problem: 1,293 of 2,500 vpreview rows have NULL "reviewQADate". Every one
-- of them was inserted in a single legacy bulk import on 2019-07-25
-- 17:28:21 (reviews created via the app since 2020 all carry a QA date —
-- this is one bounded historical bucket, not an ongoing data-quality leak).
--
-- "reviewQADate" is the domain's intended "when the review decision was
-- made" signal, and the Review filter keys off it. A NULL there forces the
-- filter to special-case it forever and leaves the field unusable for
-- ordering/anchoring. Backfill it from the best stable historical signal
-- we have:
--
--   * 1,279 of the 1,293 have a real linked vpvisit."visitDate"
--     (1930-04-30 .. 2013-01-24) — the historical field-visit date the
--     review was attached to. Use that.
--   * 14 have the import's "unknown date" placeholder
--     (vpvisit."visitDate" = '1900-01-01'). Fall back to the review row's
--     own "createdAt"::date (the import moment, 2019-07-25) — the latest
--     the QA could possibly have been.
--
-- NOTE on semantics: this backfill is for data hygiene + to anchor FUTURE
-- edits correctly. It is NOT what keeps these legacy reviews out of the
-- re-review queue — that protection comes from vpvisit."lastEditedAt"
-- being NULL until a user actually edits a visit through the app (see
-- migration 016 + the per-visit Review filter). Both halves are needed.

-- (1) 1,279 rows with a real linked visit date.
UPDATE vpreview r
   SET "reviewQADate" = v."visitDate"
  FROM vpvisit v
 WHERE v."visitId" = r."reviewVisitId"
   AND r."reviewQADate" IS NULL
   AND v."visitDate" IS NOT NULL
   AND v."visitDate" <> '1900-01-01';

-- (2) Remaining rows (placeholder/absent visit date, or no linked visit):
--     use the review row's own insert date as the upper bound.
UPDATE vpreview
   SET "reviewQADate" = "createdAt"::date
 WHERE "reviewQADate" IS NULL;

-- (3) Guarantee it can't recur. Every review now has a QA date; the app's
-- review-create path already supplies one, so NOT NULL is safe going
-- forward and lets the filter drop its NULL special-casing.
ALTER TABLE vpreview ALTER COLUMN "reviewQADate" SET NOT NULL;
