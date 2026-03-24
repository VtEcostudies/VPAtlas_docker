#!/bin/bash

# =============================================================================
# VPAtlas Internal Migration Runner
# =============================================================================
# Runs INSIDE a Docker container (or any host with psql).
# Uses environment variables for connection -- no docker exec.
#
# Required env vars: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#
# Mounted volume: /db_migrate/migrations (contains .sql files)
#
# Modeled on LoonWeb's migrate_internal.sh.
# =============================================================================

set -e

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/db_migrate/migrations}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

run_sql() {
    psql -v ON_ERROR_STOP=1 "$@"
}

run_sql_quiet() {
    psql -t -A "$@"
}

file_checksum() {
    sha256sum "$1" | cut -d' ' -f1
}

# -----------------------------------------------------------------------------
# Wait for database
# -----------------------------------------------------------------------------
log "Waiting for database ${PGHOST}:${PGPORT}/${PGDATABASE}..."
RETRIES=0
MAX_RETRIES=30
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" > /dev/null 2>&1; do
    RETRIES=$((RETRIES + 1))
    if [ $RETRIES -ge $MAX_RETRIES ]; then
        log "ERROR: Database not ready after ${MAX_RETRIES} attempts. Exiting."
        exit 1
    fi
    sleep 2
done
log "Database is ready"

# -----------------------------------------------------------------------------
# Ensure tracking table
# -----------------------------------------------------------------------------
run_sql -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    checksum VARCHAR(64),
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    applied_by VARCHAR(100),
    execution_time_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename ON schema_migrations(filename);
" > /dev/null 2>&1

# -----------------------------------------------------------------------------
# Check migrations directory
# -----------------------------------------------------------------------------
if [ ! -d "$MIGRATIONS_DIR" ]; then
    log "No migrations directory at $MIGRATIONS_DIR -- skipping."
    exit 0
fi

MIGRATION_FILES=$(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort)
if [ -z "$MIGRATION_FILES" ]; then
    log "No .sql files in $MIGRATIONS_DIR -- nothing to do."
    exit 0
fi

# -----------------------------------------------------------------------------
# Run migrations
# -----------------------------------------------------------------------------
log ""
log "=========================================="
log "VPAtlas Database Migrations"
log "=========================================="
log "Database: ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
log "Source:   ${MIGRATIONS_DIR}"
log ""

APPLIED=0
SKIPPED=0
FAILED=0

for migration_file in $MIGRATION_FILES; do
    filename=$(basename "$migration_file")
    checksum=$(file_checksum "$migration_file")

    # Check if already applied
    is_applied=$(run_sql_quiet -c "SELECT 1 FROM schema_migrations WHERE filename = '$filename' AND success = true;" 2>/dev/null)

    if [ -n "$is_applied" ]; then
        # Check for changed file
        stored_checksum=$(run_sql_quiet -c "SELECT checksum FROM schema_migrations WHERE filename = '$filename';" 2>/dev/null)
        if [ -n "$stored_checksum" ] && [ "$stored_checksum" != "$checksum" ]; then
            log "WARNING: $filename has changed since applied (checksum mismatch)"
        fi
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # Run it
    log "Running: $filename"
    START_TIME=$(date +%s%3N 2>/dev/null || date +%s)

    if run_sql -f "$migration_file" > /tmp/migration_output.txt 2>&1; then
        END_TIME=$(date +%s%3N 2>/dev/null || date +%s)
        DURATION=$((END_TIME - START_TIME))

        run_sql -c "
            INSERT INTO schema_migrations (filename, checksum, applied_by, execution_time_ms, success)
            VALUES ('$filename', '$checksum', 'docker@$(hostname)', $DURATION, true)
            ON CONFLICT (filename) DO UPDATE SET
                checksum = '$checksum',
                applied_at = CURRENT_TIMESTAMP,
                applied_by = 'docker@$(hostname)',
                execution_time_ms = $DURATION,
                success = true,
                error_message = NULL;
        " > /dev/null 2>&1

        log "OK: $filename (${DURATION}ms)"
        APPLIED=$((APPLIED + 1))
    else
        END_TIME=$(date +%s%3N 2>/dev/null || date +%s)
        DURATION=$((END_TIME - START_TIME))
        ERROR_MSG=$(cat /tmp/migration_output.txt | head -20 | tr "'" '"')

        run_sql -c "
            INSERT INTO schema_migrations (filename, checksum, applied_by, execution_time_ms, success, error_message)
            VALUES ('$filename', '$checksum', 'docker@$(hostname)', $DURATION, false, '$ERROR_MSG')
            ON CONFLICT (filename) DO UPDATE SET
                checksum = '$checksum',
                applied_at = CURRENT_TIMESTAMP,
                applied_by = 'docker@$(hostname)',
                execution_time_ms = $DURATION,
                success = false,
                error_message = '$ERROR_MSG';
        " > /dev/null 2>&1

        log "FAILED: $filename"
        cat /tmp/migration_output.txt
        FAILED=$((FAILED + 1))

        log "Stopping due to failure."
        exit 1
    fi
done

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
log ""
log "--- Migration Summary ---"
log "Applied: $APPLIED"
log "Skipped: $SKIPPED (already applied)"
log "Failed:  $FAILED"

if [ $APPLIED -eq 0 ] && [ $FAILED -eq 0 ]; then
    log "Database is up to date"
else
    log "Migrations complete"
fi

exit 0
