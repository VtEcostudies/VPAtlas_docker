#!/bin/bash
#
# deploy-dev.sh — Deploy VPAtlas to dev.vpatlas.org
#
# Run from your local machine:
#   ./deploy/deploy-dev.sh              # full deploy (pull + build all)
#   ./deploy/deploy-dev.sh ui           # rebuild UI only
#   ./deploy/deploy-dev.sh setup        # first-time setup (nginx + certs)
#
set -e

SSH_KEY="/home/jloomis/.ssh/vpatlas_aws_key_pair.pem"
SSH_HOST="ubuntu@vpatlas.org"
REMOTE_DIR="/home/ubuntu/VPAtlas_docker"
COMPOSE="docker compose -f docker-compose-vpatlas.yml -f docker-compose-dev.yml"

ssh_cmd() {
    ssh -i "$SSH_KEY" "$SSH_HOST" "$@"
}

case "${1:-deploy}" in

# ─── First-time setup: nginx configs + SSL certs ───
setup)
    echo "=== Setting up nginx + SSL on remote ==="

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

    # Push local commits first
    echo "Pushing to origin..."
    git push origin main 2>/dev/null || echo "(push skipped or failed — continuing)"

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

    git push origin main 2>/dev/null || echo "(push skipped)"

    ssh_cmd "cd $REMOTE_DIR && \
             git pull origin main && \
             $COMPOSE up -d --build ui_vp"

    VERSION=$(ssh_cmd "docker exec ui_vp cat /opt/ui/uiVPAtlas/explore/manifest.json" 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "?")
    echo ""
    echo "UI rebuilt: https://dev.vpatlas.org (v${VERSION})"
    ;;

# ─── DB restore: restore database from backup ───
db-restore)
    echo "=== Restoring DB on remote ==="
    ssh_cmd "cd $REMOTE_DIR && bash db_restore.sh"
    echo "DB restored."
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
