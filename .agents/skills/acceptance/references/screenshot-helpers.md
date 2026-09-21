# Bundled screenshot helpers

Resolve `SKILL_DIR` to the absolute directory containing the `SKILL.md` you loaded.
Installers may use different directories. Helpers resolve siblings relative to
their own location, so the current working directory does not matter. Invoke
them with `bash` or `node`: installers need not preserve executable bits.

## CDP screenshots (Chrome / Electron)

Requires **Node.js 22.15 or later** with its built-in WebSocket enabled, and a
running Chrome/Electron target exposing a local CDP port. No npm packages,
`node_modules`, LobeHub checkout, or reporting-service login are needed.
The Bash wrapper works on macOS and Linux; on Windows, invoke the Node helper
directly or use a Bash environment that can reach the target's localhost port.

```bash
bash "$SKILL_DIR/scripts/cdp-screenshot.sh" --port 9222 \
  --target-url 'localhost:3000' --out ./proof/page.png

# Direct portable capture, with one JSON result and no brightness probe:
node "$SKILL_DIR/scripts/cdp-capture.cjs" --port 9222 \
  --target-url 'localhost:3000' --out ./proof/full-page.png --full
```

Use `--target-url <substring>` whenever the CDP instance has multiple pages;
otherwise the first page target is selected. The result reports `targetUrl` so
you can check which page was captured. `--timeout <milliseconds>` (default 12000)
bounds discovery, the WebSocket handshake, and capture together. `--full` captures
the page's content bounds. Errors exit nonzero; missing/old Node exits 7, capture
failure exits 5. The script creates the output's parent directories.

The wrapper also attempts a brightness probe using **macOS `sips` and Python 3**
(standard library only). Ordinary capture can succeed without these tools, but
explicitly reports that brightness was not measured. A measured black frame exits
6\. Blackness is a coarse diagnostic; a dark page may legitimately trigger it.

```bash
# macOS only: exit 0 requires a captured, measured, non-black frame.
bash "$SKILL_DIR/scripts/cdp-screenshot.sh" --port 9222 \
  --target-url 'localhost:3000' --check
```

`--check` exits 2 when brightness cannot be measured, including on platforms
without `sips`. It deletes only its own temporary screenshot; an explicit `--out`
is retained. Do not report an unavailable check as passed. A non-black image alone
does not establish that the right UI rendered: inspect the screenshot separately.

## macOS screen-recording preflight

Use before OS-level `screencapture` or screen recording, not for renderer-only CDP
capture. Requires a local macOS display, **Python 3**, `screencapture`, `sips`, and
a working **clang or Swift toolchain with the macOS SDK** for the permission probe
(normally supplied by Xcode Command Line Tools). There are no Python packages to
install. The helper queries Screen Recording permission without requesting it or
changing system settings, then captures a temporary screen frame to measure
brightness. Temporary images and compiled probes are removed on exit.

```bash
bash "$SKILL_DIR/scripts/check-screen-recording.sh" --json
```

| Exit | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| 0    | Permission granted **and** a non-black OS frame measured                       |
| 2    | Not applicable outside macOS, missing/broken tools, or an undetermined check   |
| 3    | Permission denied; enable Screen Recording for the reported app and restart it |
| 4    | Permission granted but frame black; wake/unlock the display and retry          |

JSON output includes `ok`, `permission`, `capture`, and a remediation message.
Only exit 0 has `ok: true`; a permission bit alone is never a pass. This is a
preflight, not proof that a later recording contains the intended window or motion.
