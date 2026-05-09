-- 013_visit_user_id_trigger_no_name_fill.sql
--
-- Two related problems surfaced when 012 ran on live data:
--
-- 1) The unique constraint vpVisit_unique_visitPoolId_Date_UserName was
--    keyed on (visitPoolId, visitDate, visitUserName) — a DATE plus a
--    mutable string. That's wrong on two counts:
--      a) DATE is too coarse — the same observer can legitimately visit
--         the same pool more than once on the same day (morning and
--         afternoon for instance), and the constraint forbade it.
--      b) Keying on the mutable name string compounded the trouble: when
--         a NULL-named row collided with a non-NULL-named row, postgres
--         treated them as distinct (NULLS DISTINCT default), but the
--         moment we tried to fill in the NULL name with a derived value
--         the constraint fired.
--    Replace it with a timestamp-based + id-based constraint:
--    (visitPoolId, "createdAt", visitObserverUserId). Same shape, just
--    using the columns we actually want — a precise insert timestamp and
--    a stable user id.
--
-- 2) Migration 012 patched the trigger to preserve the caller's non-NULL
--    id but also derived visitUserName from that id and wrote it back
--    when the name column was NULL. That promotion is what caused the
--    collision noted above. The right rule for this trigger is:
--      * If the caller supplied a userId, trust it. DO NOT touch the
--        userName column. NULL stays NULL.
--      * If the caller supplied only a name, do the legacy name→id
--        lookup and normalize the name as before.
--      * If both are NULL, leave the row alone.
--
-- After both fixes are in place, re-run 012's UPDATEs (idempotent — they
-- only touch NULL columns).

-- (1) Constraint swap. The old constraint may not exist if this is a
-- fresh database, hence IF EXISTS. The new constraint is keyed on the
-- columns ownership/uploads should naturally be unique by; existing
-- rows that violate it would block the ADD, but createdAt is set by
-- DEFAULT now() per row so collisions are mathematically improbable.
ALTER TABLE vpvisit DROP CONSTRAINT IF EXISTS "vpVisit_unique_visitPoolId_Date_UserName";
ALTER TABLE vpvisit DROP CONSTRAINT IF EXISTS vpvisit_unique_pool_createdat_user;
ALTER TABLE vpvisit ADD CONSTRAINT vpvisit_unique_pool_createdat_user
    UNIQUE ("visitPoolId", "createdAt", "visitObserverUserId");

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
                -- (visitPoolId, visitDate, visitUserName) unique constraint
                -- whenever a separately-named row already shares the pool +
                -- date.
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

-- Re-run the backfill. The first two UPDATEs are no-ops on rows already
-- handled by 011, but they're idempotent so leaving them in is safe.
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

-- This is the UPDATE that 012 failed on. With the new trigger, the
-- visitUserName column is left untouched, so no unique-constraint
-- collisions with rows that already share the (poolId, date, name) tuple.
UPDATE vpvisit
   SET "visitUserId" = "visitObserverUserId"
 WHERE "visitUserId" IS NULL
   AND "visitObserverUserId" IS NOT NULL
   AND ("visitUserName" IS NULL OR "visitUserName" = '');
