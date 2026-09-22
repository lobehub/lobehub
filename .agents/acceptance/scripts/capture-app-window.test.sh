#!/usr/bin/env bash
# Test the project capture helper's boundary with the installed acceptance skill.
# Stub the preflight and OS commands; never capture the user's real desktop.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

PROJECT="$TEST_TMP/project with spaces"
CAPTURE="$PROJECT/.agents/acceptance/scripts/capture-app-window.sh"
PREFLIGHT="$PROJECT/.agents/skills/acceptance/scripts/check-screen-recording.sh"
mkdir -p "$(dirname "$CAPTURE")" "$(dirname "$PREFLIGHT")" "$TEST_TMP/bin"
cp "$SCRIPT_DIR/capture-app-window.sh" "$CAPTURE"

# Skills CLI installs this resource without executable permission.
cat > "$PREFLIGHT" <<'SH'
printf '%s\n' preflight >> "${CAPTURE_TEST_LOG:?}"
echo 'fixture preflight diagnostic'
exit "${CAPTURE_TEST_PREFLIGHT_STATUS:?}"
SH
chmod 644 "$PREFLIGHT"

cat > "$TEST_TMP/bin/swift" <<'SH'
#!/usr/bin/env bash
printf '%s\n' window-lookup >> "${CAPTURE_TEST_LOG:?}"
echo 42
SH
cat > "$TEST_TMP/bin/screencapture" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "capture:$*" >> "${CAPTURE_TEST_LOG:?}"
SH
chmod +x "$TEST_TMP/bin/swift" "$TEST_TMP/bin/screencapture"

export PATH="$TEST_TMP/bin:$PATH"
export CAPTURE_TEST_LOG="$TEST_TMP/calls.log"
export CAPTURE_TEST_PREFLIGHT_STATUS=0
export SKIP_SCREEN_CHECK=0
OUTPUT="$TEST_TMP/window shot.png"

# Invoke from outside the project to catch cwd-relative paths as well.
pushd "$TEST_TMP" >/dev/null
if ! output="$(bash "$CAPTURE" 'Test App' "$OUTPUT" 2>&1)"; then
  fail "capture should continue after a passing installed preflight: $output"
fi
expected="$(printf 'preflight\nwindow-lookup\ncapture:-l 42 -x %s' "$OUTPUT")"
[ "$(cat "$CAPTURE_TEST_LOG")" = "$expected" ] || fail "wrong capture call order or arguments"

# Undetermined, denied, and black-frame checks must all block OS capture.
for status in 2 3 4; do
  export CAPTURE_TEST_PREFLIGHT_STATUS="$status"
  : > "$CAPTURE_TEST_LOG"
  if output="$(bash "$CAPTURE" 'Test App' "$OUTPUT" 2>&1)"; then
    fail "preflight exit $status did not block capture"
  fi
  [ "$(cat "$CAPTURE_TEST_LOG")" = preflight ] || fail "OS commands ran after preflight exit $status"
  [[ "$output" == *'fixture preflight diagnostic'* ]] || fail "preflight diagnostic was lost"
  [[ "$output" == *'preflight did not pass'* ]] || fail "failure was not reported as an unverified preflight"
done

rm "$PREFLIGHT"
: > "$CAPTURE_TEST_LOG"
if bash "$CAPTURE" 'Test App' "$OUTPUT" >/dev/null 2>&1; then
  fail "missing installed preflight did not block capture"
fi
[ ! -s "$CAPTURE_TEST_LOG" ] || fail "OS commands ran without the installed preflight"

# Preserve the existing explicit bypass for callers that already checked capture.
export SKIP_SCREEN_CHECK=1
bash "$CAPTURE" 'Test App' "$OUTPUT"
expected="$(printf 'window-lookup\ncapture:-l 42 -x %s' "$OUTPUT")"
[ "$(cat "$CAPTURE_TEST_LOG")" = "$expected" ] || fail "explicit bypass changed capture behavior"
popd >/dev/null

echo 'capture-app-window tests passed (6 cases)'
