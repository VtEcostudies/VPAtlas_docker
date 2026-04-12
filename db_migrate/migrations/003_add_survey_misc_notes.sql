-- Add miscellaneous notes column to vpsurvey (from S123 field definition)
ALTER TABLE vpsurvey
  ADD COLUMN IF NOT EXISTS "surveyMiscNotes" text;
