#!/usr/bin/env bash
# Acceptance guard adapter: asserts the arguments LobeHub supplies to the skill's
# resource guard, and the run-tag validation that keeps ownership narrow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/acceptance-guard.sh"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local value="$1"
  local expected="$2"
  [[ "$value" == *"$expected"* ]] || fail "expected '$expected' in '$value'"
}

# The skill's guard is stubbed: what this test owns is the adapter's arguments. The
# real guard's behaviour is covered upstream in lobehub/acceptance.
cat > "$TEST_TMP/guard-stub.sh" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "--help" ]; then
  echo "Usage: bash resource-guard.sh check|start|claim|stop|status [options]" >&2
  exit 2
fi
printf '%s\n' "$*" >> "${GUARD_STUB_LOG:?}"
SH
chmod +x "$TEST_TMP/guard-stub.sh"

mkdir -p "$TEST_TMP/bin"
cat > "$TEST_TMP/bin/agent-browser" <<'SH'
#!/usr/bin/env bash
echo "ws://127.0.0.1:57604/devtools/browser/49e9d98b-cda8-4136-8b65-3d5342403a02"
SH
cat > "$TEST_TMP/bin/lsof" <<'SH'
#!/usr/bin/env bash
echo 75919
SH
chmod +x "$TEST_TMP/bin/agent-browser" "$TEST_TMP/bin/lsof"

export PATH="$TEST_TMP/bin:$PATH"
export ACCEPTANCE_GUARD_SCRIPT="$TEST_TMP/guard-stub.sh"
export GUARD_STUB_LOG="$TEST_TMP/calls.log"
export ACCEPTANCE_RUN_TAG="lobehub-acceptance-test"
export ACCEPTANCE_GUARD_DIR="$TEST_TMP/state"

# Runs the adapter, records the stub's arguments, and returns the adapter's exit code.
adapter() {
  : > "$GUARD_STUB_LOG"
  set +e
  "$SCRIPT" "$@" > "$TEST_TMP/stdout" 2> "$TEST_TMP/stderr"
  STATUS=$?
  set -e
  return 0
}

stub_args() { cat "$GUARD_STUB_LOG"; }

expect_refused() {
  local message="$1"
  shift
  if adapter "$@" && [ "$STATUS" -eq 0 ]; then
    fail "$message"
  fi
}

# A tag short enough to appear inside unrelated command lines must be refused: the
# guard grants ownership by substring, so a short tag stops other runs' work.
ACCEPTANCE_RUN_TAG=abc
expect_refused "a short run tag must be refused" check
assert_contains "$(cat "$TEST_TMP/stderr")" "at least 8 characters"

ACCEPTANCE_RUN_TAG="has space"
expect_refused "a run tag with spaces must be refused" check

ACCEPTANCE_RUN_TAG=""
expect_refused "an empty run tag must be refused" check

ACCEPTANCE_RUN_TAG="lobehub-acceptance-test"

# start supplies this repository's groups, thresholds, red action and state dir.
adapter start
assert_contains "$(stub_args)" "start --state-dir $TEST_TMP/state"
assert_contains "$(stub_args)" "--run-tag lobehub-acceptance-test"
assert_contains "$(stub_args)" "--group browser=Google Chrome for Testing"
assert_contains "$(stub_args)" "--group devserver=next-server|vite"
assert_contains "$(stub_args)" "--group typecheck=tsgo"
assert_contains "$(stub_args)" "--yellow swap=60,free=20"
assert_contains "$(stub_args)" "--red swap=80,free=8"
assert_contains "$(stub_args)" "--on-red stop-owned"

# A run may retune the thresholds without editing the adapter.
export ACCEPTANCE_GUARD_RED='swap=95,free=4'
adapter start
assert_contains "$(stub_args)" "--red swap=95,free=4"
export ACCEPTANCE_GUARD_RED='swap=80,free=8'

# check tiers on the same thresholds as the watcher, so a run cannot read one tier
# from the one-shot and be acted on by another.
adapter check --json
assert_contains "$(stub_args)" "check --state-dir $TEST_TMP/state"
assert_contains "$(stub_args)" "--yellow swap=60,free=20"
assert_contains "$(stub_args)" "--red swap=80,free=8"
assert_contains "$(stub_args)" "--json"

# Every claimed pid is forwarded, and an empty claim is a usage error.
adapter claim 11 22
assert_contains "$(stub_args)" "claim --state-dir $TEST_TMP/state"
assert_contains "$(stub_args)" "--pid 11 --pid 22"
expect_refused "claim without a pid must be refused" claim
assert_contains "$(cat "$TEST_TMP/stderr")" "claim needs at least one pid"

# claim-browser resolves the session's CDP port to the listening process, which is
# the only positive identifier agent-browser exposes for a run's own browser.
adapter claim-browser app-1234
assert_contains "$(stub_args)" "--pid 75919"
assert_contains "$(cat "$TEST_TMP/stdout")" "browser pid 75919"

# status and stop carry the state dir the run started with, so a run can read its
# recorded tier and teardown can find the watcher it started.
adapter status --json
assert_contains "$(stub_args)" "status --state-dir $TEST_TMP/state"
assert_contains "$(stub_args)" "--json"

adapter stop
assert_contains "$(stub_args)" "stop --state-dir $TEST_TMP/state"

# An unknown subcommand is a usage error, not a silent no-op.
expect_refused "an unknown subcommand must fail" sweep
assert_contains "$(cat "$TEST_TMP/stderr")" "Usage: acceptance-guard.sh"

# A skill too old to have `claim` cannot back this adapter's ownership proof: say so
# instead of failing later with an opaque guard error.
cat > "$TEST_TMP/old-guard-stub.sh" <<'SH'
#!/usr/bin/env bash
echo "Usage: bash resource-guard.sh check|start|stop|status [options]" >&2
exit 2
SH
chmod +x "$TEST_TMP/old-guard-stub.sh"
ACCEPTANCE_GUARD_SCRIPT="$TEST_TMP/old-guard-stub.sh"
expect_refused "an installed skill without claim must be refused" start
assert_contains "$(cat "$TEST_TMP/stderr")" "has no 'claim' mode"
ACCEPTANCE_GUARD_SCRIPT="$TEST_TMP/guard-stub.sh"

echo "acceptance-guard.test.sh: ok"
