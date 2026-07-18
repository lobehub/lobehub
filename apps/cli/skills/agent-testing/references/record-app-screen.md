# record-app-screen.sh

General-purpose screen recording for a CDP-driven Electron/Chrome app. Captures CDP
screenshots as video frames and gallery snapshots, then assembles them into an MP4
on stop. Because it renders from the browser engine over CDP (not the OS screen), it
works under Xvfb and is unaffected by display sleep.

## Why CDP Screenshots Instead of ffmpeg Screen Capture

- **Works on any screen** — CDP screenshots capture the browser viewport directly,
  so external monitors, Retina scaling, and window positioning are handled
  automatically.
- **No signal-handling issues** — `ffmpeg-static` (npm) can produce corrupt MP4
  files when killed (missing moov atom). CDP screenshots avoid this entirely.
- **Consistent output** — resolution-independent, no crop-coordinate math.

## Commands

```bash
# $SKILL_DIR = the skill's install dir; the target app must be running with CDP
"$SKILL_DIR/scripts/record-app-screen.sh" start [output_name] # start recording
"$SKILL_DIR/scripts/record-app-screen.sh" stop                # stop + assemble video
"$SKILL_DIR/scripts/record-app-screen.sh" status              # is recording active?
```

### Arguments

| Argument      | Default                     | Description                |
| ------------- | --------------------------- | -------------------------- |
| `output_name` | `recording-YYYYMMDD-HHMMSS` | Base name for output files |

### Environment Variables

| Variable               | Default | Description                            |
| ---------------------- | ------- | -------------------------------------- |
| `CDP_PORT`             | `9222`  | Chrome DevTools Protocol port          |
| `SCREENSHOT_INTERVAL`  | `3`     | Seconds between gallery screenshots    |
| `VIDEO_FRAME_INTERVAL` | `0.5`   | Seconds between video frames (\~2 fps) |

## Output Structure

```
.records/
  <name>.mp4          # Video assembled from frames (~2 fps)
  <name>/             # Gallery screenshots (every 3s)
    0000.png
    0001.png
    ...
```

The `.records/` directory is at the repo root and is gitignored.

## How It Works

### Start

1. Creates two background loops:
   - **Video frames** — `agent-browser screenshot` every `VIDEO_FRAME_INTERVAL`
     seconds into a temp directory.
   - **Gallery screenshots** — `agent-browser screenshot` every
     `SCREENSHOT_INTERVAL` seconds into `.records/<name>/`.
2. Saves PIDs and paths to `/tmp/record-app-screen.pids` and
   `/tmp/record-app-screen.state`.

### Stop

1. Kills both background loops.
2. Assembles video frames into MP4 with ffmpeg:
   ```
   ffmpeg -framerate 2 -i frame_%06d.png -c:v libx264 -crf 23 -pix_fmt yuv420p <output>.mp4
   ```
3. Cleans up the temp frame directory.
4. Reports file sizes and paths.

## Usage Example

```bash
# 1. Start the Electron dev instance (launch command from PROJECT.md §4)

# 2. Start recording
"$SKILL_DIR/scripts/record-app-screen.sh" start my-test

# 3. Drive the automation
agent-browser --cdp 9222 click @e61
agent-browser --cdp 9222 type @e42 "hello"
agent-browser --cdp 9222 press Enter
sleep 10

# 4. Stop and get results
"$SKILL_DIR/scripts/record-app-screen.sh" stop
# → .records/my-test.mp4 + .records/my-test/*.png
```

## When to use a GIF instead

For a short, time-based assertion (streaming output, a ticking timer, a loading
state) attach a GIF from `scripts/record-gif.sh` to the case's evidence — it is
lighter than a full recording and embeds inline on the verify page. Reach for a full
MP4 recording only when a longer flow needs to be watched end to end.

## Prerequisites

- **ffmpeg** — for video assembly. Install via `bun add -g ffmpeg-static` or
  `brew install ffmpeg`.
- **agent-browser** — for CDP screenshots. Install via `npm i -g agent-browser`.
- **The app running with CDP enabled** — start the dev instance per `PROJECT.md`.

## Troubleshooting

| Problem                             | Solution                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| "No active recording found" on stop | PID file was cleaned up; check for background loops with `ps aux \| grep agent-browser`   |
| "A recording is already active"     | Run `stop` first, or clean: `rm /tmp/record-app-screen.pids /tmp/record-app-screen.state` |
| Video is 0 bytes                    | No frames captured. Ensure the app is running and the CDP port is correct                 |
| Screenshots are blank/white         | The app may not have finished loading yet. Wait for renderer readiness first              |
| ffmpeg assembly fails               | Check `/tmp/ffmpeg-assemble.log`; ensure ffmpeg is installed and frames exist             |
