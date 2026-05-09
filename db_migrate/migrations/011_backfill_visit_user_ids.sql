-- 011_backfill_visit_user_ids.sql
-- Backfill the stable user-id ownership columns on existing visit rows.
--
-- vpvisit has four owner-ish columns: two strings (visitUserName,
-- visitObserverUserName) and two ids (visitUserId, visitObserverUserId).
-- Until we started forcing the auth user's id onto every write, app
-- uploads landed with NULL ids — only the names were populated. Worse,
-- different historical app versions stored DIFFERENT names for the same
-- person:
--
--    user 3 (jloomis):  visitObserverUserName = 'jLooVCE'  (recent, used handle)
--                       visitObserverUserName = 'jloomis'  (April, used username)
--                       visitObserverUserName = 'Jloomis'  (2022, capitalised)
--
-- "My Visits and Tracks" used to query by a single name string and
-- silently lose anything stored under a different variant. From now on
-- the query keys off visitObserverUserId (stable forever) — but only if
-- the column is populated. This migration walks every NULL-id row and
-- looks up a vpuser whose username, handle, or email matches the stored
-- name (case-insensitively). Idempotent: only updates NULL columns and
-- only writes a found id.

-- visitObserverUserId — backfill from visitObserverUserName.
UPDATE vpvisit v
   SET "visitObserverUserId" = u.id
  FROM vpuser u
 WHERE v."visitObserverUserId" IS NULL
   AND v."visitObserverUserName" IS NOT NULL
   AND v."visitObserverUserName" <> ''
   AND ( LOWER(u.username) = LOWER(v."visitObserverUserName")
      OR LOWER(u.handle)   = LOWER(v."visitObserverUserName")
      OR LOWER(u.email)    = LOWER(v."visitObserverUserName") );

-- visitUserId — backfill from visitUserName (uploader, distinct from
-- observer for S123-imported rows).
UPDATE vpvisit v
   SET "visitUserId" = u.id
  FROM vpuser u
 WHERE v."visitUserId" IS NULL
   AND v."visitUserName" IS NOT NULL
   AND v."visitUserName" <> ''
   AND ( LOWER(u.username) = LOWER(v."visitUserName")
      OR LOWER(u.handle)   = LOWER(v."visitUserName")
      OR LOWER(u.email)    = LOWER(v."visitUserName") );

-- For rows where visitUserName is empty but visitObserverUserName is
-- populated (true for almost every app-uploaded row), copy the observer
-- id over so "uploader == observer" rows have both columns populated and
-- ownership checks have something to grip on either side.
UPDATE vpvisit
   SET "visitUserId" = "visitObserverUserId"
 WHERE "visitUserId" IS NULL
   AND "visitObserverUserId" IS NOT NULL
   AND ("visitUserName" IS NULL OR "visitUserName" = '');

-- Index the columns we're now going to query by so the filter on
-- /pools/visit?visitObserverUserId=N stays cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_vpvisit_observer_user_id
    ON vpvisit ("visitObserverUserId");
CREATE INDEX IF NOT EXISTS idx_vpvisit_user_id
    ON vpvisit ("visitUserId");
