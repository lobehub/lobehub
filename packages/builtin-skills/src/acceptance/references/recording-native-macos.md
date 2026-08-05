# Native macOS screen recording

Use this reference only when the criterion owns a native macOS window or OS
chrome that CDP cannot observe. It requires a local macOS display and is not
cloud-portable.

## Record the host screen

Prefer a fixed duration so the recorder finalizes without an external kill:

```bash
screencapture -V 15 ./proof/native-flow.mp4
```

For explicit encoder control, identify the AVFoundation screen device first,
then record it with `ffmpeg`:

```bash
ffmpeg -f avfoundation -list_devices true -i ""

# Replace 1 with the discovered screen device index.
ffmpeg -y -f avfoundation -framerate 30 -i "1:none" -t 15 \
  -c:v libx264 -crf 23 -pix_fmt yuv420p ./proof/native-flow.mp4
```

Convert a short clip to GIF when inline playback is important:

```bash
ffmpeg -y -i ./proof/native-flow.mp4 \
  -vf "fps=8,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  ./proof/native-flow.gif
```

Inspect the resulting file before citing it and confirm that no unrelated window,
notification, or secret entered the host-screen capture. Tag direct
`screencapture` output as `--by cli` and FFmpeg-derived media as `--by program`.

For input and Accessibility commands, use
[computer-use.md](./computer-use.md). Choose `gif` versus `video` and submit using
the shared contract in [evidence.md](./evidence.md).
