-- 009_add_vptrack.sql
-- Per-user GPS breadcrumb tracks recorded in PoolFinder. Tracks are stored
-- locally in IndexedDB while recording and uploaded on demand from the
-- "My Visits and Tracks" page (no automatic background sync).
--
-- Visibility: a user sees their own tracks; admins see all tracks. Tracks
-- are never public — see api_vp/vpTrack/* for enforcement.

CREATE TABLE IF NOT EXISTS vptrack (
    "trackId"     SERIAL PRIMARY KEY,
    "userId"      INTEGER NOT NULL REFERENCES vpuser(id) ON DELETE CASCADE,
    "name"        TEXT,
    "notes"       TEXT,
    "startedAt"   TIMESTAMP NOT NULL,
    "endedAt"     TIMESTAMP NOT NULL,
    "pointCount"  INTEGER NOT NULL DEFAULT 0,
    "lengthM"     DOUBLE PRECISION,
    -- LINESTRING with M values; XY = lng/lat (SRID 4326), M = epoch ms.
    -- Elevation, when present, is stored on a per-point basis in geomZ
    -- below. We keep both: geom (2D for spatial queries) and geomZ
    -- (3D when the device reported elevation).
    "geom"        GEOMETRY(LineString, 4326) NOT NULL,
    "geomZ"       GEOMETRY(LineStringZ, 4326),
    "uploadedAt"  TIMESTAMP NOT NULL DEFAULT now(),
    "createdAt"   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vptrack_userId_startedAt
    ON vptrack ("userId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_vptrack_geom
    ON vptrack USING GIST ("geom");
