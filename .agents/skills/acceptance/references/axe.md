# AXe CLI reference

Driver reference for [AXe](https://github.com/cameroncooke/AXe), the fallback
iOS Simulator driver when sim-use is absent or cannot express a step. AXe talks
to Simulator Accessibility and HID directly and covers what sim-use lacks:
`batch` for a fixed flow in one HID session, `drag --steps` for explicit
move-event density, and `slider` for deterministic slider values. Surface-level
proof, build, evidence, and status rules stay in [the iOS Simulator surface](../surfaces/ios-simulator.md).

## Contents

- [Probe and install](#probe-and-install)
- [Select the device](#select-the-device)
- [Inspect before acting](#inspect-before-acting)
- [Tap and run multi-step flows](#tap-and-run-multi-step-flows)
- [Long press, swipe, and drag](#long-press-swipe-and-drag)
- [Capture](#capture)

## Probe and install

```bash
command -v axe && axe --version
axe help <subcommand>
```

Capabilities differ by version; read `axe help <subcommand>` before relying on a
flag. Install only when dependency installation is explicitly in scope:

```bash
brew install cameroncooke/axe/axe
```

## Select the device

Pass `--udid "$UDID"` on every command; AXe does not infer the target device.

```bash
axe list-simulators
```

## Inspect before acting

```bash
axe describe-ui --udid "$UDID" > ./proof/before-ui.txt
axe describe-ui --point 220,710 --udid "$UDID"
```

Prefer `--id` (accessibility identifier), then `--label` plus `--element-type`.
Use coordinates only when the UI exposes no unambiguous selector. If selector
resolution reports multiple matches or an invalid/zero-size frame, inspect the
intended control with `--point` and use its device coordinates; do not force the
ambiguous selector.

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

## Long press, swipe, and drag

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
screenshot displayed at an unknown host scale.

## Capture

```bash
axe screenshot --udid "$UDID" --output ./proof/after.png
axe describe-ui --udid "$UDID" > ./proof/after-ui.txt
```

`axe record-video --fps <1-30> --quality <1-100>` exists, but terminal wrappers
can intercept SIGINT before AXe writes MP4 metadata. Use it only after a short
probe file passes `ffprobe`; otherwise keep AXe for input/Accessibility and
record with `simctl` per [recording-ios-simulator.md](./recording-ios-simulator.md).
