# Electron macOS window glass

Main-process adapter for AppKit's sidebar material (macOS 26+). A native
`NSSplitViewController` with one sidebar item supplies the system glass. The material
fills the native window beneath Electron web contents. Existing transparent
renderer regions reveal it; opaque content remains opaque.

`WindowThemeManager` installs the material when the window attaches, updates
its appearance, removes it for fullscreen, and reinstalls it when leaving
fullscreen. Older systems and addon failures retain Electron sidebar vibrancy.

| API                                                 | Purpose                                        |
| --------------------------------------------------- | ---------------------------------------------- |
| `isSupported()`                                     | Check addon and system glass availability      |
| `setWindowGlass(nativeWindowHandle, enabled, dark)` | Enable, update, or release the window material |

Pass `BrowserWindow.getNativeWindowHandle()` on the main thread. AppKit owns
resizing and releases the material with the window. No renderer hooks, IPC,
sidebar measurements, custom opacity, or CSS injection are required. The native
window uses AppKit's standard `windowBackgroundColor` and opaque backing, rather
than clearing it and compensating with a translucent overlay. Sidebar glass and
window color both follow the selected appearance.

Electron's `vibrancy: 'sidebar'` is the older `NSVisualEffectView` material.
AppKit owns the new sidebar glass through `NSSplitViewController`. This controller
only supplies the background; Electron keeps its existing content hierarchy and
the renderer keeps its sidebar layout.

Build with `pnpm --filter @lobechat/electron-mac-sidebar-glass build:native`
from `apps/desktop`. The existing native dependency discovery handles packaging.
