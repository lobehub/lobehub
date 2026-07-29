# osascript Common Patterns

General macOS automation via AppleScript / `osascript` — activating apps, typing,
pasting, keyboard shortcuts, clicking, screenshots, and accessibility reads. This is
a general macOS-automation asset, not tied to any one app or surface. Use it when a
test needs to drive a native macOS app that is not reachable over CDP.

macOS only. See also [record-app-screen.md](./record-app-screen.md) for capture and
the screen-recording preflight (`scripts/check-screen-recording.sh`) before any
OS-level capture.

## Core Patterns

### Activate an App

```bash
osascript -e 'tell application "AppName" to activate'
```

### Type Text

```bash
# Type character by character (reliable, but slow for long text)
osascript -e 'tell application "System Events" to keystroke "Hello world"'

# Press Enter
osascript -e 'tell application "System Events" to key code 36'

# Press Tab
osascript -e 'tell application "System Events" to key code 48'

# Press Escape
osascript -e 'tell application "System Events" to key code 53'
```

### Paste from Clipboard (fast, for long text)

```bash
# Set clipboard and paste — much faster than keystroke for long messages
osascript -e 'set the clipboard to "Your long message here"'
osascript -e 'tell application "System Events" to keystroke "v" using command down'
```

Or in one shot:

```bash
osascript -e '
set the clipboard to "Your long message here"
tell application "System Events" to keystroke "v" using command down
'
```

### Keyboard Shortcuts

```bash
osascript -e 'tell application "System Events" to keystroke "k" using command down'               # Cmd+K
osascript -e 'tell application "System Events" to keystroke "f" using command down'               # Cmd+F
osascript -e 'tell application "System Events" to keystroke "n" using command down'               # Cmd+N
osascript -e 'tell application "System Events" to keystroke "k" using {command down, shift down}' # multi-modifier
```

### Click at Position

```bash
osascript -e '
tell application "System Events"
    click at {500, 300}
end tell
'
```

### Get Window Info

```bash
osascript -e '
tell application "System Events"
    tell process "AppName"
        get {position, size} of window 1
    end tell
end tell
'
```

### Screenshot

```bash
screencapture /tmp/screenshot.png           # Full screen
screencapture -i /tmp/screenshot.png        # Interactive region select
screencapture -l "$WINDOW_ID" /tmp/shot.png # Specific window (id from CGWindowList)
```

To get the window id for a specific app:

```bash
osascript -e '
tell application "System Events"
    tell process "AppName"
        get id of window 1
    end tell
end tell
'
```

### Read Accessibility Elements

```bash
# Get all UI elements of the frontmost window (can be slow/large)
osascript -e '
tell application "System Events"
    tell process "AppName"
        entire contents of window 1
    end tell
end tell
'

# Get a specific element's value
osascript -e '
tell application "System Events"
    tell process "AppName"
        get value of text field 1 of window 1
    end tell
end tell
'
```

> **Warning:** `entire contents` can be extremely slow on complex UIs. Prefer
> screenshots + the `Read` tool for visual verification.

### Read Screen Text via Clipboard

```bash
osascript -e '
tell application "System Events"
    keystroke "a" using command down
    keystroke "c" using command down
end tell
'
sleep 0.5
pbpaste
```

## General App-Automation Workflow

```bash
APP_NAME="AppName"
TARGET="some-target"
MESSAGE="Hello!"
WAIT_SECONDS=10

# 1. Activate
osascript -e "tell application \"$APP_NAME\" to activate"
sleep 1

# 2. Navigate (via the app's own quick switcher / search shortcut)
osascript -e 'tell application "System Events" to keystroke "k" using command down'
sleep 0.5
osascript -e "tell application \"System Events\" to keystroke \"$TARGET\""
sleep 1
osascript -e 'tell application "System Events" to key code 36'
sleep 2

# 3. Input (clipboard paste for long/non-ASCII text)
osascript -e "set the clipboard to \"$MESSAGE\""
osascript -e '
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36
end tell
'

# 4. Wait for the app to react
sleep "$WAIT_SECONDS"

# 5. Screenshot for verification
screencapture /tmp/app-test.png
```

### Tips

- **Use clipboard paste** (`Cmd+V`) for messages with special characters or long
  text — `keystroke` can mangle non-ASCII.
- **Add `delay`** between actions — apps need time to process UI events.
- **Screenshot for verification** — `screencapture` + the `Read` tool.
- **Accessibility permission required** — System Events automation requires
  Accessibility access for the driving app (Terminal / iTerm / the agent host) in
  System Settings > Privacy & Security > Accessibility.

## Gotchas

- **Accessibility permission required** — first run prompts for access; grant it in
  System Settings > Privacy & Security > Accessibility.
- **`keystroke` is slow for long text** — use clipboard paste (`Cmd+V`) for anything
  over \~20 characters.
- **`keystroke` can mangle non-ASCII** — use clipboard paste for CJK, emoji, or
  special characters.
- **`key code 36` is Enter** — hardware key code, works regardless of keyboard
  layout.
- **`entire contents` is extremely slow** — avoid for complex UIs; use screenshots.
- **OS screenshots go BLACK when the display is asleep/locked/screensaver** — gate
  with `scripts/check-screen-recording.sh` and keep the display awake with
  `caffeinate -dimsu &` for the whole capture run.
