#!/usr/bin/env bash
# =============================================================================
# test-offline-serve.sh — offline-deliverability test
# =============================================================================
# Every URL listed in urlsToCache.js must return HTTP 200 with a non-empty
# body from the running ui_vp container. If any precached entry 404s, the
# SW install fails offline and users hit "Unavailable Offline" on first
# visit (or worse, a half-rendered page if the missing entry is a JS dep).
#
# This is the RUNTIME complement to sw-validate.js (which is a build-time
# graph check that every script/link/import in a cached HTML page also
# appears in the cache list). sw-validate proves the list is internally
# consistent; this test proves the deployed UI server actually serves
# each listed URL right now.
#
# Run after every deploy. Exit code 0 = all good, 1 = at least one entry
# is undeliverable.
#
# Usage:
#   ./ui_vp/uiVPAtlas/test-offline-serve.sh                       # localhost:8090
#   BASE=http://staging.example UI_VP_URL=… ./test-offline-serve.sh
#
# Env:
#   BASE  — defaults to http://localhost:8090
# =============================================================================
set -u
BASE=${BASE:-http://localhost:8090}

# Locate urlsToCache.js relative to this script, so the test works from
# any cwd (CI, deploy hook, manual run, etc.).
HERE=$(cd "$(dirname "$0")" && pwd)
URLS_FILE="$HERE/urlsToCache.js"
[[ -r "$URLS_FILE" ]] || { echo "FATAL: cannot read $URLS_FILE"; exit 2; }

# Extract bare URL strings. Strip line comments first so commented-out
# entries (`// '/some/path',`) don't pollute the list. urlsToCache.js
# only uses // line comments, no block comments.
mapfile -t URLS < <(
    sed 's|//.*$||' "$URLS_FILE" \
    | grep -oE "'[^']+'" \
    | tr -d "'" \
    | grep -E '^/' \
    | sort -u
)
total=${#URLS[@]}
if (( total == 0 )); then
    echo "FATAL: no URLs extracted from $URLS_FILE"
    exit 2
fi

echo "offline-serve test: $total URLs from urlsToCache.js against $BASE"

fail=0
declare -a FAILURES
for u in "${URLS[@]}"; do
    # %{http_code} + %{size_download}: catches both 4xx/5xx and 0-byte
    # 200s (the SW would happily cache an empty body and the page would
    # half-render — better to flag both as failure here).
    out=$(curl -sS -o /dev/null -w '%{http_code} %{size_download}' "$BASE$u" 2>/dev/null || echo '000 0')
    code=${out% *}
    size=${out#* }
    if [[ "$code" != "200" || "$size" == "0" ]]; then
        FAILURES+=("$(printf '%-3s %6sB  %s' "$code" "$size" "$u")")
        fail=$((fail + 1))
    fi
done

ok=$((total - fail))
if (( fail == 0 )); then
    echo "PASS: $ok / $total entries deliverable"
    exit 0
fi
echo "FAIL: $fail / $total entries undeliverable:"
printf '  %s\n' "${FAILURES[@]}"
exit 1
