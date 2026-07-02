#!/usr/bin/env bash
#
# record-app-screen.sh — Record the Electron app window (video + screenshots)
#
# Captures screenshots via agent-browser (CDP), then assembles into video on stop.
# Works on any screen (including external monitors) since it uses CDP, not screen capture.
#
# Usage:
#   ./record-app-screen.sh start [output_name]   # Begin recording
#   ./record-app-screen.sh stop                   # Stop and save
#   ./record-app-screen.sh status                 # Check recording state
#
# Outputs to .records/ directory:
#   .records/<name>.mp4   — Video assembled from screenshots (~2 fps)
#   .records/<name>/      — Screenshots every SCREENSHOT_INTERVAL seconds
#
# Prerequisites:
#   - ffmpeg installed (bun add -g ffmpeg-static, or brew install ffmpeg)
#   - agent-browser CLI installed
#   - Electron app already running with CDP enabled
#
# Environment variables:
#   CDP_PORT              — Chrome DevTools Protocol port (default: 9222)
#   SCREENSHOT_INTERVAL   — Seconds between gallery screenshots (default: 3)
#   VIDEO_FRAME_INTERVAL  — Seconds between video frames (default: 0.5)
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
SCREENSHOT_INTERVAL="${SCREENSHOT_INTERVAL:-3}"
VIDEO_FRAME_INTERVAL="${VIDEO_FRAME_INTERVAL:-0.5}"

AB="agent-browser --cdp $CDP_PORT"

# ─── Commands ───

cmd_start() {
  local output_name="${1:-recording-$(date +%Y%m%d-%H%M%S)}"
  local output_video="$RECORDS_DIR/${output_name}.mp4"
  local screenshot_dir="$RECORDS_DIR/${output_name}"
  local frames_dir
  frames_dir=$(mktemp -d /tmp/record-frames-XXXXXX)

  if [ -f "$PID_FILE" ]; then
    echo "[record] A recording is already active. Run '$0 stop' first."
    exit 1
  fi

  mkdir -p "$RECORDS_DIR" "$screenshot_dir"

  # Video frames loop (~2 fps via agent-browser CDP screenshots)
  (
    local idx=0
    while true; do
      local fname
      fname=$(printf "%s/frame_%06d.png" "$frames_dir" "$idx")
      $AB screenshot "$fname" 2>/dev/null || true
      idx=$((idx + 1))
      sleep "$VIDEO_FRAME_INTERVAL"
    done
  ) &
  local frames_pid=$!

  # Gallery screenshots loop (every N seconds for human review)
  (
    local idx=0
    while true; do
      local fname
      fname=$(printf "%s/%04d.png" "$screenshot_dir" "$idx")
      $AB screenshot "$fname" 2>/dev/null || true
      idx=$((idx + 1))
      sleep "$SCREENSHOT_INTERVAL"
    done
  ) &
  local screenshot_pid=$!

  # Save state
  echo "$frames_pid $screenshot_pid" > "$PID_FILE"
  echo "$output_video $frames_dir $screenshot_dir" > "$STATE_FILE"

  echo "[record] Started!"
  echo "  Video frames: every ${VIDEO_FRAME_INTERVAL}s (PID $frames_pid)"
  echo "  Screenshots:  every ${SCREENSHOT_INTERVAL}s → $screenshot_dir/"
  echo "  Stop with:    $0 stop"
}

cmd_stop() {
  if [ ! -f "$PID_FILE" ] || [ ! -f "$STATE_FILE" ]; then
    echo "[record] No active recording found."
    return 0
  fi

  local frames_pid screenshot_pid
  read -r frames_pid screenshot_pid < "$PID_FILE"

  local output_video frames_dir screenshot_dir
  read -r output_video frames_dir screenshot_dir < "$STATE_FILE"

  # Stop both capture loops
  kill "$frames_pid" 2>/dev/null || true
  kill "$screenshot_pid" 2>/dev/null || true
  wait "$frames_pid" 2>/dev/null || true
  wait "$screenshot_pid" 2>/dev/null || true

  # Assemble frames into video
  local frame_count
  frame_count=$(ls -1 "$frames_dir"/frame_*.png 2>/dev/null | wc -l | tr -d ' ')

  if [ "$frame_count" -gt 0 ]; then
    echo "[record] Assembling $frame_count frames into video..."
    ffmpeg -y -framerate 2 -i "$frames_dir/frame_%06d.png" \
      -c:v libx264 -crf 23 -pix_fmt yuv420p -an \
      "$output_video" > /tmp/ffmpeg-assemble.log 2>&1

    if [ ! -s "$output_video" ]; then
      echo "  [warn] Video assembly failed. Check /tmp/ffmpeg-assemble.log"
      echo "  Frames preserved in: $frames_dir/"
    fi
  else
    echo "  [warn] No frames captured."
  fi

  rm -rf "$frames_dir" 2>/dev/null
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

  local frames_pid screenshot_pid
  read -r frames_pid screenshot_pid < "$PID_FILE"

  local frames_ok="no" screenshot_ok="no"
  kill -0 "$frames_pid" 2>/dev/null && frames_ok="yes"
  kill -0 "$screenshot_pid" 2>/dev/null && screenshot_ok="yes"

  if [ -f "$STATE_FILE" ]; then
    local output_video frames_dir screenshot_dir
    read -r output_video frames_dir screenshot_dir < "$STATE_FILE"
    local frame_count ss_count
    frame_count=$(ls -1 "$frames_dir"/frame_*.png 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    ss_count=$(ls -1 "$screenshot_dir"/*.png 2>/dev/null | wc -l | tr -d ' ' || echo "0")
    echo "[record] Active recording"
    echo "  Frames:      $frame_count captured (running: $frames_ok)"
    echo "  Screenshots: $ss_count captured (running: $screenshot_ok)"
    echo "  Output:      $output_video"
  fi
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
