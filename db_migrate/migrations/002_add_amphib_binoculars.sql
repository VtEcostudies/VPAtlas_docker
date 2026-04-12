-- Add binoculars column to vpsurvey_amphib
-- Matches surveyAmphibPolarizedGlasses pattern (boolean, default false)
ALTER TABLE vpsurvey_amphib
  ADD COLUMN IF NOT EXISTS "surveyAmphibBinoculars" boolean DEFAULT false;
