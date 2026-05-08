#!/usr/bin/env bash
#
# electron-dev.sh — Manage Electron dev environment for testing
#
# Usage:
#   ./electron-dev.sh start   # Kill existing, start fresh, wait until ready
#   ./electron-dev.sh stop    # Kill all Electron-related processes
#   ./electron-dev.sh status  # Check if Electron is running and CDP is reachable
#   ./electron-dev.sh restart # Stop then start
#
# Environment variables:
#   CDP_PORT          — Chrome DevTools Protocol port (default: 9222)
#   ELECTRON_LOG      — Log file path (default: /tmp/electron-dev.log)
#   ELECTRON_WAIT_S   — Max seconds to wait for CDP to become reachable (default: 90)
#   RENDERER_WAIT_S   — Max seconds to wait for SPA after CDP is up (default: 60)
#   FORCE_KILL_USER   — When set to 1, silently kill the user's `bun run dev`
#                       Electron without confirmation (default: always confirm-by-action)
#
set -euo pipefail

CDP_PORT="${CDP_PORT:-9222}"
ELECTRON_LOG="${ELECTRON_LOG:-/tmp/electron-dev.log}"
ELECTRON_WAIT_S="${ELECTRON_WAIT_S:-90}"
RENDERER_WAIT_S="${RENDERER_WAIT_S:-60}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PIDFILE="/tmp/electron-dev-cdp-${CDP_PORT}.pid"

# Project-scoped electron path prefix used for pgrep matching. Any Electron
# binary from this project (main + helpers, with or without --remote-debugging-port)
# starts with this string in its argv[0], so a single substring match catches all.
PROJECT_ELECTRON_PATH="${PROJECT_ROOT}/apps/desktop/node_modules/.pnpm/electron@"

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

# Find seed PIDs related to this project's Electron dev session.
# Matches REGARDLESS of whether --remote-debugging-port was passed, so it also
# catches a plain `bun run dev` session the user started outside this script.
find_project_pids() {
  local pids=""

  # 1. Any process whose command line mentions this project's electron path
  #    (covers the main Electron binary AND every Helper subprocess)
  local electron_pids
  electron_pids=$(pgrep -f "$PROJECT_ELECTRON_PATH" 2>/dev/null || true)
  pids="$pids $electron_pids"

  # 2. electron-vite dev server (narrow match to avoid catching unrelated Vite invocations)
  local vite_pids
  vite_pids=$(pgrep -f "electron-vite[/.].*\\bdev\\b" 2>/dev/null || true)
  pids="$pids $vite_pids"

  # 3. The launcher subshell from a previous `start` (saved to pidfile)
  if [ -f "$PIDFILE" ]; then
    local saved_pid
    saved_pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [ -n "$saved_pid" ] && kill -0 "$saved_pid" 2>/dev/null; then
      pids="$pids $saved_pid"
    fi
  fi

  # 4. Whatever is currently bound to the CDP port — catches strays whose
  #    binary path doesn't match (e.g. orphaned from a crashed restart)
  local port_pid
  port_pid=$(lsof -ti tcp:"$CDP_PORT" -sTCP:LISTEN 2>/dev/null || true)
  pids="$pids $port_pid"

  echo "$pids" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' '
}

# Wait for the CDP HTTP endpoint to respond, with a deadline + early bail-out
# if the launcher process died (no point waiting if Electron crashed).
wait_for_cdp() {
  local deadline=$(( $(date +%s) + ELECTRON_WAIT_S ))
  echo "[electron-dev] Waiting for CDP on port ${CDP_PORT} (up to ${ELECTRON_WAIT_S}s)..."

  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -sf --max-time 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
      echo "[electron-dev] CDP is reachable."
      return 0
    fi

    # If our launcher subshell died, abort early so we don't hang the full timeout
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

# After CDP is up, wait until the SPA renders interactive elements.
wait_for_renderer() {
  local deadline=$(( $(date +%s) + RENDERER_WAIT_S ))
  echo "[electron-dev] Waiting for SPA to load (up to ${RENDERER_WAIT_S}s)..."

  while [ "$(date +%s)" -lt "$deadline" ]; do
    local snap
    snap=$(agent-browser --cdp "$CDP_PORT" snapshot -i 2>&1 || true)
    if echo "$snap" | grep -qE '\b(link|button)\b'; then
      echo "[electron-dev] Renderer ready."
      return 0
    fi
    sleep 2
  done

  echo "[electron-dev] WARNING: Renderer not interactive within ${RENDERER_WAIT_S}s — proceeding anyway."
  return 0
}

# ── Commands ─────────────────────────────────────────────────────────

do_stop() {
  echo "[electron-dev] Stopping Electron dev environment..."

  local seed_pids
  seed_pids=$(find_project_pids)

  # Expand to include all descendants — catches helpers spawned by the main
  # process AFTER our pgrep snapshot, and the launcher's child node/electron-vite
  # process tree.
  local all_pids=""
  for pid in $seed_pids; do
    all_pids="$all_pids $(expand_descendants "$pid")"
  done
  all_pids=$(echo "$all_pids" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ')

  if [ -z "$all_pids" ]; then
    echo "[electron-dev] No project Electron/vite processes found."
  else
    local count
    count=$(echo "$all_pids" | tr ' ' '\n' | grep -c .)
    echo "[electron-dev] Sending SIGTERM to $count process(es): $all_pids"
    for pid in $all_pids; do
      kill "$pid" 2>/dev/null || true
    done

    # Wait up to 5s for graceful exit
    local waited=0
    while [ $waited -lt 5 ]; do
      local any_alive=0
      for pid in $all_pids; do
        if kill -0 "$pid" 2>/dev/null; then any_alive=1; break; fi
      done
      [ "$any_alive" = "0" ] && break
      sleep 1
      waited=$((waited + 1))
    done

    # SIGKILL anyone still alive
    for pid in $all_pids; do
      if kill -0 "$pid" 2>/dev/null; then
        echo "[electron-dev] Force-killing PID $pid"
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi

  # Belt-and-suspenders: anything still bound to the CDP port goes away
  local port_pid
  port_pid=$(lsof -ti tcp:"$CDP_PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$port_pid" ]; then
    echo "[electron-dev] Port $CDP_PORT still bound by PID $port_pid; force-killing"
    # shellcheck disable=SC2086
    kill -9 $port_pid 2>/dev/null || true
  fi

  # Also re-sweep the project's electron processes — sometimes the OS spawns
  # new helpers during shutdown that didn't exist when we first enumerated.
  local stragglers
  stragglers=$(pgrep -f "$PROJECT_ELECTRON_PATH" 2>/dev/null || true)
  if [ -n "$stragglers" ]; then
    echo "[electron-dev] Cleaning up stragglers: $stragglers"
    for pid in $stragglers; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi

  # Close any agent-browser sessions connected to this port
  agent-browser --cdp "$CDP_PORT" close --all 2>/dev/null || true

  rm -f "$PIDFILE"
  echo "[electron-dev] Stopped."
}

do_status() {
  local pids
  pids=$(find_project_pids)

  if [ -z "$pids" ]; then
    echo "[electron-dev] No project Electron processes found."
    return 1
  fi

  echo "[electron-dev] Project processes: $pids"

  if curl -sf --max-time 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    local url
    url=$(agent-browser --cdp "$CDP_PORT" get url 2>&1 | tail -1 || echo "?")
    echo "[electron-dev] CDP port ${CDP_PORT} is reachable. URL: $url"
    return 0
  else
    echo "[electron-dev] CDP port ${CDP_PORT} is NOT reachable (no --remote-debugging-port, or still loading)."
    return 2
  fi
}

do_start() {
  # Already up and CDP is reachable → nothing to do
  if curl -sf --max-time 2 "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo "[electron-dev] CDP already reachable on port $CDP_PORT. Skipping start."
    echo "[electron-dev] Use 'restart' to force a fresh session."
    return 0
  fi

  # Detect the user's existing dev session (or stale processes) BEFORE killing
  local existing
  existing=$(find_project_pids)
  if [ -n "$existing" ]; then
    echo "[electron-dev] Existing project Electron/vite processes detected:"
    echo "$existing" | tr ' ' '\n' | sed 's/^/[electron-dev]   PID /'
    echo "[electron-dev] Tearing them down so we can start a CDP-enabled session..."
  fi

  do_stop

  # Wait for port + user-data-dir locks to release. Without this, the new
  # Electron may fail with "user data directory in use" or fail to bind CDP.
  local waited=0
  while [ $waited -lt 10 ]; do
    if ! lsof -i tcp:"$CDP_PORT" >/dev/null 2>&1 \
       && ! pgrep -f "$PROJECT_ELECTRON_PATH" >/dev/null 2>&1; then
      break
    fi
    [ $waited -eq 0 ] && echo "[electron-dev] Waiting for port + Electron locks to release..."
    sleep 1
    waited=$((waited + 1))
  done

  echo "[electron-dev] Starting Electron dev server..."
  echo "[electron-dev]   Project:  $PROJECT_ROOT"
  echo "[electron-dev]   CDP port: $CDP_PORT"
  echo "[electron-dev]   Log:      $ELECTRON_LOG"

  : > "$ELECTRON_LOG"  # Truncate log

  # Launch in a new session (setsid) so the whole process tree shares a PGID
  # we can later signal in one shot. `setsid bash -c '... exec ...' &` keeps
  # the bash shell as the session leader; its PID is what we save.
  setsid bash -c "
    cd '$PROJECT_ROOT/apps/desktop'
    exec npx electron-vite dev -- --remote-debugging-port=$CDP_PORT
  " >> "$ELECTRON_LOG" 2>&1 < /dev/null &
  local launcher_pid=$!
  echo "$launcher_pid" > "$PIDFILE"
  echo "[electron-dev] Launcher PID (session leader): $launcher_pid"

  if ! wait_for_cdp; then
    echo "[electron-dev] Failed to bring up CDP. Cleaning up..."
    do_stop
    return 1
  fi

  if ! wait_for_renderer; then
    echo "[electron-dev] Renderer not interactive — you may need to wait more."
  fi

  echo "[electron-dev] Ready! Use: agent-browser --cdp $CDP_PORT snapshot -i"
}

do_restart() {
  do_stop
  sleep 1
  do_start
}

# ── Main ─────────────────────────────────────────────────────────────

case "${1:-help}" in
  start)   do_start ;;
  stop)    do_stop ;;
  status)  do_status ;;
  restart) do_restart ;;
  *)
    echo "Usage: $0 {start|stop|status|restart}"
    echo ""
    echo "  start   — Start Electron dev with CDP. Detects + tears down any"
    echo "            existing project Electron (e.g. \`bun run dev\`) first."
    echo "  stop    — Kill all project Electron/vite processes (main + helpers"
    echo "            + descendants), with SIGTERM → 5s wait → SIGKILL fallback."
    echo "  status  — Check if Electron is running and CDP is reachable."
    echo "  restart — Stop then start."
    exit 1
    ;;
esac
