-- =============================================================================
-- 019_add_ogc_features_views.sql
-- =============================================================================
-- Support for serving VPAtlas data to ArcGIS Online (and any other OGC client)
-- as a live OGC API - Features service via pg_featureserv (container ogc_vp).
--
-- WHY THIS EXISTS
--   AGOL cannot consume our REST API as a live data source -- it can only
--   ingest uploaded files, or *reference* a service that speaks ArcGIS REST
--   FeatureServer or OGC API - Features. This schema is the OGC option: it
--   lets AGOL read through to Postgres on every draw, so there is no copy in
--   AGOL to keep in sync and no scheduled overwrite to babysit.
--
-- SECURITY MODEL -- read this before adding a column
--   pg_featureserv publishes EVERY relation its database role can SELECT, on a
--   PUBLIC, UNAUTHENTICATED endpoint. Two independent controls keep that safe:
--
--     1. Curated views, columns listed ONE BY ONE. Never `SELECT *`. vpmapped
--        carries landowner PII (mappedLandownerName / Address / Phone / Email /
--        Zip5) and free-text columns that can contain it (mappedComments,
--        mappedlocationInfoDirections). A `SELECT *` here would publish all of
--        it to the open internet the moment someone adds a column.
--     2. A least-privilege role. pgfs_reader gets USAGE on this schema and
--        SELECT on these views ONLY -- never on public.* base tables. Views run
--        with the view owner's rights, so the role never needs base-table
--        access. If pg_featureserv is ever misconfigured, the role still cannot
--        see anything but what is listed below.
--
--   Adding a column to a view here publishes it publicly. Treat it as such.
--
-- NOTES
--   - Geometry: pg_featureserv inherits a view's spatial metadata only when the
--     view uses an underlying table's geometry column DIRECTLY (no function
--     wrapper). "mappedPoolLocation" is geometry(Geometry,4326) and is selected
--     as-is, so type and SRID are inherited. 4326 is also exactly the CRS84
--     that OGC API - Features Core requires by default -- no reprojection.
--   - Feature id: pg_featureserv uses a relation's PRIMARY KEY as the feature
--     id, and a plain view has none. /collections/{id}/items works regardless;
--     /items/{featureId} may not. Verified behaviour is recorded in the
--     changelog rather than assumed here.
--   - Status filter mirrors the public /mapped/geojson route, which hides
--     Eliminated and Duplicate pools from non-admin callers.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS ogc;
COMMENT ON SCHEMA ogc IS
  'Curated, public-safe views published as OGC API - Features collections by the ogc_vp (pg_featureserv) container. Column lists are deliberate: anything added here becomes publicly readable without authentication.';

-- ── Collection: mapped pools ────────────────────────────────────────────────
DROP VIEW IF EXISTS ogc.mapped_pools;
CREATE VIEW ogc.mapped_pools AS
SELECT
    m."mappedPoolId"                                    AS pool_id,
    m."mappedPoolStatus"                                AS pool_status,
    t."townName"                                        AS town_name,
    c."countyName"                                      AS county_name,
    m."mappedDateText"                                  AS mapped_date,
    m."mappedSource"                                    AS mapped_source,
    m."mappedMethod"                                    AS mapped_method,
    m."mappedConfidence"                                AS mapped_confidence,
    m."mappedLocationAccuracy"                          AS location_accuracy,
    m."mappedLocationUncertainty"                       AS location_uncertainty,
    m."createdAt"                                       AS created_at,
    m."updatedAt"                                       AS updated_at,
    CONCAT('https://vpatlas.org/pools/list?poolId=',
           m."mappedPoolId", '&zoomFilter=false')       AS pool_url,
    m."mappedPoolLocation"                              AS geom
FROM vpmapped m
LEFT JOIN vptown   t ON m."mappedTownId"  = t."townId"
LEFT JOIN vpcounty c ON t."townCountyId"  = c."govCountyId"
WHERE m."mappedPoolLocation" IS NOT NULL
  AND (m."mappedPoolStatus" IS NULL
       OR m."mappedPoolStatus" NOT IN ('Eliminated', 'Duplicate'));

COMMENT ON VIEW ogc.mapped_pools IS
  'Public OGC API - Features collection of mapped vernal pools. Excludes Eliminated/Duplicate pools and all landowner PII and free-text columns.';

-- ── Least-privilege role for pg_featureserv ─────────────────────────────────
-- Dev password matches this repo's dev convention (postgres/postgres in
-- docker-compose-vpatlas.yml). PROD MUST override it:
--     ALTER ROLE pgfs_reader PASSWORD '<value of PGFS_PASSWORD in prod .env>';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgfs_reader') THEN
        CREATE ROLE pgfs_reader LOGIN PASSWORD 'pgfs_dev_only';
    END IF;
END
$$;

-- Explicit, even though none of this is granted by default: states the intent
-- so a later blanket GRANT in another migration reads as the anomaly it is.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pgfs_reader;

GRANT USAGE  ON SCHEMA ogc            TO pgfs_reader;
GRANT SELECT ON ogc.mapped_pools      TO pgfs_reader;
