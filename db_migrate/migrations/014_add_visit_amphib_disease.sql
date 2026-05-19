-- Add "signs of amphibian disease observed" flag to vpvisit.
-- Surfaced on the Species tab of the visit form, above "Fish observed".
ALTER TABLE vpvisit
  ADD COLUMN IF NOT EXISTS "visitAmphibianDisease" boolean DEFAULT false;

COMMENT ON COLUMN vpvisit."visitAmphibianDisease" IS 'Observer reported visible signs of amphibian disease (e.g. ranavirus, chytrid, deformities) during the visit';
