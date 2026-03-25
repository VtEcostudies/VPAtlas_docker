#!/bin/bash
# db_restore.sh - Restore VPAtlas database from backup into Docker container
#
# Usage: ./db_restore.sh [path/to/vpatlas.backup]
#
# Prerequisites: db_vp container must be running (docker compose up db_vp)

if [ -n "$1" ]; then
    BACKUP_FILE="$1"
else
    BACKUP_FILE=$(ls -t db_backup/*.backup 2>/dev/null | head -1)
    if [ -z "$BACKUP_FILE" ]; then
        echo "ERROR: No .backup files found in db_backup/"
        exit 1
    fi
fi
CONTAINER="db_vp"
DB_NAME="vpatlas"
DB_USER="postgres"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    echo "Usage: ./db_restore.sh [path/to/vpatlas.backup]"
    exit 1
fi

echo "=============================================="
echo "VPAtlas Database Restore"
echo "=============================================="
echo "Backup:    $BACKUP_FILE"
echo "Container: $CONTAINER"
echo "Database:  $DB_NAME"
echo ""

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "ERROR: Container '$CONTAINER' is not running."
    echo "Start it first: docker compose -f docker-compose-vpatlas.yml up -d db_vp"
    exit 1
fi

# Wait for postgres to be ready
echo "Waiting for PostgreSQL..."
until docker exec $CONTAINER pg_isready -U $DB_USER -d $DB_NAME > /dev/null 2>&1; do
    sleep 1
done
echo "PostgreSQL is ready."

# Enable PostGIS extension (needed before restore)
echo "Ensuring PostGIS extension..."
docker exec $CONTAINER psql -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null

# Copy backup into container
echo "Copying backup file to container..."
docker cp "$BACKUP_FILE" $CONTAINER:/tmp/vpatlas.backup

# Restore
echo "Restoring database (this may take a few minutes)..."
docker exec $CONTAINER pg_restore \
    -U $DB_USER \
    -d $DB_NAME \
    --no-owner \
    --no-privileges \
    --verbose \
    /tmp/vpatlas.backup 2>&1 | tail -5

# Cleanup
docker exec $CONTAINER rm /tmp/vpatlas.backup

echo ""
echo "=============================================="
echo "Restore complete."
echo "=============================================="

# Quick check
echo ""
echo "Table count:"
docker exec $CONTAINER psql -U $DB_USER -d $DB_NAME -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

echo "Pool count:"
docker exec $CONTAINER psql -U $DB_USER -d $DB_NAME -t -c \
    "SELECT count(*) FROM vpmapped;" 2>/dev/null || echo "(table may not exist yet)"
