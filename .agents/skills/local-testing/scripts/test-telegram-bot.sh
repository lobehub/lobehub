#!/usr/bin/env bash
#
# test-telegram-bot.sh — Send a message to a Telegram bot and capture the response
#
# Usage:
#   ./scripts/test-telegram-bot.sh <bot_or_chat> <message> [wait_seconds] [screenshot_path]
#
#   bot_or_chat     — Bot username or chat name to search for
#   message         — Message to send to the bot
#   wait_seconds    — Seconds to wait for bot response (default: 10)
#   screenshot_path — Output screenshot path (default: /tmp/telegram-bot-test.png)
#
# Prerequisites:
#   - Telegram desktop app installed and logged in
#   - Accessibility permission granted (System Preferences > Privacy > Accessibility)
#
# Notes:
#   - The app name may be "Telegram" or "Telegram Desktop" depending on installation
#   - Uses Cmd+F to search for the bot, then Enter to open the chat
#
# Examples:
#   ./scripts/test-telegram-bot.sh "MyTestBot" "/start"
#   ./scripts/test-telegram-bot.sh "MyTestBot" "Hello bot" 30
#   ./scripts/test-telegram-bot.sh "GPTBot" "/ask What is AI?" 60 /tmp/my-test.png
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT="${1:?Usage: test-telegram-bot.sh <bot_or_chat> <message> [wait_seconds] [screenshot_path]}"
MESSAGE="${2:?Usage: test-telegram-bot.sh <bot_or_chat> <message> [wait_seconds] [screenshot_path]}"
WAIT="${3:-10}"
SCREENSHOT="${4:-/tmp/telegram-bot-test.png}"

# Detect app name — "Telegram" or "Telegram Desktop"
APP=""
if osascript -e 'tell application "Telegram" to name' &>/dev/null; then
  APP="Telegram"
elif osascript -e 'tell application "Telegram Desktop" to name' &>/dev/null; then
  APP="Telegram Desktop"
else
  echo "[error] Telegram app not found. Install Telegram or Telegram Desktop."
  exit 1
fi

echo "[$APP] Activating..."
osascript -e "tell application \"$APP\" to activate"
sleep 1

echo "[$APP] Searching for: $BOT"
osascript -e '
tell application "System Events"
    -- Search (Escape first to clear any existing state)
    key code 53  -- Escape
    delay 0.3
    keystroke "f" using command down
    delay 0.8
    keystroke "'"$BOT"'"
    delay 2
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
    key code 36  -- Enter
end tell
'

echo "[$APP] Waiting ${WAIT}s for bot response..."
sleep "$WAIT"

echo "[$APP] Capturing screenshot..."
"$SCRIPT_DIR/capture-app-window.sh" "$APP" "$SCREENSHOT"
echo "[$APP] Done! Screenshot saved to $SCREENSHOT"
