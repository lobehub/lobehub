# iOS Simulator surface

Use this surface when a criterion depends on native iOS rendering, navigation,
gestures, lifecycle, system sheets, or device-size layout. It requires macOS,
Xcode, and an installed Simulator runtime; it is not cloud-portable.

The required workflow is shell-only: every input and capture step must be
executable by a general agent through a documented CLI. An agent-specific GUI
controller or private plugin is not a prerequisite.

## Contents

- [Proof contract](#proof-contract)
- [Probe and choose a CLI driver](#probe-and-choose-a-cli-driver)
- [Establish the tested build](#establish-the-tested-build)
- [Inspect and interact](#inspect-before-acting)
- [Capture and review evidence](#capture-device-evidence)
- [Decide the case status](#decide-the-case-status)

## Proof contract

Separate the plan into observable claims before testing:

1. **Build/install/launch** — the current source produced the app now running.
2. **Static UI state** — the expected controls, content, and layout are visible.
3. **Behavior over time** — an animation, transition, or multi-step flow occurred.
4. **Touch semantics** — the intended tap, long press, swipe, or pan was actually
   delivered before judging the product response.
5. **Hardware-only behavior** — haptics, thermal behavior, camera input, and
   real-device performance require a physical device; Simulator cannot prove them.

Record the repository, branch, commit, dirty state, build command, Xcode version,
Simulator model/runtime/UDID, bundle identifier, and tested time. A screenshot
from an old install is not evidence for the current source.

## Probe and choose a CLI driver

Prefer a CLI that talks to Simulator Accessibility and HID directly. Probe the
host rather than assuming one tool is installed:

```bash
command -v axe
command -v idb
command -v idb_companion
command -v cliclick
command -v ffmpeg
command -v ffprobe
xcrun simctl help io
```

| Tool                    | Responsibility in this workflow                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AXe                     | Accessibility inspection; selector/coordinate tap; touch, swipe, drag, and preset gesture injection; screenshots |
| `simctl`                | Device discovery and lifecycle; app install/launch; logs; authoritative framebuffer screenshots and recording    |
| `ffprobe`               | Prove the recorded movie is readable and report its observed duration, dimensions, rate, and frame count         |
| `ffmpeg`                | Losslessly enumerate decoded frames, sample review frames, and generate contact sheets                           |
| `idb` + `idb_companion` | Optional alternative driver only when both halves are installed and working                                      |
| `cliclick`              | Last-resort host-window click for smoke testing; not proof of native touch semantics                             |

Driver priority:

1. **AXe** — preferred general-purpose agent driver. It resolves accessibility
   selectors, injects taps/touch/swipe/drag, describes UI, and captures
   screenshots. Treat its video recorder as a probe-only fallback to `simctl`.
2. **The repository's existing XCUITest or documented CLI driver** — use when AXe
   is absent or the project already owns stronger domain assertions.
3. **`idb` + `idb_companion` together** — use only when both client and companion
   are available. `idb_companion` alone is not an interaction CLI.
4. **`cliclick`** — host-window fallback for a simple click only. It depends on
   Simulator window geometry and does not independently prove native HID semantics.

If no available driver can express the planned gesture, mark the case `blocked`.
Do not switch to a private agent plugin or silently downgrade a long press to a
tap. If AXe must be installed, use its official distribution only after the task
scope allows installation; otherwise report the missing prerequisite.

```bash
# Only when AXe is absent and dependency installation is explicitly in scope.
brew install cameroncooke/axe/axe
```

The examples below target AXe. Run `axe --version`, `axe --help`, and
`axe help <subcommand>` first because capabilities may differ by installed
version.

## Establish the tested build

Resolve one explicit device and keep using its UDID. Avoid `booted` after device
selection when several Simulators may be running.

```bash
axe list-simulators
xcrun simctl list devices booted --json > ./proof/simulator-devices.json
xcodebuild -version > ./proof/xcode-version.txt

# Build with the repository's canonical command first, then install its product.
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE_ID"
```

For a development client, also prove that its Metro/dev-server URL is reachable
and that the newly built native binary, rather than a stale installation, opened.
Save the build product path and modification time in the text evidence.

## Inspect before acting

Read the current Accessibility hierarchy before choosing selectors or coordinates:

```bash
axe describe-ui --udid "$UDID" > ./proof/before-ui.txt
axe describe-ui --point 220,710 --udid "$UDID"
```

Prefer `--id` (accessibility identifier), then `--label` plus `--element-type`.
Use coordinates only when the UI exposes no unambiguous selector. Stable
identifiers make the same flow reusable across device sizes and reduce accidental
actions on the wrong control. If selector resolution reports multiple matches or
an invalid/zero-size frame, inspect the intended control with `--point` and use
its device coordinates; do not force the ambiguous selector.

## Tap and run multi-step flows

```bash
# Selector tap with polling and a settle delay.
axe tap --id photo-info-button --wait-timeout 5 --post-delay 0.5 --udid "$UDID"

# Disambiguated label tap.
axe tap --label 'Exposure & Metering' --element-type Button --udid "$UDID"

# Coordinate fallback using physical touch down/up.
axe tap -x 220 -y 710 --tap-style physical --udid "$UDID"
```

Most AXe HID commands are fire-and-forget: successful dispatch does not prove the
app processed the event. Always re-read UI or capture the post-state.

Prefer `axe batch` for a fixed multi-step flow so one HID session executes all
steps. Use selector polling for transitions and refresh the AX cache when screens
change:

```bash
axe batch --udid "$UDID" --wait-timeout 5 --ax-cache perStep \
  --step "tap --id first-photo" \
  --step "sleep 0.5" \
  --step "tap --id photo-info-button"
```

Use discrete commands instead when the next selector/coordinate depends on
runtime inspection of the previous state.

## Deliver long press, swipe, and drag precisely

AXe exposes the touch primitives that host-mouse automation often lacks:

```bash
# Long press: explicit touch down, hold, and touch up.
axe touch -x 220 -y 710 --down --up --delay 0.6 --udid "$UDID"

# Horizontal page swipe with controlled duration.
axe swipe --start-x 330 --start-y 430 --end-x 70 --end-y 430 \
  --duration 0.6 --post-delay 0.5 --udid "$UDID"

# Low-level drag with explicit move-event density.
axe drag --start-x 200 --start-y 350 --end-x 200 --end-y 760 \
  --duration 0.8 --steps 80 --post-delay 0.5 --udid "$UDID"

# Device-relative common pattern; provide the actual screen dimensions.
axe gesture scroll-left --screen-width 402 --screen-height 874 \
  --duration 0.6 --udid "$UDID"
```

Derive coordinates from `describe-ui` and the selected device, not from a
screenshot displayed at an unknown host scale. A dispatched gesture is only the
input half of the proof; verify the expected page identity, count, disclosure,
or visual state afterward.

## Capture device evidence

Capture clean device pixels with AXe or `simctl`, not a cropped host-window
screenshot:

```bash
axe screenshot --udid "$UDID" --output ./proof/after.png
xcrun simctl io "$UDID" screenshot --type=png ./proof/after-simctl.png
```

For transitions and multi-step behavior, record the Simulator framebuffer and
derive every-frame or sampled contact sheets using
[../references/recording-ios-simulator.md](../references/recording-ios-simulator.md).
Keep the original MP4; a contact sheet is an index for review, not a replacement
for temporal evidence. Treat requested recording FPS as a target only: Simulator
movies may be variable-frame-rate, so verify actual duration, rate, and frame count
with `ffprobe`.

After each material action, preserve a fresh UI hierarchy as text evidence:

```bash
axe describe-ui --udid "$UDID" > ./proof/after-ui.txt
```

For diagnostics, capture a scoped log after the interaction:

```bash
xcrun simctl spawn "$UDID" log show --style compact --last 5m \
  --predicate 'process == "YourApp"' > ./proof/runtime.log
```

Treat runtime warnings precisely: report relevant crashes/assertions, distinguish
environment noise, and never use the absence of a visible crash as proof that all
logs are harmless.

## Review UI evidence

- **Static layout:** inspect a full-resolution device screenshot; check clipping,
  overlap, hierarchy, safe areas, text, selected state, and target identity.
- **Animation/transition:** inspect the raw MP4 plus extracted start/event/end
  frames. Extract every encoded frame when timing, flicker, or a one-frame flash
  is the claim; otherwise use a declared sampling rate and retain the video.
- **Gesture:** pair the exact AXe command with the postcondition. A final
  screenshot alone cannot prove which gesture caused it.
- **Accessibility:** compare the visual state with `describe-ui` before/after.
  A visually correct control that cannot be identified or activated remains an
  accessibility concern rather than an unqualified pass.
- **Performance:** Simulator footage can reveal gross stalls but cannot establish
  physical-device FPS, thermal, energy, or haptic quality.

## Decide the case status

| Status    | Use when                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `pass`    | The required input was delivered, the expected state was observed, and required evidence was captured |
| `fail`    | The required input was delivered and the product violated the expected behavior                       |
| `blocked` | The build/environment/driver could not execute or observe the required condition                      |

For a blocked case, attach the recording or screenshot, UI hierarchy before/after,
the attempted command, stderr/exit status, and the missing driver capability. A
fallback close button, ordinary tap, or static frame may be useful smoke evidence
but cannot satisfy a different planned gesture.

CLI interactions may mutate live data. Use a test fixture when possible. If an
exploratory command appends a reaction, message, or other irreversible record,
disclose the exact side effect in the report.

Publish the artifacts with the plan-driven submit flow or place them under the
structured report's `assets/` directory and ingest the whole round. Tag direct
AXe/`simctl` captures as `--by cli`, deterministic UI-test/media-transform output
as `--by program`, and preserve the device identity in every artifact description.
