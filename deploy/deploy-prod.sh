#!/bin/bash
#
# deploy-prod.sh — Deploy new docker VPAtlas to vpatlas.org (blue/green over legacy Angular)
#
# Runs from your local machine. SSHes into the AWS EC2 host as ubuntu@vpatlas.org
# and operates on /home/ubuntu/VPAtlas_docker_production (separate from the dev
# stack at /home/ubuntu/VPAtlas_docker).
#
# Typical first-time sequence:
#
#   ./deploy/deploy-prod.sh setup                  # installs api.vpatlas.org nginx vhost
#   ssh -i $SSH_KEY $SSH_HOST
#     sudo certbot --nginx -d api.vpatlas.org      # one-off: issue cert
#     exit
#   ./deploy/deploy-prod.sh clone                  # git clone into prod dir, symlink .env
#   ./deploy/deploy-prod.sh db-restore-from-live   # pg_dump live → prod stack
#   ./deploy/deploy-prod.sh deploy                 # build + up; migrations run automatically
#
# Then verify against https://api.vpatlas.org and a temporary hostname for
# the UI before:
#
#   ./deploy/deploy-prod.sh inspect-legacy-nginx   # find the legacy vhost filename
#   ./deploy/deploy-prod.sh cutover                # swap vpatlas.org nginx → new UI
#   ./deploy/deploy-prod.sh rollback               # if smoke test fails: put legacy back
#
set -e

SSH_KEY="/home/jloomis/.ssh/vpatlas_aws_key_pair.pem"
SSH_HOST="ubuntu@vpatlas.org"
REMOTE_DIR="/home/ubuntu/VPAtlas_docker_production"
# Legacy location of the shared .env. The prod dir's .env used to be a symlink
# into here. The directory on the host is actually spelled "developement" — the
# path below was wrong for months, so the symlink dangled, compose interpolated
# every ${VAR} to empty, and prod ran with EMAIL_PASSWORD="" (all registration
# and password-reset mail silently failed). Kept only so `clone` can migrate an
# old symlink; new installs get a real file, not a link into another checkout.
DEV_DIR="/home/ubuntu/VPAtlas_docker_developement"
COMPOSE_FILES="-f docker-compose-vpatlas.yml -f docker-compose-prod.yml"
GIT_REPO="https://github.com/VtEcostudies/VPAtlas_docker.git"

ssh_cmd() {
    ssh -i "$SSH_KEY" "$SSH_HOST" "$@"
}

# Refuse to recreate api_vp against a broken or placeholder .env.
#
# This is the interlock that would have caught the outage this function exists
# because of: prod's .env was a dangling symlink, so compose interpolated
# EMAIL_PASSWORD to "" and every registration / password-reset email failed
# with `Missing credentials for "PLAIN"` for months, with nothing in the deploy
# output to suggest anything was wrong. Values are never echoed — only whether
# they are present and non-placeholder.
#
# API_SECRET is intentionally NOT checked here: it isn't passed into the
# container at all (see docker-compose-vpatlas.yml), so its value in .env is
# inert. Adding it to this list would block every deploy over a setting we have
# deliberately decided not to change.
preflight_env() {
    echo "→ Preflight: validating $REMOTE_DIR/.env"
    ssh_cmd "cd '$REMOTE_DIR' && \
      if [ ! -e .env ]; then \
        echo '  ✗ .env missing or unresolvable'; \
        [ -L .env ] && echo '    (dangling symlink -> '\$(readlink .env)')'; \
        exit 1; \
      fi; \
      fail=0; \
      for v in EMAIL_PASSWORD APP_EMAIL DB_PASSWORD PGFS_PASSWORD; do \
        val=\$(grep -E \"^\$v=\" .env | head -1 | cut -d= -f2-); \
        case \"\$val\" in \
          '') echo \"  ✗ \$v is empty or absent\"; fail=1 ;; \
          change-me-in-production|changeme) \
             echo \"  ✗ \$v is a published placeholder value\"; fail=1 ;; \
          *) echo \"  ✓ \$v set (\${#val} chars)\" ;; \
        esac; \
      done; \
      exit \$fail" || {
        echo ""
        echo "ABORTING: prod .env is incomplete. Fix it on the host before deploying —"
        echo "an empty EMAIL_PASSWORD silently kills registration and"
        echo "password-reset email, which is exactly the outage this check exists for."
        exit 1
      }
    echo "→ Preflight OK"
}

# Auto-commit any local changes before pushing (matches deploy-dev.sh).
commit_local_changes() {
    local custom_msg="$1"
    git add -A
    if git diff --cached --quiet; then
        echo "No local changes to commit."
        return 0
    fi
    local version
    version=$(python3 -c "import json; print(json.load(open('ui_vp/uiVPAtlas/manifest.json'))['version'])" 2>/dev/null || echo "")
    local msg="${custom_msg:-deploy v${version:-unknown}}"
    echo "Committing local changes: \"$msg\""
    git commit -m "$msg"
}

# Pinned Compose v2 version compatible with Docker 20.10 on the AWS host.
COMPOSE_VER="v2.24.7"

# Auto-detect docker compose command on remote (already installed via deploy-dev.sh setup).
COMPOSE=$(ssh_cmd "docker compose version >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose'" 2>/dev/null)
COMPOSE="$COMPOSE $COMPOSE_FILES"

case "${1:-help}" in

# ─── First-time nginx setup for api.vpatlas.org ───
# Installs ONLY the api.vpatlas.org vhost. Does NOT touch the legacy vpatlas.org
# vhost — that happens during cutover.
setup)
    echo "=== Installing api.vpatlas.org nginx vhost on remote ==="

    scp -i "$SSH_KEY" deploy/nginx-api.vpatlas.org.conf "$SSH_HOST:/tmp/"

    ssh_cmd "sudo cp /tmp/nginx-api.vpatlas.org.conf /etc/nginx/sites-available/api.vpatlas.org && \
             sudo ln -sf /etc/nginx/sites-available/api.vpatlas.org /etc/nginx/sites-enabled/api.vpatlas.org && \
             sudo nginx -t && sudo systemctl reload nginx"

    echo ""
    echo "✓ api.vpatlas.org HTTP vhost installed."
    echo ""
    echo "Next steps:"
    echo "  1. Confirm DNS: dig +short api.vpatlas.org   (should resolve to this server)"
    echo "  2. Issue cert:  ssh -i $SSH_KEY $SSH_HOST"
    echo "                  sudo certbot --nginx -d api.vpatlas.org"
    echo "  3. Then run:    ./deploy/deploy-prod.sh clone"
    ;;

# ─── One-time: git clone the prod working directory + symlink shared .env ───
clone)
    echo "=== Cloning $GIT_REPO into $REMOTE_DIR (idempotent) ==="

    ssh_cmd "if [ -d '$REMOTE_DIR/.git' ]; then \
                echo 'Already cloned — pulling latest main.'; \
                cd '$REMOTE_DIR' && git pull origin main; \
             else \
                git clone '$GIT_REPO' '$REMOTE_DIR'; \
             fi"

    # Ensure prod has a usable .env.
    #
    # The old version of this block tested `[ -L .env ]` and reported ".env
    # symlink already present" — true even when the link was DANGLING, which
    # is how prod ran for months with an empty EMAIL_PASSWORD. Existence of a
    # symlink is not evidence of a readable file; `-e` (which follows links)
    # is. Prod now gets a real file so it can't be broken by something that
    # happens in a different checkout.
    ssh_cmd "if [ -f '$REMOTE_DIR/.env' ] && [ ! -L '$REMOTE_DIR/.env' ]; then \
                echo '.env present (real file).'; \
             elif [ -L '$REMOTE_DIR/.env' ] && [ -e '$REMOTE_DIR/.env' ]; then \
                echo 'Converting .env symlink -> real file (target: '\$(readlink '$REMOTE_DIR/.env')')'; \
                cp -L '$REMOTE_DIR/.env' '$REMOTE_DIR/.env.tmp' && mv -f '$REMOTE_DIR/.env.tmp' '$REMOTE_DIR/.env' && \
                chmod 600 '$REMOTE_DIR/.env' && echo '.env is now a real file.'; \
             elif [ -L '$REMOTE_DIR/.env' ]; then \
                echo 'ERROR: $REMOTE_DIR/.env is a DANGLING symlink -> '\$(readlink '$REMOTE_DIR/.env'); \
                if [ -f '$DEV_DIR/.env' ]; then \
                  rm -f '$REMOTE_DIR/.env' && cp '$DEV_DIR/.env' '$REMOTE_DIR/.env' && chmod 600 '$REMOTE_DIR/.env' && \
                  echo 'Recovered .env from $DEV_DIR.'; \
                else \
                  echo 'No source to recover from. Create $REMOTE_DIR/.env from .env.example.'; exit 1; \
                fi; \
             elif [ -f '$DEV_DIR/.env' ]; then \
                cp '$DEV_DIR/.env' '$REMOTE_DIR/.env' && chmod 600 '$REMOTE_DIR/.env' && echo '.env seeded from $DEV_DIR.'; \
             else \
                echo 'ERROR: no .env at $REMOTE_DIR and none to copy from.'; \
                echo 'Create it from .env.example — API_SECRET and EMAIL_PASSWORD are required.'; exit 1; \
             fi"

    preflight_env

    # photo_data: fresh empty dir owned by container's api user (uid 1001).
    ssh_cmd "cd '$REMOTE_DIR' && mkdir -p photo_data && sudo chown -R 1001:1001 photo_data && sudo chmod -R u+rwX,g+rwX photo_data"

    echo ""
    echo "✓ Prod working dir ready at $REMOTE_DIR"
    echo ""
    echo "Next: ./deploy/deploy-prod.sh db-restore-from-live"
    ;;

# ─── Dump the live legacy DB, drop it into prod's db_backup/ ───
# Does NOT restore — call db-restore-from-live + deploy to bring stack up,
# or call db-restore separately if the stack is already up.
db-dump-from-live)
    echo "=== Dumping live legacy DB to $REMOTE_DIR/db_backup/ ==="

    ssh_cmd "mkdir -p $REMOTE_DIR/db_backup && \
        sudo -u postgres pg_dump -d vpatlas \
            -Fc --no-owner --no-privileges \
            -f /tmp/vpatlas_prod_\$(date +%Y%m%d_%H%M%S).backup && \
        sudo mv /tmp/vpatlas_prod_*.backup $REMOTE_DIR/db_backup/ 2>/dev/null; \
        sudo chown ubuntu $REMOTE_DIR/db_backup/vpatlas_prod_*.backup && \
        ls -lh $REMOTE_DIR/db_backup/ | tail -5"
    ;;

# ─── Dump live legacy DB + restore into the prod db container ───
# Brings up only db_vp_prod (and the migrator) so we can restore before
# starting the api. Migrations will then run as part of the next `deploy`.
db-restore-from-live)
    echo "=== Dump live + restore into prod db container ==="

    # Step 1: fresh dump
    ssh_cmd "mkdir -p $REMOTE_DIR/db_backup && \
        TS=\$(date +%Y%m%d_%H%M%S) && \
        sudo -u postgres pg_dump -d vpatlas \
            -Fc --no-owner --no-privileges \
            -f /tmp/vpatlas_prod_\${TS}.backup && \
        sudo mv /tmp/vpatlas_prod_\${TS}.backup $REMOTE_DIR/db_backup/ && \
        sudo chown ubuntu $REMOTE_DIR/db_backup/vpatlas_prod_\${TS}.backup && \
        echo \"Latest backup: \$(ls -t $REMOTE_DIR/db_backup/*.backup | head -1)\""

    # Step 2: bring up just the db so we can restore into a clean DB
    echo "Bringing up db_vp_prod (without api/migrate)..."
    ssh_cmd "cd $REMOTE_DIR && $COMPOSE up -d db_vp"

    # Step 3: wipe + recreate the DB so pg_restore lands into an empty schema
    echo "Recreating vpatlas database in db_vp_prod..."
    ssh_cmd "docker exec db_vp_prod psql -U postgres -c 'DROP DATABASE IF EXISTS vpatlas;' && \
             docker exec db_vp_prod psql -U postgres -c 'CREATE DATABASE vpatlas;'"

    # Step 4: restore using the shared db_restore.sh with prod overrides
    echo "Restoring backup into db_vp_prod..."
    ssh_cmd "cd $REMOTE_DIR && CONTAINER=db_vp_prod DB_NAME=vpatlas DB_USER=postgres bash db_restore.sh"

    echo ""
    echo "✓ DB restored into db_vp_prod from latest live dump."
    echo ""
    echo "Next: ./deploy/deploy-prod.sh deploy  (this will run all pending migrations)"
    ;;

# ─── Install the LoonWeb-style nightly backup pipeline on prod ───
# Idempotent: writes ~/.vpatlas_backup.conf only if missing or out of sync,
# installs / refreshes a single cron line tagged with a managed-by marker,
# auto-comments out any legacy crontab line that writes .backup files. After
# install, runs db_backup.sh once on prod to validate end-to-end (locally +
# S3 upload to s3://vpatlas.backup/daily/YYYYMMDD/).
#
# Re-run anytime to converge prod's backup config with the canonical version
# baked into this script — the same way `clone` is idempotent.
backup-install)
    echo "=== Installing VPAtlas backup pipeline on $SSH_HOST ==="

    # 1. Make sure prod has the latest db_dump_restore/ from main.
    echo "→ Pulling latest main on prod..."
    ssh_cmd "cd '$REMOTE_DIR' && git pull origin main"

    # 2. Generate the canonical prod conf locally, scp it up to a staging
    #    path, install only if missing or different from what's already there.
    #    BACKUP_TARGETS points at db_vp_prod (not db_vp) because prod uses
    #    the suffixed container name — see docker-compose-vpatlas-prod.yml.
    echo "→ Writing ~/.vpatlas_backup.conf (idempotent)..."
    TMP_CONF=$(mktemp)
    cat > "$TMP_CONF" <<'CONF_EOF'
#!/bin/bash
# =============================================================================
# VPAtlas S3 Backup Configuration (prod)
# Managed by deploy-prod.sh backup-install — re-run that command to refresh.
# Loaded by db_dump_restore/db_backup.sh when present.
# =============================================================================

# ----- AWS -----
S3_BUCKET="vpatlas.backup"
AWS_REGION="us-east-1"

# SNS_TOPIC_ARN deferred — set after creating the topic via AWS console
# (or after granting sns:CreateTopic to whichever IAM identity this host uses).
# SNS_TOPIC_ARN="arn:aws:sns:us-east-1:824614856275:vpatlas-backup-alerts"

# ----- DATABASE TARGETS -----
# Prod uses the suffixed container name `db_vp_prod`. The script-internal
# STATE_CONFIG entry in db_dump_restore/config.sh points at `db_vp` (dev);
# this BACKUP_TARGETS array overrides that for cron-with-no-args.
BACKUP_TARGETS=(
    "vp:db_vp_prod:vpatlas"
)
DB_USER="postgres"

# ----- THRESHOLDS -----
MIN_DUMP_SIZE_BYTES=100000
CONF_EOF

    scp -i "$SSH_KEY" "$TMP_CONF" "$SSH_HOST:/tmp/.vpatlas_backup.conf.new" >/dev/null
    rm -f "$TMP_CONF"

    ssh_cmd "if [ ! -f \$HOME/.vpatlas_backup.conf ] || ! cmp -s \$HOME/.vpatlas_backup.conf /tmp/.vpatlas_backup.conf.new; then \
                mv /tmp/.vpatlas_backup.conf.new \$HOME/.vpatlas_backup.conf && \
                chmod 600 \$HOME/.vpatlas_backup.conf && \
                echo '  conf installed/updated'; \
             else \
                rm -f /tmp/.vpatlas_backup.conf.new && echo '  conf unchanged'; \
             fi"

    # 3. Make sure the cron log directory exists before cron tries to write to it.
    ssh_cmd "mkdir -p \$HOME/db_backups"

    # 4. Show current crontab so any legacy line is visible in the deploy output.
    echo ""
    echo "→ Current crontab (before changes):"
    ssh_cmd "crontab -l 2>/dev/null || echo '(empty)'" | sed 's/^/    /'

    # 5. Update the crontab. Idempotency rules:
    #    a) Drop any existing line containing 'db_dump_restore/db_backup.sh'
    #       — we'll re-append a fresh, canonical version below. This makes
    #       the mode safe to re-run when the cron line itself evolves.
    #    b) Comment out any uncommented line that mentions BOTH 'backup'
    #       AND 'vpatlas' (case-insensitive). This catches the legacy job
    #       whether it's a wrapper script named vpatlas_backup.sh or a
    #       direct pg_dump writing *.backup, without touching unrelated
    #       cron entries (the weekly vpatlas_vacuum.sh, MAILTO, system
    #       backups of /etc/, etc.). The grep -v above already removed
    #       our managed line, so awk won't re-comment it.
    #    c) Append the new cron line with a managed-by tag so future updates
    #       can match-and-replace by tag.
    echo ""
    echo "→ Updating crontab (disable legacy + install new line)..."
    NEW_CRON_LINE="0 2 * * * $REMOTE_DIR/db_dump_restore/db_backup.sh >> \$HOME/db_backups/vpatlas_cron.log 2>&1 # managed-by: deploy-prod.sh backup-install"

    ssh_cmd "{ crontab -l 2>/dev/null || true; } \
             | grep -v 'db_dump_restore/db_backup.sh' \
             | awk '/^[^#]/ && index(tolower(\$0),\"backup\")>0 && index(tolower(\$0),\"vpatlas\")>0 { print \"# disabled-by-deploy-prod.sh-backup-install: \" \$0; next } { print }' \
             > /tmp/cron.new && \
             echo '$NEW_CRON_LINE' >> /tmp/cron.new && \
             crontab /tmp/cron.new && \
             rm -f /tmp/cron.new"

    echo ""
    echo "→ Crontab after changes:"
    ssh_cmd "crontab -l 2>/dev/null || echo '(empty)'" | sed 's/^/    /'

    # 6. Smoke-test: run the backup script once on prod. Validates the full
    #    chain — pg_dump in db_vp_prod, .sql.gz to db_backup/, S3 upload.
    echo ""
    echo "→ Running one-time backup on prod to validate..."
    ssh_cmd "cd '$REMOTE_DIR' && bash db_dump_restore/db_backup.sh" | tail -20

    # 7. Confirm the upload landed.
    echo ""
    echo "→ S3 daily/ prefix:"
    ssh_cmd "aws s3 ls s3://vpatlas.backup/daily/ 2>&1 | tail -5" | sed 's/^/    /'

    echo ""
    echo "✓ Backup pipeline installed on $SSH_HOST"
    echo ""
    echo "Followups (not done by this command):"
    echo "  • SNS alerts — create vpatlas-backup-alerts topic via AWS console,"
    echo "    paste ARN into ~/.vpatlas_backup.conf on the server."
    echo "  • S3 lifecycle policy — scope to daily/, weekly/, monthly/ prefixes"
    echo "    so legacy *.backup files aren't auto-expired."
    echo "  • Delete legacy .backup files from S3 once you trust the new pipeline:"
    echo "    aws s3 rm s3://vpatlas.backup/ --recursive --exclude '*' --include 'vpatlas_*.backup'"
    ;;

# ─── Apply S3 lifecycle policy to vpatlas.backup ───
# Idempotent — PutBucketLifecycleConfiguration replaces. Scoped to daily/,
# weekly/, monthly/ prefixes so legacy *.backup files at the bucket root
# are untouched. Mirrors loonweb-db-backups's retention (30/90/365 days).
# Re-run to converge after editing deploy/s3-lifecycle.json.
backup-lifecycle)
    echo "=== Applying S3 lifecycle policy to s3://vpatlas.backup/ ==="

    SCRIPT_DIR_LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    LIFECYCLE_JSON="$SCRIPT_DIR_LOCAL/s3-lifecycle.json"

    if [ ! -f "$LIFECYCLE_JSON" ]; then
        echo "ERROR: lifecycle policy file not found: $LIFECYCLE_JSON" >&2
        exit 1
    fi

    echo "→ Policy file: $LIFECYCLE_JSON"
    aws s3api put-bucket-lifecycle-configuration \
        --bucket vpatlas.backup \
        --lifecycle-configuration "file://${LIFECYCLE_JSON}"

    echo ""
    echo "→ Live policy:"
    aws s3api get-bucket-lifecycle-configuration --bucket vpatlas.backup \
        | sed 's/^/    /'

    echo ""
    echo "✓ S3 lifecycle applied to s3://vpatlas.backup/"
    echo "  daily/    → expire after 30 days"
    echo "  weekly/   → expire after 90 days"
    echo "  monthly/  → expire after 365 days"
    echo "  (legacy *.backup files at bucket root: untouched — no prefix match)"
    ;;

# ─── Full deploy: sw-build patch → local rebuild (all) → push → prod rebuild (all) ───
# Use when you've changed UI + API (and/or migrations). Always rebuilds api_vp too;
# Docker layer cache makes that cheap if the API hasn't actually changed.
deploy)
    echo "=== App update (full stack): local + prod ==="

    # 0. Prod .env must be sane BEFORE we recreate api_vp with it.
    preflight_env

    # 1. Bump SW patch (regenerates sw.js, runs precache validator).
    echo "→ Bumping SW patch version + regen sw.js"
    ( cd ui_vp && node uiVPAtlas/sw-build.js patch )

    # 2. Rebuild local containers so localhost:8090 reflects the change before
    #    we ship the same code to prod.
    echo "→ Rebuilding local containers (ui_vp, api_vp)"
    docker compose -f docker-compose-vpatlas.yml up -d --build ui_vp api_vp

    # 3. Commit + push (this is what carries sw-build's manifest.json/sw.js
    #    changes to the prod box's git pull on the next line).
    commit_local_changes "${2:-}"
    echo "→ Pushing to origin"
    git push origin main 2>/dev/null || echo "(push skipped or failed — continuing)"

    # 4. Photo dir perms (idempotent, harmless on re-run)
    ssh_cmd "cd $REMOTE_DIR && mkdir -p photo_data && sudo chown -R 1001:1001 photo_data && sudo chmod -R u+rwX,g+rwX photo_data"

    # 5. Pull + rebuild on prod (full stack — migrations run automatically)
    echo "→ Deploying full stack to vpatlas.org"
    ssh_cmd "cd $REMOTE_DIR && \
             git pull origin main && \
             $COMPOSE up -d --build"

    # 6. Migration log (the migrate container exits 0 on success; surfaces failures)
    echo ""
    echo "=== db_migrate_vp_prod log (most recent run) ==="
    ssh_cmd "docker logs db_migrate_vp_prod 2>&1 | tail -50" || true

    # 7. Show resulting version
    VERSION=$(ssh_cmd "docker exec ui_vp_prod cat /opt/ui/uiVPAtlas/manifest.json" 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "?")
    echo ""
    echo "✓ Full deploy complete: https://vpatlas.org (v${VERSION})"
    ;;

# ─── UI: sw-build patch → local ui_vp rebuild → push → prod ui_vp_prod rebuild ───
# The standard "I made some UI/script changes" workflow. Files in deploy/,
# db_restore.sh, etc. ride along via the remote git pull even though they
# don't trigger a container rebuild — they just need to be on disk.
ui)
    echo "=== App update (UI): local + prod ==="

    # 1. Bump SW patch (precache validator runs first; aborts if cache list is broken).
    echo "→ Bumping SW patch version + regen sw.js"
    ( cd ui_vp && node uiVPAtlas/sw-build.js patch )

    # 2. Rebuild local ui_vp so localhost:8090 picks up the change BEFORE prod.
    echo "→ Rebuilding local ui_vp container"
    docker compose -f docker-compose-vpatlas.yml up -d --build ui_vp

    # 3. Commit + push.
    commit_local_changes "${2:-}"
    echo "→ Pushing to origin"
    git push origin main 2>/dev/null || echo "(push skipped or failed — continuing)"

    # 4. Pull + rebuild ui_vp_prod on prod.
    echo "→ Deploying to vpatlas.org"
    ssh_cmd "cd $REMOTE_DIR && \
             git pull origin main && \
             $COMPOSE up -d --build ui_vp"

    # 5. Show resulting version (path is /opt/ui/uiVPAtlas/manifest.json — older
    #    version of this script looked under /explore/ and always printed v?).
    VERSION=$(ssh_cmd "docker exec ui_vp_prod cat /opt/ui/uiVPAtlas/manifest.json" 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "?")
    echo ""
    echo "✓ App update complete: https://vpatlas.org (v${VERSION})"
    ;;

# ─── Look up the existing legacy vpatlas.org vhost ───
# Run this BEFORE cutover so we know what we're replacing.
inspect-legacy-nginx)
    echo "=== Inspecting existing /etc/nginx/sites-enabled/ ==="
    ssh_cmd "sudo ls -la /etc/nginx/sites-enabled/"
    echo ""
    echo "=== Candidates that mention vpatlas.org ==="
    ssh_cmd "sudo grep -l 'server_name.*vpatlas.org' /etc/nginx/sites-available/* 2>/dev/null || true"
    echo ""
    echo "=== Existing vpatlas.org server blocks (sites-enabled) ==="
    ssh_cmd "for f in /etc/nginx/sites-enabled/*; do \
                if sudo grep -lE 'server_name +(www\\.)?vpatlas\\.org( |;)' \"\$f\" >/dev/null 2>&1; then \
                    echo \"---- \$f ----\"; sudo cat \"\$f\"; \
                fi; \
             done"
    ;;

# ─── Cutover: swap the legacy vpatlas.org vhost for the new docker-prod one ───
#
# Approach: install the new docker vhost as a DIFFERENT file in sites-available
# (vpatlas.org-docker), so the legacy file stays untouched as a rollback safety
# net. Cutover only changes which file the sites-enabled symlink points at.
#
# Pre-req: inspect-legacy-nginx has been run and you know the actual legacy
# vhost name (could be `vpatlas.org`, `default`, etc.). Pass it as $2 if not
# the default below. The script REQUIRES it to be in sites-enabled.
cutover)
    LEGACY_LINK="${2:-/etc/nginx/sites-enabled/vpatlas.org}"
    NEW_AVAIL="/etc/nginx/sites-available/vpatlas.org-docker"
    NEW_LINK="/etc/nginx/sites-enabled/vpatlas.org-docker"
    echo "=== Cutover: vpatlas.org → ui_vp_prod (127.0.0.1:8091) ==="
    echo "  Legacy vhost link:  $LEGACY_LINK"
    echo "  New docker vhost:   $NEW_AVAIL  ←  $NEW_LINK"

    read -p "Confirm cutover? Type YES to proceed: " confirm
    [[ "$confirm" != "YES" ]] && { echo "Aborted."; exit 1; }

    scp -i "$SSH_KEY" deploy/nginx-vpatlas.org.conf "$SSH_HOST:/tmp/"

    ssh_cmd "set -e; \
        TS=\$(date +%Y%m%d_%H%M%S); \
        # 1. Stage the new vhost file in sites-available (separate filename from legacy)
        sudo cp /tmp/nginx-vpatlas.org.conf '$NEW_AVAIL'; \
        # 2. Note the legacy link target for rollback
        if [ -L '$LEGACY_LINK' ] || [ -f '$LEGACY_LINK' ]; then \
            LEGACY_TARGET=\$(readlink -f '$LEGACY_LINK' 2>/dev/null || echo '$LEGACY_LINK'); \
            echo \"\$LEGACY_TARGET\" | sudo tee \"/home/ubuntu/legacy_vpatlas_vhost_\${TS}.target\" >/dev/null; \
            echo \"Recorded legacy target: \$LEGACY_TARGET → /home/ubuntu/legacy_vpatlas_vhost_\${TS}.target\"; \
        else \
            echo 'WARNING: no existing $LEGACY_LINK to disable.'; \
        fi; \
        # 3. Disable the legacy link, enable the new one
        sudo rm -f '$LEGACY_LINK'; \
        sudo ln -sf '$NEW_AVAIL' '$NEW_LINK'; \
        # 4. Test + reload; on failure, atomically revert
        if sudo nginx -t; then \
            sudo systemctl reload nginx && echo 'Cutover complete.'; \
            echo \"To roll back: ./deploy/deploy-prod.sh rollback /home/ubuntu/legacy_vpatlas_vhost_\${TS}.target\"; \
        else \
            echo 'nginx -t failed — auto-rolling back.' >&2; \
            sudo rm -f '$NEW_LINK'; \
            if [ -f \"/home/ubuntu/legacy_vpatlas_vhost_\${TS}.target\" ]; then \
                LEGACY_TARGET=\$(cat \"/home/ubuntu/legacy_vpatlas_vhost_\${TS}.target\"); \
                sudo ln -sf \"\$LEGACY_TARGET\" '$LEGACY_LINK'; \
            fi; \
            sudo nginx -t && sudo systemctl reload nginx; \
            exit 1; \
        fi"
    ;;

# ─── Rollback the cutover ───
# Reverses the symlink flip done by `cutover`. Pass the .target file path
# printed by cutover; default: newest .target snapshot.
rollback)
    SNAPSHOT="${2:-}"
    LEGACY_LINK="${3:-/etc/nginx/sites-enabled/vpatlas.org}"
    NEW_LINK="/etc/nginx/sites-enabled/vpatlas.org-docker"
    echo "=== Rollback: restore legacy vpatlas.org vhost ==="

    if [ -z "$SNAPSHOT" ]; then
        SNAPSHOT=$(ssh_cmd "ls -t /home/ubuntu/legacy_vpatlas_vhost_*.target 2>/dev/null | head -1")
        [ -z "$SNAPSHOT" ] && { echo "No snapshot found. Pass the .target file explicitly."; exit 1; }
    fi
    echo "Snapshot: $SNAPSHOT"

    ssh_cmd "set -e; \
             LEGACY_TARGET=\$(cat '$SNAPSHOT'); \
             echo \"Restoring symlink: $LEGACY_LINK → \$LEGACY_TARGET\"; \
             sudo rm -f '$NEW_LINK'; \
             sudo ln -sf \"\$LEGACY_TARGET\" '$LEGACY_LINK'; \
             sudo nginx -t && sudo systemctl reload nginx && \
             echo 'Legacy vhost restored.'"
    ;;

# ─── Status ───
# ─── Read-only: validate prod's .env without deploying anything ───
preflight)
    preflight_env
    ;;

status)
    echo "=== Remote prod status ==="
    ssh_cmd "cd $REMOTE_DIR && $COMPOSE ps"
    echo ""
    echo "=== Migrations table (db_vp_prod) ==="
    ssh_cmd "docker exec db_vp_prod psql -U postgres -d vpatlas -c \
        \"SELECT id, filename, applied_at FROM schema_migrations ORDER BY id\"" 2>/dev/null || \
        echo "(schema_migrations table not present — migrations may not have run yet)"
    ;;

# ─── Logs ───
logs)
    ssh_cmd "cd $REMOTE_DIR && $COMPOSE logs --tail=80 ${2:-}"
    ;;

help|*)
    cat <<EOF
Usage: $0 {ui|deploy|preflight|status|logs|db-dump-from-live|db-restore-from-live|backup-install|backup-lifecycle|setup|clone|inspect-legacy-nginx|cutover|rollback}

== Day-to-day app updates ==

  ./deploy/deploy-prod.sh ui         # standard UI update: sw-build patch +
                                     #   local rebuild + commit/push +
                                     #   prod rebuild. Use this for any
                                     #   change under ui_vp/uiVPAtlas/**
                                     #   plus deploy/ scripts, db_restore.sh,
                                     #   etc. (non-UI files ride along
                                     #   via the remote git pull).

  ./deploy/deploy-prod.sh deploy     # full-stack update: same as 'ui' but
                                     #   also rebuilds api_vp(_prod) and
                                     #   runs any new migrations. Use when
                                     #   api_vp/** or db_migrate/** changed.

  Both accept an optional commit message:
    ./deploy/deploy-prod.sh ui "fix login redirect"

== Inspect ==

  ./deploy/deploy-prod.sh status     # docker compose ps on prod
  ./deploy/deploy-prod.sh logs [svc] # tail -80 of prod logs

== DB ==

  ./deploy/deploy-prod.sh db-dump-from-live      # pg_dump legacy → prod's db_backup/
  ./deploy/deploy-prod.sh db-restore-from-live   # dump + DROP/CREATE + restore

== Backups ==

  ./deploy/deploy-prod.sh backup-install         # write ~/.vpatlas_backup.conf,
                                                 #   disable legacy .backup cron,
                                                 #   install 2 AM cron for the new
                                                 #   db_dump_restore/db_backup.sh
                                                 #   pipeline, run one validation
                                                 #   dump. Idempotent — re-run anytime.

  ./deploy/deploy-prod.sh backup-lifecycle       # apply S3 lifecycle rules to
                                                 #   s3://vpatlas.backup/ from
                                                 #   deploy/s3-lifecycle.json
                                                 #   (daily 30d / weekly 90d /
                                                 #   monthly 365d). Idempotent.

== One-time bootstrap (already done — kept for reproducibility) ==

  ./deploy/deploy-prod.sh setup                  # install api.vpatlas.org nginx vhost
  ./deploy/deploy-prod.sh clone                  # initial git clone on AWS
  ./deploy/deploy-prod.sh inspect-legacy-nginx   # find legacy vhost name
  ./deploy/deploy-prod.sh cutover [legacy-path]  # flip vpatlas.org nginx to docker UI
  ./deploy/deploy-prod.sh rollback               # restore legacy vhost
EOF
    ;;
esac
