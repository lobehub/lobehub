#!/usr/bin/env bash
#
# test-discord-bot.sh — Send a message to a Discord bot and capture the response
#
# Usage:
#   ./scripts/test-discord-bot.sh <channel> <message> [wait_seconds] [screenshot_path]
#
#   channel         — Channel name to navigate to via Quick Switcher (Cmd+K)
#   message         — Message to send to the bot
#   wait_seconds    — Seconds to wait for bot response (default: 10)
#   screenshot_path — Output screenshot path (default: /tmp/discord-bot-test.png)
#
# Prerequisites:
#   - Discord desktop app installed and logged in
#   - Accessibility permission granted (System Preferences > Privacy > Accessibility)
#
# Examples:
#   ./scripts/test-discord-bot.sh "bot-testing" "!ping"
#   ./scripts/test-discord-bot.sh "bot-testing" "/ask Tell me a joke" 30
#   ./scripts/test-discord-bot.sh "general" "Hello bot" 15 /tmp/my-test.png
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANNEL="${1:?Usage: test-discord-bot.sh <channel> <message> [wait_seconds] [screenshot_path]}"
MESSAGE="${2:?Usage: test-discord-bot.sh <channel> <message> [wait_seconds] [screenshot_path]}"
WAIT="${3:-10}"
SCREENSHOT="${4:-/tmp/discord-bot-test.png}"

APP="Discord"

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
