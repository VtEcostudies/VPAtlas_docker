#!/bin/bash
set -e

# =============================================================================
# db_restore.sh - VPAtlas Database Restore Script
#
# Restores a compressed SQL dump (.sql.gz produced by db_backup.sh) into the
# target database. Mirrors LoonWeb's db_dump_restore/db_restore.sh.
#
# Usage:
#   ./db_restore.sh <state> <dumpfile>
#
# Arguments:
#   state:    vp  (single state — VPAtlas is one DB)
#   dumpfile: Path to .sql.gz file (relative to repo root or absolute)
#
# Examples:
#   ./db_restore.sh vp db_backup/vpatlas_vp_complete_20260520.sql.gz
#   ./db_restore.sh vp db_backup/vpatlas_vp_partial_20260520.sql.gz
#
# After a complete restore, re-apply any newer migrations:
#   docker compose -f docker-compose-vpatlas.yml up db_migrate_vp
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/config.sh"

# ----- ARGUMENTS -----
STATE=$1
DUMPFILE=$2

# ----- VALIDATION -----
if [ -z "$STATE" ] || [ -z "$DUMPFILE" ]; then
    echo "Usage: ./db_restore.sh <state> <dumpfile>"
    echo ""
    echo "States: $(list_states | tr '\n' ' ')"
    echo ""
    echo "Available dumps:"
    find "${DEPLOY_DIR}" -maxdepth 1 -name "*.sql.gz" 2>/dev/null | sort -r | head -10 | while read -r f; do
        echo "  ${f#${REPO_ROOT}/}"
    done
    exit 1
fi

if ! is_valid_state "$STATE"; then
    echo "ERROR: Invalid state '${STATE}'"
    echo "Valid states: $(list_states | tr '\n' ' ')"
    exit 1
fi

# Handle relative paths — resolve against repo root, not script dir, so
# `db_backup/<file>.sql.gz` works the same way the user types it.
if [[ ! "$DUMPFILE" = /* ]]; then
    DUMPFILE="${REPO_ROOT}/${DUMPFILE}"
fi

if [ ! -f "$DUMPFILE" ]; then
    echo "ERROR: Dump file not found: ${DUMPFILE}"
    echo ""
    echo "Available dumps:"
    find "${DEPLOY_DIR}" -maxdepth 1 -name "*.sql.gz" 2>/dev/null | sort -r | head -10 | while read -r f; do
        echo "  ${f#${REPO_ROOT}/}"
    done
    exit 1
fi

# ----- CONFIGURATION -----
CONTAINER=$(get_container "$STATE")
DATABASE=$(get_database "$STATE")

# ----- PREFLIGHT -----
echo "=============================================="
echo "VPAtlas Database Restore"
echo "=============================================="
echo "State:     ${STATE}"
echo "Container: ${CONTAINER}"
echo "Database:  ${DATABASE}"
echo "Source:    ${DUMPFILE}"
echo "Size:      $(ls -lh "${DUMPFILE}" | awk '{print $5}')"
echo ""

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "ERROR: Container '${CONTAINER}' is not running"
    echo "Start with: docker compose -f docker-compose-vpatlas.yml up -d ${CONTAINER}"
    exit 1
fi

# Wait for PostgreSQL to be ready
echo "--- Waiting for PostgreSQL ---"
for i in {1..30}; do
    if docker exec "${CONTAINER}" pg_isready -U "${DB_USER}" -q 2>/dev/null; then
        echo "PostgreSQL is ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: PostgreSQL not ready after 30 seconds"
        exit 1
    fi
    echo "  Waiting... ($i/30)"
    sleep 1
done

# =============================================================================
# CONFIRMATION
# =============================================================================
echo ""
echo "WARNING: This will REPLACE all data in ${DATABASE}."
echo ""
read -p "Continue? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# =============================================================================
# STEP 1: Check/Create database
# =============================================================================
echo ""
echo "--- [1/4] Checking database ---"

DB_EXISTS=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DATABASE}'" 2>/dev/null || echo "0")

if [ "${DB_EXISTS}" = "1" ]; then
    echo "  Database '${DATABASE}' exists."
    read -p "  Drop and recreate? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "  Terminating connections..."
        docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -c \
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DATABASE}' AND pid <> pg_backend_pid();" \
            >/dev/null 2>&1 || true

        echo "  Dropping database..."
        docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -c \
            "DROP DATABASE IF EXISTS ${DATABASE};" >/dev/null

        echo "  Creating database..."
        docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -c \
            "CREATE DATABASE ${DATABASE};" >/dev/null
    else
        echo "  Keeping existing database (restore may show errors for existing objects)"
    fi
else
    echo "  Creating database '${DATABASE}'..."
    docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres -c \
        "CREATE DATABASE ${DATABASE};" >/dev/null
fi

echo "Database ready"

# =============================================================================
# STEP 2: Enable PostGIS
# =============================================================================
echo ""
echo "--- [2/4] Enabling PostGIS ---"

docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DATABASE}" >/dev/null 2>&1 <<EOF
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
EOF

echo "PostGIS enabled"

# =============================================================================
# STEP 3: Restore dump
# =============================================================================
echo ""
echo "--- [3/4] Restoring data ---"
echo "  (This may take a while and show some warnings — that's normal)"

# Decompress and pipe to psql. ON_ERROR_STOP=0 so that benign "already exists"
# notices on extensions/roles don't abort the whole restore.
gunzip -c "${DUMPFILE}" | docker exec -i "${CONTAINER}" psql \
    -U "${DB_USER}" \
    -d "${DATABASE}" \
    -v ON_ERROR_STOP=0 \
    2>&1 | grep -E "(ERROR|FATAL)" | grep -v "already exists" | head -20 || true

echo "Data restored"

# =============================================================================
# STEP 4: Apply settings (no-op for VPAtlas — default search_path is fine)
# =============================================================================
echo ""
echo "--- [4/4] Applying settings ---"
echo "(VPAtlas uses default search_path; nothing to apply)"

# =============================================================================
# VERIFICATION
# =============================================================================
echo ""
echo "=============================================="
echo "VERIFICATION"
echo "=============================================="

echo ""
echo "Schemas:"
docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DATABASE}" -c \
    "SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT LIKE 'pg_%'
       AND schema_name NOT IN ('information_schema', 'tiger', 'tiger_data', 'topology')
     ORDER BY schema_name;"

echo ""
echo "Table count (public):"
docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DATABASE}" -c \
    "SELECT COUNT(*) AS tables FROM pg_tables WHERE schemaname = 'public';"

echo ""
echo "Row counts (top 15 tables):"
docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DATABASE}" -c \
    "SELECT schemaname || '.' || relname AS table_name,
            n_live_tup AS row_count
     FROM pg_stat_user_tables
     WHERE schemaname = 'public'
     ORDER BY n_live_tup DESC
     LIMIT 15;"

echo ""
echo "=============================================="
echo "Restore complete"
echo "=============================================="
echo ""
echo "Database:  ${DATABASE}"
echo "Container: ${CONTAINER}"
echo ""
echo "Next step — re-apply any migrations added after this dump was taken:"
echo "  docker compose -f docker-compose-vpatlas.yml up db_migrate_vp"
