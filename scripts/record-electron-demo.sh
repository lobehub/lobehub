#!/usr/bin/env bash
#
# record-electron-demo.sh — Record an automated demo of the Electron app
#
# Usage:
#   ./scripts/record-electron-demo.sh [script.sh] [output.mp4]
#
#   script.sh  — A shell script containing agent-browser commands to automate.
#                It receives the CDP port as $1. Defaults to a built-in queue-edit demo.
#   output.mp4 — Output file path. Defaults to /tmp/electron-demo.mp4
#
# Prerequisites:
#   - agent-browser CLI installed globally
#   - ffmpeg installed (brew install ffmpeg)
#   - Electron app NOT already running (script manages lifecycle)
#
# Examples:
#   # Run built-in demo
#   ./scripts/record-electron-demo.sh
#
#   # Run custom automation script
#   ./scripts/record-electron-demo.sh ./my-demo.sh /tmp/my-demo.mp4
#
set -euo pipefail

CDP_PORT=9222
DEMO_SCRIPT="${1:-}"
OUTPUT="${2:-/tmp/electron-demo.mp4}"
ELECTRON_LOG="/tmp/electron-dev.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RECORD_PID=""
ELECTRON_PID=""

# ── Helpers ──────────────────────────────────────────────────────────

cleanup() {
  echo "[cleanup] Stopping all processes..."
  [ -n "$RECORD_PID" ] && kill -INT "$RECORD_PID" 2>/dev/null && sleep 2
  pkill -f "electron-vite" 2>/dev/null || true
  pkill -f "Electron" 2>/dev/null || true
  pkill -f "agent-browser" 2>/dev/null || true
  echo "[cleanup] Done."
}
trap cleanup EXIT

wait_for_electron() {
  echo "[wait] Waiting for Electron to start..."
  for i in $(seq 1 24); do
    sleep 5
    if strings "$ELECTRON_LOG" 2>/dev/null | grep -q "starting electron"; then
      echo "[wait] Electron process ready."
      return 0
    fi
    echo "[wait] Still waiting... (${i}/24)"
  done
  echo "[error] Electron failed to start within 120s"
  exit 1
}

wait_for_renderer() {
  echo "[wait] Waiting for renderer to load..."
  sleep 15
  agent-browser --cdp "$CDP_PORT" wait 3000
  echo "[wait] Renderer ready."
}

get_window_bounds() {
  # Returns: x y w h (in pixels, accounting for Retina scale)
  osascript -e '
    tell application "System Events"
      set appProc to first process whose name is "LobeHub"
      set appWindow to first window of appProc
      set {x, y} to position of appWindow
      set {w, h} to size of appWindow
    end tell
    return (x as text) & " " & (y as text) & " " & (w as text) & " " & (h as text)
  '
}

get_retina_scale() {
  # Get the display scale factor (2 for Retina, 1 for standard)
  osascript -e '
    use framework "AppKit"
    set mainScreen to current application'\''s NSScreen'\''s mainScreen()
    set scaleFactor to mainScreen'\''s backingScaleFactor() as integer
    return scaleFactor
  ' 2>/dev/null || echo "2"
}

start_recording() {
  local x=$1 y=$2 w=$3 h=$4
  local scale
  scale=$(get_retina_scale)

  # ffmpeg avfoundation captures at native (Retina) resolution
  # so we need to scale the crop coordinates
  local cx=$((x * scale))
  local cy=$((y * scale))
  local cw=$((w * scale))
  local ch=$((h * scale))

  echo "[record] Window bounds: ${x},${y} ${w}x${h} (scale=${scale})"
  echo "[record] Capture region: ${cx},${cy} ${cw}x${ch}"
  echo "[record] Output: $OUTPUT"

  ffmpeg -y \
    -f avfoundation -framerate 30 -capture_cursor 1 -i "3:" \
    -vf "crop=${cw}:${ch}:${cx}:${cy},scale=${w}:${h}" \
    -c:v libx264 -crf 23 -preset fast -an \
    "$OUTPUT" \
    > /tmp/ffmpeg-record.log 2>&1 &
  RECORD_PID=$!
  sleep 2
  echo "[record] Recording started (PID=$RECORD_PID)"
}

stop_recording() {
  if [ -n "$RECORD_PID" ]; then
    echo "[record] Stopping recording..."
    kill -INT "$RECORD_PID" 2>/dev/null || true
    wait "$RECORD_PID" 2>/dev/null || true
    RECORD_PID=""
    echo "[record] Recording saved to $OUTPUT"
    ls -lh "$OUTPUT"
  fi
}

# ── Built-in demo: Queue Edit ────────────────────────────────────────

builtin_demo() {
  local port=$1

  echo "[demo] Step 1: Navigate to Lobe AI agent"
  local agent_ref
  agent_ref=$(agent-browser --cdp "$port" snapshot -i 2>&1 | grep -o 'link "Lobe AI" \[ref=e[0-9]*\]' | grep -o 'e[0-9]*')
  agent-browser --cdp "$port" click "@$agent_ref"
  sleep 3

  echo "[demo] Step 2: Send first message (triggers AI generation)"
  local input_ref
  input_ref=$(agent-browser --cdp "$port" snapshot -i -C 2>&1 | grep "editable" | grep -o 'ref=e[0-9]*' | head -1 | sed 's/ref=//')
  agent-browser --cdp "$port" click "@$input_ref"
  agent-browser --cdp "$port" type "@$input_ref" "Please write a detailed analysis of quantum computing"
  sleep 1
  agent-browser --cdp "$port" press Enter
  sleep 3

  echo "[demo] Step 3: Queue message 1"
  input_ref=$(agent-browser --cdp "$port" snapshot -i -C 2>&1 | grep "editable" | grep -o 'ref=e[0-9]*' | head -1 | sed 's/ref=//')
  agent-browser --cdp "$port" click "@$input_ref"
  agent-browser --cdp "$port" type "@$input_ref" "This message should be edited"
  sleep 1
  agent-browser --cdp "$port" press Enter
  sleep 2

  echo "[demo] Step 4: Queue message 2"
  input_ref=$(agent-browser --cdp "$port" snapshot -i -C 2>&1 | grep "editable" | grep -o 'ref=e[0-9]*' | head -1 | sed 's/ref=//')
  agent-browser --cdp "$port" click "@$input_ref"
  agent-browser --cdp "$port" type "@$input_ref" "Another queued message"
  sleep 1
  agent-browser --cdp "$port" press Enter
  sleep 2

  echo "[demo] Step 5: Scroll to show queue tray"
  agent-browser --cdp "$port" scroll down 5000
  sleep 3

  echo "[demo] Step 6: Click edit button on first queued message"
  agent-browser --cdp "$port" eval --stdin << 'EVALEOF'
(function() {
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    var node = walker.currentNode;
    if (node.textContent.trim() === 'This message should be edited') {
      var row = node.parentElement.parentElement;
      var buttons = row.querySelectorAll('[role="button"]');
      if (buttons.length >= 1) {
        buttons[0].click();
        return 'clicked edit button';
      }
    }
  }
  return 'edit button not found';
})()
EVALEOF
  sleep 3

  echo "[demo] Step 7: Show result — content restored to input"
  sleep 3

  echo "[demo] Complete!"
}

# ── Main ─────────────────────────────────────────────────────────────

echo "=== Electron Demo Recorder ==="

# 1. Kill existing instances
echo "[setup] Cleaning up existing processes..."
pkill -f "Electron" 2>/dev/null || true
pkill -f "electron-vite" 2>/dev/null || true
pkill -f "agent-browser" 2>/dev/null || true
sleep 3

# 2. Start Electron
echo "[setup] Starting Electron..."
cd "$PROJECT_ROOT/apps/desktop"
ELECTRON_ENABLE_LOGGING=1 npx electron-vite dev -- --remote-debugging-port="$CDP_PORT" > "$ELECTRON_LOG" 2>&1 &
ELECTRON_PID=$!

wait_for_electron
wait_for_renderer

# 3. Bring window to front and get bounds
osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "LobeHub") to true'
sleep 1
read -r wx wy ww wh <<< "$(get_window_bounds)"

# 4. Start recording the window region
start_recording "$wx" "$wy" "$ww" "$wh"

# 5. Run demo script
if [ -n "$DEMO_SCRIPT" ] && [ -f "$DEMO_SCRIPT" ]; then
  echo "[demo] Running custom script: $DEMO_SCRIPT"
  bash "$DEMO_SCRIPT" "$CDP_PORT"
else
  echo "[demo] Running built-in queue-edit demo"
  builtin_demo "$CDP_PORT"
fi

# 6. Stop recording
stop_recording

echo "=== Done! Output: $OUTPUT ==="
