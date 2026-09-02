-- =============================================================================
-- 021_set_pgfs_reader_password.sql
-- =============================================================================
-- Sets the pgfs_reader login password from the PGFS_PASSWORD environment
-- variable, so a prod deploy is self-contained.
--
-- WHY THIS EXISTS
--   Migration 019 creates pgfs_reader with a dev-only password, because
--   migrations are committed to git and must never carry a real secret. But the
--   ogc_vp container connects using PGFS_PASSWORD from the environment. Without
--   this step those two disagree on prod, pg_featureserv fails authentication,
--   and the container restart-loops after an otherwise successful deploy --
--   with the deploy reporting success.
--
--   psql \getenv (PostgreSQL 16+; this stack runs 17.5) reads the value at
--   migration time. docker-compose passes PGFS_PASSWORD into db_migrate_vp,
--   defaulting to the dev password locally and required (:?) on prod.
--
-- ROTATION
--   This migration runs ONCE, tracked by filename in schema_migrations. Changing
--   PGFS_PASSWORD later does NOT re-run it -- rotate manually with:
--       ALTER ROLE pgfs_reader PASSWORD '<new value>';
--   and update the prod .env in the same change.
--
-- The \if guard keeps the migration safe when run outside docker-compose (e.g.
-- a manual psql run with no PGFS_PASSWORD in the environment): it leaves the
-- existing password alone rather than erroring out under ON_ERROR_STOP=1.
-- =============================================================================

\getenv pgfs_pw PGFS_PASSWORD

\if :{?pgfs_pw}
    ALTER ROLE pgfs_reader PASSWORD :'pgfs_pw';
    \echo '021: pgfs_reader password set from PGFS_PASSWORD'
\else
    \echo '021: PGFS_PASSWORD not set in environment - leaving pgfs_reader password unchanged'
\endif
