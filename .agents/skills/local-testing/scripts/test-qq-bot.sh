#!/usr/bin/env bash
#
# test-qq-bot.sh — Send a message to a QQ bot and capture the response
#
# Usage:
#   ./scripts/test-qq-bot.sh <contact> <message> [wait_seconds] [screenshot_path]
#
#   contact         — Contact, group, or bot name to search for
#   message         — Message to send
#   wait_seconds    — Seconds to wait for bot response (default: 10)
#   screenshot_path — Output screenshot path (default: /tmp/qq-bot-test.png)
#
# Prerequisites:
#   - QQ desktop app installed and logged in
#   - Accessibility permission granted (System Preferences > Privacy > Accessibility)
#
# Notes:
#   - The app name is "QQ"
#   - Uses Cmd+F to open search
#   - Enter sends message by default; Shift+Enter for newlines
#   - Uses clipboard paste for CJK character support
#
# Examples:
#   ./scripts/test-qq-bot.sh "TestBot" "Hello"
#   ./scripts/test-qq-bot.sh "bot-testing" "Hello bot" 30
#   ./scripts/test-qq-bot.sh "MyBot" "/help" 15 /tmp/my-test.png
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTACT="${1:?Usage: test-qq-bot.sh <contact> <message> [wait_seconds] [screenshot_path]}"
MESSAGE="${2:?Usage: test-qq-bot.sh <contact> <message> [wait_seconds] [screenshot_path]}"
WAIT="${3:-10}"
SCREENSHOT="${4:-/tmp/qq-bot-test.png}"

APP="QQ"

echo "[$APP] Activating..."
osascript -e "tell application \"$APP\" to activate"
sleep 1

echo "[$APP] Searching for contact: $CONTACT"
osascript -e '
tell application "System Events"
    -- Search (Cmd+F)
    keystroke "f" using command down
    delay 0.8
end tell
'
# Use clipboard for contact name (supports CJK characters)
osascript -e '
set the clipboard to "'"$CONTACT"'"
tell application "System Events"
    keystroke "v" using command down
    delay 1.5
    key code 36  -- Enter to select first result
end tell
'
sleep 2

echo "[$APP] Sending message: $MESSAGE"
osascript -e '
set the clipboard to "'"$MESSAGE"'"
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36  -- Enter to send
end tell
'

echo "[$APP] Waiting ${WAIT}s for bot response..."
sleep "$WAIT"

echo "[$APP] Capturing screenshot..."
"$SCRIPT_DIR/capture-app-window.sh" "$APP" "$SCREENSHOT"
echo "[$APP] Done! Screenshot saved to $SCREENSHOT"
