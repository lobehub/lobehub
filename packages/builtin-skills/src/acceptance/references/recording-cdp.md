# Web and Electron recording via CDP

Use this reference only for Web or Electron criteria that assert behavior over
time: streaming output, loading-to-loaded transitions, timers, animations, or
multi-step flows. Capture renderer frames through `agent-browser`; do not record
the host screen.

## Capture a frame sequence

Run the capture loop in a persistent shell while driving the scenario from
another shell. Choose exactly one capture function for the selected surface:

```bash
FRAME_DIR=$(mktemp -d)

# Web:
capture_frame() { agent-browser --session app screenshot "$1"; }

# Electron alternative:
# capture_frame() { agent-browser --cdp 9222 screenshot "$1"; }

i=0
while [ "$i" -lt 40 ]; do # about 20 seconds at 0.5 seconds per frame
  printf -v frame_number "%06d" "$i"
  capture_frame "$FRAME_DIR/frame_$frame_number.png"
  i=$((i + 1))
  sleep 0.5
done
```

Use a shorter interval such as `0.25` seconds for quick transitions and a longer
interval such as `1` second for slow flows. Keep the capture scoped to the
behavior under review.

## Assemble and validate the clip

```bash
# MP4
ffmpeg -y -framerate 2 -i "$FRAME_DIR/frame_%06d.png" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p ./proof/flow.mp4

# GIF with a generated palette
ffmpeg -y -framerate 2 -i "$FRAME_DIR/frame_%06d.png" \
  -vf "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  ./proof/flow.gif

ffprobe -v error \
  -show_entries format=duration:stream=codec_name,width,height,avg_frame_rate,nb_frames \
  -of json ./proof/flow.mp4
```

Inspect the first frame, action frame, transient state, and settled frame before
citing the artifact. Keep the original frame directory until verification is
published; it is useful when a reviewer asks about a one-frame defect.

## Boundaries

- CDP frames are headless/cloud-safe and exclude browser or Electron window
  chrome.
- A native file picker, permission prompt, menu, or other OS-owned surface is not
  present in these frames. Follow the selected surface's conditional native-step
  guidance when that chrome is part of the criterion.
- Use `--by agent-browser` for the captured frames and `--by program` for the
  assembled media artifact.
- `agent-browser` and `ffmpeg`/`ffprobe` are required. Probe them before the run.

Choose `gif` versus `video` and submit the artifact using the shared contract in
[evidence.md](./evidence.md).
