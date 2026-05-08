-- 010_add_vpvisit_photos.sql
-- Visit photo metadata. The actual files live on disk under /opt/api/photos
-- (or S3-style storage in the future); this table holds the {visitId, species,
-- url} tuples so /pools/visit/:id/photos can list them and so the visits
-- query can return a per-row photoCount badge in the visit list.
--
-- Migration is idempotent: existing dev/prod databases that already have the
-- table from an older dump will see no-ops here.

CREATE TABLE IF NOT EXISTS vpvisit_photos (
    "visitPhotoVisitId" INTEGER NOT NULL REFERENCES vpvisit("visitId") ON DELETE CASCADE,
    "visitPhotoSpecies" TEXT NOT NULL,
    "visitPhotoUrl"     TEXT NOT NULL,
    "visitPhotoName"    TEXT,
    CONSTRAINT vpvisit_photos_unique_visitId_species_url
        UNIQUE ("visitPhotoVisitId", "visitPhotoSpecies", "visitPhotoUrl")
);

CREATE INDEX IF NOT EXISTS idx_vpvisit_photos_visitId
    ON vpvisit_photos ("visitPhotoVisitId");
