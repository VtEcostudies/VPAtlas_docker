#!/bin/bash
# build_ui.sh — Bump version, rebuild UI container
#
# Usage:
#   ./build_ui.sh          # patch bump (default): 3.1.1 → 3.1.2
#   ./build_ui.sh minor    # minor bump: 3.1.1 → 3.2.0
#   ./build_ui.sh major    # major bump: 3.1.1 → 4.0.0
#
# This script bumps the version in the SOURCE manifest files (on the host)
# so each build starts from the previously committed version. The Docker
# build then bumps again (patch) to produce the running version.
#
# Example: source is 3.1.0, this script bumps to 3.1.1, Docker bumps to 3.1.2.
# The container runs 3.1.2, and next time source starts at 3.1.1.

set -e
cd "$(dirname "$0")"

TYPE="${1:-patch}"

# Bump version in both manifest files using node
bump_version() {
    local manifest="$1"
    local type="$2"
    node -e "
        const fs = require('fs');
        const m = JSON.parse(fs.readFileSync('$manifest', 'utf8'));
        const [major, minor, patch] = m.version.split('.').map(Number);
        switch ('$type') {
            case 'major': m.version = (major+1)+'.0.0'; break;
            case 'minor': m.version = major+'.'+(minor+1)+'.0'; break;
            default:      m.version = major+'.'+minor+'.'+(patch+1); break;
        }
        fs.writeFileSync('$manifest', JSON.stringify(m, null, 4) + '\n');
        console.log('  ' + '$manifest' + ' → ' + m.version);
    "
}

echo "Bumping version ($TYPE)..."
bump_version "ui_vp/uiVPAtlas/explore/manifest.json" "$TYPE"
bump_version "ui_vp/uiVPAtlas/survey/manifest.json" "$TYPE"

echo "Building UI container..."
docker compose -f docker-compose-vpatlas.yml up -d --build ui_vp 2>&1 | tail -8

# Show final version
RUNNING_VERSION=$(docker exec ui_vp cat /opt/ui/uiVPAtlas/explore/manifest.json 2>/dev/null | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).version))" 2>/dev/null || echo "?")
echo ""
echo "UI running version: $RUNNING_VERSION"
