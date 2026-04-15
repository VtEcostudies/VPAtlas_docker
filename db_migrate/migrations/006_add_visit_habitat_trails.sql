-- Add trails checkbox to adjacent land use options
ALTER TABLE vpvisit
  ADD COLUMN IF NOT EXISTS "visitHabitatTrails" boolean DEFAULT false;
