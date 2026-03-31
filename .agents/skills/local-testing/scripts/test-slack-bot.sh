#!/usr/bin/env bash
#
# test-slack-bot.sh — Send a message to a Slack bot and capture the response
#
# Usage:
#   ./scripts/test-slack-bot.sh <channel> <message> [wait_seconds] [screenshot_path]
#
#   channel         — Channel name to navigate to via Quick Switcher (Cmd+K)
#   message         — Message to send (e.g., "@mybot hello" or "/ask question")
#   wait_seconds    — Seconds to wait for bot response (default: 10)
#   screenshot_path — Output screenshot path (default: /tmp/slack-bot-test.png)
#
# Prerequisites:
#   - Slack desktop app installed and logged in
#   - Accessibility permission granted (System Preferences > Privacy > Accessibility)
#
# Examples:
#   ./scripts/test-slack-bot.sh "bot-testing" "@mybot hello"
#   ./scripts/test-slack-bot.sh "bot-testing" "/ask What is 2+2?" 20
#   ./scripts/test-slack-bot.sh "general" "Hey bot" 15 /tmp/my-test.png
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANNEL="${1:?Usage: test-slack-bot.sh <channel> <message> [wait_seconds] [screenshot_path]}"
MESSAGE="${2:?Usage: test-slack-bot.sh <channel> <message> [wait_seconds] [screenshot_path]}"
WAIT="${3:-10}"
SCREENSHOT="${4:-/tmp/slack-bot-test.png}"

APP="Slack"

echo "[$APP] Activating..."
osascript -e "tell application \"$APP\" to activate"
sleep 1

echo "[$APP] Navigating to channel: $CHANNEL"
osascript -e '
tell application "System Events"
    -- Quick Switcher
    keystroke "k" using command down
    delay 0.8
    keystroke "'"$CHANNEL"'"
    delay 1.5
    key code 36  -- Enter
end tell
'
sleep 2

echo "[$APP] Sending message: $MESSAGE"
osascript -e '
set the clipboard to "'"$MESSAGE"'"
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36  -- Enter
end tell
'

echo "[$APP] Waiting ${WAIT}s for bot response..."
sleep "$WAIT"

echo "[$APP] Capturing screenshot..."
"$SCRIPT_DIR/capture-app-window.sh" "$APP" "$SCREENSHOT"
echo "[$APP] Done! Screenshot saved to $SCREENSHOT"
