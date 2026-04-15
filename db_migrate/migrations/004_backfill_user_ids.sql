-- 004_backfill_user_ids.sql
-- Backfill missing userId foreign keys from username/email/handle string matching.
-- Safe to run on v2 live DB — only fills NULLs, never overwrites existing IDs.
-- Uses the vpuser_alias table for additional matching.
--
-- IMPORTANT: Disables triggers during vpvisit updates to avoid the
-- set_visit_user_id_from_visit_user_name() trigger which can rename
-- visitUserName and cause unique constraint violations.

-- Disable vpvisit triggers for this migration
ALTER TABLE vpvisit DISABLE TRIGGER ALL;

-- 1. vpvisit: fill visitUserId from visitUserName
UPDATE vpvisit v SET "visitUserId" = u.id
FROM vpuser u
WHERE v."visitUserId" IS NULL
  AND v."visitUserName" IS NOT NULL
  AND (lower(v."visitUserName") = lower(u.username)
    OR lower(v."visitUserName") = lower(u.email)
    OR lower(v."visitUserName") = lower(u.handle));

-- 1b. vpvisit: try alias table for remaining NULLs
UPDATE vpvisit v SET "visitUserId" = a."aliasUserId"
FROM vpuser_alias a
WHERE v."visitUserId" IS NULL
  AND v."visitUserName" IS NOT NULL
  AND lower(v."visitUserName") = lower(a.alias);

-- 2. vpvisit: fill visitObserverUserId from visitObserverUserName
UPDATE vpvisit v SET "visitObserverUserId" = u.id
FROM vpuser u
WHERE v."visitObserverUserId" IS NULL
  AND v."visitObserverUserName" IS NOT NULL
  AND (lower(v."visitObserverUserName") = lower(u.username)
    OR lower(v."visitObserverUserName") = lower(u.email)
    OR lower(v."visitObserverUserName") = lower(u.handle));

-- Re-enable vpvisit triggers
ALTER TABLE vpvisit ENABLE TRIGGER ALL;

-- 3. vpsurvey: fill surveyUserId from surveyUserEmail
UPDATE vpsurvey s SET "surveyUserId" = u.id
FROM vpuser u
WHERE s."surveyUserId" IS NULL
  AND s."surveyUserEmail" IS NOT NULL
  AND lower(s."surveyUserEmail") = lower(u.email);

-- 3b. vpsurvey: try username match for remaining NULLs
UPDATE vpsurvey s SET "surveyUserId" = u.id
FROM vpuser u
WHERE s."surveyUserId" IS NULL
  AND s."surveyUserEmail" IS NOT NULL
  AND (lower(s."surveyUserEmail") = lower(u.username)
    OR lower(s."surveyUserEmail") = lower(u.handle));

-- 4. vpmapped: fill mappedUserId from mappedByUser
UPDATE vpmapped m SET "mappedUserId" = u.id
FROM vpuser u
WHERE m."mappedUserId" IS NULL
  AND m."mappedByUser" IS NOT NULL
  AND (lower(m."mappedByUser") = lower(u.username)
    OR lower(m."mappedByUser") = lower(u.email)
    OR lower(m."mappedByUser") = lower(u.handle));

-- Report: show remaining orphans for manual review
DO $$
DECLARE
  v_orphan INT; s_orphan INT; m_orphan INT;
BEGIN
  SELECT count(*) INTO v_orphan FROM vpvisit
    WHERE "visitUserId" IS NULL AND "visitUserName" IS NOT NULL;
  SELECT count(*) INTO s_orphan FROM vpsurvey
    WHERE "surveyUserId" IS NULL AND "surveyUserEmail" IS NOT NULL;
  SELECT count(*) INTO m_orphan FROM vpmapped
    WHERE "mappedUserId" IS NULL AND "mappedByUser" IS NOT NULL;
  RAISE NOTICE 'Remaining orphans — visits: %, surveys: %, mapped: %',
    v_orphan, s_orphan, m_orphan;
END $$;
