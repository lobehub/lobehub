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

now() { python3 -c 'import time; print(f"{time.time():.3f}")'; }

i=0
while [ "$i" -lt 40 ]; do # about 20 seconds at 0.5 seconds per frame
  printf -v frame_number "%06d" "$i"
  at=$(now)
  capture_frame "$FRAME_DIR/frame_$frame_number.png" &&
    echo "$FRAME_DIR/frame_$frame_number.png $at" >> "$FRAME_DIR/frames.log"
  i=$((i + 1))
  sleep 0.5
done
```

`frames.log` records when each frame was taken. A screenshot takes a variable
share of each interval, so the log — not the nominal interval — is the clip's
real timeline: assemble from it, and derive [chapters](./video-chapters.md)
from its first line.

Use a shorter interval such as `0.25` seconds for quick transitions and a longer
interval such as `1` second for slow flows. Keep the capture scoped to the
behavior under review.

## Assemble and validate the clip

```bash
# MP4 on the real timeline: each frame lasts until the next one was taken
python3 - "$FRAME_DIR" > "$FRAME_DIR/concat.txt" <<'PY'
import sys
frames = [line.split() for line in open(f"{sys.argv[1]}/frames.log")]
for (path, at), nxt in zip(frames, frames[1:] + [[None, float(frames[-1][1]) + 0.5]]):
    print(f"file '{path}'\nduration {float(nxt[1]) - float(at):.3f}")
print(f"file '{frames[-1][0]}'")
PY
ffmpeg -y -f concat -safe 0 -i "$FRAME_DIR/concat.txt" \
  -vf "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart ./proof/flow.mp4

# GIF with a generated palette
ffmpeg -y -framerate 2 -i "$FRAME_DIR/frame_%06d.png" \
  -vf "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  ./proof/flow.gif

ffprobe -v error \
  -show_entries format=duration:stream=codec_name,width,height,avg_frame_rate,nb_frames \
  -of json ./proof/flow.mp4
```

Inspect the first frame, action frame, transient state, and settled frame before
citing the artifact. While driving, log a chapter for each step and each claim
you verify ([video-chapters.md](./video-chapters.md)); the frames you inspect
here are the ones your `check` chapters point at. Keep the original frame
directory until verification is published; it is useful when a reviewer asks
about a one-frame defect.

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
