#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/app-probe.sh"
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

mkdir -p "$TEST_TMP/bin"
cat > "$TEST_TMP/bin/agent-browser" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == *"eval --stdin"* ]]; then
  source="$(cat)"
  case "$source" in
    *rootChildren*) echo '{"ok":true,"rootChildren":1,"storeCount":2,"stores":["chat","user"]}' ;;
    *user.getUserState*) echo '{"ok":true,"authenticated":true,"status":200}' ;;
    *Object.keys\(stores\).sort*) echo '{"ok":true,"stores":["chat","user"]}' ;;
    *runningCount*)
      count_file="${APP_PROBE_TEST_COUNT_FILE:?}"
      count="$(cat "$count_file")"
      if [[ "$count" == "0" ]]; then
        echo '{"ok":true,"running":[],"runningCount":1,"total":1}'
        echo 1 > "$count_file"
      else
        echo '{"ok":true,"running":[],"runningCount":0,"total":1}'
      fi
      ;;
    *activeTopicId*) echo '{"ok":true,"activeTopicId":"topic_1","agentId":"agent_1","metadata":{"workingDirectoryConfig":{"path":"/tmp/repo"}},"reason":null}' ;;
    *location.pathname*) echo '/settings' ;;
    *) echo '{}' ;;
  esac
  exit 0
fi

if [[ "$*" == *"eval location.href ="* ]]; then
  printf '%s\n' "$*" > "${APP_PROBE_TEST_GOTO_FILE:?}"
  exit 0
fi

echo "unexpected agent-browser invocation: $*" >&2
exit 2
SH
chmod +x "$TEST_TMP/bin/agent-browser"

export PATH="$TEST_TMP/bin:$PATH"
export APP_PROBE_TEST_COUNT_FILE="$TEST_TMP/count"
export APP_PROBE_TEST_GOTO_FILE="$TEST_TMP/goto"
echo 0 > "$APP_PROBE_TEST_COUNT_FILE"

ready="$("$SCRIPT" ready)"
assert_contains "$ready" '"rootChildren":1'

server_auth="$("$SCRIPT" server-auth)"
assert_contains "$server_auth" '"status":200'

stores="$("$SCRIPT" stores)"
assert_contains "$stores" '"chat"'

topic="$("$SCRIPT" topic)"
assert_contains "$topic" '"activeTopicId":"topic_1"'
assert_contains "$topic" '"workingDirectoryConfig"'

settled="$("$SCRIPT" wait-ops 2)"
assert_contains "$settled" '"runningCount":0'

"$SCRIPT" goto "/agent/a'b?tab=1" > "$TEST_TMP/goto.out"
goto_call="$(cat "$APP_PROBE_TEST_GOTO_FILE")"
assert_contains "$goto_call" "location.href = \"/agent/a'b?tab=1\""

if "$SCRIPT" wait-ops nope > /dev/null 2>&1; then
  fail "wait-ops accepted a non-numeric timeout"
fi

echo "app-probe tests passed"
