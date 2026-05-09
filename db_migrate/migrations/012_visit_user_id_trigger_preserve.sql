-- 012_visit_user_id_trigger_preserve.sql
--
-- The set_visit_user_id_from_visit_user_name trigger blindly overwrote
-- NEW.visitUserId / NEW.visitObserverUserId with whatever its name-based
-- lookup produced — including NULL when the lookup couldn't resolve the
-- name. That made it impossible to:
--   (a) backfill ids via a plain UPDATE (the trigger immediately blew the
--       newly-set id away), and
--   (b) trust the API's new injectAuthUserId behavior, since the trigger
--       would clobber the JWT-derived id whenever the supplied name didn't
--       match a vpuser.username.
--
-- Patch the trigger to PRESERVE incoming non-NULL ids, then re-run the
-- backfill that 011 attempted. For rows where the caller didn't supply
-- an id, the legacy lookup behavior is unchanged.

CREATE OR REPLACE FUNCTION set_visit_user_id_from_visit_user_name() RETURNS TRIGGER AS $$
DECLARE
        u_name text;
        o_name text;
        usr_id integer;
        obs_id integer;
BEGIN
        -- visitUserName / visitUserId
        RAISE NOTICE 'set_visit_user_id_from_visit_user_name() visitUserName: % | visitUserId: %', NEW."visitUserName", NEW."visitUserId";

        -- If the caller already supplied a valid visitUserId, keep it.
        -- Either the API stamped it from the JWT or migration 011 backfilled
        -- it; either way the explicit id outranks any name-based lookup.
        IF NEW."visitUserId" IS NOT NULL THEN
                usr_id := NEW."visitUserId";
                IF NEW."visitUserName" IS NULL OR NEW."visitUserName" = '' THEN
                        u_name := (SELECT "username" FROM vpuser WHERE id = usr_id);
                ELSE
                        u_name := btrim(NEW."visitUserName", '\"');
                END IF;
        ELSE
                u_name := btrim(COALESCE(NEW."visitUserName", ''), '\"');
                IF u_name <> '' THEN
                        IF valid_email(u_name) THEN
                                usr_id := (SELECT "id" FROM vpuser WHERE LOWER("email") = LOWER(u_name));
                        END IF;
                        IF usr_id IS NOT NULL THEN
                                NEW."visitUserId" := usr_id;
                                RAISE NOTICE 'Matched visitUserName % to email having userId %.', u_name, usr_id;
                                u_name := (SELECT "username" FROM vpuser WHERE id = usr_id);
                        ELSE
                                u_name := SPLIT_PART(u_name, '@', 1);
                                usr_id := find_or_insert_user_from_ambig_user_email_input(u_name);
                        END IF;
                END IF;
        END IF;
        IF NEW."visitUserName" IS DISTINCT FROM u_name AND u_name <> '' THEN
                RAISE NOTICE 'Altered incoming visitUserName % to %.', NEW."visitUserName", u_name;
                NEW."visitUserName" := u_name;
        END IF;
        NEW."visitUserId" := usr_id;

        -- visitObserverUserName / visitObserverUserId — same shape.
        RAISE NOTICE 'set_visit_user_id_from_visit_user_name() visitObserverUserName: % | visitObserverUserId: %', NEW."visitObserverUserName", NEW."visitObserverUserId";

        IF NEW."visitObserverUserId" IS NOT NULL THEN
                obs_id := NEW."visitObserverUserId";
                IF NEW."visitObserverUserName" IS NULL OR NEW."visitObserverUserName" = '' THEN
                        o_name := (SELECT "username" FROM vpuser WHERE id = obs_id);
                ELSE
                        o_name := btrim(NEW."visitObserverUserName", '\"');
                END IF;
        ELSE
                o_name := btrim(COALESCE(NEW."visitObserverUserName", ''), '\"');
                IF o_name <> '' THEN
                        IF valid_email(o_name) THEN
                                obs_id := (SELECT "id" FROM vpuser WHERE LOWER("email") = LOWER(o_name));
                        END IF;
                        IF obs_id IS NOT NULL THEN
                                NEW."visitObserverUserId" := obs_id;
                                RAISE NOTICE 'Matched visitObserverUserName % to email having userId %.', o_name, obs_id;
                                o_name := (SELECT "username" FROM vpuser WHERE id = obs_id);
                        ELSE
                                o_name := SPLIT_PART(o_name, '@', 1);
                                obs_id := find_or_insert_user_from_ambig_user_email_input(o_name);
                        END IF;
                END IF;
        END IF;
        IF NEW."visitObserverUserName" IS DISTINCT FROM o_name AND o_name <> '' THEN
                RAISE NOTICE 'Altered incoming visitObserverUserName % to %.', NEW."visitObserverUserName", o_name;
                NEW."visitObserverUserName" := o_name;
        END IF;
        NEW."visitObserverUserId" := obs_id;

        RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Now retry the 011 backfill — the trigger will leave our explicitly-set
-- ids alone instead of clobbering them.
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
