-- 018_amphib_skip_placeholder_observer.sql
--
-- s123 ingest path writes a phantom 2nd row to vpsurvey_amphib for every
-- single-observer survey:
--
--   * Survey123 emits an Obs 2 sub-object in surveyAmphibJson even when
--     that slot wasn't filled — it's a fixed structure in the form. The
--     obs2 sub-object has surveyAmphibObsEmail = JSON null and every
--     count column missing/null.
--   * The trigger function below loops over jsonb_each(amphibJson) and
--     inserts a row whenever the sub-object is `!= '{}'`. The empty-Obs-2
--     sub-object is NOT '{}' (it has keys with null values), so the
--     guard never fires.
--   * The old INSERT used `phibJson->'surveyAmphibObsEmail'` (the `->`
--     operator returns JSONB) into the TEXT surveyAmphibObsEmail column;
--     a JSONB null cast to text yields the literal four-character string
--     'null'. So the phantom row landed with surveyAmphibObsEmail='null',
--     surveyAmphibObsId IS NULL (no vpuser matches the literal 'null'),
--     and every count column at 0 (NOT NULL DEFAULT 0 on the schema).
--
-- Downstream consequences this migration closes:
--   * survey_view.html displayed a phantom "null" observer with all-zero
--     counts (UI fix shipped 3.5.330 — kept in place as defense in depth).
--   * /survey CSV and /survey/geojson responses both carried the phantom
--     row, polluting CSV exports and external API pulls with
--     observer-saw-zero-of-everything records that never existed.
--   * Any per-row analytic — "what % of surveys had >0 wood-frog egg
--     masses?" — was understating by ~19% (489 phantom zero rows out of
--     2568 total in production).
--
-- This migration does two things:
--   1. Replaces the trigger function so future s123 ingests skip empty
--      observer slots and use ->> (text) instead of -> (jsonb) for the
--      email column. The skip predicate cleans the email to SQL NULL
--      first (NULLIF the literal string 'null' AND the empty string),
--      then CONTINUEs the LOOP when there's nothing real to record.
--   2. Backfills by deleting existing placeholder rows. Identified by
--      surveyAmphibObsId IS NULL AND email is one of {NULL, '', 'null'} —
--      matches the UI filter and the new trigger guard exactly.
--
-- Idempotent: the trigger replacement is a CREATE OR REPLACE, and the
-- backfill DELETE only touches rows that match the placeholder shape (a
-- real observer would have either a non-null obsId or a real email,
-- not both null/empty/'null' simultaneously).

CREATE OR REPLACE FUNCTION public.insert_vpsurvey_subtables_from_vpsurvey_jsonb()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    amphibJson    jsonb := NEW."surveyAmphibJson";
    macroJson     jsonb := NEW."surveyMacroJson";
    yearJson      jsonb := NEW."surveyYearJson";
    photoJson     jsonb := NEW."surveyPhotoJson";
    observer      text;
    phibJson      jsonb;
    cleaned_email text;
BEGIN
    RAISE NOTICE 'insert_vpsurvey_subtables_from_vpsurvey_jsonb() surveyId: %', NEW."surveyId";
    RAISE NOTICE 'surveyPhotoJson: %', photoJson;
    RAISE NOTICE 'surveyYearJson->>surveyYear: %', yearJson->>'surveyYear';
    RAISE NOTICE 'surveyMacroJson: %', macroJson;
    RAISE NOTICE 'surveyAmphibJson.1: %', amphibJson->'1';
    RAISE NOTICE 'surveyAmphibJson.2: %', amphibJson->'2';

    IF photoJson != '{}' THEN
        INSERT INTO vpsurvey_photos (
            "surveyPhotoSurveyId",
            "surveyPhotoSpecies",
            "surveyPhotoUrl",
            "surveyPhotoName"
        ) VALUES (
            NEW."surveyId",
            (photoJson->>'surveyPhotoSpecies')::TEXT,
            (photoJson->>'surveyPhotoUrl')::TEXT,
            (photoJson->>'surveyPhotoName')::TEXT
        );
    END IF;

    IF yearJson->>'surveyYear' IS NOT NULL THEN
        INSERT INTO vpsurvey_year ("surveyYearSurveyId", "surveyYear")
            VALUES (NEW."surveyId", (yearJson->>'surveyYear')::INTEGER);
    ELSE
        INSERT INTO vpsurvey_year ("surveyYearSurveyId", "surveyYear")
            VALUES (NEW."surveyId", EXTRACT(YEAR FROM NEW."surveyDate"));
    END IF;

    IF macroJson != '{}' THEN
        INSERT INTO vpsurvey_macro (
            "surveyMacroSurveyId",
            "surveyMacroNorthFASH",
            "surveyMacroEastFASH",
            "surveyMacroSouthFASH",
            "surveyMacroWestFASH",
            "surveyMacroTotalFASH",
            "surveyMacroNorthCDFY",
            "surveyMacroEastCDFY",
            "surveyMacroSouthCDFY",
            "surveyMacroWestCDFY",
            "surveyMacroTotalCDFY"
        ) VALUES (
            NEW."surveyId",
            COALESCE((macroJson->>'surveyMacroNorthFASH')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroEastFASH')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroSouthFASH')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroWestFASH')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroTotalFASH')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroNorthCDFY')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroEastCDFY')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroSouthCDFY')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroWestCDFY')::INTEGER, 0),
            COALESCE((macroJson->>'surveyMacroTotalCDFY')::INTEGER, 0)
        );
    END IF;

    FOR observer, phibJson IN
        SELECT * FROM jsonb_each(amphibJson)
    LOOP
        RAISE NOTICE 'observer:%, amphibJson:%', observer, phibJson;
        IF phibJson = '{}' THEN
            CONTINUE;
        END IF;

        -- Clean the email: JSON null surfaces as the literal text 'null'
        -- when extracted with ->>, and Survey123 also sometimes sends an
        -- empty string for an empty slot. NULLIF chained collapses both
        -- to a real SQL NULL so the guard below and the column value are
        -- consistent.
        cleaned_email := NULLIF(NULLIF(phibJson->>'surveyAmphibObsEmail', 'null'), '');

        -- Skip placeholder observer slots: no email AND no resolvable
        -- vpuser FK means no real observer was here. Drops the phantom
        -- Obs 2 row that previously landed for every single-observer
        -- s123 survey.
        IF cleaned_email IS NULL
           AND NOT EXISTS (SELECT 1 FROM vpuser WHERE email = phibJson->>'surveyAmphibObsEmail')
        THEN
            RAISE NOTICE 'skipping placeholder observer slot:% (no email, no user)', observer;
            CONTINUE;
        END IF;

        INSERT INTO vpsurvey_amphib (
            "surveyAmphibSurveyId",
            "surveyAmphibObsEmail",
            "surveyAmphibObsId",
            "surveyAmphibEdgeStart",
            "surveyAmphibEdgeStop",
            "surveyAmphibEdgeWOFR",
            "surveyAmphibEdgeSPSA",
            "surveyAmphibEdgeJESA",
            "surveyAmphibEdgeBLSA",
            "surveyAmphibInteriorStart",
            "surveyAmphibInteriorStop",
            "surveyAmphibInteriorWOFR",
            "surveyAmphibInteriorSPSA",
            "surveyAmphibInteriorJESA",
            "surveyAmphibInteriorBLSA"
        ) VALUES (
            NEW."surveyId",
            -- Use ->> (text) not -> (jsonb) so a JSON null lands as a SQL
            -- NULL rather than the four-character text 'null'.
            cleaned_email,
            (SELECT "id" FROM "vpuser" WHERE "email" = phibJson->>'surveyAmphibObsEmail'),
            (phibJson->>'surveyAmphibEdgeStart')::TIME,
            (phibJson->>'surveyAmphibEdgeStop')::TIME,
            COALESCE((phibJson->>'surveyAmphibEdgeWOFR')::INTEGER, 0),
            COALESCE((phibJson->>'surveyAmphibEdgeSPSA')::INTEGER, 0),
            COALESCE((phibJson->>'surveyAmphibEdgeJESA')::INTEGER, 0),
            COALESCE((phibJson->>'surveyAmphibEdgeBLSA')::INTEGER, 0),
            (phibJson->>'surveyAmphibInteriorStart')::TIME,
            (phibJson->>'surveyAmphibInteriorStop')::TIME,
            COALESCE((phibJson->>'surveyAmphibInteriorWOFR')::INTEGER, 0),
            COALESCE((phibJson->>'surveyAmphibInteriorSPSA')::INTEGER, 0),
            COALESCE((phibJson->>'surveyAmphibInteriorJESA')::INTEGER, 0),
            COALESCE((phibJson->>'surveyAmphibInteriorBLSA')::INTEGER, 0)
        );
    END LOOP;

    RETURN NEW;
END;
$function$;

-- Backfill: drop the placeholder rows that landed before this fix.
-- Match the same predicate the new trigger uses to skip future
-- placeholders: no obsId AND email is NULL / '' / literal 'null'.
DELETE FROM vpsurvey_amphib
WHERE "surveyAmphibObsId" IS NULL
  AND (
    "surveyAmphibObsEmail" IS NULL
    OR LOWER(TRIM("surveyAmphibObsEmail")) = 'null'
    OR TRIM("surveyAmphibObsEmail") = ''
  );
