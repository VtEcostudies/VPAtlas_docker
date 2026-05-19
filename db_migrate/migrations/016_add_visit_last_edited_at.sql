-- 016_add_visit_last_edited_at.sql
--
-- The Review filter needs a "when did a user last edit this visit?" signal
-- to decide whether a reviewed visit needs re-review. vpvisit."updatedAt"
-- can't serve that role: a grep of the codebase found four subsystems that
-- depend on updatedAt bumping on every write —
--   1. S123 ESRI delta-sync (MAX(updatedAt) high-water mark)
--   2. insert-vs-update detection (RETURNING "createdAt"!="updatedAt")
--   3. admin user-activity rollup (MAX(vpvisit.updatedAt) per user)
--   4. /pools delta filter (updatedAt > $ts)
-- — and it is re-stamped by trigger_updated_at on every UPDATE (including
-- migrations and a production DB re-instantiation). Overloading it would
-- break those and still leave the comparison migration-tainted.
--
-- So: a NEW, dedicated, nullable column that ONLY the API's user-edit
-- path writes. No DEFAULT, no trigger, no backfill:
--   * NULL  => no app-edit since baseline => the visit's existing review
--              is still valid => NOT flagged for re-review.
--   * non-NULL (set to now() by the visit PUT handler) => a user edited
--              the visit after it was reviewed => compare against the
--              review's reviewQADate to decide re-review.
--
-- trigger_updated_at and vpvisit."updatedAt" are deliberately left
-- untouched so the four subsystems above keep working unchanged.

ALTER TABLE vpvisit ADD COLUMN IF NOT EXISTS "lastEditedAt" timestamp;

COMMENT ON COLUMN vpvisit."lastEditedAt" IS
  'Set to now() by the API only when a user edits an existing visit through the app. NULL = never user-edited since the 2026-05 baseline. Drives the Review filter (re-review when lastEditedAt > its review''s reviewQADate). Intentionally has no DEFAULT and no trigger — do not repurpose updatedAt for this.';
