-- 018_review_pool_locator_updates_lat_lon.sql
--
-- When a reviewer ticks the "Pool Locator" box and saves a review, the
-- existing trigger set_vpmapped_geolocation_from_vpvisit_coordinates()
-- ALREADY updated vpmapped.mappedPoolLocation (the PostGIS geometry
-- column) — but the UI reads the scalar mappedLatitude / mappedLongitude
-- columns, which were left stale. As a result the map continued to show
-- the old pool location even though the geometry column was correct.
--
-- This migration replaces the trigger function so it also writes the
-- scalar lat/lon, keeping the three columns in sync. Same gate
-- (reviewPoolLocator must be true), same pseudo-uniqueness clear of any
-- other review of the same pool. The function is attached to the same
-- triggers (trigger_after_insert_set_vpmapped_pool_location,
-- trigger_after_update_set_vpmapped_pool_location), so CREATE OR
-- REPLACE is enough — no trigger DROP/CREATE needed.

CREATE OR REPLACE FUNCTION set_vpmapped_geolocation_from_vpvisit_coordinates()
RETURNS trigger AS $$
DECLARE
    visit record;
BEGIN
    IF NEW."reviewPoolLocator" THEN
        SELECT * FROM vpvisit WHERE "visitId"=NEW."reviewVisitId" INTO visit;
        RAISE NOTICE 'set_vpmapped_geolocation_from_vpvisit_coordinates() | Set geoLocation from vpvisit lat/lon for reviewId:% | visitId:% | poolId:% | lat:% | lon:%',
            NEW."reviewId", NEW."reviewVisitId", NEW."reviewPoolId", visit."visitLatitude", visit."visitLongitude";
        UPDATE vpmapped SET
            "mappedPoolLocation" = ST_GEOMFROMTEXT('POINT(' || visit."visitLongitude" || ' ' || visit."visitLatitude" || ')', 4326),
            "mappedLatitude"     = visit."visitLatitude",
            "mappedLongitude"    = visit."visitLongitude"
            WHERE "mappedPoolId"=NEW."reviewPoolId";
        -- Only allow a single Visit's Review's Pool Locator flag to be set at once (pseudo-uniqueness)
        UPDATE vpreview SET "reviewPoolLocator"=false
            WHERE "reviewPoolId"=NEW."reviewPoolId" AND "reviewVisitId"!=NEW."reviewVisitId";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
