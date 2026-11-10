# @lobechat/electron-mac-permission-guide

Native N-API addon that floats a compact, non-activating panel inside the
macOS System Settings window. The panel offers the app bundle as a file drag
source, so the user can drop it straight into a privacy list (Accessibility,
Screen Recording, Full Disk Access, Input Monitoring) instead of hunting for
the app with the `+` button.

## Build

```bash
pnpm --filter @lobechat/electron-mac-permission-guide build:native
```

No-op on non-darwin platforms. The desktop packaging pipeline runs this
automatically in `beforePack`.

## Behavior

- The panel tracks the Settings window through `CGWindowListCopyWindowInfo`
  (bounds only, so no Screen Recording permission is needed) on a 60 Hz timer
  in common run loop modes, and stays pinned while the window is dragged.
- It is shown only while System Settings (or the Touch ID / password agent it
  raises) is the frontmost app.
- When the Settings window is gone for `missingTimeoutMs`, the panel centers on
  the main screen and emits `settingsLost`; `settingsFound` follows once the
  window is back.
- The Touch ID / password prompt (and the file chooser) is another Settings
  window centered over the main one; its appearance and dismissal emit
  `promptShown` / `promptDismissed`, which is how a cancelled prompt is told
  apart from a granted one.
- The main window's title is emitted as `windowTitle` when it changes. Titles
  of other apps are only readable with Screen Recording; without it, clicks on
  the Settings sidebar or toolbar navigation emit `navigationClicked` instead.
- The sidebar width cannot be read without Accessibility permission, so the
  caller passes it per macOS version; `0` centers the panel on the window.
- The background is `NSGlassEffectView` on macOS 26+, resolved at runtime, and
  `NSVisualEffectView` elsewhere.
