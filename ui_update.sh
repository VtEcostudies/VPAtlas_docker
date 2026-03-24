#!/bin/bash
# ui_update.sh - Rebuild service workers and update manifest versions
# Usage: ./ui_update.sh [major|minor|patch]
#   Defaults to 'patch' if no argument given.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UI_DIR="$SCRIPT_DIR/ui_vp/uiVPAtlas"
TYPE="${1:-patch}"

echo "=============================================="
echo "VPAtlas UI Update - $TYPE version bump"
echo "=============================================="

# Build explore service worker
echo ""
echo "--- Explore App ---"
cd "$UI_DIR/explore" && node sw-build.js "$TYPE"

# Build survey service worker
echo ""
echo "--- Survey App ---"
cd "$UI_DIR/survey" && node sw-build.js "$TYPE"

echo ""
echo "Done. Restart the UI container to pick up changes."
