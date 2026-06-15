#!/usr/bin/env bash
# setup-auth.sh — one-stop auth setup & check for local agent testing.
#
# Auth is the gate for all automated testing: prepare it BEFORE writing any
# test step. Background and failure modes: ../references/auth.md
#
# Usage:
#   setup-auth.sh status        # check server + CLI + web + Electron readiness
#   setup-auth.sh status --surface web  # check only the Web surface gate
#   setup-auth.sh cli-seed      # configure CLI API-key auth from seeded local env
#   setup-auth.sh cli           # interactive CLI device-code login (run by a human)
#   setup-auth.sh open-chrome   # open SERVER_URL in Chrome and show DevTools
#   setup-auth.sh web-seed      # sign in seeded user and inject cookies automatically
#   setup-auth.sh web           # stdin = Cookie header -> inject into agent-browser session
#   setup-auth.sh web-verify    # live-check the agent-browser session is authenticated
#
# Env:
#   SERVER_URL  (default from test-env.sh)        dev server under test
#   SESSION     (default lobehub-dev)             agent-browser session name
#   AUTH_DIR    (default ~/.lobehub-agent-testing) where web state is persisted
#   SEED_EMAIL / SEED_PASSWORD                    seeded better-auth login

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

workspace_root_for_port() {
  local root="$REPO_ROOT"
  local name
  name="$(basename "$root")"

  if [[ "$name" == "lobehub" ]]; then
    local parent
    parent="$(cd "$root/.." && pwd)"
    local parent_name
    parent_name="$(basename "$parent")"
    if [[ "$parent_name" == lobehub-cloud* ]]; then
      root="$parent"
    fi
  fi

  printf '%s\n' "$root"
}

default_server_url() {
  local env_resolver resolved
  env_resolver="$(dirname "${BASH_SOURCE[0]}")/test-env.sh"
  if [[ -x "$env_resolver" ]]; then
    resolved="$("$env_resolver" --value SERVER_URL 2> /dev/null || true)"
    if [[ -n "$resolved" ]]; then
      printf '%s\n' "$resolved"
      return 0
    fi
  fi

  local root name suffix port
  root="$(workspace_root_for_port)"
  name="$(basename "$root")"

  case "$name" in
    lobehub-cloud)
      port=3020
      ;;
    lobehub-cloud-*)
      suffix="${name#lobehub-cloud-}"
      if [[ "$suffix" =~ ^[0-9]+$ ]]; then
        port=$((3020 + 10#$suffix))
      else
        port=3010
      fi
      ;;
    *)
      port=3010
      ;;
  esac

  printf 'http://localhost:%s\n' "$port"
}

SERVER_URL="${SERVER_URL:-$(default_server_url)}"
SESSION="${SESSION:-lobehub-dev}"
AUTH_DIR="${AUTH_DIR:-$HOME/.lobehub-agent-testing}"
STATE_FILE="$AUTH_DIR/web-state.json"
CLI_HOME_NAME="${LOBEHUB_CLI_HOME:-.lobehub-dev}"
CLI_HOME="$HOME/${CLI_HOME_NAME#/}"
CLI_CREDENTIALS_FILE="$CLI_HOME/credentials.json"
SEED_EMAIL="${SEED_EMAIL:-agent-testing@lobehub.com}"
SEED_PASSWORD="${SEED_PASSWORD:-TestPassword123!}"
SEED_API_KEY="${SEED_API_KEY:-${AGENT_TESTING_API_KEY:-sk-lh-agenttesting0001}}"
CLI_ENV_FILE="${CLI_ENV_FILE:-$REPO_ROOT/.records/env/agent-testing-cli.env}"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✘\033[0m %s\n' "$1"; }
note() { printf '      %s\n' "$1"; }

usage() {
  cat << EOF
Usage:
  $0 status [--surface all|cli|web|electron]
  $0 cli-seed
  $0 cli
  $0 open-chrome [--dry-run]
  $0 web-seed
  $0 web
  $0 web-verify

Env:
  SERVER_URL=$SERVER_URL
  SESSION=$SESSION
  AUTH_DIR=$AUTH_DIR
  SEED_EMAIL=$SEED_EMAIL
  CLI_HOME=$CLI_HOME
EOF
}

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
  local api_key="${LOBEHUB_CLI_API_KEY:-${LOBE_API_KEY:-}}"
  if [[ -n "$api_key" ]]; then
    local body_file code
    body_file="$(mktemp)"
    code=$(curl -sS -o "$body_file" -w '%{http_code}' \
      -H "Authorization: Bearer $api_key" \
      "$SERVER_URL/api/v1/users/me?includeCount=0" 2> /dev/null || true)

    if [[ "$code" =~ ^[23] ]]; then
      rm -f "$body_file"
      ok "CLI API-key auth valid for $SERVER_URL"
      return 0
    fi

    bad "CLI API-key auth failed for $SERVER_URL (http_code='$code')"
    note "seed the local API key first:"
    note "./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user"
    note "source $CLI_ENV_FILE"
    rm -f "$body_file"
    return 1
  fi

  if [[ -f "$CLI_HOME/settings.json" ]] && grep -q "$SERVER_URL" "$CLI_HOME/settings.json" && [[ -f "$CLI_CREDENTIALS_FILE" ]]; then
    ok "CLI device-code credentials configured for $SERVER_URL (creds: $CLI_HOME)"
  else
    bad "CLI not logged in to $SERVER_URL"
    note "automated path:"
    note "./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user && source $CLI_ENV_FILE && $0 cli-seed"
    note "interactive fallback:"
    note "cd apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server $SERVER_URL"
    return 1
  fi
}

check_web() {
  if [[ -f "$STATE_FILE" ]]; then
    ok "web auth state saved ($STATE_FILE)"
  else
    bad "no web auth state for agent-browser"
    note "for the seeded local user, run: $0 web-seed"
    note "or copy the Cookie header from Chrome DevTools (Network tab), then:"
    note "pbpaste | $0 web   (see references/auth.md)"
    return 1
  fi
  cmd_web_verify --skip-server-check
}

check_agent_browser() {
  if command -v agent-browser > /dev/null 2>&1; then
    ok "agent-browser available"
  else
    bad "agent-browser command not found"
    note "install or expose agent-browser before Web/Electron UI testing"
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
  local surface="all"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --surface)
        if [[ $# -lt 2 ]]; then
          echo "--surface requires one of: all, cli, web, electron" >&2
          return 2
        fi
        surface="${2:-}"
        shift 2
        ;;
      --surface=*)
        surface="${1#*=}"
        shift
        ;;
      all|cli|web|electron)
        surface="$1"
        shift
        ;;
      -h|--help)
        usage
        return 0
        ;;
      *)
        echo "unknown status option: $1" >&2
        usage >&2
        return 2
        ;;
    esac
  done

  case "$surface" in
    all|cli|web|electron) ;;
    "")
      echo "--surface requires one of: all, cli, web, electron" >&2
      return 2
      ;;
    *)
      echo "unknown surface: $surface" >&2
      usage >&2
      return 2
      ;;
  esac

  echo "agent-testing auth status (surface=$surface, SERVER_URL=$SERVER_URL):"
  local rc=0
  case "$surface" in
    all)
      check_server || rc=1
      check_cli || rc=1
      check_web || rc=1
      check_electron || rc=1
      ;;
    cli)
      check_server || rc=1
      check_cli || rc=1
      ;;
    web)
      check_server || rc=1
      check_web || rc=1
      ;;
    electron)
      check_electron || rc=1
      ;;
  esac
  if [[ $rc -eq 0 ]]; then
    echo "$surface auth green — safe to start automated testing on this surface."
  else
    echo "$surface auth NOT ready — fix the ✘ items before writing any test step."
  fi
  return $rc
}

cmd_cli() {
  echo "Starting CLI device-code login against $SERVER_URL ..."
  echo "(opens a browser authorization — must be run by a human in a terminal)"
  cd "$REPO_ROOT/apps/cli"
  LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server "$SERVER_URL"
}

write_cli_seed_env() {
  mkdir -p "$(dirname "$CLI_ENV_FILE")"
  cat > "$CLI_ENV_FILE" << EOF
# Source this file before running LobeHub CLI agent tests.
# Generated by setup-auth.sh cli-seed
export LOBE_API_KEY=$SEED_API_KEY
export LOBEHUB_CLI_API_KEY="\${LOBE_API_KEY}"
export LOBEHUB_SERVER=$SERVER_URL
export LOBEHUB_CLI_HOME=.lobehub-dev
EOF
}

write_cli_settings() {
  mkdir -p "$CLI_HOME"
  python3 - "$CLI_HOME/settings.json" "$SERVER_URL" << 'PY'
import json
import os
import sys

path, server_url = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump({"serverUrl": server_url}, f, indent=2)
    f.write("\n")
os.chmod(path, 0o600)
PY
}

cmd_cli_seed() {
  check_server || return 1
  write_cli_seed_env
  write_cli_settings
  ok "wrote CLI seed env: $CLI_ENV_FILE"
  note "source it before CLI commands: source $CLI_ENV_FILE"
  note "settings saved at: $CLI_HOME/settings.json"
  LOBE_API_KEY="$SEED_API_KEY" LOBEHUB_CLI_API_KEY="$SEED_API_KEY" check_cli
}

cmd_open_chrome() {
  local mode="${1:-}"
  if [[ "$mode" != "" && "$mode" != "--dry-run" ]]; then
    echo "unknown open-chrome option: $mode" >&2
    usage >&2
    return 2
  fi

  if [[ "$mode" == "--dry-run" ]]; then
    echo "would open Google Chrome at $SERVER_URL/"
    echo "would press Cmd+Option+I to open DevTools"
    echo "would open DevTools command menu and run 'Show Network'"
    return 0
  fi

  if [[ "$(uname -s)" != "Darwin" ]]; then
    bad "open-chrome is macOS-only"
    note "open $SERVER_URL/ in your browser and open DevTools manually"
    return 1
  fi

  if ! command -v osascript > /dev/null 2>&1; then
    bad "osascript not found"
    note "open $SERVER_URL/ in Chrome and press Cmd+Option+I manually"
    return 1
  fi

  SERVER_URL="$SERVER_URL" osascript << 'OSA'
set targetUrl to (system attribute "SERVER_URL") & "/"

tell application "Google Chrome"
  activate
  if (count of windows) = 0 then
    make new window
  end if
  tell front window to make new tab with properties {URL:targetUrl}
end tell

delay 1

tell application "System Events"
  tell process "Google Chrome"
    set frontmost to true
    keystroke "i" using {command down, option down}
    delay 1
    keystroke "p" using {command down, shift down}
    delay 0.2
    keystroke "Show Network"
    key code 36
  end tell
end tell
OSA
  ok "opened Chrome at $SERVER_URL/ and requested DevTools Network panel"
}

cookie_header_from_jar() {
  local jar="$1"
  awk '
    BEGIN { first = 1 }
    /^$/ { next }
    /^#/ {
      if ($0 !~ /^#HttpOnly_/) next
      sub(/^#HttpOnly_/, "")
    }
    NF >= 7 {
      if (!first) printf "; "
      printf "%s=%s", $6, $7
      first = 0
    }
    END {
      if (!first) printf "\n"
    }
  ' "$jar"
}

# Build a Playwright storageState file from a raw Cookie header on stdin,
# keeping only the better-auth cookies. See references/auth.md for why the
# header must come from a Network request (HttpOnly) and why httpOnly=false.
cmd_web() {
  mkdir -p "$AUTH_DIR"
  local raw
  raw="$(cat)"
  COOKIE_INPUT="$raw" python3 - "$STATE_FILE" << 'PY'
import json, os, sys, time

raw = os.environ.get("COOKIE_INPUT", "").strip()
cookie_lines = []
for line in raw.splitlines():
    stripped = line.strip()
    if not stripped:
        continue
    if stripped.lower().startswith("cookie:"):
        cookie_lines.append(stripped.split(":", 1)[1].strip())
    else:
        cookie_lines.append(stripped)

raw = "; ".join(cookie_lines)

WANTED = {"better-auth.session_token", "better-auth.session_data", "better-auth.state"}
exp = int(time.time()) + 30 * 24 * 3600  # 30 days

cookies = []
for pair in raw.split(";"):
    pair = pair.strip()
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
  cmd_web_verify
}

cmd_web_seed() {
  check_server || return 1
  mkdir -p "$AUTH_DIR"

  local cookie_jar="$AUTH_DIR/web-seed-cookie.jar"
  local response_body="$AUTH_DIR/web-seed-response.json"
  local payload code
  payload="$(
    SEED_EMAIL="$SEED_EMAIL" SEED_PASSWORD="$SEED_PASSWORD" python3 - << 'PY'
import json
import os

print(json.dumps({
    "callbackURL": "/",
    "email": os.environ["SEED_EMAIL"],
    "password": os.environ["SEED_PASSWORD"],
}))
PY
  )"

  code=$(curl -sS -o "$response_body" -w '%{http_code}' \
    -c "$cookie_jar" \
    -H 'Content-Type: application/json' \
    -X POST "$SERVER_URL/api/auth/sign-in/email" \
    --data "$payload" 2> /dev/null || true)

  if [[ ! "$code" =~ ^[23] ]]; then
    bad "seed user sign-in failed at $SERVER_URL/api/auth/sign-in/email (http_code='$code')"
    note "make sure the seed user exists:"
    note "./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user"
    return 1
  fi

  local cookie_header
  cookie_header="$(cookie_header_from_jar "$cookie_jar")"
  if [[ -z "$cookie_header" ]]; then
    bad "seed sign-in succeeded but no cookies were written to $cookie_jar"
    return 1
  fi

  printf '%s\n' "$cookie_header" | cmd_web
}

cmd_web_verify() {
  local skip_server_check="${1:-}"
  if [[ "$skip_server_check" != "--skip-server-check" ]]; then
    check_server || return 1
  fi
  if [[ ! -f "$STATE_FILE" ]]; then
    bad "no web auth state for agent-browser"
    note "for the seeded local user, run: $0 web-seed"
    note "or copy the Cookie header from Chrome DevTools (Network tab), then:"
    note "pbpaste | $0 web"
    return 1
  fi
  check_agent_browser || return 1
  if ! agent-browser --session "$SESSION" state load "$STATE_FILE" > /dev/null; then
    bad "failed to load web auth state into agent-browser session '$SESSION'"
    return 1
  fi
  if ! agent-browser --session "$SESSION" open "$SERVER_URL/" > /dev/null; then
    bad "failed to open $SERVER_URL in agent-browser session '$SESSION'"
    return 1
  fi
  local url
  url=$(agent-browser --session "$SESSION" get url 2> /dev/null || true)
  if [[ -z "$url" ]]; then
    bad "agent-browser session '$SESSION' did not report a current URL"
    return 1
  fi
  if [[ "$url" == *"/signin"* || "$url" == *"/login"* ]]; then
    bad "agent-browser session '$SESSION' NOT authenticated (landed on $url)"
    note "re-copy the Cookie header and re-run: pbpaste | $0 web"
    return 1
  fi
  ok "agent-browser session '$SESSION' authenticated (at $url)"
}

case "${1:-status}" in
  status)
    shift || true
    cmd_status "$@"
    ;;
  cli-seed) cmd_cli_seed ;;
  cli) cmd_cli ;;
  open-chrome)
    shift || true
    cmd_open_chrome "$@"
    ;;
  web-seed) cmd_web_seed ;;
  web) cmd_web ;;
  web-verify) cmd_web_verify ;;
  -h|--help) usage ;;
  *)
    echo "Usage: $0 {status|cli-seed|cli|open-chrome|web-seed|web|web-verify}" >&2
    exit 2
    ;;
esac
