-- 001_add_user_handle.sql
-- Add handle column to vpuser for display purposes.
-- Defaults to username for existing users. Handle is the public display name.

ALTER TABLE vpuser ADD COLUMN IF NOT EXISTS handle text;

-- Populate handle from username for all existing users
UPDATE vpuser SET handle = username WHERE handle IS NULL;
