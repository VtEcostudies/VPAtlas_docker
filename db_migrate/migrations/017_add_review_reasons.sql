-- 017_add_review_reasons.sql
-- Add multi-select "reasons" to vpreview so admins can categorize
-- eliminations (non-pool, seep, etc.) and unconfirmed-status reasons
-- (lacks landowner permission, lacks indicator species) for downstream
-- sorting. Complements existing free-text reviewQANotes.
ALTER TABLE vpreview
  ADD COLUMN IF NOT EXISTS "reviewReasons" text[] DEFAULT '{}'::text[];
