#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/init-dev-env.sh"
TMP="$(mktemp -d)"
PIDS=()

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/bun" <<'SH'
#!/usr/bin/env bash
sleep 300 &
wait
SH
chmod +x "$TMP/bin/bun"

start_fixture() {
  local state="$1" server_port="$2" spa_port="$3"
  PATH="$TMP/bin:$PATH" \
    AGENT_TESTING_DEV_STATE_FILE="$state" \
    SERVER_PORT="$server_port" SPA_PORT="$spa_port" \
    "$SCRIPT" dev > "$state.log" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  for _ in $(seq 1 50); do
    [[ -f "$state" ]] && break
    sleep 0.1
  done
  [[ -f "$state" ]]
  kill -0 "$pid"
  LAST_PID="$pid"
}

STATE_A="$TMP/a.state"
STATE_B="$TMP/b.state"
start_fixture "$STATE_A" 41001 41002
PID_A="$LAST_PID"
start_fixture "$STATE_B" 42001 42002
PID_B="$LAST_PID"

if PATH="$TMP/bin:$PATH" AGENT_TESTING_DEV_STATE_FILE="$STATE_A" \
  SERVER_PORT=41001 SPA_PORT=41002 "$SCRIPT" dev > "$TMP/duplicate-a.log" 2>&1; then
  echo "duplicate start unexpectedly replaced an active ownership record" >&2
  exit 1
fi
if ! kill -0 "$PID_A" 2>/dev/null; then
  echo "duplicate start disturbed the active owned process" >&2
  exit 1
fi

AGENT_TESTING_DEV_STATE_FILE="$STATE_A" "$SCRIPT" clean > "$TMP/clean-a.log"
for _ in $(seq 1 30); do
  kill -0 "$PID_A" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$PID_A" 2>/dev/null; then
  echo "owned process A survived clean" >&2
  exit 1
fi
if ! kill -0 "$PID_B" 2>/dev/null; then
  echo "sibling process B was killed by cleaning A" >&2
  exit 1
fi

STATE_C="$TMP/c.state"
start_fixture "$STATE_C" 43001 43002
PID_C="$LAST_PID"
sed -i.bak 's/^PROCESS_START=.*/PROCESS_START=stale/' "$STATE_C"
if AGENT_TESTING_DEV_STATE_FILE="$STATE_C" "$SCRIPT" clean > "$TMP/clean-c.log" 2>&1; then
  echo "stale ownership metadata unexpectedly succeeded" >&2
  exit 1
fi
if ! kill -0 "$PID_C" 2>/dev/null; then
  echo "stale ownership metadata killed an unverified process" >&2
  exit 1
fi

echo "init-dev-env ownership tests passed"
