#!/bin/bash
# test_stack.sh - VPAtlas Docker stack smoke tests
#
# Run before any deployment to verify all services are healthy.
# Usage: ./test_stack.sh
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed

COMPOSE_FILE="docker-compose-vpatlas.yml"
API_URL="http://localhost:4010"
UI_URL="http://localhost:8090"

PASSED=0
FAILED=0
TOTAL=0

# Colors (if terminal supports them)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

pass() {
    PASSED=$((PASSED + 1))
    TOTAL=$((TOTAL + 1))
    echo -e "  ${GREEN}PASS${NC}  $1"
}

fail() {
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
    echo -e "  ${RED}FAIL${NC}  $1"
    if [ -n "$2" ]; then echo "        $2"; fi
}

section() {
    echo ""
    echo -e "${YELLOW}--- $1 ---${NC}"
}

# =============================================================================
section "Container Health"
# =============================================================================

# db_vp is running and healthy
status=$(docker inspect --format='{{.State.Health.Status}}' db_vp 2>/dev/null)
if [ "$status" = "healthy" ]; then
    pass "db_vp container is healthy"
else
    fail "db_vp container health: $status" "Expected 'healthy'"
fi

# api_vp is running
if docker ps --format '{{.Names}}' | grep -q "^api_vp$"; then
    pass "api_vp container is running"
else
    fail "api_vp container is not running"
fi

# ui_vp is running
if docker ps --format '{{.Names}}' | grep -q "^ui_vp$"; then
    pass "ui_vp container is running"
else
    fail "ui_vp container is not running"
fi

# db_migrate_vp exited successfully (one-shot)
exit_code=$(docker inspect --format='{{.State.ExitCode}}' db_migrate_vp 2>/dev/null)
if [ "$exit_code" = "0" ]; then
    pass "db_migrate_vp exited with code 0"
else
    fail "db_migrate_vp exit code: $exit_code" "Expected 0"
fi

# =============================================================================
section "Database"
# =============================================================================

# PostGIS extension loaded
result=$(docker exec db_vp psql -U postgres -d vpatlas -t -c "SELECT 1 FROM pg_extension WHERE extname='postgis';" 2>/dev/null | tr -d ' ')
if [ "$result" = "1" ]; then
    pass "PostGIS extension is loaded"
else
    fail "PostGIS extension not found"
fi

# Core tables exist
for table in vpmapped vpvisit vpreview vpsurvey vpuser vptown vpcounty; do
    result=$(docker exec db_vp psql -U postgres -d vpatlas -t -c "SELECT 1 FROM information_schema.tables WHERE table_name='$table';" 2>/dev/null | tr -d ' ')
    if [ "$result" = "1" ]; then
        pass "Table '$table' exists"
    else
        fail "Table '$table' not found"
    fi
done

# Data present in key tables
pool_count=$(docker exec db_vp psql -U postgres -d vpatlas -t -c "SELECT count(*) FROM vpmapped;" 2>/dev/null | tr -d ' ')
if [ "$pool_count" -gt 0 ] 2>/dev/null; then
    pass "vpmapped has $pool_count rows"
else
    fail "vpmapped is empty or inaccessible"
fi

user_count=$(docker exec db_vp psql -U postgres -d vpatlas -t -c "SELECT count(*) FROM vpuser;" 2>/dev/null | tr -d ' ')
if [ "$user_count" -gt 0 ] 2>/dev/null; then
    pass "vpuser has $user_count rows"
else
    fail "vpuser is empty or inaccessible"
fi

# =============================================================================
section "API Endpoints"
# =============================================================================

# API is listening
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API_URL/vtinfo/counties" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET /vtinfo/counties returns 200"
else
    fail "GET /vtinfo/counties returned $http_code" "Expected 200"
fi

# Mapped pools endpoint
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/pools/mapped/count" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET /pools/mapped/count returns 200"
else
    fail "GET /pools/mapped/count returned $http_code"
fi

# Pool data returns expected count
api_count=$(curl -s --max-time 10 "$API_URL/pools/mapped/count" 2>/dev/null | grep -o '"count":"[0-9]*"' | grep -o '[0-9]*')
if [ "$api_count" -gt 0 ] 2>/dev/null; then
    pass "API reports $api_count mapped pools"
    # Cross-check with DB
    if [ "$api_count" = "$pool_count" ]; then
        pass "API count matches DB count ($pool_count)"
    else
        fail "API count ($api_count) != DB count ($pool_count)"
    fi
else
    fail "API pool count is empty or invalid"
fi

# Towns endpoint
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API_URL/vtinfo/towns" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET /vtinfo/towns returns 200"
else
    fail "GET /vtinfo/towns returned $http_code"
fi

# Visits endpoint
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/pools/visit" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET /pools/visit returns 200"
else
    fail "GET /pools/visit returned $http_code"
fi

# Reviews endpoint (bare /review requires auth; /review/1 is public per jwt.js)
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/review" 2>/dev/null)
if [ "$http_code" = "200" ] || [ "$http_code" = "401" ]; then
    pass "GET /review returns $http_code (401=auth required, 200=public)"
else
    fail "GET /review returned $http_code" "Expected 200 or 401"
fi

# Survey endpoint
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/survey" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET /survey returns 200"
else
    fail "GET /survey returned $http_code"
fi

# Auth endpoint (should return 400 without credentials, not 500)
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST -H "Content-Type: application/json" -d '{}' "$API_URL/users/authenticate" 2>/dev/null)
if [ "$http_code" = "400" ] || [ "$http_code" = "401" ]; then
    pass "POST /users/authenticate returns $http_code (auth rejection, not crash)"
else
    fail "POST /users/authenticate returned $http_code" "Expected 400 or 401"
fi

# Protected endpoint without token (should return 401)
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST -H "Content-Type: application/json" -d '{}' "$API_URL/pools/mapped" 2>/dev/null)
if [ "$http_code" = "401" ]; then
    pass "POST /pools/mapped without token returns 401"
else
    fail "POST /pools/mapped without token returned $http_code" "Expected 401"
fi

# =============================================================================
section "UI Static Assets"
# =============================================================================

# Explore index
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/explore/" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET /explore/ returns 200"
else
    fail "GET /explore/ returned $http_code"
fi

# Config.js is generated
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/js/config.js" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET /js/config.js returns 200"
else
    fail "GET /js/config.js returned $http_code"
fi

# Config.js contains appConfig
config_content=$(curl -s --max-time 5 "$UI_URL/js/config.js" 2>/dev/null)
if echo "$config_content" | grep -q "appConfig"; then
    pass "config.js contains appConfig object"
else
    fail "config.js does not contain appConfig"
fi

# Auth pages
for page in login.html register.html reset.html; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/explore/$page" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /explore/$page returns 200"
    else
        fail "GET /explore/$page returned $http_code"
    fi
done

# Pool pages
for page in pool_view.html pool_create.html visit_create.html; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/explore/$page" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /explore/$page returns 200"
    else
        fail "GET /explore/$page returned $http_code"
    fi
done

# List pages
for page in review_list.html survey_list.html; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/explore/$page" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /explore/$page returns 200"
    else
        fail "GET /explore/$page returned $http_code"
    fi
done

# Admin pages
for page in profile.html users_admin.html; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/explore/$page" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /explore/$page returns 200"
    else
        fail "GET /explore/$page returned $http_code"
    fi
done

# Survey sub-app
for page in survey_start.html survey_main.html; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/survey/$page" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /survey/$page returns 200"
    else
        fail "GET /survey/$page returned $http_code"
    fi
done

# JS modules
for js in api.js auth.js storage.js utils.js modal.js map.js pool_list.js pool_summary.js filter_bar.js url_state.js; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/explore/js/$js" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /explore/js/$js returns 200"
    else
        fail "GET /explore/js/$js returned $http_code"
    fi
done

# Shared libraries
for lib in bootstrap_5.2.3.min.js leaflet_1.9.4.js resource_manager.js app.js idb-keyval_6.esm.js; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/js/$lib" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /js/$lib returns 200"
    else
        fail "GET /js/$lib returned $http_code"
    fi
done

# CSS files
for css in bootstrap_5.2.3.min.css leaflet_1.9.4.css font-awesome_6.6.0.all.min.css map.css; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$UI_URL/css/$css" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        pass "GET /css/$css returns 200"
    else
        fail "GET /css/$css returned $http_code"
    fi
done

# Root redirect
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -L "$UI_URL/" 2>/dev/null)
if [ "$http_code" = "200" ]; then
    pass "GET / redirects to /explore/ (200)"
else
    fail "GET / returned $http_code after redirect"
fi

# =============================================================================
section "Cross-Service Integration"
# =============================================================================

# UI can reach API (config.js has API port configured)
api_port=$(curl -s --max-time 5 "$UI_URL/js/config.js" 2>/dev/null | grep -o "appConfig.api.port = [0-9]*" | head -1 | grep -o '[0-9]*')
if [ "$api_port" = "4010" ]; then
    pass "config.js API port is 4010"
else
    fail "config.js API port is '$api_port'" "Expected 4010"
fi

# GeoJSON endpoint returns features (used by map)
geojson_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$API_URL/pools/mapped/geojson" 2>/dev/null)
if [ "$geojson_code" = "200" ]; then
    pass "GET /pools/mapped/geojson returns 200 (map data)"
else
    fail "GET /pools/mapped/geojson returned $geojson_code"
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "=============================================="
echo -e "  ${GREEN}Passed: $PASSED${NC}  ${RED}Failed: $FAILED${NC}  Total: $TOTAL"
echo "=============================================="

if [ $FAILED -gt 0 ]; then
    echo -e "  ${RED}STACK NOT READY FOR DEPLOYMENT${NC}"
    exit 1
else
    echo -e "  ${GREEN}ALL TESTS PASSED - READY FOR DEPLOYMENT${NC}"
    exit 0
fi
