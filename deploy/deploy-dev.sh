#!/bin/bash
#
# deploy-dev.sh — Deploy VPAtlas to dev.vpatlas.org
#
# Run from your local machine:
#   ./deploy/deploy-dev.sh                          # full deploy (auto-commit + pull + build all)
#   ./deploy/deploy-dev.sh deploy "your message"    # full deploy with custom commit message
#   ./deploy/deploy-dev.sh ui                       # rebuild UI only (auto-commit + pull)
#   ./deploy/deploy-dev.sh ui "your message"        # UI rebuild with custom commit message
#   ./deploy/deploy-dev.sh setup                    # first-time setup (nginx + certs)
#
set -e

SSH_KEY="/home/jloomis/.ssh/vpatlas_aws_key_pair.pem"
SSH_HOST="ubuntu@vpatlas.org"
REMOTE_DIR="/home/ubuntu/VPAtlas_docker"
COMPOSE_FILES="-f docker-compose-vpatlas.yml -f docker-compose-dev.yml"

ssh_cmd() {
    ssh -i "$SSH_KEY" "$SSH_HOST" "$@"
}

# Auto-commit any local changes before pushing.
# Honors .gitignore. Safe to run when there's nothing to commit (no-op).
# Optional argument: custom commit message tail (default: "v<version>").
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

# Auto-detect docker compose command on remote
COMPOSE=$(ssh_cmd "docker compose version >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose'" 2>/dev/null)
COMPOSE="$COMPOSE $COMPOSE_FILES"

case "${1:-deploy}" in

# ─── First-time setup: nginx configs + SSL certs ───
setup)
    echo "=== Setting up nginx + SSL on remote ==="

    # Ensure compatible Docker Compose v2 plugin (v2.24 works with Docker 20.10+)
    COMPOSE_VER="v2.24.7"
    ssh_cmd "INSTALLED=\$(docker compose version --short 2>/dev/null || echo '0'); \
        if echo \$INSTALLED | grep -qE '^2\.(1[0-9]|2[0-4])'; then \
            echo 'Docker Compose \$INSTALLED OK'; \
        else \
            echo 'Installing Docker Compose $COMPOSE_VER...' && \
            sudo mkdir -p /usr/local/lib/docker/cli-plugins && \
            sudo curl -SL https://github.com/docker/compose/releases/download/$COMPOSE_VER/docker-compose-linux-\$(uname -m) \
              -o /usr/local/lib/docker/cli-plugins/docker-compose && \
            sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose && \
            docker compose version; \
        fi"

    # Copy nginx configs
    scp -i "$SSH_KEY" \
        deploy/nginx-dev.vpatlas.org.conf \
        deploy/nginx-api.dev.vpatlas.org.conf \
        "$SSH_HOST:/tmp/"

    ssh_cmd "sudo cp /tmp/nginx-dev.vpatlas.org.conf /etc/nginx/sites-available/dev.vpatlas.org && \
             sudo cp /tmp/nginx-api.dev.vpatlas.org.conf /etc/nginx/sites-available/api.dev.vpatlas.org && \
             sudo ln -s /etc/nginx/sites-available/dev.vpatlas.org /etc/nginx/sites-enabled/ 2>/dev/null; \
             sudo ln -s /etc/nginx/sites-available/api.dev.vpatlas.org /etc/nginx/sites-enabled/ 2>/dev/null; \
             sudo nginx -t && sudo systemctl reload nginx"

    echo ""
    echo "Nginx configured. Now run certbot for SSL:"
    echo "  ssh -i $SSH_KEY $SSH_HOST"
    echo "  sudo certbot --nginx -d dev.vpatlas.org -d api.dev.vpatlas.org"
    echo ""
    echo "Then run: ./deploy/deploy-dev.sh deploy"
    ;;

# ─── Deploy: pull + build + restart ───
deploy)
    echo "=== Deploying to dev.vpatlas.org ==="

    # Auto-commit any local changes ($2 = optional custom commit message)
    commit_local_changes "${2:-}"

    # Push local commits
    echo "Pushing to origin..."
    git push origin main 2>/dev/null || echo "(push skipped or failed — continuing)"

    # Ensure photo_data dir exists and is writable by the container's api user (uid 1001).
    # Container api user differs from host ubuntu user (uid 1000), so we chown to 1001.
    ssh_cmd "cd $REMOTE_DIR && \
             mkdir -p photo_data && \
             sudo chown -R 1001:1001 photo_data && \
             sudo chmod -R u+rwX,g+rwX photo_data"

    # Pull on remote + rebuild
    ssh_cmd "cd $REMOTE_DIR && \
             git pull origin main && \
             $COMPOSE up -d --build"

    # Show running version
    VERSION=$(ssh_cmd "docker exec ui_vp cat /opt/ui/uiVPAtlas/explore/manifest.json" 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "?")
    echo ""
    echo "Deployed: https://dev.vpatlas.org (v${VERSION})"
    ;;

# ─── UI only: rebuild just the UI container ───
ui)
    echo "=== Rebuilding UI on dev.vpatlas.org ==="

    commit_local_changes "${2:-}"
    git push origin main 2>/dev/null || echo "(push skipped)"

    ssh_cmd "cd $REMOTE_DIR && \
             git pull origin main && \
             $COMPOSE up -d --build ui_vp"

    VERSION=$(ssh_cmd "docker exec ui_vp cat /opt/ui/uiVPAtlas/explore/manifest.json" 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "?")
    echo ""
    echo "UI rebuilt: https://dev.vpatlas.org (v${VERSION})"
    ;;

# ─── DB dump + restore: fresh backup from live DB, restore into dev container ───
db-restore)
    echo "=== Dumping live DB and restoring into dev container ==="

    # Dump from the live production DB on the same server
    # Production DB: user=vpatlas, runs on localhost:5432 (outside Docker)
    # Uses sudo -u postgres to connect via peer auth (no password needed)
    echo "Dumping production database..."
    ssh_cmd "mkdir -p $REMOTE_DIR/db_backup && \
        sudo -u postgres pg_dump -d vpatlas \
            -Fc --no-owner --no-privileges \
            -f /tmp/vpatlas_\$(date +%Y%m%d).backup && \
        sudo mv /tmp/vpatlas_\$(date +%Y%m%d).backup $REMOTE_DIR/db_backup/ && \
        sudo chown ubuntu $REMOTE_DIR/db_backup/vpatlas_\$(date +%Y%m%d).backup && \
        ls -lh $REMOTE_DIR/db_backup/vpatlas_\$(date +%Y%m%d).backup"

    echo "Restoring into dev container..."
    ssh_cmd "cd $REMOTE_DIR && bash db_restore.sh"

    echo ""
    echo "Restarting stack (migrations + api)..."
    ssh_cmd "cd $REMOTE_DIR && $COMPOSE restart api_vp"

    echo "DB restore complete."
    ;;

# ─── Status: check what's running ───
status)
    echo "=== Remote status ==="
    ssh_cmd "cd $REMOTE_DIR && $COMPOSE ps"
    ;;

# ─── Logs ───
logs)
    ssh_cmd "cd $REMOTE_DIR && $COMPOSE logs --tail=50 ${2:-}"
    ;;

*)
    echo "Usage: $0 {setup|deploy|ui|db-restore|status|logs [service]}"
    exit 1
    ;;
esac
