#!/usr/bin/env bash
#
# capture-app-window.sh — Capture a screenshot of a specific app window
#
# Uses CGWindowList via Swift to find the window by process name, then
# screencapture -l <windowID> to capture only that window.
# Falls back to full-screen capture if the window is not found.
#
# Usage:
#   ./capture-app-window.sh <process_name> <output_path>
#
# Arguments:
#   process_name — The process/owner name as shown in Activity Monitor
#                  (e.g., "Discord", "Slack", "Telegram", "WeChat", "QQ", "Lark")
#   output_path  — Path to save the screenshot (e.g., /tmp/screenshot.png)
#
# Examples:
#   ./capture-app-window.sh "Discord" /tmp/discord.png
#   ./capture-app-window.sh "Slack" /tmp/slack.png
#   ./capture-app-window.sh "微信" /tmp/wechat.png
#
set -euo pipefail

PROCESS="${1:?Usage: capture-app-window.sh <process_name> <output_path>}"
OUTPUT="${2:?Usage: capture-app-window.sh <process_name> <output_path>}"

# Find the CGWindowID for the target process using Swift + CGWindowList
# Pass process name via environment variable (swift -e doesn't support -- args)
WINDOW_ID=$(TARGET_PROCESS="$PROCESS" swift -e '
import Cocoa
import Foundation
let target = ProcessInfo.processInfo.environment["TARGET_PROCESS"] ?? ""
let windowList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in windowList {
    let owner = w["kCGWindowOwnerName"] as? String ?? ""
    let layer = w["kCGWindowLayer"] as? Int ?? -1
    let bounds = w["kCGWindowBounds"] as? [String: Any] ?? [:]
    let ww = bounds["Width"] as? Double ?? 0
    let wh = bounds["Height"] as? Double ?? 0
    let wid = w["kCGWindowNumber"] as? Int ?? 0
    // Match process name, normal window layer (0), and reasonable size
    if owner == target && layer == 0 && ww > 200 && wh > 200 {
        print(wid)
        break
    }
}
' 2>/dev/null || true)

if [ -n "$WINDOW_ID" ]; then
  screencapture -l "$WINDOW_ID" -x "$OUTPUT"
else
  echo "[capture] Warning: Could not find window for '$PROCESS', falling back to full screen"
  screencapture -x "$OUTPUT"
fi
