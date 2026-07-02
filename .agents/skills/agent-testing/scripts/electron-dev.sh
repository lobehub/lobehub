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
#   userData   = $POOL_DIR/ud-<id> (login state copied from the golden profile)
#   IPC id     = lobehub-desktop-dev-<id>       → needs LOBE_IPC_ID support
# Drive each with a DISTINCT agent-browser session, else the daemon reuses one
# connection across ports:  agent-browser --session s<port> --cdp <port> ...
#
# Environment variables:
#   CDP_PORT          — (legacy only) CDP port (default: 9222)
#   ELECTRON_LOG      — (legacy only) log file path (default: /tmp/electron-dev.log)
#   CDP_BASE          — pool CDP base (default: 9222 → instance id adds on top)
#   VITE_BASE         — pool Vite base (default: 5173)
#   POOL_DIR          — pool state dir (default: /tmp/lobe-electron-pool)
#   LOBE_GOLDEN_PROFILE — userData to copy login state from
#                       (default: ~/Library/Application Support/lobehub-desktop-dev)
#   KEEP_DATA=1       — on `stop <id>`, keep the instance's userData dir
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

# Copy the login-bearing items from the golden profile into a fresh userData dir
# (skips the multi-GB caches). No-op if the dir already exists.
seed_userdata() {
  local dst="$1"
  [ -d "$dst" ] && return 0
  if [ ! -d "$GOLDEN_PROFILE" ]; then
    echo "[electron-dev] WARNING: golden profile not found at $GOLDEN_PROFILE — instance will start signed out."
    mkdir -p "$dst"
    return 0
  fi
  echo "[electron-dev] Seeding login state from golden profile → $dst"
  mkdir -p "$dst"
  local items=(
    "lobehub-settings.json" "Local State" "Preferences"
    "Cookies" "Cookies-journal" "Local Storage" "IndexedDB"
    "Session Storage" "Network Persistent State" "lobehub-storage"
  )
  local f
  for f in "${items[@]}"; do
    [ -e "$GOLDEN_PROFILE/$f" ] && cp -R "$GOLDEN_PROFILE/$f" "$dst/" 2>/dev/null || true
  done
}

# ── Commands ─────────────────────────────────────────────────────────

do_stop() {
  local label="legacy"
  [ "$POOL_MODE" = "1" ] && label="instance $INSTANCE (cdp $CDP_PORT)"
  echo "[electron-dev] Stopping Electron dev ($label)..."

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

  # Pool mode: wipe the instance's userData unless asked to keep it.
  if [ "$POOL_MODE" = "1" ] && [ -n "$USER_DATA_DIR" ]; then
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
    exec env $env_assignments npx electron-vite dev -- --remote-debugging-port=$CDP_PORT
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
    do_stop
    return 1
  fi
  wait_for_renderer || true

  if [ "$POOL_MODE" = "1" ]; then
    echo "[electron-dev] Ready! Drive it with: agent-browser --session s$CDP_PORT --cdp $CDP_PORT snapshot -i"
  else
    echo "[electron-dev] Ready! Use: agent-browser --cdp $CDP_PORT snapshot -i"
  fi
}

# Quiet stop used at the head of start — never wipes userData.
do_stop_quiet_for_start() {
  KEEP_DATA=1 do_stop >/dev/null 2>&1 || true
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
  *)
    echo "Usage: $0 {start|stop|status|restart} [<id>]   |   $0 stop --all   |   $0 list"
    echo ""
    echo "  start [<id>]   — Start an instance. No id = legacy single instance (CDP 9222)."
    echo "                   <id> = pool member: CDP 9222+id, Vite 5173+id, own userData"
    echo "                   (login copied from the golden profile) + IPC id."
    echo "  stop [<id>]    — Stop an instance. Pool stop is sibling-safe. KEEP_DATA=1 to"
    echo "                   preserve the instance's userData."
    echo "  stop --all     — Stop every pool instance."
    echo "  status [<id>]  — Check whether the instance's CDP is reachable."
    echo "  restart [<id>] — Stop then start."
    echo "  list           — List pool instances and their CDP reachability."
    exit 1
    ;;
esac
