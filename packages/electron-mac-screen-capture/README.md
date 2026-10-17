# @lobechat/electron-mac-screen-capture

Native N-API addon that lists displays and windows and takes stills through
**ScreenCaptureKit** — `SCShareableContent` for the list, `SCScreenshotManager`
for the images. It is the capture backend on macOS 14 and newer; the
`node-screenshots` path in `apps/desktop` stays for macOS 13 and older.

## Why not `CGWindowListCreateImage`

The previous backend captured through `CGWindowListCreateImage`. Apple
obsoleted that API family, and the [macOS Sequoia 15 release
notes](https://developer.apple.com/documentation/macos-release-notes/macos-15-release-notes)
state that applications using it "can trigger system alerts indicating they
might be able to collect detailed information about the user", with ScreenCaptureKit
and `SCContentSharingPicker` as the migration path (Apple DTS repeats this in
[forum thread 760483](https://developer.apple.com/forums/thread/760483), which
also recommends `SCScreenshotManager` for stills).

Two further properties matter for the permission flow:

- ScreenCaptureKit re-reads the Screen Recording grant on every call, so a
  permission granted while the app is running can start working without a fresh
  process.
- Its frames are already in **points**, the same unit Electron reports display
  bounds in and the overlay lays out in, so geometry needs no conversion.

## Build

```bash
pnpm --filter @lobechat/electron-mac-screen-capture build:native
```

No-op on non-darwin platforms. `native-deps.config.mjs` discovers the package
through its `binding.gyp` + `lobechat.nativeAddonPlatforms`, so packaging needs
no further registration.

## API

| Export | Behaviour |
|---|---|
| `isSupported()` | Whether `SCScreenshotManager` exists (macOS 14+). |
| `probeCapturePermission()` | `granted` / `denied` / `unknown` from a `SCShareableContent` query. Raises the system prompt if the permission is unresolved, so call the prompt-free tccd status check first. |
| `screenShareableContent()` | `{ displays, windows }` with frames in points, frontmost first; `null` when the kit cannot answer. |
| `captureWindow(windowId)` | `Promise<{ png, reason }>` — PNG at native pixel resolution (`frame.size × backing scale`), including parts of the window that are off screen. |
| `captureRect(rect)` | `Promise<{ png, reason }>` — PNG of a global-points region, cropped by the kit, at native pixel resolution. |

### Capture reasons

`reason` is `null` on success, otherwise `denied`, `not-found`, `timeout`,
`unsupported` or `failed` — mapped from the `NSError` the completion handler
hands back, which is otherwise easy to drop on the floor.

`denied` needs the caller's context: on macOS 15 and newer the **first** direct
capture raises a one-time consent ("… is requesting to bypass the system window
picker and directly access your screen and audio", with *Allow* / *Open System
Settings*), and until it is accepted ScreenCaptureKit refuses exactly like a
refused permission. Only the caller knows whether the permission itself is
granted, so it alone can tell "waiting for consent" from "not granted". Measured
on macOS 26: the consent is per bundle id and survives re-signing, so it is asked
at most once per installation.

Both capture calls run on a worker thread: a 5K capture takes long enough that a
synchronous call would stall the main process.

## Notes

- `SCDisplay.width` counts **points**, not pixels, so the backing scale comes
  from `CGDisplayCopyDisplayMode` (`pixelWidth / width`) — the ratio Electron
  reports as `screen.scaleFactor`.
- A missing or failed capture resolves to `null` rather than a blank image, and
  the caller does not fall back to the deprecated API: an unauthorised legacy
  capture returns a black image that would read as a successful one.
- The module is loaded through `@lobechat/napi-loader`, which also resolves the
  addon from `app.asar.unpacked` in a packaged app.
