# macOS Computer Use (osascript) toolkit

`agent-browser` drives Chromium surfaces (web, Electron). For everything it can't
reach, this is the escape hatch: **macOS Computer Use** via `osascript`
(AppleScript) and `screencapture`. Use it to drive native apps, handle OS-level
chrome, and read the screen when no CDP target exists.

This is the native/OS counterpart of [agent-browser.md](./agent-browser.md). It is
**macOS-only and not cloud-portable** — prefer CDP automation when both can reach
the target; reach here only when CDP can't.

## When you need it

- **Native (non-Chromium) app under test** — the thing you're verifying is a native
  macOS app agent-browser can't attach to. Drive it here (see
  [../surfaces/native.md](../surfaces/native.md)).
- **OS-level steps inside a web/Electron flow** — a native file picker, a system
  permission prompt, a Save dialog, dock/menu-bar interaction, or a Spotlight/
  app-switch the page can't script. Drop to Computer Use for that step, then return
  to agent-browser.
- **Reading the screen** when no DOM/CDP is available — screenshot + visual read, or
  select-all-copy + `pbpaste`.

## Core patterns

### Activate an app

```bash
osascript -e 'tell application "AppName" to activate'
```

### Type / press keys

```bash
osascript -e 'tell application "System Events" to keystroke "Hello world"'
osascript -e 'tell application "System Events" to key code 36' # Enter (hardware code, layout-independent)
osascript -e 'tell application "System Events" to key code 48' # Tab
osascript -e 'tell application "System Events" to key code 53' # Escape
```

### Paste from clipboard (fast; required for long / non-ASCII text)

```bash
osascript -e 'set the clipboard to "Your long or 中文 / emoji message"'
osascript -e 'tell application "System Events" to keystroke "v" using command down'
```

### Keyboard shortcuts (modifiers)

```bash
osascript -e 'tell application "System Events" to keystroke "f" using command down'               # Cmd+F
osascript -e 'tell application "System Events" to keystroke "k" using {command down, shift down}' # Cmd+Shift+K
```

### Click at screen coordinates

```bash
osascript -e 'tell application "System Events" to click at {500, 300}'
```

### Window position / size / id

```bash
osascript -e '
tell application "System Events" to tell process "AppName"
  get {position, size} of window 1
end tell'
```

### Screenshot (OS-level)

```bash
screencapture /tmp/shot.png                 # full screen
screencapture -i /tmp/shot.png              # interactive region select
screencapture -l "$WINDOW_ID" /tmp/shot.png # specific window
```

Get a window id:

```bash
osascript -e 'tell application "System Events" to tell process "AppName" to get id of window 1'
```

### Read accessibility elements

```bash
osascript -e '
tell application "System Events" to tell process "AppName"
  get value of text field 1 of window 1
end tell'
```

> `entire contents of window 1` dumps the whole UI tree but is **extremely slow**
> on complex apps — prefer a screenshot + visual read, or the clipboard read below.

### Read screen text via clipboard

```bash
osascript -e '
tell application "System Events"
  keystroke "a" using command down
  keystroke "c" using command down
end tell'
sleep 0.5
pbpaste
```

## Capturing as evidence

- A `screencapture` PNG → `--type screenshot --by cli`.
- For time-based native behavior, OS screen-record to MP4/GIF — see
  [recording.md](./recording.md#path-2--os-screen-recording-macos-local-only).
- Text read via `pbpaste` → `--type text --content "$(pbpaste)"`.

## Gotchas

- **Accessibility permission required.** First run prompts for it; grant the host
  (Terminal / iTerm / the agent runner) in System Settings → Privacy & Security →
  Accessibility, or every `System Events` call silently fails.
- **`keystroke` is slow and mangles non-ASCII** — use clipboard paste (`Cmd+V`) for
  anything long or for Chinese / emoji / special characters.
- **`key code 36` is Enter** by hardware code, so it works regardless of keyboard
  layout. Some apps send-on-Enter — use `Shift+Enter` for a newline within input.
- **Add small `delay`/`sleep` between actions** — native apps need time to process
  UI events; back-to-back commands drop.
- **App name varies by locale** — e.g. `微信` vs `WeChat`; handle the name the
  running OS uses.
- **Not cloud-portable.** Everything here needs a real macOS session with a display.
  Keep evidence CDP-based when the target is reachable that way.
