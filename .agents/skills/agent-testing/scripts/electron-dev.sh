#!/usr/bin/env bash
#
# electron-dev.sh — Manage Electron dev environment(s) for testing
#
# Single instance (legacy, backward compatible):
#   ./electron-dev.sh start        # CDP 9222, default userData, default Vite port
#   ./electron-dev.sh stop
#   ./electron-dev.sh status
#   ./electron-dev.sh restart
#
# Instance pool (concurrent isolated instances — e.g. one git worktree each):
#   ./electron-dev.sh start <id>   # CDP 9222+id, Vite 5173+id, own userData + IPC id
#   ./electron-dev.sh stop <id>    # stop ONLY instance <id> (never touches siblings)
#   ./electron-dev.sh stop --all   # stop every pool instance
#   ./electron-dev.sh status <id>
#   ./electron-dev.sh list         # list running pool instances
#
# Each pool instance <id> gets, all env-driven so instances never collide:
#   CDP port   = CDP_BASE + id   (9222 + id)
#   Vite port  = VITE_BASE + id  (5173 + id)   → needs LOBE_DESKTOP_VITE_PORT support
#   userData   = $POOL_DIR/ud-<id> (login state seeded from the saved snapshot)
#   IPC id     = lobehub-desktop-dev-<id>       → needs LOBE_IPC_ID support
# Drive each with a DISTINCT agent-browser session, else the daemon reuses one
# connection across ports:  agent-browser --session s<port> --cdp <port> ...
#
# Login persistence (so you sign in ONCE, not once per run):
#   `stop` snapshots the instance's login state into $LOGIN_STATE_DIR before it
#   wipes the userData, and `start` seeds new instances from that snapshot. The
#   app's OAuth refresh token ROTATES on every boot, so only the instance that
#   booted last holds a usable one — the snapshot must be re-taken each run, which
#   is exactly what `stop` does. The golden profile is only a fallback for the very
#   first run, and is never written to (it belongs to the user's own dev app).
#     ./electron-dev.sh login-status      # where the login comes from + expiry
#     ./electron-dev.sh save-login <id>   # snapshot a live instance without stopping
#   If an instance is killed instead of stopped (crash, command timeout), its
#   rotated token dies with it — run `save-login` before anything risky.
#
# Environment variables:
#   CDP_PORT          — (legacy only) CDP port (default: 9222)
#   ELECTRON_LOG      — (legacy only) log file path (default: /tmp/electron-dev.log)
#   CDP_BASE          — pool CDP base (default: 9222 → instance id adds on top)
#   VITE_BASE         — pool Vite base (default: 5173)
#   POOL_DIR          — pool state dir (default: /tmp/lobe-electron-pool)
#   LOBE_LOGIN_STATE_DIR — persistent login snapshot, survives /tmp cleanup
#                       (default: ~/.lobehub/agent-testing/electron-login)
#   LOBE_GOLDEN_PROFILE — userData to seed from when no snapshot exists yet
#                       (default: ~/Library/Application Support/lobehub-desktop-dev)
#   KEEP_DATA=1       — on `stop <id>`, keep the instance's userData dir
#   SKIP_LOGIN_SAVE=1 — on `stop <id>`, do not snapshot the login state
#   ELECTRON_WAIT_S   — max seconds to wait for CDP (default: 90)
#   RENDERER_WAIT_S   — max seconds to wait for the SPA (default: 60)
#
set -euo pipefail

# Capture legacy env overrides BEFORE we clobber the same-named internals.
ENV_CDP_PORT="${CDP_PORT:-}"
ENV_ELECTRON_LOG="${ELECTRON_LOG:-}"

CMD="${1:-help}"
INSTANCE="${2:-}" # empty = legacy single instance; integer = pool member

CDP_BASE="${CDP_BASE:-9222}"
VITE_BASE="${VITE_BASE:-5173}"
ELECTRON_WAIT_S="${ELECTRON_WAIT_S:-90}"
RENDERER_WAIT_S="${RENDERER_WAIT_S:-60}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
POOL_DIR="${POOL_DIR:-/tmp/lobe-electron-pool}"
GOLDEN_PROFILE="${LOBE_GOLDEN_PROFILE:-$HOME/Library/Application Support/lobehub-desktop-dev}"
# Persistent across runs AND across /tmp cleanup — the pool dir is not.
LOGIN_STATE_DIR="${LOBE_LOGIN_STATE_DIR:-$HOME/.lobehub/agent-testing/electron-login}"

# Project-scoped electron path prefix used for pgrep matching in LEGACY mode only
# (pool mode never uses it — it would cross instances). Any Electron binary from
# this project starts with this string in its argv[0].
PROJECT_ELECTRON_PATH="${PROJECT_ROOT}/apps/desktop/node_modules/.pnpm/electron@"

# Per-instance vars, filled by derive_instance.
POOL_MODE=0
CDP_PORT=""
VITE_PORT=""
USER_DATA_DIR=""
IPC_ID=""
ELECTRON_LOG=""
PIDFILE=""

# Resolve the target instance's ports/paths from its id (empty id = legacy).
derive_instance() {
  local id="$1"
  if [ -z "$id" ]; then
    POOL_MODE=0
    CDP_PORT="${ENV_CDP_PORT:-$CDP_BASE}"
    VITE_PORT="" # legacy: no override, config default applies
    USER_DATA_DIR="" # legacy: default userData
    IPC_ID="" # legacy: default IPC id
    ELECTRON_LOG="${ENV_ELECTRON_LOG:-/tmp/electron-dev.log}"
    PIDFILE="/tmp/electron-dev-cdp-${CDP_PORT}.pid"
  else
    [[ "$id" =~ ^[0-9]+$ ]] || {
      echo "[electron-dev] instance id must be a non-negative integer, got: $id" >&2
      exit 1
    }
    POOL_MODE=1
    CDP_PORT=$((CDP_BASE + id))
    VITE_PORT=$((VITE_BASE + id))
    USER_DATA_DIR="$POOL_DIR/ud-$id"
    IPC_ID="lobehub-desktop-dev-$id"
    ELECTRON_LOG="$POOL_DIR/instance-$id.log"
    PIDFILE="$POOL_DIR/instance-$id.pid"
  fi
}

# ── Helpers ──────────────────────────────────────────────────────────

# Print pid + every descendant pid (DFS via pgrep -P).
expand_descendants() {
  local pid="$1"
  echo "$pid"
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for c in $children; do
    expand_descendants "$c"
  done
}

# Seed PIDs for the CURRENT instance only. Pool mode scopes strictly to this
# instance (pidfile session leader + whoever holds this instance's CDP/Vite
# ports) so stopping one instance never kills a sibling. Legacy mode additionally
# sweeps the project's Electron + electron-vite (to tear down a stray `bun run
# dev` the user started outside this script).
find_instance_pids() {
  local pids=""

  # 1. Launcher subshell saved by a previous `start`
  if [ -f "$PIDFILE" ]; then
    local saved_pid
    saved_pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [ -n "$saved_pid" ] && kill -0 "$saved_pid" 2>/dev/null; then
      pids="$pids $saved_pid"
    fi
  fi

  # 2. Whatever is bound to this instance's CDP port
  local port_pid
  port_pid=$(lsof -ti tcp:"$CDP_PORT" -sTCP:LISTEN 2>/dev/null || true)
  pids="$pids $port_pid"

  # 3. Whatever is bound to this instance's Vite port (pool mode)
  if [ -n "$VITE_PORT" ]; then
    local vite_pid
    vite_pid=$(lsof -ti tcp:"$VITE_PORT" -sTCP:LISTEN 2>/dev/null || true)
    pids="$pids $vite_pid"
  fi

  # 4. Legacy only: broad project matching (would cross pool instances)
  if [ "$POOL_MODE" = "0" ]; then
    pids="$pids $(pgrep -f "$PROJECT_ELECTRON_PATH" 2>/dev/null || true)"
    pids="$pids $(pgrep -f "electron-vite[/.].*\\bdev\\b" 2>/dev/null || true)"
  fi

  # `|| true` because `grep -v '^$'` exits 1 on all-empty input, which with
  # pipefail + set -e would silently kill the caller.
  echo "$pids" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ' || true
}

wait_for_cdp() {
  local deadline=$(($(date +%s) + ELECTRON_WAIT_S))
  echo "[electron-dev] Waiting for CDP on port ${CDP_PORT} (up to ${ELECTRON_WAIT_S}s)..."
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -sf --max-time 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
      echo "[electron-dev] CDP is reachable."
      return 0
    fi
    if [ -f "$PIDFILE" ]; then
      local saved_pid
      saved_pid=$(cat "$PIDFILE" 2>/dev/null || true)
      if [ -n "$saved_pid" ] && ! kill -0 "$saved_pid" 2>/dev/null; then
        echo "[electron-dev] Launcher PID $saved_pid is gone before CDP came up."
        echo "[electron-dev] Last 30 lines of $ELECTRON_LOG:"
        tail -30 "$ELECTRON_LOG" 2>/dev/null || true
        return 1
      fi
    fi
    sleep 2
  done
  echo "[electron-dev] ERROR: CDP did not respond within ${ELECTRON_WAIT_S}s"
  echo "[electron-dev] Last 30 lines of $ELECTRON_LOG:"
  tail -30 "$ELECTRON_LOG" 2>/dev/null || true
  return 1
}

wait_for_renderer() {
  local deadline=$(($(date +%s) + RENDERER_WAIT_S))
  echo "[electron-dev] Waiting for SPA to load (up to ${RENDERER_WAIT_S}s)..."
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local snap
    snap=$(agent-browser --session "edev$CDP_PORT" --cdp "$CDP_PORT" snapshot -i 2>&1 || true)
    if echo "$snap" | grep -qE '\b(link|button)\b'; then
      echo "[electron-dev] Renderer ready."
      return 0
    fi
    sleep 2
  done
  echo "[electron-dev] WARNING: Renderer not interactive within ${RENDERER_WAIT_S}s — proceeding anyway."
  return 0
}

# ── Login state ──────────────────────────────────────────────────────
#
# The login-bearing subset of a userData dir (skips the multi-GB caches). The
# OAuth tokens themselves live in lobehub-settings.json → encryptedTokens.
LOGIN_ITEMS=(
  "lobehub-settings.json" "Local State" "Preferences"
  "Cookies" "Cookies-journal" "Local Storage" "IndexedDB"
  "Session Storage" "Network Persistent State" "lobehub-storage"
)

copy_login_items() {
  local src="$1" dst="$2" f
  mkdir -p "$dst"
  for f in "${LOGIN_ITEMS[@]}"; do
    [ -e "$src/$f" ] && cp -R "$src/$f" "$dst/" 2>/dev/null || true
  done
}

# Reads lobehub-settings.json → encryptedTokens and prints
#   "<hasRefreshToken:0|1> <msUntilAccessTokenExpiry|?>"
#
# `expiresAt` is `Date.now() + data.expires_in * 1000` (RemoteServerConfigCtr.saveTokens),
# i.e. the ACCESS token's lifetime — NOT the refresh token's. It is routinely in the
# past on a perfectly refreshable login, so it must never gate whether we keep a
# profile. What does gate it: the app deletes the whole `encryptedTokens` key
# (clearTokens) the moment a refresh fails non-retryably (`invalid_grant` &co), and
# keeps it on transient failures. So a present refreshToken means "can still re-auth".
read_token_state() {
  python3 - "$1/lobehub-settings.json" 2>/dev/null <<'PY' || echo "0 ?"
import json, pathlib, sys, time

path = pathlib.Path(sys.argv[1])
if not path.is_file():
    print("0 ?")
    sys.exit(0)
try:
    tokens = (json.loads(path.read_text()) or {}).get('encryptedTokens') or {}
except Exception:
    print("0 ?")
    sys.exit(0)

has_refresh = 1 if tokens.get('refreshToken') else 0
expires_at = tokens.get('expiresAt')
if not expires_at:
    print(f"{has_refresh} ?")
    sys.exit(0)
# The field has been seen in both seconds and milliseconds.
if expires_at < 1e11:
    expires_at *= 1000
print(f"{has_refresh} {int(expires_at - time.time() * 1000)}")
PY
}

# True when the profile still carries a refresh token, i.e. the app can mint a new
# session from it on the next boot. An expired ACCESS token says nothing here.
profile_can_reauth() {
  local state
  state=$(read_token_state "$1")
  [ "${state%% *}" = "1" ]
}

describe_login() {
  local label="$1" profile="$2" state ms access
  if [ ! -d "$profile" ]; then
    echo "  $label: (absent) — $profile"
    return
  fi
  state=$(read_token_state "$profile")
  ms="${state##* }"
  if [[ "$ms" =~ ^-?[0-9]+$ ]]; then
    [ "$ms" -gt 0 ] &&
      access="access token fresh for $((ms / 3600000))h" ||
      access="access token stale $(( -ms / 3600000 ))h (harmless — it gets refreshed)"
  else
    access="no access-token expiry recorded"
  fi
  if [ "${state%% *}" = "1" ]; then
    echo "  $label: refresh token PRESENT — $access — $profile"
  else
    echo "  $label: refresh token GONE (app cleared it after a failed refresh) — $profile"
  fi
}

# 1 when the running renderer reports a signed-in user. The OAuth refresh token
# is not the only way the app holds a session (a better-auth cookie outlives it),
# so an expired token does NOT mean the instance is signed out — ask the app.
probe_renderer_authed() {
  if ! curl -sf --max-time 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo 0
    return
  fi
  local out
  out=$(agent-browser --session "edev$CDP_PORT" --cdp "$CDP_PORT" eval \
    '(function(){try{var u=window.__LOBE_STORES.user();return (u.user&&u.user.id)?"AUTHED":"ANON";}catch(e){return "ERR";}})()' \
    2>/dev/null | tail -1 || true)
  case "$out" in
    *AUTHED*) echo 1 ;;
    *) echo 0 ;;
  esac
}

# Persist an instance's login into the snapshot so the NEXT run starts signed in.
# The refresh token rotates on every boot, so the instance's copy is the only
# valid one by the time it stops — capture it before the userData is wiped.
# `authed_hint=1` (from probe_renderer_authed, taken while the app was alive)
# overrides the token check, which cannot see a cookie-only session.
save_login_state() {
  local src="$1" authed_hint="${2:-0}"
  [ -d "$src" ] || return 0
  if [ "$authed_hint" != "1" ] && ! profile_can_reauth "$src"; then
    echo "[electron-dev] Not saving login state: $src is signed out (the app cleared its refresh token) — kept the previous snapshot."
    return 0
  fi
  local staging="${LOGIN_STATE_DIR}.staging.$$"
  rm -rf "$staging"
  mkdir -p "$(dirname "$LOGIN_STATE_DIR")"
  copy_login_items "$src" "$staging"
  rm -rf "$LOGIN_STATE_DIR"
  mv "$staging" "$LOGIN_STATE_DIR"
  if profile_can_reauth "$LOGIN_STATE_DIR"; then
    echo "[electron-dev] Saved login state → $LOGIN_STATE_DIR (refresh token captured)"
  else
    echo "[electron-dev] Saved login state → $LOGIN_STATE_DIR (cookie session only — no refresh token on disk)"
  fi
}

# Seed a fresh userData dir: prefer the snapshot we saved on the last stop, and
# fall back to the user's own dev profile for the very first run. No-op if the
# dir already exists.
seed_userdata() {
  local dst="$1"
  [ -d "$dst" ] && return 0

  # The snapshot only exists because a `stop`/`save-login` found that instance
  # signed in, so prefer it unconditionally over the golden profile.
  local src="" label=""
  if [ -d "$LOGIN_STATE_DIR" ]; then
    src="$LOGIN_STATE_DIR"
    label="saved login state"
  elif [ -d "$GOLDEN_PROFILE" ]; then
    src="$GOLDEN_PROFILE"
    label="golden profile (first run)"
  else
    echo "[electron-dev] WARNING: no login state at $LOGIN_STATE_DIR or $GOLDEN_PROFILE — instance will start signed out."
    mkdir -p "$dst"
    return 0
  fi

  echo "[electron-dev] Seeding userData from $label → $dst"
  profile_can_reauth "$src" ||
    echo "[electron-dev]   note: no refresh token on disk — a cookie session may still carry it; otherwise sign in once and 'stop' will capture it."
  copy_login_items "$src" "$dst"
}

# ── Commands ─────────────────────────────────────────────────────────

do_stop() {
  local label="legacy"
  [ "$POOL_MODE" = "1" ] && label="instance $INSTANCE (cdp $CDP_PORT)"
  echo "[electron-dev] Stopping Electron dev ($label)..."

  # Ask the still-running app whether it is signed in — after the kill there is
  # nothing left to ask, and the on-disk token alone can't see a cookie session.
  local authed=0
  if [ "$POOL_MODE" = "1" ] && [ "${SKIP_LOGIN_SAVE:-0}" != "1" ]; then
    authed=$(probe_renderer_authed)
  fi

  local seed_pids
  seed_pids=$(find_instance_pids)

  local all_pids=""
  local pid
  for pid in $seed_pids; do
    all_pids="$all_pids $(expand_descendants "$pid")"
  done
  all_pids=$(echo "$all_pids" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ' || true)

  if [ -z "$all_pids" ]; then
    echo "[electron-dev] No matching Electron/vite processes found."
  else
    local count
    count=$(echo "$all_pids" | tr ' ' '\n' | grep -c .)
    echo "[electron-dev] Sending SIGTERM to $count process(es): $all_pids"
    for pid in $all_pids; do kill "$pid" 2>/dev/null || true; done

    local waited=0
    while [ $waited -lt 5 ]; do
      local any_alive=0
      for pid in $all_pids; do
        if kill -0 "$pid" 2>/dev/null; then
          any_alive=1
          break
        fi
      done
      [ "$any_alive" = "0" ] && break
      sleep 1
      waited=$((waited + 1))
    done

    for pid in $all_pids; do
      if kill -0 "$pid" 2>/dev/null; then
        echo "[electron-dev] Force-killing PID $pid"
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi

  # Belt-and-suspenders: free this instance's CDP port.
  local port_pid
  port_pid=$(lsof -ti tcp:"$CDP_PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$port_pid" ]; then
    echo "[electron-dev] CDP port $CDP_PORT still bound by $port_pid; force-killing"
    # shellcheck disable=SC2086
    kill -9 $port_pid 2>/dev/null || true
  fi

  # Legacy only: re-sweep stray project electron (pool mode must NOT — sibling-safe).
  if [ "$POOL_MODE" = "0" ]; then
    local stragglers
    stragglers=$(pgrep -f "$PROJECT_ELECTRON_PATH" 2>/dev/null || true)
    if [ -n "$stragglers" ]; then
      echo "[electron-dev] Cleaning up stragglers: $stragglers"
      for pid in $stragglers; do kill -9 "$pid" 2>/dev/null || true; done
    fi
  fi

  agent-browser --session "edev$CDP_PORT" --cdp "$CDP_PORT" close --all 2>/dev/null || true
  rm -f "$PIDFILE"

  # Pool mode: capture the (freshly rotated) login before touching the userData,
  # then wipe it unless asked to keep it.
  if [ "$POOL_MODE" = "1" ] && [ -n "$USER_DATA_DIR" ]; then
    [ "${SKIP_LOGIN_SAVE:-0}" = "1" ] || save_login_state "$USER_DATA_DIR" "$authed"
    if [ "${KEEP_DATA:-0}" = "1" ]; then
      echo "[electron-dev] Keeping userData: $USER_DATA_DIR"
    else
      rm -rf "$USER_DATA_DIR"
      echo "[electron-dev] Removed userData: $USER_DATA_DIR"
    fi
  fi

  echo "[electron-dev] Stopped ($label)."
}

do_status() {
  if curl -sf --max-time 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    local url
    url=$(agent-browser --session "edev$CDP_PORT" --cdp "$CDP_PORT" get url 2>&1 | tail -1 || echo "?")
    echo "[electron-dev] CDP $CDP_PORT reachable. URL: $url"
    return 0
  fi
  echo "[electron-dev] CDP $CDP_PORT NOT reachable (not started, or still loading)."
  return 2
}

do_start() {
  if curl -sf --max-time 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo "[electron-dev] CDP already reachable on $CDP_PORT. Skipping start (use 'restart')."
    return 0
  fi

  # Clear stale state for THIS instance/session first.
  do_stop_quiet_for_start

  # Wait for this instance's ports to release.
  local waited=0
  while [ $waited -lt 10 ]; do
    local busy=0
    lsof -i tcp:"$CDP_PORT" >/dev/null 2>&1 && busy=1
    [ -n "$VITE_PORT" ] && lsof -i tcp:"$VITE_PORT" >/dev/null 2>&1 && busy=1
    [ "$busy" = "0" ] && break
    [ $waited -eq 0 ] && echo "[electron-dev] Waiting for ports to release..."
    sleep 1
    waited=$((waited + 1))
  done

  # Env prefix + userData seeding for pool instances.
  local env_assignments=""
  if [ "$POOL_MODE" = "1" ]; then
    mkdir -p "$POOL_DIR"
    seed_userdata "$USER_DATA_DIR"
    env_assignments="LOBE_DESKTOP_USER_DATA_DIR='$USER_DATA_DIR' LOBE_DESKTOP_VITE_PORT=$VITE_PORT LOBE_IPC_ID='$IPC_ID'"
  fi

  echo "[electron-dev] Starting Electron dev..."
  echo "[electron-dev]   Project:   $PROJECT_ROOT"
  echo "[electron-dev]   CDP port:  $CDP_PORT"
  [ -n "$VITE_PORT" ] && echo "[electron-dev]   Vite port: $VITE_PORT"
  [ -n "$USER_DATA_DIR" ] && echo "[electron-dev]   userData:  $USER_DATA_DIR"
  [ -n "$IPC_ID" ] && echo "[electron-dev]   IPC id:    $IPC_ID"
  echo "[electron-dev]   Log:       $ELECTRON_LOG"

  mkdir -p "$(dirname "$ELECTRON_LOG")"
  : >"$ELECTRON_LOG"

  local launch_cmd="
    cd '$PROJECT_ROOT/apps/desktop'
    exec env $env_assignments LOBE_DESKTOP_CDP_PORT=$CDP_PORT pnpm dev
  "
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c "$launch_cmd" >>"$ELECTRON_LOG" 2>&1 </dev/null &
  else
    bash -c "$launch_cmd" >>"$ELECTRON_LOG" 2>&1 </dev/null &
  fi
  local launcher_pid=$!
  echo "$launcher_pid" >"$PIDFILE"
  echo "[electron-dev] Launcher PID (session leader): $launcher_pid"

  if ! wait_for_cdp; then
    echo "[electron-dev] Failed to bring up CDP. Cleaning up..."
    # The app never came up, so its userData is just the seed copy — snapshotting it
    # would overwrite a good snapshot with an unverified (possibly rejected) token.
    SKIP_LOGIN_SAVE=1 do_stop
    return 1
  fi
  wait_for_renderer || true

  if [ "$POOL_MODE" = "1" ]; then
    echo "[electron-dev] Ready! Drive it with: agent-browser --session s$CDP_PORT --cdp $CDP_PORT snapshot -i"
  else
    echo "[electron-dev] Ready! Use: agent-browser --cdp $CDP_PORT snapshot -i"
  fi
}

# Quiet stop used at the head of start — never wipes userData, and never
# snapshots: a leftover userData can carry a token that a LATER run has already
# rotated away, which still looks unexpired but would overwrite a good snapshot.
do_stop_quiet_for_start() {
  KEEP_DATA=1 SKIP_LOGIN_SAVE=1 do_stop >/dev/null 2>&1 || true
}

do_restart() {
  do_stop
  sleep 1
  do_start
}

do_list() {
  echo "[electron-dev] Pool instances (dir: $POOL_DIR):"
  local found=0
  if [ -d "$POOL_DIR" ]; then
    local pf id port reach
    for pf in "$POOL_DIR"/instance-*.pid; do
      [ -e "$pf" ] || continue
      found=1
      id=$(basename "$pf" | sed -E 's/instance-([0-9]+)\.pid/\1/')
      port=$((CDP_BASE + id))
      if curl -sf --max-time 2 "http://localhost:${port}/json/version" >/dev/null 2>&1; then
        reach="UP"
      else
        reach="down"
      fi
      echo "  instance $id → cdp $port [$reach], vite $((VITE_BASE + id)), ud $POOL_DIR/ud-$id"
    done
  fi
  [ "$found" = "0" ] && echo "  (none)"
}

do_login_status() {
  echo "[electron-dev] Login sources (the snapshot wins when present):"
  describe_login "saved snapshot" "$LOGIN_STATE_DIR"
  describe_login "golden profile" "$GOLDEN_PROFILE"
  if [ ! -d "$LOGIN_STATE_DIR" ] && [ ! -d "$GOLDEN_PROFILE" ]; then
    echo "[electron-dev] Nothing to seed from: sign in once inside the app, then 'save-login <id>' (or just 'stop <id>')."
    return 2
  fi
  echo "[electron-dev] Note: 'expiresAt' in the profile is the ACCESS token's lifetime, not the"
  echo "[electron-dev] refresh token's — a stale one is normal and gets refreshed on boot. Only a"
  echo "[electron-dev] missing refresh token means signed out. 'stop'/'save-login' also probe the"
  echo "[electron-dev] running renderer, so a cookie-only session is captured too."
}

do_stop_all() {
  local found=0
  if [ -d "$POOL_DIR" ]; then
    local pf id
    for pf in "$POOL_DIR"/instance-*.pid; do
      [ -e "$pf" ] || continue
      found=1
      id=$(basename "$pf" | sed -E 's/instance-([0-9]+)\.pid/\1/')
      INSTANCE="$id"
      derive_instance "$id"
      do_stop
    done
  fi
  [ "$found" = "0" ] && echo "[electron-dev] No pool instances to stop."
}

# ── Main ─────────────────────────────────────────────────────────────

case "$CMD" in
  start)
    derive_instance "$INSTANCE"
    do_start
    ;;
  stop)
    if [ "$INSTANCE" = "--all" ]; then
      do_stop_all
    else
      derive_instance "$INSTANCE"
      do_stop
    fi
    ;;
  status)
    derive_instance "$INSTANCE"
    do_status
    ;;
  restart)
    derive_instance "$INSTANCE"
    do_restart
    ;;
  list)
    do_list
    ;;
  save-login)
    derive_instance "$INSTANCE"
    if [ "$POOL_MODE" != "1" ]; then
      echo "[electron-dev] save-login needs a pool instance id (its userData dir)."
      exit 1
    fi
    save_login_state "$USER_DATA_DIR" "$(probe_renderer_authed)"
    ;;
  login-status)
    do_login_status
    ;;
  *)
    echo "Usage: $0 {start|stop|status|restart} [<id>]   |   $0 stop --all   |   $0 list"
    echo "       $0 save-login <id>   |   $0 login-status"
    echo ""
    echo "  start [<id>]      — Start an instance. No id = legacy single instance (CDP 9222)."
    echo "                      <id> = pool member: CDP 9222+id, Vite 5173+id, own userData"
    echo "                      (login seeded from the saved snapshot) + IPC id."
    echo "  stop [<id>]       — Stop an instance. Pool stop is sibling-safe, and snapshots the"
    echo "                      instance's login first. KEEP_DATA=1 preserves the userData;"
    echo "                      SKIP_LOGIN_SAVE=1 skips the snapshot."
    echo "  stop --all        — Stop every pool instance."
    echo "  status [<id>]     — Check whether the instance's CDP is reachable."
    echo "  restart [<id>]    — Stop then start."
    echo "  list              — List pool instances and their CDP reachability."
    echo "  save-login <id>   — Snapshot a live instance's login without stopping it."
    echo "  login-status      — Show which source will seed the next instance, and its expiry."
    exit 1
    ;;
esac
