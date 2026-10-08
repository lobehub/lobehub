# iOS Simulator surface

Use this surface when a criterion depends on native iOS rendering, navigation,
gestures, lifecycle, system sheets, or device-size layout. It requires macOS,
Xcode, and an installed Simulator runtime; it is not cloud-portable.

The required workflow is shell-only: every input and capture step must be
executable by a general agent through a documented CLI. An agent-specific GUI
controller or private plugin is not a prerequisite.

## Contents

- [Proof contract](#proof-contract)
- [Resolve the host app by Xcode version](#resolve-the-host-app-by-xcode-version)
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

## Resolve the host app by Xcode version

Xcode 27 and later replace `Simulator.app` with **DeviceHub**
(`Xcode.app/Contents/Applications/DeviceHub.app`, bundle id
`com.apple.dt.Devices`). `xcrun simctl` and the simulated devices themselves are
unchanged; only the host GUI app differs. Read the major version before opening,
activating, or locating the host window:

```bash
XCODE_MAJOR=$(xcodebuild -version | awk 'NR==1 { split($2, v, "."); print v[1] }')
if [ "$XCODE_MAJOR" -ge 27 ]; then HOST_APP=DeviceHub; else HOST_APP=Simulator; fi
open -a "$HOST_APP"
```

Never hard-code `open -a Simulator` or `tell application "Simulator"`: on Xcode 27+
it fails, and a failed launch is a harness error, not a product failure.

## Probe and choose a CLI driver

Prefer the most agent-friendly CLI that talks to Simulator Accessibility and HID
directly. Probe the host rather than assuming one tool is installed:

```bash
command -v sim-use
command -v axe
command -v idb
command -v idb_companion
command -v cliclick
command -v ffmpeg
command -v ffprobe
xcrun simctl help io
```

Pick the first available driver, then read **only** its reference for commands:

| Priority | Driver                                | Use when                                                                                          | Commands                               |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1        | sim-use                               | Default. Outline with `@N` aliases, `hint` on failed targets, built-in long press and crash check | [sim-use.md](../references/sim-use.md) |
| 2        | AXe                                   | sim-use is absent, or the step needs `batch`, `drag --steps`, or `slider`                         | [axe.md](../references/axe.md)         |
| 3        | Repository XCUITest or documented CLI | Neither is installed, or the project already owns stronger domain assertions                      | The repository's own docs              |
| 4        | `idb` + `idb_companion`               | Both halves are installed and working; `idb_companion` alone is not an interaction CLI            | `idb --help`                           |
| 5        | `cliclick`                            | Smoke-test click only; depends on `$HOST_APP` window geometry and does not prove HID semantics    | `cliclick -h`                          |

`simctl` owns device lifecycle, install/launch, logs, and framebuffer capture for
every driver. `ffprobe` and `ffmpeg` verify and slice recordings.

If no available driver can express the planned gesture, mark the case `blocked`.
Do not switch to a private agent plugin or silently downgrade a long press to a
tap. Install a missing driver from its official distribution only when the task
scope allows installation; otherwise report the missing prerequisite. Record the
driver name and version in the text evidence.

## Establish the tested build

Resolve one explicit device and keep using its UDID for both the driver and
`simctl`. Avoid `booted` after device selection when several Simulators may be
running; the driver reference shows how to pin the device.

```bash
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

Read the current Accessibility hierarchy with the driver's `describe-ui` before
choosing a target, and again after every navigation, scroll, or modal change.
Prefer an accessibility identifier, then a label narrowed by element type; use
coordinates only when the UI exposes no unambiguous selector. Stable identifiers
make the same flow reusable across device sizes and reduce accidental actions on
the wrong control. On a multi-match or zero-size frame, inspect the intended
control by point instead of forcing the ambiguous selector.

Derive coordinates from `describe-ui`, not from a screenshot: screenshots are
device pixels while the hierarchy is in points.

HID commands are fire-and-forget: successful dispatch does not prove the app
processed the event. A dispatched tap or gesture is only the input half of the
proof; verify the expected page identity, count, disclosure, or visual state
afterward.

## Capture device evidence

Capture clean device pixels with the driver's screenshot command or `simctl`, not
a cropped host-window screenshot:

```bash
xcrun simctl io "$UDID" screenshot --type=png ./proof/after.png
```

For transitions and multi-step behavior, record the device framebuffer and
derive every-frame or sampled contact sheets using
[../references/recording-ios-simulator.md](../references/recording-ios-simulator.md).
Keep the original MP4; a contact sheet is an index for review, not a replacement
for temporal evidence. Treat requested recording FPS as a target only: Simulator
movies may be variable-frame-rate, so verify actual duration, rate, and frame count
with `ffprobe`.

After each material action, preserve a fresh `describe-ui` hierarchy (and, with
sim-use, `app-state`) as text evidence.

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
- **Gesture:** pair the exact driver command with the postcondition. A final
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

For a blocked case, attach the recording or screenshot, UI outline before/after,
the attempted command, stderr/exit status, and the missing driver capability. A
fallback close button, ordinary tap, or static frame may be useful smoke evidence
but cannot satisfy a different planned gesture.

CLI interactions may mutate live data. Use a test fixture when possible. If an
exploratory command appends a reaction, message, or other irreversible record,
disclose the exact side effect in the report.

Publish the artifacts with the plan-driven submit flow or place them under the
structured report's `assets/` directory and ingest the whole round. Tag direct
driver/`simctl` captures as `--by cli`, deterministic UI-test/media-transform
output as `--by program`, and preserve the device identity in every artifact
description.
