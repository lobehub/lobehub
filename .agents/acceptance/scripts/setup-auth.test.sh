#!/usr/bin/env bash
# Smoke tests for setup-auth.sh. Uses a temporary agent-browser stub and local
# HTTP server, so it does not need real browser auth.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/setup-auth.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local text="$2"
  grep -Fq "$text" "$file" || fail "expected '$text' in $file"
}

tmp_dir="$(mktemp -d)"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" > /dev/null 2>&1 || true
    wait "$server_pid" > /dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
export HOME="$tmp_dir/home"

port="$(python3 - << 'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"

python3 - "$port" << 'PY' > "$tmp_dir/http.log" 2>&1 &
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/v1/users/me"):
            if self.headers.get("authorization") != "Bearer sk-lh-agenttesting0001":
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"success":false}')
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"success":true,"data":{"id":"user_agent_testing_001"}}')
            return

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        length = int(self.headers.get("content-length") or "0")
        if length:
            self.rfile.read(length)

        if self.path != "/api/auth/sign-in/email":
            self.send_response(404)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header(
            "Set-Cookie",
            "better-auth.session_token=seed.token; Path=/; HttpOnly; SameSite=Lax",
        )
        self.send_header(
            "Set-Cookie",
            "better-auth.session_data=seed.data; Path=/; HttpOnly; SameSite=Lax",
        )
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format, *args):
        return


ThreadingHTTPServer(("localhost", int(sys.argv[1])), Handler).serve_forever()
PY
server_pid="$!"

server_url="http://localhost:$port"
for _ in {1..50}; do
  if curl -s -o /dev/null "$server_url/"; then
    break
  fi
  sleep 0.1
done
curl -s -o /dev/null "$server_url/" || fail "test HTTP server did not start"

mkdir -p "$tmp_dir/bin" "$tmp_dir/auth"
cat > "$tmp_dir/bin/agent-browser" << 'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--session" ]]; then
  shift 2
fi

case "${1:-}" in
  state)
    [[ "${2:-}" == "load" ]] || exit 2
    [[ -f "${3:-}" ]] || exit 1
    ;;
  open)
    printf '%s\n' "${2:-}" > "${AGENT_BROWSER_URL_FILE:?}"
    ;;
  get)
    [[ "${2:-}" == "url" ]] || exit 2
    cat "${AGENT_BROWSER_URL_FILE:?}"
    ;;
  *)
    echo "unexpected agent-browser command: $*" >&2
    exit 2
    ;;
esac
SH
chmod +x "$tmp_dir/bin/agent-browser"

export PATH="$tmp_dir/bin:$PATH"
export AUTH_DIR="$tmp_dir/auth"
export SESSION="setup-auth-test"
export SERVER_URL="$server_url"
export AGENT_BROWSER_URL_FILE="$tmp_dir/current-url"

cookie_header="Cookie: foo=bar; better-auth.session_token=test.token; better-auth.session_data=encoded%3D; theme=dark"
printf '%s\n' "$cookie_header" | "$SCRIPT" web > "$tmp_dir/web.out"

python3 - "$AUTH_DIR/web-state.json" << 'PY'
import json, sys

with open(sys.argv[1]) as f:
    state = json.load(f)

names = {cookie["name"] for cookie in state["cookies"]}
expected = {"better-auth.session_token", "better-auth.session_data"}
if names != expected:
    raise SystemExit(f"unexpected cookies: {sorted(names)}")
PY

"$SCRIPT" web-seed > "$tmp_dir/web-seed.out"

python3 - "$AUTH_DIR/web-state.json" << 'PY'
import json, sys

with open(sys.argv[1]) as f:
    state = json.load(f)

values = {cookie["name"]: cookie["value"] for cookie in state["cookies"]}
expected = {
    "better-auth.session_token": "seed.token",
    "better-auth.session_data": "seed.data",
}
if values != expected:
    raise SystemExit(f"unexpected seeded cookies: {values}")
PY

"$SCRIPT" status --surface web > "$tmp_dir/status.out"
assert_contains "$tmp_dir/status.out" "surface=web"
assert_contains "$tmp_dir/status.out" "web auth green"

"$SCRIPT" cli-seed > "$tmp_dir/cli-seed.out"
assert_contains "$tmp_dir/cli-seed.out" "CLI API-key auth valid"
assert_contains "$tmp_dir/cli-seed.out" "settings saved at: $HOME/.lobehub-dev/settings.json"

if "$SCRIPT" status --surface cli > "$tmp_dir/cli-no-env.out"; then
  fail "cli status without API key unexpectedly passed"
fi
assert_contains "$tmp_dir/cli-no-env.out" "CLI not logged in"

LOBEHUB_CLI_API_KEY=sk-lh-agenttesting0001 "$SCRIPT" status --surface cli > "$tmp_dir/cli-status.out"
assert_contains "$tmp_dir/cli-status.out" "CLI API-key auth valid"
assert_contains "$tmp_dir/cli-status.out" "cli auth green"

if printf 'foo=bar\n' | "$SCRIPT" web > "$tmp_dir/invalid.out" 2> "$tmp_dir/invalid.err"; then
  fail "invalid cookie unexpectedly passed"
fi
assert_contains "$tmp_dir/invalid.err" "no better-auth cookies found"

echo "setup-auth tests passed"
