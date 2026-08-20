#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/electron-profile-server.py"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP"' EXIT

DB_A="postgresql://postgres:postgres@localhost:5433/postgres"
DB_B="postgresql://postgres:postgres@localhost:5432/other"
PROFILE="$TEST_TMP/lobehub-settings.json"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  [[ "$1" == *"$2"* ]] || fail "expected '$2' in '$1'"
}

write_profile() {
  python3 - "$PROFILE" "$1" <<'PY'
import json, pathlib, sys
path, url = pathlib.Path(sys.argv[1]), sys.argv[2]
path.write_text(json.dumps({
    'dataSyncConfig': {'active': True, 'remoteServerUrl': url, 'storageMode': 'selfHost'},
    'encryptedTokens': {'accessToken': 'a', 'refreshToken': 'r'},
}))
PY
}

read_field() {
  python3 - "$PROFILE" "$1" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
key = sys.argv[2]
if key == 'hasTokens':
    print('yes' if 'encryptedTokens' in data else 'no')
else:
    print(data.get('dataSyncConfig', {}).get(key, ''))
PY
}

# An unstamped profile is the user's own desktop app (or a copy of it). Its tokens
# were signed into another database and fail `invalid_grant` on every boot here.
write_profile 'http://localhost:3111'
out="$("$HELPER" "$PROFILE" 'http://localhost:33976' "$DB_A")"
assert_contains "$out" 'http://localhost:3111 -> http://localhost:33976'
assert_contains "$out" 'dropped tokens signed into another database'
[ "$(read_field hasTokens)" = "no" ] || fail "foreign tokens should have been dropped"
[ "$(read_field remoteServerUrl)" = "http://localhost:33976" ] || fail "server url not repointed"

# Re-running the same launch must not churn the profile.
out="$("$HELPER" "$PROFILE" 'http://localhost:33976' "$DB_A")"
assert_contains "$out" 'already points at http://localhost:33976'

# A sign-in performed against this database survives a move to another worktree:
# the grant is a row in the shared database, so the port is irrelevant. Dropping
# here would cost a manual sign-in every time a worktree changes.
python3 - "$PROFILE" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
data['encryptedTokens'] = {'accessToken': 'a', 'refreshToken': 'r'}
path.write_text(json.dumps(data))
PY
out="$("$HELPER" "$PROFILE" 'http://localhost:31515' "$DB_A")"
assert_contains "$out" 'kept tokens (same database)'
[ "$(read_field hasTokens)" = "yes" ] || fail "same-database tokens must survive a port change"
[ "$(read_field remoteServerUrl)" = "http://localhost:31515" ] || fail "server url not repointed"

# A different database can never honour them.
out="$("$HELPER" "$PROFILE" 'http://localhost:3111' "$DB_B")"
assert_contains "$out" 'dropped tokens signed into another database'
[ "$(read_field hasTokens)" = "no" ] || fail "tokens from another database must be dropped"

# A missing/corrupt settings file must not fail a launch.
echo 'not json' > "$PROFILE"
out="$("$HELPER" "$PROFILE" 'http://localhost:33976' "$DB_A")"
assert_contains "$out" '-> http://localhost:33976'
rm -f "$PROFILE"
out="$("$HELPER" "$PROFILE" 'http://localhost:33976' "$DB_A")"
assert_contains "$out" '-> http://localhost:33976'

echo "electron-profile-server tests passed"
