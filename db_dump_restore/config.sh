#!/bin/bash
# =============================================================================
# config.sh - Centralized configuration for VPAtlas database scripts.
#
# Mirrors the LoonWeb db_dump_restore/config.sh structure so the two projects'
# backup systems are operationally identical. VPAtlas is single-state (one
# container, one database), so STATE_CONFIG has one entry; the structure is
# preserved so the same scripts work in both projects.
# =============================================================================

# ----- STATE CONFIGURATIONS -----
# Format: STATE_CODE="container_name:database_name"

declare -A STATE_CONFIG
STATE_CONFIG=(
    ["vp"]="db_vp:vpatlas"
)

# ----- DATABASE CREDENTIALS -----
DB_USER="postgres"
DB_PASSWORD="postgres"

# ----- TABLE DEFINITIONS BY DUMP TYPE -----

# Empty: schema + the bare-minimum static config to bring up a fresh DB.
# Just user roles; everything else is empty.
TABLES_EMPTY=(
    "public.vprole"
)

# Partial: empty + geo reference + biophysical regions. Enough for the
# Explore map to render without any user-submitted data.
TABLES_PARTIAL_BASE=(
    "public.vprole"
    "public.vpstate"
    "public.vpcounty"
    "public.vptown"
    "public.vpbiophysical"
)

# Complete: every table in these schemas. Used by the nightly cron backup.
SCHEMAS_COMPLETE=(
    "public"
)

# LoonWeb has multi-state source tables (me_*, vt_*, nh_*) included in
# partial dumps; VPAtlas is single-state so this stays empty. Kept so the
# script's get_state_source_tables() helper still has something to read.
STATE_SOURCE_PREFIXES=()

# ----- PATHS -----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Per user preference, dumps land in the repo's existing db_backup/ tree
# (already gitignored) rather than a sibling deploy/ dir like LoonWeb uses.
DEPLOY_DIR="${REPO_ROOT}/db_backup"
ARCHIVE_DIR="${DEPLOY_DIR}/archive"

# ----- HELPER FUNCTIONS -----

get_container() {
    local state=$1
    echo "${STATE_CONFIG[$state]}" | cut -d: -f1
}

get_database() {
    local state=$1
    echo "${STATE_CONFIG[$state]}" | cut -d: -f2
}

list_states() {
    echo "${!STATE_CONFIG[@]}" | tr ' ' '\n' | sort
}

is_valid_state() {
    local state=$1
    [[ -v STATE_CONFIG[$state] ]]
}

generate_filename() {
    local state=$1
    local type=$2
    local date
    date=$(date +%Y%m%d)
    echo "vpatlas_${state}_${type}_${date}.sql.gz"
}

# Single-state project — no per-state source tables. Returns empty.
get_state_source_tables() {
    return 0
}
