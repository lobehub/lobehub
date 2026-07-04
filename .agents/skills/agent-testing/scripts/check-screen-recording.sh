#!/usr/bin/env bash
#
# check-screen-recording.sh — Preflight gate for OS-level screen capture (macOS).
#
# OS screenshots (`screencapture`, osascript, bot-channel captures) come out
# ENTIRELY BLACK when either:
#   1. Screen Recording (TCC) permission is not granted to the responsible app, or
#   2. the display is asleep / locked / running a screensaver (permission is fine
#      but there is nothing lit to capture — common after a long idle test run).
# A black artifact is easy to mistake for a real capture, so gate on this BEFORE
# any OS-capture step. CDP-based evidence (agent-browser screenshot, record-app-screen)
# renders from the browser engine and is NOT affected — this check is only for the
# OS-capture surfaces (bot tests, capture-app-window.sh, osascript screenshots).
#
# Usage:
#   ./check-screen-recording.sh            # human-readable; exit 0 if OS capture will work
#   ./check-screen-recording.sh --json     # machine-readable one-line JSON
#
# Exit codes:
#   0  OS capture works (permission granted AND a live, non-black frame captured)
#   0  non-macOS (OS capture N/A — use CDP evidence)
#   3  permission NOT granted        → grant Screen Recording, then restart the app
#   4  permission ok but frame BLACK → wake/unlock display, quit screensaver, or restart app
#   2  could not determine (no screencapture/toolchain)
#
set -uo pipefail

JSON=0
for a in "$@"; do case "$a" in --json) JSON=1 ;; esac; done

emit() { # $1=ok(true/false) $2=perm $3=capture $4=exit $5=message [$6=app]
  if [[ $JSON == 1 ]]; then
    printf '{"platform":"%s","ok":%s,"permission":"%s","capture":"%s","responsibleApp":"%s","message":"%s"}\n' \
      "$(uname -s)" "$1" "${2:-unknown}" "${3:-unknown}" "${6:-}" "$5"
  else
    echo "[screen-recording] $5"
  fi
  exit "$4"
}

os=$(uname -s)
if [[ "$os" != "Darwin" ]]; then
  emit true "n/a" "n/a" 0 "non-macOS ($os): OS screen capture N/A; CDP-based evidence is unaffected. OK."
fi

# --- responsible app: TCC attributes Screen Recording to the ancestor .app bundle ---
responsible_app() {
  local pid=$$ ppid comm
  for _ in $(seq 1 12); do
    if ! read -r ppid comm < <(ps -o ppid=,comm= -p "$pid" 2>/dev/null); then break; fi
    [[ -z "${ppid:-}" ]] && break
    if [[ "$comm" == *.app/Contents/MacOS/* ]]; then
      local app="${comm%%.app/*}"; echo "${app##*/}.app"; return 0
    fi
    [[ "${ppid:-0}" -le 1 ]] && break
    pid=$ppid
  done
  echo "${TERM_PROGRAM:-your terminal app}"
}
APP="$(responsible_app)"

# --- layer 1: TCC permission via CGPreflightScreenCaptureAccess (no prompt, no display) ---
perm="unknown"
bin="${TMPDIR:-/tmp}/lobehub-scrcheck"
if [[ ! -x "$bin" ]] && command -v clang >/dev/null 2>&1; then
  src="${TMPDIR:-/tmp}/lobehub-scrcheck.c"
  cat > "$src" <<'EOF'
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
int main(void){ bool ok = CGPreflightScreenCaptureAccess(); printf(ok?"granted\n":"denied\n"); return ok?0:1; }
EOF
  clang -framework CoreGraphics -o "$bin" "$src" 2>/dev/null || rm -f "$bin"
fi
if [[ -x "$bin" ]]; then
  perm="$("$bin" 2>/dev/null || echo denied)"
elif command -v swift >/dev/null 2>&1; then
  perm="$(swift - <<'EOF' 2>/dev/null || echo denied
import CoreGraphics
print(CGPreflightScreenCaptureAccess() ? "granted" : "denied")
EOF
)"
fi

# --- layer 2: liveness — capture one real frame and detect a fully-black image ---
# Uses the brightest pixel across a downscaled grid: a live desktop always has some
# lit chrome (menu bar / cursor / window), a blocked/asleep capture is uniformly ~0.
capture="unknown"; maxv=""
if command -v screencapture >/dev/null 2>&1; then
  shot="${TMPDIR:-/tmp}/lobehub-scrlive.png"
  small="${TMPDIR:-/tmp}/lobehub-scrlive.bmp"
  rm -f "$shot" "$small"
  screencapture -x "$shot" 2>/dev/null || true
  if [[ -s "$shot" ]] && command -v sips >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    sips -z 16 16 "$shot" --out "${shot}.s.png" >/dev/null 2>&1
    sips -s format bmp "${shot}.s.png" --out "$small" >/dev/null 2>&1
    if [[ -s "$small" ]]; then
      maxv="$(python3 - "$small" <<'PY' 2>/dev/null || echo -1
import sys
d=open(sys.argv[1],'rb').read()
off=int.from_bytes(d[10:14],'little')
w=int.from_bytes(d[18:22],'little')
h=abs(int.from_bytes(d[22:26],'little',signed=True))
bpp=int.from_bytes(d[28:30],'little') or 24
Bpp=bpp//8
row=((w*bpp+31)//32)*4
mx=0
for y in range(h):
    base=off+y*row
    for x in range(w):
        p=base+x*Bpp
        if p+2 < len(d):
            mx=max(mx, d[p], d[p+1], d[p+2])
print(mx)
PY
)"
      if [[ "${maxv:-}" =~ ^[0-9]+$ ]]; then
        # brightest channel < 12/255 across the whole screen ⇒ effectively black
        if (( maxv < 12 )); then capture="black"; else capture="live"; fi
      fi
    fi
  fi
  rm -f "$shot" "${shot}.s.png" "$small" 2>/dev/null || true
fi

# --- decision ---
if [[ "$capture" == "live" ]]; then
  emit true "$perm" "$capture" 0 "OK — Screen Recording works (permission granted, display live). OS captures and bot tests will render real frames." "$APP"
fi

if [[ "$capture" == "black" ]]; then
  if [[ "$perm" == "denied" ]]; then
    emit false "$perm" "$capture" 3 "BLOCKED — Screen Recording permission is NOT granted to '$APP'. Enable it in: System Settings ▸ Privacy & Security ▸ Screen Recording ▸ turn ON '$APP', then FULLY QUIT & reopen '$APP' (TCC only takes effect on a fresh launch). Until then every OS screenshot/recording and bot test will be BLACK." "$APP"
  fi
  emit false "$perm" "$capture" 4 "BLACK FRAME — permission looks OK but the capture is black. The display is likely asleep / locked / on a screensaver, or '$APP' was just granted permission but not restarted. Wake & unlock the display, disable the screensaver for the test run (caffeinate -d), or restart '$APP', then re-run this check." "$APP"
fi

# capture couldn't be measured → fall back to the permission verdict
if [[ "$perm" == "denied" ]]; then
  emit false "$perm" "$capture" 3 "BLOCKED — Screen Recording permission is NOT granted to '$APP'. Enable it: System Settings ▸ Privacy & Security ▸ Screen Recording ▸ turn ON '$APP', then fully quit & reopen '$APP'." "$APP"
elif [[ "$perm" == "granted" ]]; then
  emit true "$perm" "$capture" 0 "Permission granted for '$APP'; could not verify a live frame (no screencapture/sips/python3). Proceeding — if OS captures come out black, wake/unlock the display." "$APP"
else
  emit false "$perm" "$capture" 2 "UNDETERMINED — could not check Screen Recording permission or capture a test frame (missing clang/swift/screencapture). Verify manually in System Settings ▸ Privacy & Security ▸ Screen Recording for '$APP'." "$APP"
fi
