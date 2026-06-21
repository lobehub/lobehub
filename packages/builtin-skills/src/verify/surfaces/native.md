# 原生 macOS 应用端验收 (Computer Use)

Use this 端 when the thing under test is a **native macOS app** that `agent-browser`
can't drive — anything not Chromium-based: a native desktop app, a chat client you
verify against (Slack/WeChat/…), Finder/system UI, or any OS-level behavior. You
drive it with macOS Computer Use (osascript + screencapture) — the toolkit is in
[../references/computer-use.md](../references/computer-use.md).

Prefer the other 端 when they can reach the target: [web.md](./web.md) /
[electron.md](./electron.md) for Chromium UIs, [cli.md](./cli.md) for backend.
Native is the **local-macOS escape hatch** — it is not cloud-portable (needs a real
display + Accessibility permission), so reach for it only when CDP can't.

## How to verify

1. Activate the app and navigate to the state under test (keystrokes / shortcuts /
   clicks — see the toolkit).
2. Drive the action that exercises your change.
3. Capture proof: a `screencapture` PNG, a screen recording for time-based behavior
   ([../references/recording.md](../references/recording.md#path-2--os-screen-recording-macos-local-only)),
   or screen text via select-all-copy + `pbpaste`.

```bash
APP="YourApp"
osascript -e "tell application \"$APP\" to activate"
sleep 1
# ... navigate + act via osascript (see computer-use.md) ...
sleep 2 # let the result settle
screencapture -l "$(osascript -e "tell application \"System Events\" to tell process \"$APP\" to get id of window 1")" ./proof/native-result.png
```

Upload as evidence (provenance `cli`, since osascript/screencapture are
shell-driven):

```bash
lh verify evidence upload --check "$CHECK_RESULT_ID" --type screenshot \
  --file ./proof/native-result.png --by cli \
  --desc "Native app shows the expected state after the change"
```

## Mid-flow use from another 端

You don't have to commit the whole run to this 端. A web or Electron flow can drop
into Computer Use for a single OS-level step it can't script — a native file picker,
a system permission prompt, a Save dialog — then hand control back to agent-browser.
Capture the proof on whichever 端 owns the criterion.

## Boundaries

- **macOS + display only.** No headless/cloud — see
  [../references/computer-use.md](../references/computer-use.md#gotchas).
- **Accessibility permission is mandatory** or every `System Events` call silently
  no-ops. Grant it to the host once.
- **Prefer CDP when reachable.** A Chromium target driven over CDP is more robust
  and portable than coordinate clicks; use native only when there's no CDP path.
