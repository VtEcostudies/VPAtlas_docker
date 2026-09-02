-- =============================================================================
-- 020_add_ogc_pool_visits_view.sql
-- =============================================================================
-- Second OGC API - Features collection: pool visits. See migration 019 for the
-- schema's purpose and security model -- read that first.
--
-- ADDING A FURTHER COLLECTION LATER (vpsurvey, vpreview)
--   1. CREATE VIEW ogc.<name> AS SELECT <columns listed one by one> ... ;
--      It MUST expose a geometry column taken DIRECTLY from a base table (no
--      function wrapper), or pg_featureserv cannot infer type + SRID and will
--      skip the view. vpvisit/vpsurvey/vpreview have no geometry of their own,
--      so join vpmapped and select "mappedPoolLocation" as-is, exactly as this
--      view does.
--   2. Nothing else. The ALTER DEFAULT PRIVILEGES below grants SELECT to
--      pgfs_reader automatically for any view later created in this schema by
--      the migration role, and pg_featureserv discovers it on restart.
--   3. Restart the ogc_vp container so it re-reads the catalog.
--
-- NEVER use SELECT * in this schema. These views are served publicly and
-- unauthenticated; a `*` would publish whatever column someone adds next.
-- Deliberately excluded here: visitLandowner (JSONB, contains landowner name
-- and email), visitUserIsLandowner, visitLandownerPermission, the visiting
-- user's identity columns, and visitDirections / visitLocationComments, which
-- describe physical access routes across private land.
-- =============================================================================

-- Future views in this schema are granted to pgfs_reader automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA ogc GRANT SELECT ON TABLES TO pgfs_reader;

-- ── Collection: pool visits ─────────────────────────────────────────────────
DROP VIEW IF EXISTS ogc.pool_visits;
CREATE VIEW ogc.pool_visits AS
SELECT
    v."visitId"                                         AS visit_id,
    v."visitPoolId"                                     AS pool_id,
    m."mappedPoolStatus"                                AS pool_status,
    t."townName"                                        AS town_name,
    c."countyName"                                      AS county_name,
    v."visitDate"                                       AS visit_date,

    -- Field verification
    v."visitLocatePool"                                 AS locate_pool,
    v."visitCertainty"                                  AS certainty,
    v."visitVernalPool"                                 AS is_vernal_pool,
    v."visitPoolType"                                   AS pool_type,
    v."visitInletType"                                  AS inlet_type,
    v."visitOutletType"                                 AS outlet_type,
    v."visitForestUpland"                               AS forest_upland,
    v."visitForestCondition"                            AS forest_condition,

    -- Surrounding habitat
    v."visitHabitatAgriculture"                         AS habitat_agriculture,
    v."visitHabitatLightDev"                            AS habitat_light_dev,
    v."visitHabitatHeavyDev"                            AS habitat_heavy_dev,
    v."visitHabitatPavedRd"                             AS habitat_paved_road,
    v."visitHabitatDirtRd"                              AS habitat_dirt_road,
    v."visitHabitatPowerline"                           AS habitat_powerline,
    v."visitHabitatTrails"                              AS habitat_trails,
    v."visitHabitatOther"                               AS habitat_other,

    -- Pool characteristics
    v."visitMaxDepth"                                   AS max_depth,
    v."visitMaxWidth"                                   AS max_width,
    v."visitMaxLength"                                  AS max_length,
    v."visitWaterLevelObs"                              AS water_level_observed,
    v."visitHydroPeriod"                                AS hydroperiod,
    v."visitPoolTrees"                                  AS pool_trees,
    v."visitPoolShrubs"                                 AS pool_shrubs,
    v."visitPoolEmergents"                              AS pool_emergents,
    v."visitPoolFloatingVeg"                            AS pool_floating_veg,
    v."visitSubstrate"                                  AS substrate,

    -- Disturbance
    v."visitDisturbDumping"                             AS disturb_dumping,
    v."visitDisturbSiltation"                           AS disturb_siltation,
    v."visitDisturbVehicleRuts"                         AS disturb_vehicle_ruts,
    v."visitDisturbRunoff"                              AS disturb_runoff,
    v."visitDisturbDitching"                            AS disturb_ditching,
    v."visitDisturbOther"                               AS disturb_other,

    -- Indicator species
    v."visitWoodFrogAdults"                             AS wood_frog_adults,
    v."visitWoodFrogLarvae"                             AS wood_frog_larvae,
    v."visitWoodFrogEgg"                                AS wood_frog_egg,
    v."visitSpsAdults"                                  AS spotted_sal_adults,
    v."visitSpsLarvae"                                  AS spotted_sal_larvae,
    v."visitSpsEgg"                                     AS spotted_sal_egg,
    v."visitJesaAdults"                                 AS jefferson_sal_adults,
    v."visitJesaLarvae"                                 AS jefferson_sal_larvae,
    v."visitJesaEgg"                                    AS jefferson_sal_egg,
    v."visitBssaAdults"                                 AS bluespot_sal_adults,
    v."visitBssaLarvae"                                 AS bluespot_sal_larvae,
    v."visitBssaEgg"                                    AS bluespot_sal_egg,
    v."visitFairyShrimp"                                AS fairy_shrimp,
    v."visitFingerNailClams"                            AS fingernail_clams,
    v."visitSpeciesOtherName"                           AS species_other_name,
    v."visitSpeciesOtherCount"                          AS species_other_count,
    v."visitFish"                                       AS fish,
    v."visitFishCount"                                  AS fish_count,
    v."visitFishSize"                                   AS fish_size,
    v."visitAmphibianDisease"                           AS amphibian_disease,

    v."createdAt"                                       AS created_at,
    v."updatedAt"                                       AS updated_at,
    v."lastEditedAt"                                    AS last_edited_at,

    CONCAT('https://vpatlas.org/pools/list?poolId=',
           v."visitPoolId", '&zoomFilter=false')        AS pool_url,
    CONCAT('https://vpatlas.org/pools/visit/view/',
           v."visitId")                                 AS visit_url,

    -- Geometry comes from the pool, taken directly so type + SRID (4326) are
    -- inherited. Visits carry no geometry column of their own.
    m."mappedPoolLocation"                              AS geom
FROM vpvisit v
INNER JOIN vpmapped  m ON v."visitPoolId"  = m."mappedPoolId"
LEFT  JOIN vptown    t ON m."mappedTownId" = t."townId"
LEFT  JOIN vpcounty  c ON t."townCountyId" = c."govCountyId"
WHERE m."mappedPoolLocation" IS NOT NULL
  AND (m."mappedPoolStatus" IS NULL
       OR m."mappedPoolStatus" NOT IN ('Eliminated', 'Duplicate'));

COMMENT ON VIEW ogc.pool_visits IS
  'Public OGC API - Features collection of pool visits, located at their pool. Excludes landowner data, visitor identity, and access directions.';

GRANT SELECT ON ogc.pool_visits TO pgfs_reader;
