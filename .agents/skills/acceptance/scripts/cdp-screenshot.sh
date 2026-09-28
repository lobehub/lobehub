#!/usr/bin/env bash
# Usage: bash cdp-screenshot.sh [--port 9222] [--out shot.png] [--full]
#        [--target-url substring] [--timeout 12000] [--check]
# Capture: Node.js >=22.15. Brightness check: macOS sips + Python 3.
# Exit: 0 captured/passed, 2 check unavailable, 5 capture failed, 6 black, 7 no runtime.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/image-brightness.sh"

CHECK=0
OUT=""
PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --out)
      [ $# -ge 2 ] && [ -n "$2" ] || { echo '[cdp-shot] --out requires a path.' >&2; exit 5; }
      OUT="$2"; shift 2 ;;
    --port|--target-url|--timeout)
      [ $# -ge 2 ] || { echo "[cdp-shot] $1 requires a value." >&2; exit 5; }
      PASS+=("$1" "$2"); shift 2 ;;
    --full) PASS+=("$1"); shift ;;
    *) echo "[cdp-shot] Unknown argument: $1" >&2; exit 5 ;;
  esac
done
command -v node >/dev/null 2>&1 || { echo '[cdp-shot] Node.js >=22.15 is required.' >&2; exit 7; }

# Give every implicit capture its own path, including concurrent calls on one port.
# Only an implicit --check output is disposable; never delete a caller's --out.
if [ -z "$OUT" ]; then
  capture_dir="$(mktemp -d "${TMPDIR:-/tmp}/acceptance-cdp.XXXXXX")" || exit 5
  if [ "$CHECK" = 1 ]; then
    trap 'rm -rf "$capture_dir"' EXIT
  fi
  OUT="$capture_dir/shot.png"
fi
node "$SCRIPT_DIR/cdp-capture.cjs" --out "$OUT" ${PASS[@]+"${PASS[@]}"}
status=$?
if [ "$status" != 0 ]; then
  # A failed implicit capture wrote nothing; do not leave its empty directory behind.
  [ "$CHECK" = 0 ] && [ -n "${capture_dir:-}" ] && rm -rf "$capture_dir"
  exit "$status"
fi

if maximum="$(image_brightness "$OUT")"; then
  if [ "$maximum" -lt 12 ]; then
    echo '[cdp-shot] CAPTURED BUT BLACK. Check that the target page has rendered.' >&2
    exit 6
  fi
  echo "[cdp-shot] Non-black frame measured (maxBrightness=$maximum)."
elif [ "$CHECK" = 1 ]; then
  echo '[cdp-shot] PREFLIGHT UNDETERMINED: brightness check needs working macOS sips and Python 3; capture alone is not a pass.' >&2
  exit 2
else
  echo '[cdp-shot] Screenshot saved; brightness was not checked (requires macOS sips and Python 3). Inspect the image before citing it.' >&2
fi
[ "$CHECK" = 0 ] || echo '[cdp-shot] PREFLIGHT PASS: captured and measured a non-black frame.'
