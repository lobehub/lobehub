# record-app-screen.sh

General-purpose screen recording tool for the Electron app. Captures CDP screenshots as video frames and gallery snapshots, then assembles into an MP4 on stop.

## Why CDP Screenshots Instead of ffmpeg Screen Capture

- **Works on any screen** — CDP screenshots capture the browser viewport directly, so external monitors, Retina scaling, and window positioning are all handled automatically
- **No signal handling issues** — ffmpeg-static (npm) produces corrupt MP4 files when killed (missing moov atom). CDP screenshots avoid this entirely
- **Consistent output** — Screenshots are resolution-independent and don't require crop coordinate calculations

## Commands

```bash
# Start recording (Electron must be running with CDP)
.agents/skills/local-testing/scripts/record-app-screen.sh start [output_name]

# Stop recording and assemble video
.agents/skills/local-testing/scripts/record-app-screen.sh stop

# Check if recording is active
.agents/skills/local-testing/scripts/record-app-screen.sh status
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
    0002.png
    ...
```

The `.records/` directory is at the project root and is gitignored.

## How It Works

### Start

1. Creates two background loops:
   - **Video frames** — `agent-browser screenshot` every `VIDEO_FRAME_INTERVAL` seconds into a temp directory (`/tmp/record-frames-XXXXXX/`)
   - **Gallery screenshots** — `agent-browser screenshot` every `SCREENSHOT_INTERVAL` seconds into `.records/<name>/`
2. Saves PIDs and paths to `/tmp/record-app-screen.pids` and `/tmp/record-app-screen.state`

### Stop

1. Kills both background loops
2. Assembles video frames into MP4 using ffmpeg:
   ```
   ffmpeg -framerate 2 -i frame_%06d.png -c:v libx264 -crf 23 -pix_fmt yuv420p <output>.mp4
   ```
3. Cleans up temp frame directory
4. Reports file sizes and paths

## Usage Examples

### Basic Test Recording

```bash
# Start Electron
.agents/skills/local-testing/scripts/electron-dev.sh start

# Start recording
.agents/skills/local-testing/scripts/record-app-screen.sh start my-test

# Run automation
agent-browser --cdp 9222 click @e61
agent-browser --cdp 9222 type @e42 "hello"
agent-browser --cdp 9222 press Enter
sleep 10

# Stop and get results
.agents/skills/local-testing/scripts/record-app-screen.sh stop
# → .records/my-test.mp4 + .records/my-test/*.png
```

### Gateway Streaming Demo

```bash
.agents/skills/local-testing/scripts/electron-dev.sh start

# Inject gateway URL
agent-browser --cdp 9222 eval --stdin << 'EOF'
(function() {
  var store = window.global_serverConfigStore;
  store.setState({ serverConfig: { ...store.getState().serverConfig,
    agentGatewayUrl: 'https://agent-gateway.lobehub.com' } });
  return 'ready';
})()
EOF

# Record
.agents/skills/local-testing/scripts/record-app-screen.sh start gateway-demo

# Navigate to agent, send message, wait for completion...
# (automation commands here)

.agents/skills/local-testing/scripts/record-app-screen.sh stop
open .records/gateway-demo.mp4
```

### Check Active Recording

```bash
.agents/skills/local-testing/scripts/record-app-screen.sh status
# [record] Active recording
#   Frames:      42 captured (running: yes)
#   Screenshots: 14 captured (running: yes)
#   Output:      .records/my-test.mp4
```

## Prerequisites

- **ffmpeg** — For video assembly. Install via `bun add -g ffmpeg-static` or `brew install ffmpeg`
- **agent-browser** — For CDP screenshots. Install via `npm i -g agent-browser`
- **Electron app running** — With CDP enabled (use `electron-dev.sh start`)

## Troubleshooting

| Problem                             | Solution                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| "No active recording found" on stop | PID file was cleaned up. Check if background processes are still running with `ps aux \| grep agent-browser` |
| "A recording is already active"     | Run `stop` first, or manually clean: `rm /tmp/record-app-screen.pids /tmp/record-app-screen.state`           |
| Video is 0 bytes                    | No frames were captured. Ensure Electron is running and CDP port is correct                                  |
| Screenshots are blank/white         | SPA may not have loaded yet. Wait for `electron-dev.sh` to report "Renderer ready"                           |
| ffmpeg assembly fails               | Check `/tmp/ffmpeg-assemble.log`. Ensure ffmpeg is installed and frames exist                                |
