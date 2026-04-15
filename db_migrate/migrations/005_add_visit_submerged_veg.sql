-- Add submerged vegetation column to vpvisit (matching vpsurvey pattern)
-- Also add comment explaining the 0-5 scale used by all vegetation fields
ALTER TABLE vpvisit
  ADD COLUMN IF NOT EXISTS "visitSubmergedVeg" integer;

COMMENT ON COLUMN vpvisit."visitSubmergedVeg" IS 'Submerged aquatic vegetation cover: 0=0%, 1=1-10%, 2=11-25%, 3=26-50%, 4=51-75%, 5=>=76%';
