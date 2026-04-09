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
#   ELECTRON_WAIT_S   — Max seconds to wait for Electron process (default: 60)
#   RENDERER_WAIT_S   — Max seconds to wait for renderer/SPA (default: 60)
#
set -euo pipefail

CDP_PORT="${CDP_PORT:-9222}"
ELECTRON_LOG="${ELECTRON_LOG:-/tmp/electron-dev.log}"
ELECTRON_WAIT_S="${ELECTRON_WAIT_S:-60}"
RENDERER_WAIT_S="${RENDERER_WAIT_S:-60}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PIDFILE="/tmp/electron-dev-cdp-${CDP_PORT}.pid"

# ── Helpers ──────────────────────────────────────────────────────────

# Get the Electron binary path used by this project
electron_bin_pattern() {
  echo "${PROJECT_ROOT}/apps/desktop/node_modules/.pnpm/electron@*/node_modules/electron/dist/Electron.app"
}

# Find all PIDs related to the project's Electron dev session
find_electron_pids() {
  local pids=""

  # 1. Main Electron process (launched with --remote-debugging-port)
  local main_pids
  main_pids=$(pgrep -f "Electron\.app.*--remote-debugging-port=${CDP_PORT}" 2>/dev/null || true)
  [ -n "$main_pids" ] && pids="$pids $main_pids"

  # 2. Electron Helper processes (gpu, renderer, utility) spawned from the project's electron binary
  local helper_pids
  helper_pids=$(pgrep -f "${PROJECT_ROOT}/apps/desktop/node_modules/.*Electron Helper" 2>/dev/null || true)
  [ -n "$helper_pids" ] && pids="$pids $helper_pids"

  # 3. electron-vite dev server
  local vite_pids
  vite_pids=$(pgrep -f "electron-vite.*dev" 2>/dev/null || true)
  [ -n "$vite_pids" ] && pids="$pids $vite_pids"

  # 4. PID from pidfile (fallback)
  if [ -f "$PIDFILE" ]; then
    local saved_pid
    saved_pid=$(cat "$PIDFILE")
    if kill -0 "$saved_pid" 2>/dev/null; then
      pids="$pids $saved_pid"
    fi
  fi

  # Deduplicate
  echo "$pids" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ' || true
}

do_stop() {
  echo "[electron-dev] Stopping Electron dev environment..."

  local pids
  pids=$(find_electron_pids)

  if [ -z "$pids" ]; then
    echo "[electron-dev] No Electron processes found."
  else
    echo "[electron-dev] Killing PIDs: $pids"
    for pid in $pids; do
      kill "$pid" 2>/dev/null || true
    done

    # Wait up to 5s for graceful exit, then force-kill survivors
    local waited=0
    while [ $waited -lt 5 ]; do
      local alive=""
      for pid in $pids; do
        kill -0 "$pid" 2>/dev/null && alive="$alive $pid"
      done
      [ -z "$alive" ] && break
      sleep 1
      waited=$((waited + 1))
    done

    # Force-kill any remaining
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        echo "[electron-dev] Force-killing PID $pid"
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi

  # Also close any agent-browser sessions connected to this port
  agent-browser --cdp "$CDP_PORT" close --all 2>/dev/null || true

  rm -f "$PIDFILE"
  echo "[electron-dev] Stopped."
}

do_status() {
  local pids
  pids=$(find_electron_pids)

  if [ -z "$pids" ]; then
    echo "[electron-dev] Electron is NOT running."
    return 1
  fi

  echo "[electron-dev] Electron is running (PIDs: $pids)"

  # Check CDP connectivity
  if agent-browser --cdp "$CDP_PORT" get url >/dev/null 2>&1; then
    local url
    url=$(agent-browser --cdp "$CDP_PORT" get url 2>&1 | tail -1)
    echo "[electron-dev] CDP port ${CDP_PORT} is reachable. URL: $url"
    return 0
  else
    echo "[electron-dev] CDP port ${CDP_PORT} is NOT reachable (Electron may still be loading)."
    return 2
  fi
}

wait_for_electron() {
  echo "[electron-dev] Waiting for Electron process (up to ${ELECTRON_WAIT_S}s)..."
  local elapsed=0
  local interval=3
  while [ $elapsed -lt "$ELECTRON_WAIT_S" ]; do
    if strings "$ELECTRON_LOG" 2>/dev/null | grep -q "starting electron"; then
      echo "[electron-dev] Electron process started."
      return 0
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
    echo "[electron-dev] Still waiting... (${elapsed}/${ELECTRON_WAIT_S}s)"
  done
  echo "[electron-dev] ERROR: Electron did not start within ${ELECTRON_WAIT_S}s"
  echo "[electron-dev] Last 20 lines of log:"
  tail -20 "$ELECTRON_LOG" 2>/dev/null || true
  return 1
}

wait_for_renderer() {
  echo "[electron-dev] Waiting for renderer/SPA to load (up to ${RENDERER_WAIT_S}s)..."

  # Initial delay — renderer needs time to bootstrap
  sleep 10

  local elapsed=10
  local interval=5
  while [ $elapsed -lt "$RENDERER_WAIT_S" ]; do
    if agent-browser --cdp "$CDP_PORT" wait 2000 >/dev/null 2>&1; then
      # Check if interactive elements are present (SPA loaded)
      local snap
      snap=$(agent-browser --cdp "$CDP_PORT" snapshot -i 2>&1 || true)
      if echo "$snap" | grep -qE 'link |button '; then
        echo "[electron-dev] Renderer ready (interactive elements found)."
        return 0
      fi
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
    echo "[electron-dev] SPA still loading... (${elapsed}/${RENDERER_WAIT_S}s)"
  done

  echo "[electron-dev] WARNING: Timed out waiting for renderer, proceeding anyway."
  return 0
}

do_start() {
  # If already running and healthy, skip
  local status_ok=0
  do_status >/dev/null 2>&1 || status_ok=$?
  if [ "$status_ok" -eq 0 ]; then
    echo "[electron-dev] Electron is already running and CDP is reachable. Skipping start."
    echo "[electron-dev] Use 'restart' to force a fresh session, or 'stop' to tear down."
    return 0
  fi

  # Clean up any stale processes
  do_stop

  # Start fresh
  echo "[electron-dev] Starting Electron dev server..."
  echo "[electron-dev]   Project: $PROJECT_ROOT"
  echo "[electron-dev]   CDP port: $CDP_PORT"
  echo "[electron-dev]   Log: $ELECTRON_LOG"

  : > "$ELECTRON_LOG"  # Truncate log

  (
    cd "$PROJECT_ROOT/apps/desktop" && \
    ELECTRON_ENABLE_LOGGING=1 npx electron-vite dev -- --remote-debugging-port="$CDP_PORT" \
      >> "$ELECTRON_LOG" 2>&1
  ) &
  local bg_pid=$!
  echo "$bg_pid" > "$PIDFILE"
  echo "[electron-dev] Background PID: $bg_pid"

  # Wait for Electron process to start
  if ! wait_for_electron; then
    echo "[electron-dev] Failed to start. Cleaning up..."
    do_stop
    return 1
  fi

  # Wait for renderer to be interactive
  if ! wait_for_renderer; then
    echo "[electron-dev] Renderer not ready, but Electron is running. You may need to wait more."
  fi

  echo "[electron-dev] Ready! Use: agent-browser --cdp $CDP_PORT snapshot -i"
}

do_restart() {
  do_stop
  sleep 2
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
    echo "  start   — Start Electron dev with CDP (idempotent, skips if already running)"
    echo "  stop    — Kill all Electron dev processes (main + helpers + vite)"
    echo "  status  — Check if Electron is running and CDP is reachable"
    echo "  restart — Stop then start"
    exit 1
    ;;
esac
