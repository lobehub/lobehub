# sim-use CLI reference

Driver reference for [sim-use](https://github.com/lycorp-jp/sim-use), the
preferred iOS Simulator driver. It is built for agents: `describe-ui` prints a
compact outline whose `@N` aliases later commands target directly, and `--json`
failures carry a `hint` listing candidate labels so the agent can re-target
without another round-trip. Surface-level proof, build, evidence, and status
rules stay in [the iOS Simulator surface](../surfaces/ios-simulator.md).

## Contents

- [Probe and install](#probe-and-install)
- [Select the device](#select-the-device)
- [Inspect before acting](#inspect-before-acting)
- [Tap and run multi-step flows](#tap-and-run-multi-step-flows)
- [Long press, swipe, and drag](#long-press-swipe-and-drag)
- [Capture and app state](#capture-and-app-state)

## Probe and install

```bash
command -v sim-use && sim-use --version
sim-use help <subcommand>
```

Capabilities differ by version; read `sim-use help <subcommand>` before relying
on a flag. Install only when dependency installation is explicitly in scope:

```bash
brew install lycorp-jp/tap/sim-use
```

## Select the device

Without `--device`, sim-use silently picks one booted simulator even when several
are booted. Resolve the UDID once and pin it for every call:

```bash
sim-use devices --platform ios --json > ./proof/simulator-devices.json
export SIM_USE_DEVICE="$UDID"
```

## Inspect before acting

`describe-ui` lists every visible element with an `@N` alias, list cells as `#N`
(`#N@M` for the M-th list), and frames in UI points:

```bash
sim-use describe-ui > ./proof/before-ui.txt
sim-use describe-ui --point 220,710
```

Target in this order: `@N` / `#N` alias from the latest outline, `#<identifier>`
or `--id`, then `--label` plus `--element-type` (or `--label-contains` /
`--label-regex` for dynamic labels). Use coordinates only when the UI exposes no
unambiguous target. Aliases read the cached outline at
`~/.sim-use/<udid>/last-outline.json`, so re-run `describe-ui` after every
navigation, scroll, or modal change; a stale alias taps whatever now sits at the
old position. On a multi-match, narrow with `--element-type` or `--frame`; do not
force the ambiguous selector.

## Tap and run multi-step flows

```bash
# Alias tap from the latest outline.
sim-use tap @6 --post-delay 0.5

# Selector tap with polling; survives UI shifts since the last outline.
sim-use tap --id photo-info-button --wait-timeout 5 --post-delay 0.5

# Disambiguated label tap.
sim-use tap --label 'Exposure & Metering' --element-type Button

# UISwitch and similar controls ignore zero-duration HID taps.
sim-use tap --id wifi-toggle --duration 0.05

# Coordinate fallback.
sim-use tap --point 220,710
```

HID commands are fire-and-forget: successful dispatch does not prove the app
processed the event. Always re-read the outline or capture the post-state.

sim-use has no batch command. Run a multi-step flow as discrete commands, using
`--wait-timeout` selectors across transitions and a fresh `describe-ui` whenever
the next target depends on the new screen. For long flows,
`sim-use daemon start` in a persistent session amortizes per-call startup cost.

## Long press, swipe, and drag

Coordinates copied from `describe-ui` are UI-space points; pass
`--coordinate-space ui` so they stay correct when the device is rotated:

```bash
# Long press (default hold 0.8s).
sim-use long-press @12
sim-use long-press --point 220,710 --duration 1.2

# Explicit touch down, hold, and touch up.
sim-use touch -x 220 -y 710 --down --up --delay 0.6 --coordinate-space ui

# Horizontal page swipe with controlled duration.
sim-use swipe --from 330,430 --to 70,430 --duration 0.6 --post-delay 0.5 \
  --coordinate-space ui

# Slow drag with denser move events (smaller --delta = more HID steps).
sim-use swipe --from 200,350 --to 200,760 --duration 0.8 --delta 4 \
  --post-delay 0.5 --coordinate-space ui

# Presets; single-finger presets auto-detect screen size and rotation.
sim-use gesture scroll-left --duration 0.6
sim-use gesture pinch-out --scale 2.5 --radius 100
```

Derive coordinates from `describe-ui`, not from a screenshot: screenshots are
device pixels (for example 1206×2622) while the outline is points (402×874).

## Capture and app state

```bash
sim-use screenshot --output ./proof/after.png
sim-use describe-ui > ./proof/after-ui.txt

# Baseline crash detection right after the intentional launch...
sim-use app-state --bundle-id "$BUNDLE_ID" --reset
# ...then prove the app is still running after each material action.
sim-use app-state --bundle-id "$BUNDLE_ID" --json > ./proof/after-app-state.json
```

`sim-use record-video --output <file.mp4>` (`--fps 1-60`, `--quality 1-100`)
stops on SIGINT. Terminal wrappers can swallow that signal before the MP4 is
finalized, so trust it only after a short probe file passes `ffprobe`; otherwise
record with `simctl` per
[recording-ios-simulator.md](./recording-ios-simulator.md).
