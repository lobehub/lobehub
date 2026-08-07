#!/usr/bin/env bash
# record-gif.sh — capture a frame sequence via agent-browser (CDP) and
# synthesize a GIF for embedding in a test report.
#
# Use this whenever the asserted behavior is about CHANGE OVER TIME —
# streaming output, a ticking timer, loading states, animations. A static
# screenshot cannot prove those; a GIF can. Cloud-portable: frames come from
# CDP rendering, no OS-level screen capture.
#
# Usage:
#   record-gif.sh <output.gif> <duration_seconds> [fps]
#
#   AB_TARGET="--cdp 9222"             # Electron (default; CDP_PORT honored)
#   AB_TARGET="--session your-session" # web agent-browser session
#   GIF_WIDTH=960                      # output width (px), default 960
#
# Requires ffmpeg (`brew install ffmpeg`). Effective fps is capped by
# screenshot latency (~0.3-0.5s per frame); 1-2 fps is the realistic range.
#
# Example — record a 12s run and embed it in the report:
#   ./record-gif.sh "$DIR/assets/case2-tray-running.gif" 12 2 &
#   GIF_PID=$!
#   # ... trigger the streaming behavior ...
#   wait $GIF_PID

set -euo pipefail

OUT="${1:?Usage: record-gif.sh <output.gif> <duration_seconds> [fps]}"
DUR="${2:?Usage: record-gif.sh <output.gif> <duration_seconds> [fps]}"
FPS="${3:-2}"
AB_TARGET="${AB_TARGET:---cdp ${CDP_PORT:-9222}}"
GIF_WIDTH="${GIF_WIDTH:-960}"

command -v ffmpeg > /dev/null || {
  echo "ffmpeg not found — install with: brew install ffmpeg" >&2
  exit 1
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

FRAMES=$((DUR * FPS))
INTERVAL=$(python3 -c "print(1 / $FPS)")

for i in $(seq -f '%04g' 1 "$FRAMES"); do
  # shellcheck disable=SC2086
  agent-browser $AB_TARGET screenshot "$TMP/frame-$i.png" > /dev/null 2>&1 || true
  sleep "$INTERVAL"
done

CAPTURED=$(find "$TMP" -name 'frame-*.png' | wc -l | tr -d ' ')
[ "$CAPTURED" -gt 0 ] || {
  echo "no frames captured — is the app reachable via $AB_TARGET?" >&2
  exit 1
}

ffmpeg -y -loglevel error -framerate "$FPS" -pattern_type glob -i "$TMP/frame-*.png" \
  -vf "fps=$FPS,scale=$GIF_WIDTH:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$OUT"

echo "$OUT ($CAPTURED frames @ ${FPS}fps)"
