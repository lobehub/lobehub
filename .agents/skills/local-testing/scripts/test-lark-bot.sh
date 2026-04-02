#!/usr/bin/env bash
#
# test-lark-bot.sh — Send a message to a Lark/Feishu bot and capture the response
#
# Usage:
#   ./scripts/test-lark-bot.sh <chat> <message> [wait_seconds] [screenshot_path]
#
#   chat            — Chat or contact name to search for
#   message         — Message to send to the bot
#   wait_seconds    — Seconds to wait for bot response (default: 10)
#   screenshot_path — Output screenshot path (default: /tmp/lark-bot-test.png)
#
# Prerequisites:
#   - Lark (飞书) desktop app installed and logged in
#   - Accessibility permission granted (System Preferences > Privacy > Accessibility)
#
# Notes:
#   - The app name may be "Lark" or "飞书" depending on version/locale
#   - Uses Cmd+K to open search/quick switcher
#   - Enter sends message by default
#
# Examples:
#   ./scripts/test-lark-bot.sh "TestBot" "Hello"
#   ./scripts/test-lark-bot.sh "bot-testing" "/ask Tell me a joke" 30
#   ./scripts/test-lark-bot.sh "MyBot" "Help me summarize this" 60 /tmp/my-test.png
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHAT="${1:?Usage: test-lark-bot.sh <chat> <message> [wait_seconds] [screenshot_path]}"
MESSAGE="${2:?Usage: test-lark-bot.sh <chat> <message> [wait_seconds] [screenshot_path]}"
WAIT="${3:-10}"
SCREENSHOT="${4:-/tmp/lark-bot-test.png}"

# Detect app name — "Lark" or "飞书"
APP=""
if osascript -e 'tell application "Lark" to name' &>/dev/null; then
  APP="Lark"
elif osascript -e 'tell application "飞书" to name' &>/dev/null; then
  APP="飞书"
else
  echo "[error] Lark/飞书 app not found. Install Lark or 飞书."
  exit 1
fi

echo "[$APP] Activating..."
osascript -e "tell application \"$APP\" to activate"
sleep 1

echo "[$APP] Searching for chat: $CHAT"
osascript -e '
tell application "System Events"
    -- Quick Switcher / Search (Cmd+K)
    keystroke "k" using command down
    delay 0.8
end tell
'
# Use clipboard for chat name (supports CJK characters)
osascript -e '
set the clipboard to "'"$CHAT"'"
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
