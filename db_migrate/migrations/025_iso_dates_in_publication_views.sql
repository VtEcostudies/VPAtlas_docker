-- =============================================================================
-- 025_iso_dates_in_publication_views.sql
-- =============================================================================
-- Rebuilds both canonical publication views so every date and timestamp is
-- published as ISO-8601 UTC text, identically in all three formats.
--
-- WHY, WITH THE EVIDENCE
--   The views previously kept native date and timestamp types, on the reasoning
--   that the shapefile could then carry a real DBF Date and each format could
--   serialise its own way. Measuring what pg_featureserv actually emits showed
--   that reasoning was wrong -- it publishes no machine-readable form:
--
--     view column type    OGC output                        parseable
--     timestamp           2019-06-22 14:03:33.953599        no
--     timestamptz         2019-06-22 14:03:33.953599+00     no
--     date                2014-04-27                        yes, but differs
--                                                           from the GeoJSON
--     ISO-8601 text       2019-06-22T14:03:33.953Z          yes
--
--   A space where ISO-8601 requires a T, and no zone designator. Casting to
--   timestamptz does not help. pg_featureserv exposes no formatting control, so
--   the value has to arrive already formatted.
--
--   Formatting in the view means the GeoJSON endpoint, the shapefile and the OGC
--   collection all emit the same string, which is what the canonical views exist
--   for. A bare date becomes midnight UTC, so date-only and timestamp columns
--   are indistinguishable in shape -- which is what lets the ArcGIS side type
--   them all as Date rather than Date Only, as the VCGI review asked.
--
-- WHAT IT COSTS, AND WHY THAT IS ACCEPTABLE
--   The shapefile carries these as Character(24) rather than DBF Date. DBF Date
--   stores YYYYMMDD with no time component at all, so every timestamp was
--   already losing its time there; a 24-character ISO string preserves strictly
--   more information than it gives up.
--
--   OGC filtering on these columns becomes a string comparison. ISO-8601 UTC
--   sorts lexicographically in chronological order, so range filters still
--   behave correctly.
--
-- GENERATED, NOT HAND-WRITTEN
--   Column lists come from _schema/build_views.js reading the field dictionary.
--   Regenerate rather than editing them here.
--
-- NOTE FOR OPERATORS
--   pg_featureserv caches collection metadata at startup. Restart ogc_vp after
--   this migration or the OGC collection keeps reporting the previous types.
-- =============================================================================

-- ── Collection: mapped_pools (20 published fields + geom) ────────────────────
DROP VIEW IF EXISTS ogc.mapped_pools CASCADE;
CREATE VIEW ogc.mapped_pools AS
SELECT
    m."mappedPoolId"                                              AS "poolId",
    (m."mappedPoolStatus")::text                                  AS "poolStatus",
    t."townName"                                                  AS "townName",
    c."countyName"                                                AS "countyName",
    CONCAT('https://vpatlas.org/pools/list?poolId=', m."mappedPoolId", '&zoomFilter=false') AS "vpatlas_pool_url",
    m."mappedPoolId"                                              AS "mappedPoolId",
    to_char(m."mappedDateText", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')  AS "mappedDateText",
    m."mappedLatitude"                                            AS "mappedLatitude",
    m."mappedLongitude"                                           AS "mappedLongitude",
    (m."mappedConfidence")::text                                  AS "mappedConfidence",
    m."mappedSource"                                              AS "mappedSource",
    m."mappedSource2"                                             AS "mappedSource2",
    m."mappedPhotoNumber"                                         AS "mappedPhotoNumber",
    (m."mappedLocationAccuracy")::text                            AS "mappedLocationAccuracy",
    to_char(m."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')       AS "createdAt",
    to_char(m."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')       AS "updatedAt",
    (m."mappedMethod")::text                                      AS "mappedMethod",
    (m."mappedLandownerPermission")::int::smallint                AS "mappedLandownerPermission",
    m."mappedLocationUncertainty"                                 AS "mappedLocationUncertainty",
    (m."mappedPoolStatus")::text                                  AS "mappedPoolStatus",
    m."mappedPoolLocation"                                        AS geom
FROM vpmapped m
LEFT JOIN vptown   t ON m."mappedTownId"  = t."townId"
LEFT JOIN vpcounty c ON t."townCountyId"  = c."govCountyId"
WHERE m."mappedPoolLocation" IS NOT NULL
  AND (m."mappedPoolStatus" IS NULL
       OR m."mappedPoolStatus" NOT IN ('Eliminated', 'Duplicate'));

COMMENT ON VIEW ogc.mapped_pools IS
  'Canonical publication view for mapped vernal pools. Generated from _schema/mapped.json; do not hand-edit. Feeds /mapped/geojson, /mapped/shapefile and the OGC API - Features collection identically. Excludes landowner PII, contributor identity and internal system identifiers.';

-- Field descriptions, published by pg_featureserv as each field's description.
COMMENT ON COLUMN ogc.mapped_pools."poolId" IS
  'Alias of mappedPoolId, retained for compatibility.';
COMMENT ON COLUMN ogc.mapped_pools."poolStatus" IS
  'Alias of mappedPoolStatus, retained for compatibility.';
COMMENT ON COLUMN ogc.mapped_pools."townName" IS
  'Town containing the pool.';
COMMENT ON COLUMN ogc.mapped_pools."countyName" IS
  'County containing the pool. Stored uppercase.';
COMMENT ON COLUMN ogc.mapped_pools."vpatlas_pool_url" IS
  'Deep link to the pool on vpatlas.org.';
COMMENT ON COLUMN ogc.mapped_pools."mappedPoolId" IS
  'Unique VPAtlas identifier for the pool. Identifiers prefixed NEW were assigned by the atlas; others carry the identifier from the source dataset.';
COMMENT ON COLUMN ogc.mapped_pools."mappedDateText" IS
  'Date the pool was mapped or first entered into the atlas.';
COMMENT ON COLUMN ogc.mapped_pools."mappedLatitude" IS
  'Latitude of the mapped pool centre, WGS84 decimal degrees.';
COMMENT ON COLUMN ogc.mapped_pools."mappedLongitude" IS
  'Longitude of the mapped pool centre, WGS84 decimal degrees.';
COMMENT ON COLUMN ogc.mapped_pools."mappedConfidence" IS
  'Mapper''s confidence that the mapped feature is a vernal pool, from L (low) through H (high). UNK where not assessed.';
COMMENT ON COLUMN ogc.mapped_pools."mappedSource" IS
  'Dataset, project or organisation the pool record originated from.';
COMMENT ON COLUMN ogc.mapped_pools."mappedSource2" IS
  'Secondary source, where the record was corroborated by or merged from more than one origin.';
COMMENT ON COLUMN ogc.mapped_pools."mappedPhotoNumber" IS
  'Reference number of the photograph taken of the pool, where one exists.';
COMMENT ON COLUMN ogc.mapped_pools."mappedLocationAccuracy" IS
  'Confidence in the positional accuracy of the mapped coordinates, from L (low) through H (high). UNK where not assessed.';
COMMENT ON COLUMN ogc.mapped_pools."createdAt" IS
  'Timestamp the record was created in VPAtlas (UTC).';
COMMENT ON COLUMN ogc.mapped_pools."updatedAt" IS
  'Timestamp the record was last modified in VPAtlas (UTC).';
COMMENT ON COLUMN ogc.mapped_pools."mappedMethod" IS
  'How the pool was identified: Aerial photography, CIR or LiDAR imagery, NDWI, a field Visit or Survey, or previously Known.';
COMMENT ON COLUMN ogc.mapped_pools."mappedLandownerPermission" IS
  'Whether landowner permission to access the pool is on record. 1 = yes, 0 = no. Landowner identity is not published.';
COMMENT ON COLUMN ogc.mapped_pools."mappedLocationUncertainty" IS
  'Positional uncertainty of the mapped coordinates as recorded by the mapper.';
COMMENT ON COLUMN ogc.mapped_pools."mappedPoolStatus" IS
  'Verification status of the pool. Potential means mapped but unvisited; Probable and Confirmed reflect field evidence. Eliminated and Duplicate records are not published.';

-- ── Collection: pool_visits (108 published fields + geom) ────────────────────
DROP VIEW IF EXISTS ogc.pool_visits CASCADE;
CREATE VIEW ogc.pool_visits AS
SELECT
    m."mappedPoolId"                                              AS "poolId",
    (m."mappedPoolStatus")::text                                  AS "poolStatus",
    t."townName"                                                  AS "townName",
    c."countyName"                                                AS "countyName",
    CONCAT('https://vpatlas.org/pools/list?poolId=', m."mappedPoolId", '&zoomFilter=false') AS "vpatlas_pool_url",
    CONCAT('https://vpatlas.org/pools/visit/view/', v."visitId")  AS "vpatlas_visit_url",
    v."visitId"                                                   AS "visitId",
    v."visitPoolId"                                               AS "visitPoolId",
    to_char(v."visitDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')       AS "visitDate",
    (v."visitLocatePool")::int::smallint                          AS "visitLocatePool",
    CASE WHEN v."visitCertainty" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitCertainty", '[\[\]"]', '', 'g')) ELSE v."visitCertainty" END AS "visitCertainty",
    CASE WHEN v."visitNavMethod" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitNavMethod", '[\[\]"]', '', 'g')) ELSE v."visitNavMethod" END AS "visitNavMethod",
    v."visitCoordSource"                                          AS "visitCoordSource",
    v."visitLatitude"                                             AS "visitLatitude",
    v."visitLongitude"                                            AS "visitLongitude",
    CASE WHEN v."visitVernalPool" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitVernalPool", '[\[\]"]', '', 'g')) ELSE v."visitVernalPool" END AS "visitVernalPool",
    CASE WHEN v."visitPoolType" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitPoolType", '[\[\]"]', '', 'g')) ELSE v."visitPoolType" END AS "visitPoolType",
    CASE WHEN v."visitInletType" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitInletType", '[\[\]"]', '', 'g')) ELSE v."visitInletType" END AS "visitInletType",
    CASE WHEN v."visitOutletType" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitOutletType", '[\[\]"]', '', 'g')) ELSE v."visitOutletType" END AS "visitOutletType",
    CASE WHEN v."visitForestUpland" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitForestUpland", '[\[\]"]', '', 'g')) ELSE v."visitForestUpland" END AS "visitForestUpland",
    CASE WHEN v."visitForestCondition" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitForestCondition", '[\[\]"]', '', 'g')) ELSE v."visitForestCondition" END AS "visitForestCondition",
    (v."visitHabitatAgriculture")::int::smallint                  AS "visitHabitatAgriculture",
    (v."visitHabitatLightDev")::int::smallint                     AS "visitHabitatLightDev",
    (v."visitHabitatHeavyDev")::int::smallint                     AS "visitHabitatHeavyDev",
    (v."visitHabitatPavedRd")::int::smallint                      AS "visitHabitatPavedRd",
    (v."visitHabitatDirtRd")::int::smallint                       AS "visitHabitatDirtRd",
    (v."visitHabitatPowerline")::int::smallint                    AS "visitHabitatPowerline",
    v."visitHabitatOther"                                         AS "visitHabitatOther",
    v."visitHabitatComment"                                       AS "visitHabitatComment",
    v."visitMaxDepth"                                             AS "visitMaxDepth",
    CASE WHEN v."visitWaterLevelObs" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitWaterLevelObs", '[\[\]"]', '', 'g')) ELSE v."visitWaterLevelObs" END AS "visitWaterLevelObs",
    CASE WHEN v."visitHydroPeriod" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitHydroPeriod", '[\[\]"]', '', 'g')) ELSE v."visitHydroPeriod" END AS "visitHydroPeriod",
    v."visitMaxWidth"                                             AS "visitMaxWidth",
    v."visitMaxLength"                                            AS "visitMaxLength",
    v."visitPoolTrees"                                            AS "visitPoolTrees",
    v."visitPoolShrubs"                                           AS "visitPoolShrubs",
    v."visitPoolEmergents"                                        AS "visitPoolEmergents",
    v."visitPoolFloatingVeg"                                      AS "visitPoolFloatingVeg",
    CASE WHEN v."visitSubstrate" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitSubstrate", '[\[\]"]', '', 'g')) ELSE v."visitSubstrate" END AS "visitSubstrate",
    (v."visitDisturbDumping")::int::smallint                      AS "visitDisturbDumping",
    (v."visitDisturbSiltation")::int::smallint                    AS "visitDisturbSiltation",
    (v."visitDisturbVehicleRuts")::int::smallint                  AS "visitDisturbVehicleRuts",
    (v."visitDisturbRunoff")::int::smallint                       AS "visitDisturbRunoff",
    (v."visitDisturbDitching")::int::smallint                     AS "visitDisturbDitching",
    v."visitDisturbOther"                                         AS "visitDisturbOther",
    v."visitWoodFrogAdults"                                       AS "visitWoodFrogAdults",
    v."visitWoodFrogLarvae"                                       AS "visitWoodFrogLarvae",
    v."visitWoodFrogEgg"                                          AS "visitWoodFrogEgg",
    CASE WHEN v."visitWoodFrogEggHow" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitWoodFrogEggHow", '[\[\]"]', '', 'g')) ELSE v."visitWoodFrogEggHow" END AS "visitWoodFrogEggHow",
    v."visitSpsAdults"                                            AS "visitSpsAdults",
    v."visitSpsLarvae"                                            AS "visitSpsLarvae",
    v."visitSpsEgg"                                               AS "visitSpsEgg",
    CASE WHEN v."visitSpsEggHow" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitSpsEggHow", '[\[\]"]', '', 'g')) ELSE v."visitSpsEggHow" END AS "visitSpsEggHow",
    v."visitJesaAdults"                                           AS "visitJesaAdults",
    v."visitJesaLarvae"                                           AS "visitJesaLarvae",
    v."visitJesaEgg"                                              AS "visitJesaEgg",
    CASE WHEN v."visitJesaEggHow" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitJesaEggHow", '[\[\]"]', '', 'g')) ELSE v."visitJesaEggHow" END AS "visitJesaEggHow",
    v."visitBssaAdults"                                           AS "visitBssaAdults",
    v."visitBssaLarvae"                                           AS "visitBssaLarvae",
    v."visitBssaEgg"                                              AS "visitBssaEgg",
    CASE WHEN v."visitBssaEggHow" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitBssaEggHow", '[\[\]"]', '', 'g')) ELSE v."visitBssaEggHow" END AS "visitBssaEggHow",
    v."visitFairyShrimp"                                          AS "visitFairyShrimp",
    v."visitFingerNailClams"                                      AS "visitFingerNailClams",
    v."visitSpeciesOther1"                                        AS "visitSpeciesOther1",
    v."visitSpeciesOther2"                                        AS "visitSpeciesOther2",
    (v."visitFish")::int::smallint                                AS "visitFish",
    v."visitFishCount"                                            AS "visitFishCount",
    v."visitFishSizeSmall"                                        AS "visitFishSizeSmall",
    v."visitFishSizeMedium"                                       AS "visitFishSizeMedium",
    v."visitFishSizeLarge"                                        AS "visitFishSizeLarge",
    to_char(v."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')       AS "createdAt",
    to_char(v."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')       AS "updatedAt",
    (v."visitPoolMapped")::int::smallint                          AS "visitPoolMapped",
    (v."visitUserIsLandowner")::int::smallint                     AS "visitUserIsLandowner",
    (v."visitLandownerPermission")::int::smallint                 AS "visitLandownerPermission",
    CASE WHEN v."visitFishSize" ~ '^\s*\[' THEN btrim(regexp_replace(v."visitFishSize", '[\[\]"]', '', 'g')) ELSE v."visitFishSize" END AS "visitFishSize",
    v."visitNavMethodOther"                                       AS "visitNavMethodOther",
    v."visitPoolTypeOther"                                        AS "visitPoolTypeOther",
    v."visitSubstrateOther"                                       AS "visitSubstrateOther",
    v."visitSpeciesOtherName"                                     AS "visitSpeciesOtherName",
    v."visitSpeciesOtherCount"                                    AS "visitSpeciesOtherCount",
    v."visitLocationUncertainty"                                  AS "visitLocationUncertainty",
    v."visitSubmergedVeg"                                         AS "visitSubmergedVeg",
    (v."visitHabitatTrails")::int::smallint                       AS "visitHabitatTrails",
    (v."visitAmphibianDisease")::int::smallint                    AS "visitAmphibianDisease",
    to_char(v."lastEditedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS "lastEditedAt",
    m."mappedPoolId"                                              AS "mappedPoolId",
    to_char(m."mappedDateText", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')  AS "mappedDateText",
    m."mappedLatitude"                                            AS "mappedLatitude",
    m."mappedLongitude"                                           AS "mappedLongitude",
    (m."mappedConfidence")::text                                  AS "mappedConfidence",
    m."mappedSource"                                              AS "mappedSource",
    m."mappedSource2"                                             AS "mappedSource2",
    m."mappedPhotoNumber"                                         AS "mappedPhotoNumber",
    (m."mappedLocationAccuracy")::text                            AS "mappedLocationAccuracy",
    (m."mappedMethod")::text                                      AS "mappedMethod",
    (m."mappedLandownerPermission")::int::smallint                AS "mappedLandownerPermission",
    m."mappedLocationUncertainty"                                 AS "mappedLocationUncertainty",
    (m."mappedPoolStatus")::text                                  AS "mappedPoolStatus",
    r."reviewId"                                                  AS "reviewId",
    r."reviewPoolId"                                              AS "reviewPoolId",
    r."reviewVisitId"                                             AS "reviewVisitId",
    r."reviewQACode"                                              AS "reviewQACode",
    r."reviewQAAlt"                                               AS "reviewQAAlt",
    to_char(r."reviewQADate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')    AS "reviewQADate",
    (r."reviewPoolStatus")::text                                  AS "reviewPoolStatus",
    (r."reviewPoolLocator")::int::smallint                        AS "reviewPoolLocator",
    NULLIF(array_to_string(COALESCE(r."reviewReasons", '{}'::text[]), ', '), '') AS "reviewReasons",
    m."mappedPoolLocation"                                        AS geom
FROM vpvisit v
INNER JOIN vpmapped m ON v."visitPoolId"   = m."mappedPoolId"
LEFT  JOIN vptown   t ON m."mappedTownId"  = t."townId"
LEFT  JOIN vpcounty c ON t."townCountyId"  = c."govCountyId"
LEFT  JOIN vpreview r ON v."visitId"       = r."reviewVisitId"
WHERE m."mappedPoolLocation" IS NOT NULL
  AND (m."mappedPoolStatus" IS NULL
       OR m."mappedPoolStatus" NOT IN ('Eliminated', 'Duplicate'));

COMMENT ON VIEW ogc.pool_visits IS
  'Canonical publication view for pool visits. Generated from _schema/visit.json; do not hand-edit. Feeds /visit/geojson, /visit/shapefile and the OGC API - Features collection identically. Excludes landowner PII, contributor identity and internal system identifiers.';

-- Field descriptions, published by pg_featureserv as each field's description.
COMMENT ON COLUMN ogc.pool_visits."poolId" IS
  'Alias of mappedPoolId, retained for compatibility.';
COMMENT ON COLUMN ogc.pool_visits."poolStatus" IS
  'Alias of mappedPoolStatus, retained for compatibility.';
COMMENT ON COLUMN ogc.pool_visits."townName" IS
  'Town containing the pool.';
COMMENT ON COLUMN ogc.pool_visits."countyName" IS
  'County containing the pool. Stored uppercase.';
COMMENT ON COLUMN ogc.pool_visits."vpatlas_pool_url" IS
  'Deep link to the pool on vpatlas.org.';
COMMENT ON COLUMN ogc.pool_visits."vpatlas_visit_url" IS
  'Deep link to the visit on vpatlas.org.';
COMMENT ON COLUMN ogc.pool_visits."visitId" IS
  'Unique identifier for this visit record.';
COMMENT ON COLUMN ogc.pool_visits."visitPoolId" IS
  'Identifier of the pool visited; joins to mappedPoolId.';
COMMENT ON COLUMN ogc.pool_visits."visitDate" IS
  'Date the pool was visited.';
COMMENT ON COLUMN ogc.pool_visits."visitLocatePool" IS
  'Whether the observer located the pool in the field. 1 = yes, 0 = no; null means not recorded.';
COMMENT ON COLUMN ogc.pool_visits."visitCertainty" IS
  'Observer''s certainty that the feature found was the mapped pool: Certain, Pretty Sure or Not Sure.';
COMMENT ON COLUMN ogc.pool_visits."visitNavMethod" IS
  'How the observer navigated to the pool: GPS, Map, Map and compass, prior knowledge of the site, or other.';
COMMENT ON COLUMN ogc.pool_visits."visitCoordSource" IS
  'Source of the coordinates used to find the pool, often the name of an originating shapefile or GPS.';
COMMENT ON COLUMN ogc.pool_visits."visitLatitude" IS
  'Latitude recorded at the pool during the visit, WGS84 decimal degrees.';
COMMENT ON COLUMN ogc.pool_visits."visitLongitude" IS
  'Longitude recorded at the pool during the visit, WGS84 decimal degrees.';
COMMENT ON COLUMN ogc.pool_visits."visitVernalPool" IS
  'Observer''s determination of whether the feature is a vernal pool: Yes, No or Don''t Know.';
COMMENT ON COLUMN ogc.pool_visits."visitPoolType" IS
  'Landform setting of the pool, such as Isolated Forest Depression, Floodplain Depression, or Manmade.';
COMMENT ON COLUMN ogc.pool_visits."visitInletType" IS
  'Nature of any inflow to the pool: No Inlet, Ephemeral Inlet or Permanent Inlet.';
COMMENT ON COLUMN ogc.pool_visits."visitOutletType" IS
  'Nature of any outflow from the pool: No Outlet, Ephemeral Outlet or Permanent Outlet.';
COMMENT ON COLUMN ogc.pool_visits."visitForestUpland" IS
  'Dominant forest type of the surrounding upland. Hardwood and Deciduous are equivalent, as are Softwood and Coniferous; both spellings persist in the data and each activates the same form control.';
COMMENT ON COLUMN ogc.pool_visits."visitForestCondition" IS
  'Condition of the surrounding forest. Minor logging and Major logging are both represented by the form''s single Recently Logged option; the stored distinction is preserved on edit.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatAgriculture" IS
  'Agricultural land present in the surrounding habitat. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatLightDev" IS
  'Light development present in the surrounding habitat. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatHeavyDev" IS
  'Heavy development present in the surrounding habitat. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatPavedRd" IS
  'Paved road present in the surrounding habitat. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatDirtRd" IS
  'Dirt road present in the surrounding habitat. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatPowerline" IS
  'Powerline corridor present in the surrounding habitat. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatOther" IS
  'Other surrounding habitat feature not covered by the habitat flags.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatComment" IS
  'Observer''s notes on the surrounding habitat. Truncated to 254 characters in the shapefile export.';
COMMENT ON COLUMN ogc.pool_visits."visitMaxDepth" IS
  'Maximum water depth observed. Free text; values range from measurements to descriptive depths such as ''Knee-deep''.';
COMMENT ON COLUMN ogc.pool_visits."visitWaterLevelObs" IS
  'Water level at the time of the visit: Full, More than 50%, Less than 50%, or Dry.';
COMMENT ON COLUMN ogc.pool_visits."visitHydroPeriod" IS
  'How long the pool holds water: Ephemeral, Dries annually, Dries every 5 years, Semi-permanent, Never dries or Permanent.';
COMMENT ON COLUMN ogc.pool_visits."visitMaxWidth" IS
  'Maximum width of the pool, in feet.';
COMMENT ON COLUMN ogc.pool_visits."visitMaxLength" IS
  'Maximum length of the pool, in feet.';
COMMENT ON COLUMN ogc.pool_visits."visitPoolTrees" IS
  'Percent of the pool shaded or occupied by trees, 0-100.';
COMMENT ON COLUMN ogc.pool_visits."visitPoolShrubs" IS
  'Percent of the pool occupied by shrubs, 0-100.';
COMMENT ON COLUMN ogc.pool_visits."visitPoolEmergents" IS
  'Percent of the pool occupied by emergent vegetation, 0-100.';
COMMENT ON COLUMN ogc.pool_visits."visitPoolFloatingVeg" IS
  'Percent of the pool occupied by floating vegetation, 0-100.';
COMMENT ON COLUMN ogc.pool_visits."visitSubstrate" IS
  'Dominant pool substrate: Leaf litter, Mud, Sand/Gravel, Bedrock or Other.';
COMMENT ON COLUMN ogc.pool_visits."visitDisturbDumping" IS
  'Evidence of dumping at the pool. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitDisturbSiltation" IS
  'Evidence of siltation at the pool. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitDisturbVehicleRuts" IS
  'Evidence of vehicle ruts at the pool. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitDisturbRunoff" IS
  'Evidence of runoff affecting the pool. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitDisturbDitching" IS
  'Evidence of ditching at or near the pool. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitDisturbOther" IS
  'Other disturbance observed, not covered by the disturbance flags.';
COMMENT ON COLUMN ogc.pool_visits."visitWoodFrogAdults" IS
  'Count of adult wood frogs (Lithobates sylvaticus) observed.';
COMMENT ON COLUMN ogc.pool_visits."visitWoodFrogLarvae" IS
  'Count of wood frog larvae observed.';
COMMENT ON COLUMN ogc.pool_visits."visitWoodFrogEgg" IS
  'Count of wood frog egg masses observed. A primary vernal pool indicator.';
COMMENT ON COLUMN ogc.pool_visits."visitWoodFrogEggHow" IS
  'Whether the wood frog egg mass count was Counted or Estimated.';
COMMENT ON COLUMN ogc.pool_visits."visitSpsAdults" IS
  'Count of adult spotted salamanders (Ambystoma maculatum) observed.';
COMMENT ON COLUMN ogc.pool_visits."visitSpsLarvae" IS
  'Count of spotted salamander larvae observed.';
COMMENT ON COLUMN ogc.pool_visits."visitSpsEgg" IS
  'Count of spotted salamander egg masses observed. A primary vernal pool indicator.';
COMMENT ON COLUMN ogc.pool_visits."visitSpsEggHow" IS
  'Whether the spotted salamander egg mass count was Counted or Estimated.';
COMMENT ON COLUMN ogc.pool_visits."visitJesaAdults" IS
  'Count of adult Jefferson salamanders (Ambystoma jeffersonianum) observed.';
COMMENT ON COLUMN ogc.pool_visits."visitJesaLarvae" IS
  'Count of Jefferson salamander larvae observed.';
COMMENT ON COLUMN ogc.pool_visits."visitJesaEgg" IS
  'Count of Jefferson salamander egg masses observed. A primary vernal pool indicator.';
COMMENT ON COLUMN ogc.pool_visits."visitJesaEggHow" IS
  'Whether the Jefferson salamander egg mass count was Counted or Estimated.';
COMMENT ON COLUMN ogc.pool_visits."visitBssaAdults" IS
  'Count of adult blue-spotted salamanders (Ambystoma laterale) observed.';
COMMENT ON COLUMN ogc.pool_visits."visitBssaLarvae" IS
  'Count of blue-spotted salamander larvae observed.';
COMMENT ON COLUMN ogc.pool_visits."visitBssaEgg" IS
  'Count of blue-spotted salamander egg masses observed. A primary vernal pool indicator.';
COMMENT ON COLUMN ogc.pool_visits."visitBssaEggHow" IS
  'Whether the blue-spotted salamander egg mass count was Counted or Estimated.';
COMMENT ON COLUMN ogc.pool_visits."visitFairyShrimp" IS
  'Count of fairy shrimp (Anostraca) observed. A primary vernal pool indicator.';
COMMENT ON COLUMN ogc.pool_visits."visitFingerNailClams" IS
  'Count of fingernail clams (Sphaeriidae) observed. A secondary vernal pool indicator.';
COMMENT ON COLUMN ogc.pool_visits."visitSpeciesOther1" IS
  'Additional species observed at the pool.';
COMMENT ON COLUMN ogc.pool_visits."visitSpeciesOther2" IS
  'Further additional species observed at the pool.';
COMMENT ON COLUMN ogc.pool_visits."visitFish" IS
  'Fish observed in the pool. 1 = yes, 0 = no. Fish presence generally disqualifies a pool as vernal habitat.';
COMMENT ON COLUMN ogc.pool_visits."visitFishCount" IS
  'Number of fish observed. Free text; may hold a count or a descriptive abundance.';
COMMENT ON COLUMN ogc.pool_visits."visitFishSizeSmall" IS
  'Fish abundance recorded for the small size class. Sparsely recorded.';
COMMENT ON COLUMN ogc.pool_visits."visitFishSizeMedium" IS
  'Fish abundance recorded for the medium size class. Sparsely recorded.';
COMMENT ON COLUMN ogc.pool_visits."visitFishSizeLarge" IS
  'Fish abundance recorded for the large size class. Sparsely recorded.';
COMMENT ON COLUMN ogc.pool_visits."createdAt" IS
  'Timestamp the visit record was created in VPAtlas (UTC).';
COMMENT ON COLUMN ogc.pool_visits."updatedAt" IS
  'Timestamp the visit record was last modified in VPAtlas (UTC).';
COMMENT ON COLUMN ogc.pool_visits."visitPoolMapped" IS
  'Whether the pool had already been mapped before this visit. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitUserIsLandowner" IS
  'Whether the observer was the landowner. 1 = yes, 0 = no. Observer identity is not published.';
COMMENT ON COLUMN ogc.pool_visits."visitLandownerPermission" IS
  'Whether landowner permission for this visit is on record. 1 = yes, 0 = no. Landowner identity is not published.';
COMMENT ON COLUMN ogc.pool_visits."visitFishSize" IS
  'Size class of fish observed: Small, Medium or Large.';
COMMENT ON COLUMN ogc.pool_visits."visitNavMethodOther" IS
  'Navigation method, where visitNavMethod is Other.';
COMMENT ON COLUMN ogc.pool_visits."visitPoolTypeOther" IS
  'Pool type, where visitPoolType is Other.';
COMMENT ON COLUMN ogc.pool_visits."visitSubstrateOther" IS
  'Substrate, where visitSubstrate is Other.';
COMMENT ON COLUMN ogc.pool_visits."visitSpeciesOtherName" IS
  'Name of the additional species recorded in visitSpeciesOtherCount.';
COMMENT ON COLUMN ogc.pool_visits."visitSpeciesOtherCount" IS
  'Count of the additional species named in visitSpeciesOtherName.';
COMMENT ON COLUMN ogc.pool_visits."visitLocationUncertainty" IS
  'Positional uncertainty of the visit coordinates as recorded by the observer.';
COMMENT ON COLUMN ogc.pool_visits."visitSubmergedVeg" IS
  'Percent of the pool occupied by submerged vegetation, 0-100.';
COMMENT ON COLUMN ogc.pool_visits."visitHabitatTrails" IS
  'Trails present in the surrounding habitat. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."visitAmphibianDisease" IS
  'Signs of amphibian disease observed. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."lastEditedAt" IS
  'Timestamp the visit record was last edited (UTC).';
COMMENT ON COLUMN ogc.pool_visits."mappedPoolId" IS
  'Unique VPAtlas identifier for the pool. Identifiers prefixed NEW were assigned by the atlas; others carry the identifier from the source dataset.';
COMMENT ON COLUMN ogc.pool_visits."mappedDateText" IS
  'Date the pool was mapped or first entered into the atlas.';
COMMENT ON COLUMN ogc.pool_visits."mappedLatitude" IS
  'Latitude of the mapped pool centre, WGS84 decimal degrees.';
COMMENT ON COLUMN ogc.pool_visits."mappedLongitude" IS
  'Longitude of the mapped pool centre, WGS84 decimal degrees.';
COMMENT ON COLUMN ogc.pool_visits."mappedConfidence" IS
  'Mapper''s confidence that the mapped feature is a vernal pool, from L (low) through H (high). UNK where not assessed.';
COMMENT ON COLUMN ogc.pool_visits."mappedSource" IS
  'Dataset, project or organisation the pool record originated from.';
COMMENT ON COLUMN ogc.pool_visits."mappedSource2" IS
  'Secondary source, where the record was corroborated by or merged from more than one origin.';
COMMENT ON COLUMN ogc.pool_visits."mappedPhotoNumber" IS
  'Reference number of the photograph taken of the pool, where one exists.';
COMMENT ON COLUMN ogc.pool_visits."mappedLocationAccuracy" IS
  'Confidence in the positional accuracy of the mapped coordinates, from L (low) through H (high). UNK where not assessed.';
COMMENT ON COLUMN ogc.pool_visits."mappedMethod" IS
  'How the pool was identified: Aerial photography, CIR or LiDAR imagery, NDWI, a field Visit or Survey, or previously Known.';
COMMENT ON COLUMN ogc.pool_visits."mappedLandownerPermission" IS
  'Whether landowner permission to access the pool is on record. 1 = yes, 0 = no. Landowner identity is not published.';
COMMENT ON COLUMN ogc.pool_visits."mappedLocationUncertainty" IS
  'Positional uncertainty of the mapped coordinates as recorded by the mapper.';
COMMENT ON COLUMN ogc.pool_visits."mappedPoolStatus" IS
  'Verification status of the pool. Potential means mapped but unvisited; Probable and Confirmed reflect field evidence. Eliminated and Duplicate records are not published.';
COMMENT ON COLUMN ogc.pool_visits."reviewId" IS
  'Unique identifier for the quality-assurance review of this visit, where one exists.';
COMMENT ON COLUMN ogc.pool_visits."reviewPoolId" IS
  'Identifier of the pool the review applies to.';
COMMENT ON COLUMN ogc.pool_visits."reviewVisitId" IS
  'Identifier of the visit the review applies to.';
COMMENT ON COLUMN ogc.pool_visits."reviewQACode" IS
  'Quality-assurance outcome code assigned by the reviewer.';
COMMENT ON COLUMN ogc.pool_visits."reviewQAAlt" IS
  'Alternate quality-assurance code, where the reviewer recorded one.';
COMMENT ON COLUMN ogc.pool_visits."reviewQADate" IS
  'Date the quality-assurance review was completed.';
COMMENT ON COLUMN ogc.pool_visits."reviewPoolStatus" IS
  'Pool status assigned by the reviewer, which may differ from the status recorded at the visit.';
COMMENT ON COLUMN ogc.pool_visits."reviewPoolLocator" IS
  'Whether the reviewer could locate the pool from the visit record. 1 = yes, 0 = no.';
COMMENT ON COLUMN ogc.pool_visits."reviewReasons" IS
  'Reasons recorded by the reviewer for the assigned status, as a comma-delimited list.';

GRANT USAGE  ON SCHEMA ogc       TO pgfs_reader;
GRANT SELECT ON ogc.mapped_pools TO pgfs_reader;
GRANT SELECT ON ogc.pool_visits  TO pgfs_reader;
