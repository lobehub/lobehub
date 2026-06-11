#!/usr/bin/env bash
# setup-auth.sh — one-stop auth setup & check for local agent testing.
#
# Auth is the gate for all automated testing: prepare it BEFORE writing any
# test step. Background and failure modes: ../references/auth.md
#
# Usage:
#   setup-auth.sh status        # check server + CLI + web auth readiness
#   setup-auth.sh cli           # interactive CLI device-code login (run by a human)
#   setup-auth.sh web           # stdin = Cookie header -> inject into agent-browser session
#   setup-auth.sh web-verify    # live-check the agent-browser session is authenticated
#
# Env:
#   SERVER_URL  (default http://localhost:3010)   dev server under test
#   SESSION     (default lobehub-dev)             agent-browser session name
#   AUTH_DIR    (default ~/.lobehub-agent-testing) where web state is persisted

set -euo pipefail

SERVER_URL="${SERVER_URL:-http://localhost:3010}"
SESSION="${SESSION:-lobehub-dev}"
AUTH_DIR="${AUTH_DIR:-$HOME/.lobehub-agent-testing}"
STATE_FILE="$AUTH_DIR/web-state.json"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CLI_HOME="$REPO_ROOT/apps/cli/.lobehub-dev"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✘\033[0m %s\n' "$1"; }
note() { printf '      %s\n' "$1"; }

check_server() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SERVER_URL/" 2> /dev/null || true)
  if [[ "$code" =~ ^[23] ]]; then
    ok "dev server reachable at $SERVER_URL"
  else
    bad "dev server NOT reachable at $SERVER_URL (http_code='$code')"
    note "start it: pnpm run dev:next  (see references/dev-server.md)"
    return 1
  fi
}

check_cli() {
  if [[ -f "$CLI_HOME/settings.json" ]] && grep -q "$SERVER_URL" "$CLI_HOME/settings.json"; then
    ok "CLI logged in to $SERVER_URL (creds: apps/cli/.lobehub-dev)"
  else
    bad "CLI not logged in to $SERVER_URL"
    note "ask the user to run:"
    note "cd apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server $SERVER_URL"
    return 1
  fi
}

check_web() {
  if [[ -f "$STATE_FILE" ]]; then
    ok "web auth state saved ($STATE_FILE)"
    note "live-verify: $0 web-verify"
  else
    bad "no web auth state for agent-browser"
    note "copy the Cookie header from Chrome DevTools (Network tab), then:"
    note "pbpaste | $0 web   (see references/auth.md)"
    return 1
  fi
}

check_electron() {
  local cdp_port="${CDP_PORT:-9222}"
  if ! curl -s -o /dev/null --max-time 2 "http://localhost:$cdp_port/json/version" 2> /dev/null; then
    note "electron: not running (CDP $cdp_port unreachable) — start with electron-dev.sh; check skipped"
    return 0
  fi
  local probe result
  probe="$(dirname "${BASH_SOURCE[0]}")/app-probe.sh"
  result=$(bash "$probe" auth 2> /dev/null || true)
  # agent-browser eval returns the JSON string with escaped quotes — normalize.
  result="${result//\\/}"
  if [[ "$result" == *'"isSignedIn":true'* ]]; then
    ok "electron app signed in ($result)"
  else
    bad "electron app NOT signed in ($result)"
    note "log in once manually inside the app (state persists across restarts)"
    return 1
  fi
}

cmd_status() {
  echo "agent-testing auth status (SERVER_URL=$SERVER_URL):"
  local rc=0
  check_server || rc=1
  check_cli || rc=1
  check_web || rc=1
  check_electron || rc=1
  if [[ $rc -eq 0 ]]; then
    echo "all green — safe to start automated testing."
  else
    echo "auth NOT ready — fix the ✘ items before writing any test step."
  fi
  return $rc
}

cmd_cli() {
  echo "Starting CLI device-code login against $SERVER_URL ..."
  echo "(opens a browser authorization — must be run by a human in a terminal)"
  cd "$REPO_ROOT/apps/cli"
  LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server "$SERVER_URL"
}

# Build a Playwright storageState file from a raw Cookie header on stdin,
# keeping only the better-auth cookies. See references/auth.md for why the
# header must come from a Network request (HttpOnly) and why httpOnly=false.
cmd_web() {
  mkdir -p "$AUTH_DIR"
  python3 - "$STATE_FILE" << 'PY'
import json, sys, time

raw = sys.stdin.read().strip()
if raw.lower().startswith("cookie:"):
    raw = raw.split(":", 1)[1].strip()

WANTED = {"better-auth.session_token", "better-auth.state"}
exp = int(time.time()) + 30 * 24 * 3600  # 30 days

cookies = []
for pair in raw.split("; "):
    if "=" not in pair:
        continue
    name, _, value = pair.partition("=")
    if name not in WANTED:
        continue
    cookies.append({
        "name": name,
        "value": value,
        "domain": "localhost",
        "path": "/",
        "expires": exp,
        "httpOnly": False,
        "secure": False,
        "sameSite": "Lax",
    })

if not cookies:
    sys.stderr.write("no better-auth cookies found in input — paste the raw Cookie header from a Network request\n")
    sys.exit(1)

with open(sys.argv[1], "w") as f:
    json.dump({"cookies": cookies, "origins": []}, f, indent=2)
print(f"wrote {len(cookies)} cookie(s) to {sys.argv[1]}")
PY
  agent-browser --session "$SESSION" state load "$STATE_FILE"
  cmd_web_verify
}

cmd_web_verify() {
  agent-browser --session "$SESSION" open "$SERVER_URL/" > /dev/null
  local url
  url=$(agent-browser --session "$SESSION" get url)
  if [[ "$url" == *"/signin"* || "$url" == *"/login"* ]]; then
    bad "agent-browser session '$SESSION' NOT authenticated (landed on $url)"
    note "re-copy the Cookie header and re-run: pbpaste | $0 web"
    return 1
  fi
  ok "agent-browser session '$SESSION' authenticated (at $url)"
}

case "${1:-status}" in
  status) cmd_status ;;
  cli) cmd_cli ;;
  web) cmd_web ;;
  web-verify) cmd_web_verify ;;
  *)
    echo "Usage: $0 {status|cli|web|web-verify}" >&2
    exit 2
    ;;
esac
