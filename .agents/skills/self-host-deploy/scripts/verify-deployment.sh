#!/usr/bin/env bash
# Verify a LobeHub/Aico self-hosted deployment (functional + best-practice checks).
# Usage: verify-deployment.sh <BASE_URL> [CONTAINER_NAME]
# Example: verify-deployment.sh https://chat.example.com lobehub

set -uo pipefail

BASE_URL="${1:?Usage: $0 <BASE_URL> [CONTAINER_NAME]}"
CONTAINER="${2:-lobehub}"
PASS=0
FAIL=0
WARN=0

green()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
red()    { printf '\033[31m✗\033[0m %s\n' "$*"; }
yellow() { printf '\033[33m!\033[0m %s\n' "$*"; }

check_http() {
  local label="$1" url="$2" expect="${3:-200}"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "$expect" ]]; then
    green "$label → HTTP $code"
    PASS=$((PASS + 1))
    return 0
  fi
  red "$label → HTTP $code (expected $expect) — $url"
  FAIL=$((FAIL + 1))
  return 1
}

check_header() {
  local label="$1" url="$2" header="$3" pattern="$4"
  local value
  value=$(curl -sS -I --max-time 15 "$url" 2>/dev/null | grep -i "^${header}:" | head -1 || true)
  if echo "$value" | grep -qiE "$pattern"; then
    green "$label → $value"
    PASS=$((PASS + 1))
  else
    yellow "$label → missing or unexpected ($value)"
    WARN=$((WARN + 1))
  fi
}

echo "=== LobeHub deployment check: $BASE_URL ==="
echo

# --- Best-practice: HTTPS ---
if [[ "$BASE_URL" == https://* ]]; then
  green "APP_URL uses HTTPS"
  PASS=$((PASS + 1))
else
  yellow "BASE_URL is not HTTPS — required for production"
  WARN=$((WARN + 1))
fi

# --- HTTP functional checks ---
check_http "Root (may redirect)" "$BASE_URL/" "302" || check_http "Root" "$BASE_URL/" "200"
check_http "Sign-in page" "$BASE_URL/signin" "200"
check_http "SPA icons" "$BASE_URL/_spa/icons/icon-192x192.png" "200"
check_http "SPA-auth favicon" "$BASE_URL/_spa-auth/favicon.ico" "200"

# Extract chunks from sign-in HTML
SIGNIN_HTML=$(curl -sS --max-time 15 "$BASE_URL/signin" 2>/dev/null || true)
JS_PATH=$(echo "$SIGNIN_HTML" | grep -oE '/_spa-auth/assets/[^"'\'' ]+\.js' | head -1)
if [[ -n "$JS_PATH" ]]; then
  JS_URL="${BASE_URL}${JS_PATH}"
  check_http "SPA-auth JS chunk ($JS_PATH)" "$JS_URL" "200" || true

  # Best-practice: JS must not be served as text/html (CDN misroute)
  JS_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$JS_URL" 2>/dev/null || echo "000")
  if [[ "$JS_CODE" == "200" ]]; then
    MIME=$(curl -sS -I --max-time 15 "$JS_URL" 2>/dev/null | grep -i '^content-type:' | head -1 || true)
    if echo "$MIME" | grep -qiE 'javascript|ecmascript'; then
      green "JS content-type OK → $MIME"
      PASS=$((PASS + 1))
    else
      red "JS content-type wrong → $MIME (CDN may be returning HTML error page)"
      FAIL=$((FAIL + 1))
    fi
  fi
else
  yellow "Could not find SPA-auth JS path in sign-in HTML"
  WARN=$((WARN + 1))
fi

CSS_PATH=$(echo "$SIGNIN_HTML" | grep -oE '/_spa-auth/assets/[^"'\'' ]+\.css' | head -1)
if [[ -n "$CSS_PATH" ]]; then
  check_http "SPA-auth CSS ($CSS_PATH)" "${BASE_URL}${CSS_PATH}" "200"
fi

# Best-practice: forwarded proto header (proxy config sanity)
check_header "X-Forwarded-Proto (via sign-in)" "$BASE_URL/signin" "x-forwarded-proto" "https"

echo

# --- Container checks (optional, run on deploy host) ---
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "=== Container: $CONTAINER ==="

  for dir in /app/public/_spa/assets /app/public/_spa-auth/assets /app/public/_spa/vendor; do
    count=$(docker exec "$CONTAINER" sh -c "ls -1 $dir 2>/dev/null | wc -l" 2>/dev/null || echo "0")
    if [[ "$count" -gt 2 ]]; then
      green "$dir → $count files"
      PASS=$((PASS + 1))
    else
      red "$dir → $count files (expected many — SPA build may be missing)"
      FAIL=$((FAIL + 1))
    fi
  done

  if docker logs "$CONTAINER" 2>&1 | tail -200 | grep -q "database migration pass"; then
    green "DB migration passed (recent logs)"
    PASS=$((PASS + 1))
  else
    yellow "Could not confirm DB migration in recent logs"
    WARN=$((WARN + 1))
  fi

  # Best-practice: internal services should not be bound to 0.0.0.0
  echo
  echo "=== Port exposure (best practice) ==="
  for port_label in "5432:PostgreSQL" "6379:Redis" "9001:RustFS-admin"; do
    port="${port_label%%:*}"
    name="${port_label#*:}"
    if ss -tln 2>/dev/null | grep -q ":${port} " || netstat -tln 2>/dev/null | grep -q ":${port} "; then
      yellow "$name port $port exposed on host — remove in production (see best-practices.md)"
      WARN=$((WARN + 1))
    else
      green "$name port $port not publicly bound"
      PASS=$((PASS + 1))
    fi
  done

  # Best-practice: lobe should bind localhost only in production
  if ss -tln 2>/dev/null | grep -q '127.0.0.1:3210 ' || netstat -tln 2>/dev/null | grep -q '127.0.0.1:3210 '; then
    green "Lobe bound to 127.0.0.1:3210 (good)"
    PASS=$((PASS + 1))
  elif ss -tln 2>/dev/null | grep -q ':3210 ' || netstat -tln 2>/dev/null | grep -q ':3210 '; then
    yellow "Lobe bound to 0.0.0.0:3210 — use production override to bind localhost"
    WARN=$((WARN + 1))
  fi
else
  yellow "Container '$CONTAINER' not running locally — skipping in-container checks"
  WARN=$((WARN + 1))
fi

echo
echo "=== Summary: $PASS passed, $FAIL failed, $WARN warnings ==="
if [[ "$FAIL" -gt 0 ]]; then
  echo "Fix failures before production. See best-practices.md and reference.md."
  exit 1
fi
if [[ "$WARN" -gt 0 ]]; then
  echo "Warnings present — review best-practices.md before going public."
fi
