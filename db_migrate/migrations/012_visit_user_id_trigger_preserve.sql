-- 012_visit_user_id_trigger_preserve.sql  (REWRITTEN — all-in-one)
--
-- Original 012 patched the visit-user-id trigger to preserve a non-NULL
-- caller-supplied id, but it ALSO derived visitUserName from that id and
-- wrote it back when the name column was NULL. On live data that hit the
-- "vpVisit_unique_visitPoolId_Date_UserName" unique constraint:
--
--    ERROR: duplicate key value violates unique constraint
--    DETAIL: Key ("visitPoolId","visitDate","visitUserName")=
--            (LDR5563, 2026-05-03, kevtolan) already exists.
--
-- The migration runner halts on first failure (set -e in the runner +
-- ON_ERROR_STOP=1 in psql), and 012 stays marked success=false so it
-- retries on every container restart — and fails the same way every time,
-- blocking 013+. This file now contains the COMPLETE fix in idempotent
-- form so a single run of 012 leaves the database in the desired final
-- state.
--
-- Final-state requirements:
--   1. The (visitPoolId, visitDate, visitUserName) unique constraint is
--      removed. The right key for "this visit row is unique" is
--      (visitPoolId, createdAt, visitObserverUserId): a precise insert
--      timestamp plus the stable user id. visitDate (DATE) is too coarse
--      for legitimate same-day repeat visits, and visitUserName is mutable.
--   2. The set_visit_user_id_from_visit_user_name trigger preserves the
--      caller's non-NULL ids and never auto-fills the name column from
--      an id (the source of the dupe collision).
--   3. Existing rows have visitObserverUserId / visitUserId backfilled
--      from their name columns where matchable (case-insensitive against
--      vpuser.username / handle / email).

-- 1) Constraint swap. Drop both possible old + new names so this is safe
-- to re-run on a database that's partially through.
ALTER TABLE vpvisit DROP CONSTRAINT IF EXISTS "vpVisit_unique_visitPoolId_Date_UserName";
ALTER TABLE vpvisit DROP CONSTRAINT IF EXISTS vpvisit_unique_pool_createdat_user;
ALTER TABLE vpvisit ADD CONSTRAINT vpvisit_unique_pool_createdat_user
    UNIQUE ("visitPoolId", "createdAt", "visitObserverUserId");

-- 2) Trigger fix. CREATE OR REPLACE FUNCTION is idempotent.
CREATE OR REPLACE FUNCTION set_visit_user_id_from_visit_user_name() RETURNS TRIGGER AS $$
DECLARE
        u_name text;
        o_name text;
        usr_id integer;
        obs_id integer;
BEGIN
        -- visitUserName / visitUserId ---------------------------------------
        RAISE NOTICE 'set_visit_user_id_from_visit_user_name() visitUserName: % | visitUserId: %', NEW."visitUserName", NEW."visitUserId";

        IF NEW."visitUserId" IS NOT NULL THEN
                -- Caller supplied an id; preserve it. Do NOT derive or
                -- modify visitUserName from this id — that violates the
                -- unique constraint whenever a separately-named row
                -- already shares the pool + timestamp.
                NULL;
        ELSIF NEW."visitUserName" IS NOT NULL AND btrim(NEW."visitUserName", '\"') <> '' THEN
                u_name := btrim(NEW."visitUserName", '\"');
                IF valid_email(u_name) THEN
                        usr_id := (SELECT "id" FROM vpuser WHERE LOWER("email") = LOWER(u_name));
                END IF;
                IF usr_id IS NOT NULL THEN
                        RAISE NOTICE 'Matched visitUserName % to email having userId %.', u_name, usr_id;
                        u_name := (SELECT "username" FROM vpuser WHERE id = usr_id);
                ELSE
                        u_name := SPLIT_PART(u_name, '@', 1);
                        usr_id := find_or_insert_user_from_ambig_user_email_input(u_name);
                END IF;
                IF NEW."visitUserName" IS DISTINCT FROM u_name THEN
                        RAISE NOTICE 'Altered incoming visitUserName % to %.', NEW."visitUserName", u_name;
                        NEW."visitUserName" := u_name;
                END IF;
                NEW."visitUserId" := usr_id;
        END IF;
        -- (both NULL → leave both NULL)

        -- visitObserverUserName / visitObserverUserId -----------------------
        RAISE NOTICE 'set_visit_user_id_from_visit_user_name() visitObserverUserName: % | visitObserverUserId: %', NEW."visitObserverUserName", NEW."visitObserverUserId";

        IF NEW."visitObserverUserId" IS NOT NULL THEN
                NULL;
        ELSIF NEW."visitObserverUserName" IS NOT NULL AND btrim(NEW."visitObserverUserName", '\"') <> '' THEN
                o_name := btrim(NEW."visitObserverUserName", '\"');
                IF valid_email(o_name) THEN
                        obs_id := (SELECT "id" FROM vpuser WHERE LOWER("email") = LOWER(o_name));
                END IF;
                IF obs_id IS NOT NULL THEN
                        RAISE NOTICE 'Matched visitObserverUserName % to email having userId %.', o_name, obs_id;
                        o_name := (SELECT "username" FROM vpuser WHERE id = obs_id);
                ELSE
                        o_name := SPLIT_PART(o_name, '@', 1);
                        obs_id := find_or_insert_user_from_ambig_user_email_input(o_name);
                END IF;
                IF NEW."visitObserverUserName" IS DISTINCT FROM o_name THEN
                        RAISE NOTICE 'Altered incoming visitObserverUserName % to %.', NEW."visitObserverUserName", o_name;
                        NEW."visitObserverUserName" := o_name;
                END IF;
                NEW."visitObserverUserId" := obs_id;
        END IF;

        RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) Backfill. Idempotent — only touches NULL columns. With the new
-- trigger and new constraint, none of these UPDATEs collide.
UPDATE vpvisit v
   SET "visitObserverUserId" = u.id
  FROM vpuser u
 WHERE v."visitObserverUserId" IS NULL
   AND v."visitObserverUserName" IS NOT NULL
   AND v."visitObserverUserName" <> ''
   AND ( LOWER(u.username) = LOWER(v."visitObserverUserName")
      OR LOWER(u.handle)   = LOWER(v."visitObserverUserName")
      OR LOWER(u.email)    = LOWER(v."visitObserverUserName") );

UPDATE vpvisit v
   SET "visitUserId" = u.id
  FROM vpuser u
 WHERE v."visitUserId" IS NULL
   AND v."visitUserName" IS NOT NULL
   AND v."visitUserName" <> ''
   AND ( LOWER(u.username) = LOWER(v."visitUserName")
      OR LOWER(u.handle)   = LOWER(v."visitUserName")
      OR LOWER(u.email)    = LOWER(v."visitUserName") );

UPDATE vpvisit
   SET "visitUserId" = "visitObserverUserId"
 WHERE "visitUserId" IS NULL
   AND "visitObserverUserId" IS NOT NULL
   AND ("visitUserName" IS NULL OR "visitUserName" = '');
