# Recording — GIF & MP4 evidence

When a criterion asserts behavior **over time** — streaming output, a loading→
loaded transition, a ticking timer, an animation, a multi-step flow — a static
screenshot can't prove it. Record a clip and upload it as `gif` or `video`
evidence. This is a first-class capability, not a nice-to-have: time-based claims
are unverifiable without it.

Choose the recorder owned by the surface. Prefer CDP frames for Web/Electron,
the Simulator framebuffer for iOS, and host screen recording only for native
macOS windows that expose neither.

## Contents

- [CDP frame sequence](#path-1--cdp-frame-sequence--mp4gif-portable-recommended)
- [iOS Simulator framebuffer](#path-2--ios-simulator-framebuffer--mp4--frames)
- [macOS screen recording](#path-3--os-screen-recording-macos-local-only)
- [GIF vs MP4](#gif-vs-mp4--which-to-upload)

## Path 1 — CDP frame sequence → MP4/GIF (portable, recommended)

Capture a sequence of `agent-browser` screenshots while the behavior happens, then
assemble with `ffmpeg`. Works on web (`--session`) and Electron (`--cdp`), and runs
headless (no display, cloud-safe) because frames come from the browser engine, not
the OS screen. It also sidesteps the corrupt-MP4-on-kill problem that ffmpeg screen
capture has.

```bash
# 1. capture frames while driving the scenario
FRAMES=$(mktemp -d)
TARGET="--session app" # or "--cdp 9222" for Electron
i=0
# start your scenario in the background or in another step, then:
while [ $i -lt 40 ]; do # ~20s at 0.5s/frame
  printf -v n "%06d" $i
  agent-browser $TARGET screenshot "$FRAMES/frame_$n.png"
  i=$((i + 1))
  sleep 0.5
done

# 2a. assemble an MP4 (~2 fps)
ffmpeg -y -framerate 2 -i "$FRAMES/frame_%06d.png" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p ./proof/flow.mp4

# 2b. or a GIF (good palette = legible inline)
ffmpeg -y -framerate 2 -i "$FRAMES/frame_%06d.png" \
  -vf "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  ./proof/flow.gif

rm -rf "$FRAMES"
```

Tune the frame interval to the behavior: faster (`0.25s`) for quick animations,
slower (`1s`) for long flows. Keep the clip scoped — a few seconds of the actual
behavior, not the whole session.

## Path 2 — iOS Simulator framebuffer → MP4 + frames

Record device pixels directly with `simctl`; this excludes Simulator window chrome
and is stronger UI evidence than a host-screen crop. Use an explicit UDID when
more than one device is booted.

```bash
# Start in a persistent terminal/session and wait until stderr says
# "Recording started" before driving the scenario.
xcrun simctl io "$UDID" recordVideo --codec=h264 ./proof/ios-flow.mp4 \
  2> ./proof/ios-recording.log

# Drive the scenario with AXe or the repository's existing native CLI/UI tests in
# parallel. Stop the recorder with SIGINT (Ctrl-C), then wait for finalization.
```

Do not use SIGKILL: `simctl` must flush in-flight frames and finalize the movie.
An interrupted recorder command may return a non-zero shell status even after a
successful SIGINT finalization; judge the artifact with `ffprobe`, not that status
alone.

AXe also exposes `record-video --fps <1-30> --quality <1-100>`, but some terminal
wrappers may intercept SIGINT before AXe writes the MP4 metadata. Use it only after
confirming a short probe file passes `ffprobe`; otherwise retain AXe for input/AX
and use `simctl` for recording.

Verify the artifact before judging it:

```bash
ffprobe -v error \
  -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames \
  -of json ./proof/ios-flow.mp4
```

Simulator recordings can be variable-frame-rate. Treat a requested rate as a
target, not a guarantee; use `avg_frame_rate` and `nb_frames` as the observed
values.

Extract **every encoded frame** when the criterion concerns one-frame flashes,
flicker, or exact transition continuity:

```bash
FRAME_DIR=$(mktemp -d)
ffmpeg -i ./proof/ios-flow.mp4 -map 0:v:0 -fps_mode passthrough \
  "$FRAME_DIR/frame_%06d.png"
```

Count the generated PNGs and compare the total with `ffprobe`'s `nb_frames`.
Variable timestamps may produce non-monotonic-DTS warnings from the image muxer;
the count check determines whether every decoded frame was retained.

For ordinary UI review, sample at a declared rate and generate paginated contact
sheets. Keep the raw video alongside these derived artifacts:

```bash
ffmpeg -i ./proof/ios-flow.mp4 -vf "fps=10" \
  ./proof/review-frame_%06d.png

ffmpeg -i ./proof/ios-flow.mp4 \
  -vf "fps=2,scale=360:-1,tile=4x4:padding=8:margin=8" \
  ./proof/contact_%03d.png
```

Inspect start, action, transient, and settled states. A contact sheet is a review
index, not proof of gesture delivery; pair it with the driver action and fresh
Accessibility/postcondition evidence. Full workflow:
[../surfaces/ios-simulator.md](../surfaces/ios-simulator.md).

## Path 3 — OS screen recording (macOS, local only)

When you must capture the real screen — native windows, OS chrome, a non-Chromium
app driven via [computer-use.md](./computer-use.md) — record at the OS level. This
is **macOS-only and not cloud-portable**.

```bash
# built-in: record the screen to MP4 (Ctrl-C / kill to stop; or -V N for N seconds)
screencapture -v ./proof/demo.mp4
screencapture -V 15 ./proof/demo.mp4 # fixed 15s capture

# ffmpeg avfoundation (list devices first: ffmpeg -f avfoundation -list_devices true -i "")
ffmpeg -y -f avfoundation -framerate 30 -i "1:none" -t 15 \
  -c:v libx264 -crf 23 -pix_fmt yuv420p ./proof/demo.mp4
```

Convert an MP4 to GIF when you need an inline-renderable artifact:

```bash
ffmpeg -y -i ./proof/demo.mp4 \
  -vf "fps=8,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  ./proof/demo.gif
```

## GIF vs MP4 — which to upload

- **GIF** — short (≤ \~10s) UI behavior that should render inline in the report
  (loading state, a toast, a streamed line appearing). Renders without a player.
- **MP4** — longer demos or multi-step flows where file size matters and a player
  is acceptable. Larger, but better quality per byte.

## Upload

```bash
lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" --type gif \
  --file ./proof/flow.gif --by agent-browser \
  --desc "Response streams in token-by-token after send"

lh acceptance run result submit --operation "$LOBE_OPERATION_ID" --item "$CHECK_ITEM_ID" --type video \
  --file ./proof/demo.mp4 --by cdp --desc "End-to-end import flow completes"
```

## Prerequisites & portability

- **ffmpeg** — `brew install ffmpeg` (or `bun add -g ffmpeg-static`). Needed for
  both paths' assembly/conversion.
- **agent-browser** — for the CDP frame path ([agent-browser.md](./agent-browser.md)).
- Path 1 is headless/cloud-safe; Paths 2 and 3 require local macOS — see
  [evidence.md](./evidence.md#headless--cloud-portability).
