#!/usr/bin/env bash
# Local regression coverage for the macOS pressure policy in the installed guard.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/.agents/skills/acceptance/scripts/resource-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
export GUARD_TEST_DIR="$TMP"

cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env bash
echo "${TEST_PLATFORM:-Darwin}"
SH
cat > "$TMP/bin/sysctl" <<'SH'
#!/usr/bin/env bash
case "$2" in
  hw.memsize) echo 25769803776 ;;
  vm.swapusage) echo 'total = 1024.00M used = 950.00M free = 74.00M (encrypted)' ;;
  kern.memorystatus_vm_pressure_level)
    if [ -f "$GUARD_TEST_DIR/sequence" ]; then
      n=$(cat "$GUARD_TEST_DIR/index")
      n=$((n + 1))
      echo "$n" > "$GUARD_TEST_DIR/index"
      value=$(sed -n "${n}p" "$GUARD_TEST_DIR/sequence")
    else
      value="${TEST_PRESSURE:-1}"
    fi
    [ "$value" != missing ] || exit 1
    echo "$value"
    ;;
  *) exit 1 ;;
esac
SH
cat > "$TMP/bin/vm_stat" <<'SH'
#!/usr/bin/env bash
# Approximately 4% free, based on the captured 24 GiB host; swap is also >80%.
echo 'Mach Virtual Memory Statistics: (page size of 16384 bytes)'
echo 'Pages free: 63491.'
echo 'Pages speculative: 5373.'
SH
cat > "$TMP/bin/ps" <<'SH'
#!/usr/bin/env bash
# No real processes may be selected by these watcher tests.
exit 0
SH
cat > "$TMP/bin/sleep" <<'SH'
#!/usr/bin/env bash
if [ -f "$GUARD_TEST_DIR/sequence" ]; then
  n=$(cat "$GUARD_TEST_DIR/index")
  total=$(wc -l < "$GUARD_TEST_DIR/sequence")
  if [ "$n" -ge "$total" ]; then rm -f "$GUARD_TEST_DIR/state/guard.pid"; fi
fi
SH
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH"

check() {
  local expected_exit="$1" expected_tier="$2"
  shift 2
  local status=0 output
  output=$(bash "$GUARD" check --yellow swap=60,free=20 --red swap=80,free=8 --json "$@") || status=$?
  [ "$status" -eq "$expected_exit" ] || { echo "FAIL: exit $status, expected $expected_exit: $output"; exit 1; }
  if [ -n "$expected_tier" ]; then
    echo "$output" | grep -q "\"platform\":\"Darwin\",\"tier\":\"$expected_tier\"" || { echo "FAIL: $output"; exit 1; }
  fi
  LAST_OUTPUT="$output"
}

TEST_PRESSURE=1 check 0 green
echo "$LAST_OUTPUT" | grep -q '"pressure":{"level":1,"status":"normal"}'
echo "$LAST_OUTPUT" | grep -q '"free":{"pct":4}'
echo "$LAST_OUTPUT" | grep -q '"usedMb":950'
TEST_PRESSURE=2 check 10 yellow
TEST_PRESSURE=4 check 20 red
TEST_PRESSURE=missing check 2 unknown
TEST_PRESSURE=8 check 2 unknown

# Explicit process budgets remain enforced. A later yellow pressure breach must
# not override the top-level red verdict when extracting the exit code.
TEST_PRESSURE=2 check 20 red --red total.rss=0

TEST_PLATFORM=Windows_NT check 2 ''

watch_case() {
  local sequence="$1" expected_stops="$2" expected_pending="$3"
  printf '%s\n' "$sequence" | tr ',' '\n' > "$TMP/sequence"
  echo 0 > "$TMP/index"
  mkdir -p "$TMP/state"
  cat > "$TMP/state/config" <<'CONF'
RUN_TAG=guard-test-owned
INTERVAL=10
ON_RED=stop-owned
GRACE=0
YELLOW=swap=60,free=20
RED=swap=80,free=8
CONF
  : > "$TMP/state/guard.pid"
  : > "$TMP/state/events.jsonl"
  : > "$TMP/state/samples.jsonl"
  bash "$GUARD" __watch --state-dir "$TMP/state"
  local stops pending
  stops=$(grep -c '"action":"stop-owned"' "$TMP/state/events.jsonl" || true)
  pending=$(grep -c '"action":"pending"' "$TMP/state/events.jsonl" || true)
  [ "$stops" -eq "$expected_stops" ] && [ "$pending" -eq "$expected_pending" ] || {
    echo "FAIL: sequence=$sequence stops=$stops pending=$pending"
    cat "$TMP/state/events.jsonl"
    exit 1
  }
}

watch_case '1,1,1' 0 0
watch_case '4,4' 0 2
watch_case '4,4,4' 1 2
watch_case '4,4,1,4,4,4' 1 4
watch_case '4,4,2,4,4' 0 4
watch_case '4,4,missing,4,4' 0 4
watch_case '4,4,8,4,4' 0 4

echo 'resource-guard.test.sh: ok'
