#!/usr/bin/env bash
#
# cdp-screenshot.sh — Reliable Electron/Chrome screenshot via RAW CDP (bypasses the
# agent-browser daemon) + optional preflight verdict.
#
# Why this exists: agent-browser's `screenshot` goes through a long-lived daemon that
# can wedge ("CDP response channel closed" / "daemon busy") after an interrupted or
# mis-invoked capture — and once wedged, every later screenshot fails while eval/get
# still work. Raw `Page.captureScreenshot` is fast (~60ms) and robust: it forces a
# compositor frame, so it works even when the DISPLAY IS ASLEEP or the WINDOW IS
# MINIMIZED/OCCLUDED (both verified). Use this instead of `agent-browser screenshot`
# for Electron evidence, and as a preflight to prove capture works before relying on it.
#
# Usage:
#   ./cdp-screenshot.sh [--port 9222] [--out shot.png] [--full] [--target-url <substr>] [--check]
#
#   --check   preflight mode: capture a throwaway frame, verify it is non-black,
#             print a PASS/FAIL verdict. Exit 0 only if a real frame was captured.
#
# Exit codes: 0 ok · 5 capture failed/timeout · 6 captured but BLACK · 7 node/dependency missing
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=9222; OUT=""; CHECK=0; PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    --full|--target-url) PASS+=("$1"); [ "$1" = "--target-url" ] && { PASS+=("$2"); shift; }; shift ;;
    *) PASS+=("$1"); shift ;;
  esac
done
[ -z "$OUT" ] && OUT="${TMPDIR:-/tmp}/cdp-shot-$PORT.png"

command -v node >/dev/null 2>&1 || { echo "[cdp-shot] node not found"; exit 7; }

# cdp-capture.cjs resolves the `ws` package itself via Node's normal ancestor
# node_modules lookup from its own file location — no NODE_PATH plumbing needed.
res="$(node "$SCRIPT_DIR/cdp-capture.cjs" --port "$PORT" --out "$OUT" --timeout 12000 ${PASS[@]+"${PASS[@]}"} 2>&1)"
ok="$(printf '%s' "$res" | sed -n 's/.*"ok":\([a-z]*\).*/\1/p')"

if [ "$ok" != "true" ]; then
  case "$res" in
    *"Cannot find module 'ws'"*)
      echo "[cdp-shot] MISSING DEPENDENCY: $res"
      exit 7
      ;;
  esac
  echo "[cdp-shot] CAPTURE FAILED: $res"
  echo "[cdp-shot] Fix: ensure the app runs with --remote-debugging-port=$PORT and CDP is reachable (curl 127.0.0.1:$PORT/json/version). If agent-browser wedged the session earlier, reset it: 'agent-browser close --all'. Raw CDP here does not use that daemon."
  exit 5
fi

# blackness verdict (sips + python3; skip silently if unavailable)
verdict="unknown"; maxv=""
if command -v sips >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  sips -z 16 16 "$OUT" --out "$OUT.s.png" >/dev/null 2>&1
  sips -s format bmp "$OUT.s.png" --out "$OUT.bmp" >/dev/null 2>&1
  maxv="$(python3 - "$OUT.bmp" <<'PY' 2>/dev/null || echo -1
import sys
d=open(sys.argv[1],'rb').read();off=int.from_bytes(d[10:14],'little');w=int.from_bytes(d[18:22],'little');h=abs(int.from_bytes(d[22:26],'little',signed=True))
bpp=int.from_bytes(d[28:30],'little') or 24;B=bpp//8;row=((w*bpp+31)//32)*4;mx=0
for y in range(h):
  for x in range(w):
    q=off+y*row+x*B
    if q+2<len(d): mx=max(mx,d[q],d[q+1],d[q+2])
print(mx)
PY
)"
  rm -f "$OUT.s.png" "$OUT.bmp" 2>/dev/null
  [[ "$maxv" =~ ^[0-9]+$ ]] && { (( maxv < 12 )) && verdict="black" || verdict="live"; }
fi

if [ "$verdict" = "black" ]; then
  echo "[cdp-shot] CAPTURED BUT BLACK ($res). Unusual for CDP — check the page actually rendered (not a blank route)."
  [ "$CHECK" = "1" ] && exit 6
  exit 6
fi

echo "[cdp-shot] OK ($res)${maxv:+ maxBrightness=$maxv}"
[ "$CHECK" = "1" ] && { rm -f "$OUT" 2>/dev/null; echo "[cdp-shot] PREFLIGHT PASS — CDP screenshot works on port $PORT."; }
exit 0
