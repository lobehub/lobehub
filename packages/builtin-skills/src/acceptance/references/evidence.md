# Capturing portable evidence

The goal is an artifact a human (and the review agent) can open and believe. Pick
the lightest capture that proves the criterion, and prefer engine-level capture so
it works the same locally and headless/cloud. UI capture uses `agent-browser`
([agent-browser.md](./agent-browser.md)) on Web/Electron; iOS Simulator uses an
installed native HID/Accessibility CLI such as AXe plus `simctl`
([ios-simulator](../surfaces/ios-simulator.md)); backend/CLI uses
[cli](../surfaces/cli.md).

## Evidence type → how to capture

### `screenshot` — UI state

Screenshots via CDP (the browser engine) need no real display:

```bash
# web (named session)
agent-browser --session app open "<url>"
agent-browser --session app click @e1 # act, after snapshot -i to get refs
agent-browser --session app screenshot ./proof/after.png

# desktop (Electron, over CDP)
agent-browser --cdp 9222 screenshot ./proof/desktop.png

# iOS Simulator (clean device framebuffer)
axe screenshot --udid "$UDID" --output ./proof/ios-after-axe.png
xcrun simctl io "$UDID" screenshot --type=png ./proof/ios-after.png
```

Avoid macOS `screencapture` / osascript unless the criterion is explicitly
native/local-only — they don't run in the cloud.

### `dom_snapshot` — structure / content proof

When the proof is "this element/text exists with these values", a DOM dump is
smaller and more assertable than a pixel screenshot:

```bash
agent-browser --session app eval "document.querySelector('[data-testid=list]').outerHTML" > ./proof/list.html
```

Upload as `--type dom_snapshot --file ./proof/list.html`.

### `text` — stdout, logs, computed values

Backend / CLI behavior is best proven by the command output itself — upload inline,
no file:

```bash
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" --type text \
  --content "$(your-cli command --json)" \
  --by cli --desc "command reports success after the change"
```

A network capture (HAR) or a request/response pair from a full-stack run also
uploads as `text` (`--file ./proof/capture.har` or `--content`).

### `transcript` — conversation / request log

A saved agent conversation, request/response pair, or event log file:
`--type transcript --file ./proof/run.jsonl`.

### `gif` / `video` — behavior over time

Required whenever a criterion asserts change over time (streaming output, a ticking
timer, a loading→loaded transition, an animation, a multi-step flow) — a static
screenshot cannot prove these. Record a clip and upload `--type gif` / `--type
video --file …`. Full recipes (portable CDP frame-sequence, iOS Simulator
framebuffer recording/frame extraction, macOS screen recording, GIF-vs-MP4):
[recording.md](./recording.md).

## Provenance (`--by`)

Tag how the artifact was produced so the reviewer can weigh it:

- `agent-browser` — captured through agent-browser (screenshots, DOM, eval)
- `cdp` — captured directly via Chrome DevTools Protocol
- `cli` — command stdout/computed text or a direct AXe/`simctl` capture
- `program` — produced by a script, UI test, or deterministic media transform

## Headless / cloud portability

The decisive constraint per surface is **how a screenshot is captured**: engine-level
capture (CDP) needs no display; OS-level capture is macOS-only.

| Surface       | macOS (local) | Linux / cloud (headless)                                        | Screenshot mechanism                             |
| ------------- | ------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| CLI / text    | ✅            | ✅                                                              | n/a — text output                                |
| Web           | ✅            | ✅ headless Chromium works natively                             | CDP — no display needed                          |
| Electron      | ✅            | ⚠️ runs but needs a display server: wrap launch with `xvfb-run` | CDP works under Xvfb; OS-window capture does NOT |
| Native macOS  | ✅            | ❌                                                              | Computer Use / host screen                       |
| iOS Simulator | ✅ Xcode only | ❌                                                              | `simctl io` device framebuffer                   |

Checklist:

- ✅ `agent-browser screenshot` / `eval` (DOM, console) — engine-level, headless-safe
- ✅ `axe screenshot` or `xcrun simctl io ...` — clean Simulator framebuffer
  on a local Xcode host; use `axe record-video` only after a short file passes
  `ffprobe`, as described in [recording.md](./recording.md)
- ✅ `--type text --content …` — pure text, always works
- ❌ `screencapture`, osascript, native-app screen recording — macOS-only, not
  cloud-safe

When a run must stay cloud-portable, prefer CDP-based evidence over OS-level
capture wherever both exist.

## Don't leak secrets

Evidence is visible to reviewers. Never capture a screenshot or text dump that
contains a live token, cookie, password, or other secret — see
[auth.md](./auth.md#boundaries--read-before-touching-cookies).
