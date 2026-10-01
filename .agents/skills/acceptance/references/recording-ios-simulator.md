# iOS Simulator framebuffer recording

Use this reference only for an iOS Simulator criterion that requires temporal
evidence. Record device pixels directly with `simctl`; this excludes the host
app's window chrome (Simulator, or DeviceHub on Xcode 27+) and is stronger
evidence than a host-screen crop. Use an explicit
UDID when more than one device is booted.

## Record and finalize

```bash
# Start in a persistent terminal/session and wait until stderr says
# "Recording started" before driving the scenario.
xcrun simctl io "$UDID" recordVideo --codec=h264 ./proof/ios-flow.mp4 \
  2> ./proof/ios-recording.log

# Drive the scenario with the selected driver (sim-use, AXe, or the repository's
# native CLI/UI tests) in parallel. Stop the recorder with SIGINT (Ctrl-C), then wait for finalization.
```

Do not use SIGKILL: `simctl` must flush in-flight frames and finalize the movie.
An interrupted recorder command may return a non-zero shell status after a
successful SIGINT finalization; judge the artifact with `ffprobe`, not that status
alone.

sim-use and AXe also ship `record-video`, but terminal wrappers can swallow
SIGINT before the MP4 is finalized. Trust a driver recorder only after a short
probe file passes `ffprobe`; see [sim-use.md](./sim-use.md) or [axe.md](./axe.md).

## Verify the movie

```bash
ffprobe -v error \
  -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames \
  -of json ./proof/ios-flow.mp4
```

Simulator recordings can be variable-frame-rate. Treat a requested rate as a
target, not a guarantee; use `avg_frame_rate` and `nb_frames` as the observed
values.

## Extract every encoded frame

Use this path for one-frame flashes, flicker, or exact transition continuity:

```bash
FRAME_DIR=$(mktemp -d)
ffmpeg -i ./proof/ios-flow.mp4 -map 0:v:0 -fps_mode passthrough \
  "$FRAME_DIR/frame_%06d.png"
```

Count the generated PNGs and compare the total with `ffprobe`'s `nb_frames`.
Variable timestamps can produce non-monotonic-DTS warnings from the image muxer;
the count check determines whether every decoded frame was retained.

## Sample frames and contact sheets

For ordinary UI review, sample at a declared rate and retain the raw video:

```bash
ffmpeg -i ./proof/ios-flow.mp4 -vf "fps=10" \
  ./proof/review-frame_%06d.png

ffmpeg -i ./proof/ios-flow.mp4 \
  -vf "fps=2,scale=360:-1,tile=4x4:padding=8:margin=8" \
  ./proof/contact_%03d.png
```

Inspect start, action, transient, and settled states. A contact sheet is a review
index, not proof of gesture delivery; pair it with the driver action and fresh
Accessibility/postcondition evidence from
[the iOS Simulator surface](../surfaces/ios-simulator.md).

Tag the direct recording as `--by cli` and deterministic frame/contact-sheet
transforms as `--by program`. Submit using the shared contract in
[evidence.md](./evidence.md).
