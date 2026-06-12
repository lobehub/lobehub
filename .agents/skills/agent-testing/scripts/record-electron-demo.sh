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
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RECORD_PID=""

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

  # Poll until interactive elements appear (SPA may take extra time)
  for i in $(seq 1 12); do
    local snap
    snap=$(agent-browser --cdp "$CDP_PORT" snapshot -i 2>&1)
    if echo "$snap" | grep -q 'link "'; then
      echo "[wait] Renderer ready (interactive elements found)."
      return 0
    fi
    echo "[wait] SPA still loading... (${i}/12)"
    sleep 5
  done
  echo "[warn] Timed out waiting for interactive elements, proceeding anyway."
}

get_window_and_screen_info() {
  # Returns: window_x window_y window_w window_h screen_index
  # Uses Swift to find the Electron window bounds and which screen it's on
  swift -e '
    import Cocoa
    let windowList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
    for w in windowList {
      let owner = w["kCGWindowOwnerName"] as? String ?? ""
      let name = w["kCGWindowName"] as? String ?? ""
      let layer = w["kCGWindowLayer"] as? Int ?? -1
      let bounds = w["kCGWindowBounds"] as? [String: Any] ?? [:]
      let wx = bounds["X"] as? Double ?? 0
      let wy = bounds["Y"] as? Double ?? 0
      let ww = bounds["Width"] as? Double ?? 0
      let wh = bounds["Height"] as? Double ?? 0
      if (owner == "Electron" || owner == "LobeHub") && layer == 0 && name == "LobeHub" && ww > 200 && wh > 200 {
        // Find which screen this window is on
        let screens = NSScreen.screens
        var screenIdx = 0
        let windowCenter = NSPoint(x: wx + ww / 2, y: wy + wh / 2)
        for (i, screen) in screens.enumerated() {
          let frame = screen.frame
          // Convert CG coords (top-left origin) to NSScreen coords (bottom-left origin)
          let mainHeight = screens[0].frame.height
          let screenTop = mainHeight - frame.origin.y - frame.height
          let screenBottom = screenTop + frame.height
          let screenLeft = frame.origin.x
          let screenRight = screenLeft + frame.width
          if windowCenter.x >= screenLeft && windowCenter.x <= screenRight &&
             windowCenter.y >= screenTop && windowCenter.y <= screenBottom {
            screenIdx = i
            break
          }
        }
        // Compute window position relative to the screen it is on
        let screen = screens[screenIdx]
        let mainHeight = screens[0].frame.height
        let screenTop = mainHeight - screen.frame.origin.y - screen.frame.height
        let relX = wx - screen.frame.origin.x
        let relY = wy - screenTop
        let scale = Int(screen.backingScaleFactor)
        print("\(Int(relX)) \(Int(relY)) \(Int(ww)) \(Int(wh)) \(screenIdx) \(scale)")
        break
      }
    }
  '
}

start_recording() {
  local rel_x=$1 rel_y=$2 w=$3 h=$4 screen_idx=$5 scale=$6

  # ffmpeg avfoundation device index for screens
  # List devices and find the one matching our screen index
  local device_idx
  device_idx=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 \
    | grep "Capture screen ${screen_idx}" \
    | grep -oE '\[[0-9]+\]' | tr -d '[]' || true)

  if [ -z "$device_idx" ]; then
    echo "[warn] Could not find capture device for screen $screen_idx, trying default (3)"
    device_idx=3
  fi

  # Scale coordinates to native resolution
  local cx=$((rel_x * scale))
  local cy=$((rel_y * scale))
  local cw=$((w * scale))
  local ch=$((h * scale))

  echo "[record] Window: ${rel_x},${rel_y} ${w}x${h} on screen ${screen_idx} (scale=${scale})"
  echo "[record] Crop: ${cx},${cy} ${cw}x${ch}, device: ${device_idx}"
  echo "[record] Output: $OUTPUT"

  ffmpeg -y \
    -f avfoundation -framerate 30 -capture_cursor 1 -i "${device_idx}:" \
    -vf "crop=${cw}:${ch}:${cx}:${cy},scale=${w}:${h}" \
    -c:v libx264 -crf 23 -preset fast -an \
    "$OUTPUT" \
    > /tmp/ffmpeg-record.log 2>&1 &
  RECORD_PID=$!
  sleep 2

  if ! kill -0 "$RECORD_PID" 2>/dev/null; then
    echo "[error] ffmpeg failed to start. Log:"
    cat /tmp/ffmpeg-record.log
    RECORD_PID=""
    return 1
  fi
  echo "[record] Recording started (PID=$RECORD_PID)"
}

stop_recording() {
  if [ -n "$RECORD_PID" ]; then
    echo "[record] Stopping recording..."
    kill -INT "$RECORD_PID" 2>/dev/null || true
    wait "$RECORD_PID" 2>/dev/null || true
    RECORD_PID=""
    echo "[record] Saved to $OUTPUT"
    ls -lh "$OUTPUT"
  fi
}

# ── Built-in demo: Queue Edit ────────────────────────────────────────

find_input_ref() {
  local port=$1
  agent-browser --cdp "$port" snapshot -i -C 2>&1 \
    | grep "editable" \
    | grep -oE 'ref=e[0-9]+' \
    | head -1 \
    | sed 's/ref=//'
}

builtin_demo() {
  local port=$1

  echo "[demo] Step 1: Navigate to first available agent"
  local snapshot agent_ref
  snapshot=$(agent-browser --cdp "$port" snapshot -i 2>&1)
  # Try Lobe AI first, then fall back to any agent link in the sidebar
  agent_ref=$(echo "$snapshot" | grep -oE 'link "Lobe AI" \[ref=e[0-9]+\]' | grep -oE 'e[0-9]+' || true)
  if [ -z "$agent_ref" ]; then
    # Pick the first agent-like link (skip nav links)
    agent_ref=$(echo "$snapshot" | grep 'link "' | grep -vE '"Home"|"Pages"|"Settings"|"Search"|"Resources"|"Marketplace"' | head -1 | grep -oE 'ref=e[0-9]+' | sed 's/ref=//' || true)
  fi
  if [ -z "$agent_ref" ]; then
    echo "[error] No agent link found in snapshot"
    echo "$snapshot" | head -30
    return 1
  fi
  echo "[demo] Clicking agent ref: @$agent_ref"
  agent-browser --cdp "$port" click "@$agent_ref"
  sleep 3

  echo "[demo] Step 2: Send first message (triggers AI generation)"
  local input_ref
  input_ref=$(find_input_ref "$port")
  agent-browser --cdp "$port" click "@$input_ref"
  agent-browser --cdp "$port" type "@$input_ref" "Write a 3000 word essay about the complete history of space exploration from Sputnik to the James Webb Space Telescope"
  sleep 1
  agent-browser --cdp "$port" press Enter
  sleep 3

  echo "[demo] Step 3: Queue message 1"
  input_ref=$(find_input_ref "$port")
  agent-browser --cdp "$port" click "@$input_ref"
  agent-browser --cdp "$port" type "@$input_ref" "This message should be edited"
  sleep 1
  agent-browser --cdp "$port" press Enter
  sleep 1

  echo "[demo] Step 4: Queue message 2"
  input_ref=$(find_input_ref "$port")
  agent-browser --cdp "$port" click "@$input_ref"
  agent-browser --cdp "$port" type "@$input_ref" "Another queued message"
  sleep 1
  agent-browser --cdp "$port" press Enter
  sleep 1

  echo "[demo] Step 5: Verify queue has messages"
  local queue_count
  queue_count=$(agent-browser --cdp "$port" eval --stdin << 'EVALEOF'
(function() {
  var chat = window.__LOBE_STORES.chat();
  var total = 0;
  Object.keys(chat.queuedMessages).forEach(function(k) {
    total += chat.queuedMessages[k].length;
  });
  return String(total);
})()
EVALEOF
  )
  echo "[demo] Queue count: $queue_count"

  if [ "$queue_count" = "0" ] || [ "$queue_count" = '"0"' ]; then
    echo "[demo] Queue was already drained. Retrying..."
    input_ref=$(find_input_ref "$port")
    agent-browser --cdp "$port" click "@$input_ref"
    agent-browser --cdp "$port" type "@$input_ref" "Now write another 3000 word essay about artificial intelligence from Turing to transformers covering every major breakthrough"
    sleep 1
    agent-browser --cdp "$port" press Enter
    sleep 2
    input_ref=$(find_input_ref "$port")
    agent-browser --cdp "$port" click "@$input_ref"
    agent-browser --cdp "$port" type "@$input_ref" "This message should be edited"
    sleep 1
    agent-browser --cdp "$port" press Enter
    sleep 1
    input_ref=$(find_input_ref "$port")
    agent-browser --cdp "$port" click "@$input_ref"
    agent-browser --cdp "$port" type "@$input_ref" "Another queued message"
    sleep 1
    agent-browser --cdp "$port" press Enter
    sleep 1
  fi

  echo "[demo] Step 6: Scroll to show queue tray"
  agent-browser --cdp "$port" scroll down 5000
  sleep 2

  echo "[demo] Step 7: Click edit button on first queued message"
  agent-browser --cdp "$port" eval --stdin << 'EVALEOF'
(function() {
  var chat = window.__LOBE_STORES.chat();
  var keys = Object.keys(chat.queuedMessages);
  for (var k = 0; k < keys.length; k++) {
    var queue = chat.queuedMessages[keys[k]];
    if (queue.length > 0) {
      var targetText = queue[0].content;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      while (walker.nextNode()) {
        var node = walker.currentNode;
        if (node.textContent.trim() === targetText) {
          var row = node.parentElement.parentElement;
          var buttons = row.querySelectorAll('[role="button"]');
          if (buttons.length >= 1) {
            buttons[0].click();
            return 'clicked edit on: ' + targetText;
          }
        }
      }
    }
  }
  return 'edit button not found';
})()
EVALEOF
  sleep 3

  echo "[demo] Step 8: Show result — content restored to input"
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

wait_for_electron
wait_for_renderer

# 3. Get window position and start recording
WIN_INFO=$(get_window_and_screen_info)
if [ -z "$WIN_INFO" ]; then
  echo "[error] Could not find Electron window"
  exit 1
fi
read -r WIN_X WIN_Y WIN_W WIN_H SCREEN_IDX SCALE <<< "$WIN_INFO"
start_recording "$WIN_X" "$WIN_Y" "$WIN_W" "$WIN_H" "$SCREEN_IDX" "$SCALE"

# 4. Run demo script
if [ -n "$DEMO_SCRIPT" ] && [ -f "$DEMO_SCRIPT" ]; then
  echo "[demo] Running custom script: $DEMO_SCRIPT"
  bash "$DEMO_SCRIPT" "$CDP_PORT"
else
  echo "[demo] Running built-in queue-edit demo"
  builtin_demo "$CDP_PORT"
fi

# 5. Stop recording
stop_recording

echo "=== Done! Output: $OUTPUT ==="
