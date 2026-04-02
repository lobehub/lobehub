#!/usr/bin/env bash
#
# test-wechat-bot.sh — Send a message to a WeChat bot and capture the response
#
# Usage:
#   ./scripts/test-wechat-bot.sh <contact> <message> [wait_seconds] [screenshot_path]
#
#   contact         — Contact or bot name to search for
#   message         — Message to send
#   wait_seconds    — Seconds to wait for bot response (default: 10)
#   screenshot_path — Output screenshot path (default: /tmp/wechat-bot-test.png)
#
# Prerequisites:
#   - WeChat (微信) desktop app installed and logged in
#   - Accessibility permission granted (System Preferences > Privacy > Accessibility)
#
# Notes:
#   - The app name may be "微信" or "WeChat" depending on system language
#   - WeChat sends on Enter by default; use Shift+Enter for newlines
#   - For Chinese text, always uses clipboard paste (keystroke can't handle CJK)
#
# Examples:
#   ./scripts/test-wechat-bot.sh "TestBot" "Hello"
#   ./scripts/test-wechat-bot.sh "文件传输助手" "test message" 5
#   ./scripts/test-wechat-bot.sh "MyBot" "Tell me a joke" 30 /tmp/my-test.png
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTACT="${1:?Usage: test-wechat-bot.sh <contact> <message> [wait_seconds] [screenshot_path]}"
MESSAGE="${2:?Usage: test-wechat-bot.sh <contact> <message> [wait_seconds] [screenshot_path]}"
WAIT="${3:-10}"
SCREENSHOT="${4:-/tmp/wechat-bot-test.png}"

# Detect app name — "微信" or "WeChat"
APP=""
if osascript -e 'tell application "微信" to name' &>/dev/null; then
  APP="微信"
elif osascript -e 'tell application "WeChat" to name' &>/dev/null; then
  APP="WeChat"
else
  echo "[error] WeChat app not found. Install 微信 (WeChat)."
  exit 1
fi

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
# Always use clipboard paste — keystroke can't handle CJK or special characters
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
