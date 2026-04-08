#!/usr/bin/env bash
#
# record-app-screen.sh — Record the Electron app window (video + screenshots)
#
# A general-purpose screen recording tool with start/stop lifecycle.
# The caller starts Electron and drives automation; this script handles recording.
#
# Usage:
#   ./record-app-screen.sh start [output_name]   # Begin recording
#   ./record-app-screen.sh stop                   # Stop and save
#   ./record-app-screen.sh status                 # Check recording state
#
# Outputs to .records/ directory:
#   .records/<name>.mp4   — Cropped video of Electron window
#   .records/<name>/      — Screenshots every SCREENSHOT_INTERVAL seconds
#
# Prerequisites:
#   - ffmpeg installed (bun add -g ffmpeg-static, or brew install ffmpeg)
#   - agent-browser CLI installed (for screenshots)
#   - Electron app already running with CDP enabled
#
# Environment variables:
#   CDP_PORT              — Chrome DevTools Protocol port (default: 9222)
#   FRAMERATE             — Recording framerate (default: 30)
#   SCREENSHOT_INTERVAL   — Seconds between screenshots (default: 3)
#
# Examples:
#   ./electron-dev.sh start
#   ./record-app-screen.sh start gateway-demo
#   # ... run automation via agent-browser ...
#   ./record-app-screen.sh stop
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

RECORDS_DIR="$PROJECT_DIR/.records"
PID_FILE="/tmp/record-app-screen.pids"
STATE_FILE="/tmp/record-app-screen.state"

CDP_PORT="${CDP_PORT:-9222}"
FRAMERATE="${FRAMERATE:-30}"
SCREENSHOT_INTERVAL="${SCREENSHOT_INTERVAL:-3}"

AB="agent-browser --cdp $CDP_PORT"

# ─── Window Detection ───

get_window_and_screen_info() {
  # Returns: rel_x rel_y width height screen_index backing_scale
  swift -e '
    import Cocoa
    let windowList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
    for w in windowList {
      let owner = w["kCGWindowOwnerName"] as? String ?? ""
      let layer = w["kCGWindowLayer"] as? Int ?? -1
      let bounds = w["kCGWindowBounds"] as? [String: Any] ?? [:]
      let wx = bounds["X"] as? Double ?? 0
      let wy = bounds["Y"] as? Double ?? 0
      let ww = bounds["Width"] as? Double ?? 0
      let wh = bounds["Height"] as? Double ?? 0
      if (owner == "Electron" || owner == "LobeHub") && layer == 0 && ww > 200 && wh > 200 {
        let screens = NSScreen.screens
        var screenIdx = 0
        let windowCenter = NSPoint(x: wx + ww / 2, y: wy + wh / 2)
        for (i, screen) in screens.enumerated() {
          let frame = screen.frame
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

# ─── Commands ───

cmd_start() {
  local output_name="${1:-recording-$(date +%Y%m%d-%H%M%S)}"
  local output_video="$RECORDS_DIR/${output_name}.mp4"
  local screenshot_dir="$RECORDS_DIR/${output_name}"

  if [ -f "$PID_FILE" ]; then
    echo "[record] A recording is already active. Run '$0 stop' first."
    exit 1
  fi

  mkdir -p "$RECORDS_DIR" "$screenshot_dir"

  # Detect window
  echo "[record] Detecting Electron window..."
  local win_info
  win_info=$(get_window_and_screen_info)
  if [ -z "$win_info" ]; then
    echo "[error] Could not find Electron window. Is the app running?"
    exit 1
  fi

  local rel_x rel_y w h screen_idx scale
  read -r rel_x rel_y w h screen_idx scale <<< "$win_info"
  echo "[record] Window: ${rel_x},${rel_y} ${w}x${h} on screen ${screen_idx} (${scale}x)"

  # Find ffmpeg capture device
  local device_idx
  device_idx=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 \
    | grep "Capture screen ${screen_idx}" \
    | grep -oE '\[[0-9]+\]' | tr -d '[]' || true)
  if [ -z "$device_idx" ]; then
    echo "[warn] Could not find device for screen $screen_idx, trying index 3"
    device_idx=3
  fi

  # Crop coordinates at native (Retina) resolution
  local cx=$((rel_x * scale))
  local cy=$((rel_y * scale))
  local cw=$((w * scale))
  local ch=$((h * scale))

  # Start ffmpeg
  local raw_video
  raw_video=$(mktemp /tmp/record-raw-XXXXXX.mp4)

  ffmpeg -y \
    -f avfoundation -framerate "$FRAMERATE" -capture_cursor 1 -i "${device_idx}:" \
    -vf "crop=${cw}:${ch}:${cx}:${cy},scale=${w}:${h}" \
    -c:v libx264 -crf 23 -preset fast -an \
    "$raw_video" \
    > /tmp/ffmpeg-record.log 2>&1 &
  local ffmpeg_pid=$!
  sleep 2

  if ! kill -0 "$ffmpeg_pid" 2>/dev/null; then
    echo "[error] ffmpeg failed to start:"
    cat /tmp/ffmpeg-record.log
    rm -f "$raw_video"
    exit 1
  fi

  # Start screenshot loop
  (
    local idx=0
    while true; do
      local filename
      filename=$(printf "%s/%04d.png" "$screenshot_dir" "$idx")
      $AB screenshot "$filename" 2>/dev/null || true
      idx=$((idx + 1))
      sleep "$SCREENSHOT_INTERVAL"
    done
  ) &
  local screenshot_pid=$!

  # Save state for stop command
  echo "$ffmpeg_pid $screenshot_pid" > "$PID_FILE"
  echo "$output_video $raw_video $screenshot_dir" > "$STATE_FILE"

  echo "[record] Started!"
  echo "  Video:       recording (PID $ffmpeg_pid)"
  echo "  Screenshots: every ${SCREENSHOT_INTERVAL}s → $screenshot_dir/"
  echo "  Stop with:   $0 stop"
}

cmd_stop() {
  if [ ! -f "$PID_FILE" ] || [ ! -f "$STATE_FILE" ]; then
    echo "[record] No active recording found."
    return 0
  fi

  local ffmpeg_pid screenshot_pid
  read -r ffmpeg_pid screenshot_pid < "$PID_FILE"

  local output_video raw_video screenshot_dir
  read -r output_video raw_video screenshot_dir < "$STATE_FILE"

  # Stop screenshot loop
  kill "$screenshot_pid" 2>/dev/null || true
  wait "$screenshot_pid" 2>/dev/null || true

  # Stop ffmpeg gracefully
  kill -INT "$ffmpeg_pid" 2>/dev/null || true
  wait "$ffmpeg_pid" 2>/dev/null || true

  # Move raw video to final location
  if [ -f "$raw_video" ]; then
    mv "$raw_video" "$output_video"
  fi

  rm -f "$PID_FILE" "$STATE_FILE"

  local video_size screenshot_count
  video_size=$(ls -lh "$output_video" 2>/dev/null | awk '{print $5}' || echo "?")
  screenshot_count=$(ls -1 "$screenshot_dir"/*.png 2>/dev/null | wc -l | tr -d ' ' || echo "0")

  echo "[record] Stopped!"
  echo "  Video:       $output_video ($video_size)"
  echo "  Screenshots: ${screenshot_count} files in $screenshot_dir/"
  echo "  Play:        open $output_video"
}

cmd_status() {
  if [ ! -f "$PID_FILE" ]; then
    echo "[record] No active recording."
    return 0
  fi

  local ffmpeg_pid screenshot_pid
  read -r ffmpeg_pid screenshot_pid < "$PID_FILE"

  local ffmpeg_ok="no" screenshot_ok="no"
  kill -0 "$ffmpeg_pid" 2>/dev/null && ffmpeg_ok="yes"
  kill -0 "$screenshot_pid" 2>/dev/null && screenshot_ok="yes"

  local output_video raw_video screenshot_dir
  read -r output_video raw_video screenshot_dir < "$STATE_FILE"
  local count
  count=$(ls -1 "$screenshot_dir"/*.png 2>/dev/null | wc -l | tr -d ' ' || echo "0")

  echo "[record] Active recording"
  echo "  Video:       PID $ffmpeg_pid (running: $ffmpeg_ok)"
  echo "  Screenshots: PID $screenshot_pid (running: $screenshot_ok), ${count} captured"
  echo "  Output:      $output_video"
}

# ─── Main ───

case "${1:-}" in
  start)  shift; cmd_start "$@" ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "Usage: $0 {start [name] | stop | status}"
    echo ""
    echo "  start [name]  Start recording (default: recording-YYYYMMDD-HHMMSS)"
    echo "  stop          Stop recording and save outputs"
    echo "  status        Check if recording is active"
    exit 1
    ;;
esac
