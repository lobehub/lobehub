#!/usr/bin/env bash
# Smoke tests for test-env.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  [[ "$actual" == "$expected" ]] || fail "expected '$expected', got '$actual'"
}

assert_contains() {
  local file="$1"
  local text="$2"
  grep -Fq "$text" "$file" || fail "expected '$text' in $file"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/lobehub-cloud-1/.agents/skills" "$tmp_dir/lobehub/.agents/skills"
ln -s "$SCRIPT_DIR/.." "$tmp_dir/lobehub-cloud-1/.agents/skills/agent-testing"
ln -s "$SCRIPT_DIR/.." "$tmp_dir/lobehub/.agents/skills/agent-testing"

cloud_script="$tmp_dir/lobehub-cloud-1/.agents/skills/agent-testing/scripts/test-env.sh"
oss_script="$tmp_dir/lobehub/.agents/skills/agent-testing/scripts/test-env.sh"

assert_eq "$("$cloud_script" --value SERVER_URL)" "http://localhost:3021"
assert_eq "$("$cloud_script" --value SPA_PORT)" "9801"
assert_eq "$("$cloud_script" --value MOBILE_SPA_PORT)" "3811"
assert_eq "$("$cloud_script" --value DESKTOP_PORT)" "3031"
assert_eq "$("$oss_script" --value SERVER_URL)" "http://localhost:3010"

cat > "$tmp_dir/lobehub-cloud-1/.env" << 'EOF'
APP_URL=http://localhost:4123
PORT=4123
AUTH_TRUSTED_ORIGINS=http://localhost:4123,http://localhost:9823
SPA_PORT=9823
MOBILE_SPA_PORT=3823
DESKTOP_PORT=3043
EOF

assert_eq "$("$cloud_script" --value SERVER_URL)" "http://localhost:4123"
assert_eq "$("$cloud_script" --value SPA_PORT)" "9823"
"$cloud_script" --exports > "$tmp_dir/exports.out"
assert_contains "$tmp_dir/exports.out" "export APP_URL=http://localhost:4123"
assert_contains "$tmp_dir/exports.out" "export SERVER_URL=http://localhost:4123"
assert_contains "$tmp_dir/exports.out" "export AUTH_TRUSTED_ORIGINS=http://localhost:4123\\,http://localhost:9823"

echo "test-env tests passed"
