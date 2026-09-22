#!/usr/bin/env bash
# macOS OS-capture preflight. Usage: bash check-screen-recording.sh [--json]
# Requires Python 3, sips, screencapture, and clang or swift for the permission probe.
# Exit: 0 granted + live, 2 undetermined/not applicable, 3 denied, 4 black.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/image-brightness.sh"
JSON=0
for argument in "$@"; do
  case "$argument" in
    --json) JSON=1 ;;
    *) echo "Unknown argument: $argument" >&2; exit 2 ;;
  esac
done

platform="$(uname -s)"
if ! command -v python3 >/dev/null 2>&1; then
  if [ "$JSON" = 1 ]; then
    printf '%s\n' '{"ok":false,"permission":"unknown","capture":"unknown","message":"Python 3 is required; no screen-recording check was performed."}'
  else
    echo '[screen-recording] UNDETERMINED: Python 3 is required; no check was performed.'
  fi
  exit 2
fi

APP=""
emit() {
  if [ "$JSON" = 1 ]; then
    python3 - "$platform" "$1" "$2" "$3" "$APP" "$5" <<'PY'
import json, sys
platform, ok, permission, capture, app, message = sys.argv[1:]
print(json.dumps(dict(platform=platform, ok=ok == 'true', permission=permission,
                     capture=capture, responsibleApp=app, message=message)))
PY
  else
    echo "[screen-recording] $5"
  fi
  exit "$4"
}
if [ "$platform" != Darwin ]; then
  emit false n/a n/a 2 "NOT APPLICABLE on $platform: this preflight checks macOS OS capture only. Use CDP for Chromium targets."
fi

# TCC attributes Screen Recording to the ancestor app, not necessarily this shell.
responsible_app() {
  local pid=$$ ppid comm count
  for ((count=0; count<12; count++)); do
    read -r ppid comm < <(ps -o ppid=,comm= -p "$pid" 2>/dev/null) || break
    [ -n "${ppid:-}" ] || break
    if [[ "$comm" == *.app/Contents/MacOS/* ]]; then
      local app="${comm%%.app/*}"
      echo "${app##*/}.app"; return
    fi
    [ "$ppid" -gt 1 ] || break
    pid=$ppid
  done
  echo "${TERM_PROGRAM:-your terminal app}"
}
APP="$(responsible_app)"
probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/acceptance-screen.XXXXXX")" || exit 2
trap 'rm -rf "$probe_dir"' EXIT

# Query only: never request permission or change TCC settings.
permission=unknown
if command -v clang >/dev/null 2>&1; then
  cat > "$probe_dir/permission.c" <<'C'
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
int main(void) { puts(CGPreflightScreenCaptureAccess() ? "granted" : "denied"); return 0; }
C
  if clang -framework CoreGraphics -o "$probe_dir/permission" "$probe_dir/permission.c" 2>/dev/null; then
    permission="$("$probe_dir/permission" 2>/dev/null)" || permission=unknown
  fi
fi
if [ "$permission" = unknown ] && command -v swift >/dev/null 2>&1; then
  permission="$(swift - <<'SWIFT' 2>/dev/null
import CoreGraphics
print(CGPreflightScreenCaptureAccess() ? "granted" : "denied")
SWIFT
)" || permission=unknown
fi
case "$permission" in granted|denied) ;; *) permission=unknown ;; esac
if [ "$permission" = denied ]; then
  emit false denied unknown 3 "BLOCKED: Screen Recording permission is denied for '$APP'. Enable it in System Settings > Privacy & Security > Screen Recording, then fully quit and reopen '$APP'."
fi
if [ "$permission" = unknown ]; then
  emit false unknown unknown 2 'UNDETERMINED: the permission probe needs a working clang or swift with the macOS SDK. No live-frame check was performed.'
fi

capture=unknown
if command -v screencapture >/dev/null 2>&1 && screencapture -x "$probe_dir/shot.png" 2>/dev/null; then
  if maximum="$(image_brightness "$probe_dir/shot.png")"; then
    if [ "$maximum" -lt 12 ]; then capture=black; else capture=live; fi
  fi
fi
case "$capture" in
  live) emit true granted live 0 'PASS: permission granted and a non-black OS frame measured. Inspect actual evidence separately.' ;;
  black) emit false granted black 4 'BLACK FRAME: permission is granted, but the screen is black. Wake/unlock the display, stop the screensaver, or restart the responsible app and retry.' ;;
  *) emit false granted unknown 2 'UNDETERMINED: permission is granted, but a live frame could not be measured. Check screencapture, sips, Python 3, and the display. Permission alone is not a pass.' ;;
esac
