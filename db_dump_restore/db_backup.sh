#!/bin/bash
# Cron runs with a minimal PATH (/usr/bin:/bin). aws-cli v2 installs to
# /usr/local/bin/aws by default, so without this line the S3 upload step
# fails at 2 AM with "aws: command not found" even though the same script
# works fine when invoked from an interactive shell. Prepend the standard
# admin/local paths so the script works regardless of invocation context.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

# =============================================================================
# db_backup.sh - VPAtlas unified database backup
#
# Creates a compressed SQL dump in db_backup/ (the canonical local location)
# and — if ~/.vpatlas_backup.conf is present — also uploads the same file to
# S3 with daily/weekly/monthly retention prefixes and sends an SNS alert.
#
# Mirrors LoonWeb's db_dump_restore/db_backup.sh so the two projects operate
# the same way. Designed to be invoked from a system cron job ON the vpatlas
# server (not the dev machine).
#
# Usage:
#   ./db_backup.sh                       # All BACKUP_TARGETS, type=complete (cron mode)
#   ./db_backup.sh <state>               # One state, type=complete
#   ./db_backup.sh <state> <type>        # Explicit type (empty|partial|complete)
#   ./db_backup.sh --no-s3 <state>       # Local backup only, skip S3
#   ./db_backup.sh --dry-run             # Show plan, no dumps / uploads
#
# State: vp  (single state — VPAtlas is one DB)
# Type:  empty    - schema + minimal static config (just vprole)
#        partial  - schema + reference data (geo + biophysical)
#        complete - everything in the public schema (default; nightly cron)
#
# Restore:
#   ./db_restore.sh vp db_backup/<file>.sql.gz
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/config.sh"

# ----- PARSE ARGS -----
DRY_RUN=false
SKIP_S3=false
POS_ARGS=()
for arg in "$@"; do
    case "$arg" in
        --dry-run)  DRY_RUN=true ;;
        --no-s3)    SKIP_S3=true ;;
        -h|--help)
            sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --*)
            echo "Unknown option: $arg" >&2; exit 1 ;;
        *)
            POS_ARGS+=("$arg") ;;
    esac
done

STATE="${POS_ARGS[0]:-}"
TYPE="${POS_ARGS[1]:-complete}"

# ----- LOAD S3 CONFIG (optional) -----
S3_CONF="${HOME}/.vpatlas_backup.conf"
S3_ENABLED=false
BACKUP_TARGETS=()       # Filled by S3_CONF when no STATE given
if [ -f "$S3_CONF" ]; then
    # shellcheck disable=SC1090
    source "$S3_CONF"
    if [ "$SKIP_S3" != true ]; then
        S3_ENABLED=true
    fi
fi

# ----- BUILD TARGET LIST -----
# Each entry: "label:container:database"
TARGETS=()
if [ -n "$STATE" ]; then
    if ! is_valid_state "$STATE"; then
        echo "ERROR: invalid state '$STATE'. Valid: $(list_states | tr '\n' ' ')" >&2
        exit 1
    fi
    TARGETS+=("${STATE}:$(get_container "$STATE"):$(get_database "$STATE")")
elif [ "${#BACKUP_TARGETS[@]}" -gt 0 ]; then
    TARGETS=("${BACKUP_TARGETS[@]}")
else
    # No state given and no config file — VPAtlas is single-state, so default
    # to the lone entry in STATE_CONFIG. This is what cron with no args hits.
    DEFAULT_STATE=$(list_states | head -1)
    TARGETS+=("${DEFAULT_STATE}:$(get_container "$DEFAULT_STATE"):$(get_database "$DEFAULT_STATE")")
fi

if [[ ! "$TYPE" =~ ^(empty|partial|complete)$ ]]; then
    echo "ERROR: invalid type '$TYPE'. Valid: empty|partial|complete" >&2
    exit 1
fi

# Only `complete` dumps go to S3 (empty/partial are point-in-time helpers).
if [ "$TYPE" != "complete" ]; then
    S3_ENABLED=false
fi

# ----- LOGGING / STATE -----
DATE=$(date +%Y%m%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
DAY_OF_WEEK=$(date +%u)
DAY_OF_MONTH=$(date +%d)
LOG_DIR_DEFAULT="${DEPLOY_DIR}/logs"
LOG_DIR="${LOG_DIR:-$LOG_DIR_DEFAULT}"
mkdir -p "$LOG_DIR" "$DEPLOY_DIR" "$ARCHIVE_DIR"
LOG_FILE="${LOG_DIR}/backup_${DATE}.log"
ERRORS=0
WARNINGS=0
RESULTS=()

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}
log_error() {
    echo "[$(date '+%H:%M:%S')] ERROR: $1" | tee -a "$LOG_FILE" >&2
    ERRORS=$((ERRORS + 1))
}
log_warn() {
    echo "[$(date '+%H:%M:%S')] WARN: $1" | tee -a "$LOG_FILE"
    WARNINGS=$((WARNINGS + 1))
}

# ----- TMP CLEANUP -----
TMP_DIR=""
cleanup() { [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# =============================================================================
# S3 UPLOAD WITH RETENTION PREFIXES
# =============================================================================
upload_to_s3() {
    local file="$1" filename
    filename=$(basename "$file")

    local s3_daily="s3://${S3_BUCKET}/daily/${DATE}/${filename}"
    log "  Uploading to ${s3_daily}"
    if [ "$DRY_RUN" = true ]; then
        log "  [DRY RUN] Would upload $(ls -lh "$file" | awk '{print $5}')"
        return 0
    fi
    if ! aws s3 cp "$file" "$s3_daily" --only-show-errors 2>>"$LOG_FILE"; then
        log_error "Failed to upload ${filename} to S3 (daily)"
        return 1
    fi

    if [ "$DAY_OF_WEEK" -eq 7 ]; then
        local s3_weekly="s3://${S3_BUCKET}/weekly/${DATE}/${filename}"
        log "  Copying to weekly: ${s3_weekly}"
        aws s3 cp "$s3_daily" "$s3_weekly" --only-show-errors 2>>"$LOG_FILE" \
            || log_warn "Failed weekly copy for ${filename}"
    fi
    if [ "$DAY_OF_MONTH" -eq "01" ]; then
        local s3_monthly="s3://${S3_BUCKET}/monthly/${DATE}/${filename}"
        log "  Copying to monthly: ${s3_monthly}"
        aws s3 cp "$s3_daily" "$s3_monthly" --only-show-errors 2>>"$LOG_FILE" \
            || log_warn "Failed monthly copy for ${filename}"
    fi
    return 0
}

# =============================================================================
# DUMP ONE TARGET
# =============================================================================
dump_one() {
    local label="$1" container="$2" database="$3"
    local filename filepath start_time elapsed file_size file_size_human line_count

    filename=$(generate_filename "$label" "$TYPE")
    filepath="${DEPLOY_DIR}/${filename}"
    start_time=$(date +%s)

    log ""
    log "====== Backing up: ${label} (${container}/${database}, type=${TYPE}) ======"

    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        log_error "Container '${container}' is not running — skipping ${label}"
        RESULTS+=("${label}: FAILED (container not running)")
        return 1
    fi

    # Archive any same-day existing dump (non-interactive)
    if [ -f "$filepath" ]; then
        local archive_name="${filename%.sql.gz}_archived_$(date +%H%M%S).sql.gz"
        log "  Existing dump found; archiving to archive/${archive_name}"
        if [ "$DRY_RUN" != true ]; then
            mv "$filepath" "${ARCHIVE_DIR}/${archive_name}"
        fi
    fi

    if [ "$DRY_RUN" = true ]; then
        log "  [DRY RUN] Would dump to ${filepath}"
        RESULTS+=("${label}: DRY RUN")
        return 0
    fi

    TMP_DIR=$(mktemp -d)
    local tmp_globals="${TMP_DIR}/globals.sql"
    local tmp_schema="${TMP_DIR}/schema.sql"
    local tmp_data="${TMP_DIR}/data.sql"
    local tmp_settings="${TMP_DIR}/settings.sql"
    local tmp_combined="${TMP_DIR}/combined.sql"

    # ---- 1/5 GLOBALS (roles) ----
    log "  [1/5] Dumping globals (roles)..."
    if ! docker exec "$container" pg_dumpall -U "$DB_USER" --globals-only \
            > "$tmp_globals" 2>>"$LOG_FILE"; then
        log_error "Globals dump failed for ${label}"
        RESULTS+=("${label}: FAILED (globals)")
        rm -rf "$TMP_DIR"; TMP_DIR=""
        return 1
    fi
    # Drop the postgres role lines — they conflict on a fresh cluster where
    # postgres already exists as the bootstrap superuser.
    sed -i '/^CREATE ROLE postgres/d; /^ALTER ROLE postgres/d' "$tmp_globals"

    # ---- 2/5 SCHEMA ----
    log "  [2/5] Dumping schema..."
    if ! docker exec "$container" pg_dump -U "$DB_USER" -d "$database" \
            -F p --schema-only --no-owner --no-acl --no-comments \
            > "$tmp_schema" 2>>"$LOG_FILE"; then
        log_error "Schema dump failed for ${label}"
        RESULTS+=("${label}: FAILED (schema)")
        rm -rf "$TMP_DIR"; TMP_DIR=""
        return 1
    fi
    # VPAtlas installs PostGIS in `public` (verified at build time); no
    # schema-rewriting sed needed here — LoonWeb's `users.*` → `public.*`
    # fixup doesn't apply.

    # ---- 3/5 DATA (per type) ----
    log "  [3/5] Dumping data (${TYPE})..."
    cat > "$tmp_data" <<EOF
-- =============================================================================
-- Data dump: ${TYPE}
-- Generated: ${TIMESTAMP}
-- =============================================================================

EOF
    case "$TYPE" in
        empty)
            for table in "${TABLES_EMPTY[@]}"; do
                log "    Dumping: ${table}"
                docker exec "$container" pg_dump -U "$DB_USER" -d "$database" \
                    -F p --data-only --no-owner --no-acl --table="$table" \
                    >> "$tmp_data" 2>>"$LOG_FILE" \
                    || log_warn "Table ${table} empty or missing"
            done
            ;;
        partial)
            for table in "${TABLES_PARTIAL_BASE[@]}"; do
                log "    Dumping: ${table}"
                docker exec "$container" pg_dump -U "$DB_USER" -d "$database" \
                    -F p --data-only --no-owner --no-acl --table="$table" \
                    >> "$tmp_data" 2>>"$LOG_FILE" \
                    || log_warn "Table ${table} empty or missing"
            done
            ;;
        complete)
            for schema in "${SCHEMAS_COMPLETE[@]}"; do
                log "    Dumping schema: ${schema}.*"
                docker exec "$container" pg_dump -U "$DB_USER" -d "$database" \
                    -F p --data-only --no-owner --no-acl --schema="$schema" \
                    >> "$tmp_data" 2>>"$LOG_FILE" \
                    || log_warn "Schema ${schema} dump had issues"
            done
            ;;
    esac

    # ---- 4/5 SETTINGS ----
    log "  [4/5] Capturing database settings..."
    docker exec "$container" psql -U "$DB_USER" -d "$database" -t -A -c "
        SELECT 'ALTER DATABASE ' || datname || ' SET ' ||
               unnest(setconfig) || ';'
        FROM pg_db_role_setting s
        JOIN pg_database d ON d.oid = s.setdatabase
        WHERE d.datname = '${database}' AND s.setrole = 0;
    " > "$tmp_settings" 2>/dev/null || true
    if [ ! -s "$tmp_settings" ]; then
        cat > "$tmp_settings" <<SEOF
-- VPAtlas uses the default search_path; no per-database SET statements.
SEOF
    fi

    # ---- 5/5 COMBINE + COMPRESS ----
    log "  [5/5] Combining and compressing..."
    cat > "$tmp_combined" <<EOF
-- =============================================================================
-- VPAtlas Database Backup
-- =============================================================================
-- State:     ${label}
-- Type:      ${TYPE}
-- Source:    ${container}/${database}
-- Generated: ${TIMESTAMP}
-- =============================================================================
--
-- RESTORE:
--   ./db_dump_restore/db_restore.sh ${label} db_backup/${filename}
--
-- Or manually:
--   gunzip -c db_backup/${filename} | docker exec -i ${container} psql -U postgres -d ${database}
--
-- After a complete restore, re-apply any newer migrations:
--   docker compose -f docker-compose-vpatlas.yml up db_migrate_vp
-- =============================================================================

-- === GLOBALS (roles) ===
EOF
    cat "$tmp_globals" >> "$tmp_combined"
    {
        echo ""
        echo "-- === SCHEMA ==="
        cat "$tmp_schema"
        echo ""
        echo "-- === DATA ==="
        cat "$tmp_data"
        echo ""
        echo "-- === SETTINGS (apply with actual database name) ==="
        cat "$tmp_settings"
    } >> "$tmp_combined"

    gzip -c "$tmp_combined" > "$filepath"

    rm -rf "$TMP_DIR"; TMP_DIR=""

    if [ ! -f "$filepath" ]; then
        log_error "Output file not created: ${filepath}"
        RESULTS+=("${label}: FAILED (file not created)")
        return 1
    fi

    file_size=$(stat -c%s "$filepath" 2>/dev/null || echo 0)
    file_size_human=$(ls -lh "$filepath" | awk '{print $5}')
    line_count=$(zcat "$filepath" | wc -l)
    elapsed=$(( $(date +%s) - start_time ))

    if [ -n "${MIN_DUMP_SIZE_BYTES:-}" ] && [ "$file_size" -lt "$MIN_DUMP_SIZE_BYTES" ]; then
        log_warn "Dump file is suspiciously small: ${file_size_human}"
    fi

    log "    Output: ${filepath}"
    log "    Size:   ${file_size_human} (${line_count} lines uncompressed)"
    log "    Time:   ${elapsed}s"

    # ---- S3 ----
    if [ "$S3_ENABLED" = true ]; then
        if upload_to_s3 "$filepath"; then
            RESULTS+=("${label}: OK (${file_size_human}, ${elapsed}s, local+S3)")
        else
            RESULTS+=("${label}: PARTIAL (local OK, S3 upload failed)")
        fi
    else
        RESULTS+=("${label}: OK (${file_size_human}, ${elapsed}s, local only)")
    fi

    return 0
}

# =============================================================================
# SNS NOTIFICATION (only when S3_ENABLED and topic configured)
# =============================================================================
send_alert() {
    local status="$1"
    [ "$S3_ENABLED" != true ] && return
    [ -z "${SNS_TOPIC_ARN:-}" ] && return
    [ "$DRY_RUN" = true ] && { log "[DRY RUN] Would send SNS alert: ${status}"; return; }

    local subject="VPAtlas Backup ${status} - ${DATE}"
    local body="VPAtlas Database Backup Report
============================================
Date:     ${TIMESTAMP}
Status:   ${status}
Errors:   ${ERRORS}
Warnings: ${WARNINGS}

Results:
"
    for r in "${RESULTS[@]}"; do body+="  - ${r}\n"; done
    body+="\nLocal:    ${DEPLOY_DIR}\nS3:       s3://${S3_BUCKET}/\nLog:      ${LOG_FILE}\n"

    aws sns publish \
        --topic-arn "$SNS_TOPIC_ARN" \
        --subject "$subject" \
        --message "$(echo -e "$body")" \
        --region "${AWS_REGION:-us-east-1}" \
        2>>"$LOG_FILE" || log_warn "Failed to send SNS notification"
}

# =============================================================================
# MAIN
# =============================================================================
log "=============================================="
log "VPAtlas Backup — ${TIMESTAMP}"
log "=============================================="
log "Type:    ${TYPE}"
log "Targets: ${TARGETS[*]}"
log "Local:   ${DEPLOY_DIR}"
if [ "$S3_ENABLED" = true ]; then
    log "S3:      s3://${S3_BUCKET}/"
else
    if [ -f "$S3_CONF" ]; then
        log "S3:      skipped (--no-s3 or type=${TYPE})"
    else
        log "S3:      skipped (no ${S3_CONF})"
    fi
fi
[ "$DRY_RUN" = true ] && log "[DRY RUN MODE]"

for entry in "${TARGETS[@]}"; do
    IFS=':' read -r label container database <<< "$entry"
    dump_one "$label" "$container" "$database" || true
done

if [ "$ERRORS" -gt 0 ]; then
    OVERALL="FAILURE"
elif [ "$WARNINGS" -gt 0 ]; then
    OVERALL="WARNING"
else
    OVERALL="SUCCESS"
fi

log ""
log "=============================================="
log "Backup ${OVERALL} — ${ERRORS} errors, ${WARNINGS} warnings"
for r in "${RESULTS[@]}"; do log "  ${r}"; done
log "=============================================="

send_alert "$OVERALL"

[ "$ERRORS" -eq 0 ]
