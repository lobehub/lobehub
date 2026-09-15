# @lobechat/electron-mac-notifications

Native N-API addon that posts macOS notifications through
`UNUserNotificationCenter`, styling them as communication notifications
(sender avatar as the primary icon, via `INSendMessageIntent`) when a sender
is provided. Consumed by the desktop main process; falls back gracefully
everywhere it can't run.

## Build

```bash
pnpm --filter @lobechat/electron-mac-notifications build:native
```

No-op on non-darwin platforms. The desktop packaging pipeline runs this
automatically in `beforePack`.

## Runtime requirements (all empirically verified)

The avatar treatment only renders when the host app satisfies all of:

1. Signed with a real certificate and launched as a regular app. Adhoc-signed
   dev Electron gets `UNErrorDomain Code=1` from the notification center, and
   this package then reports `isSupported()` but fails at show-time — callers
   fall back to Electron's `Notification`.
2. `com.apple.developer.usernotifications.communication` entitlement in the
   signature. Never add it without requirement 3: launchd refuses to spawn
   the app (POSIX 163).
3. An Apple provisioning profile authorizing the entitlement, embedded at
   `Contents/embedded.provisionprofile`. Wired through
   `MAC_PROVISIONING_PROFILE` + `APPLE_TEAM_ID` in `electron-builder.mjs`.
4. `NSUserActivityTypes = [INSendMessageIntent]` in Info.plist (set
   unconditionally via `mac.extendInfo`).

Without 2–3 the notification still shows as a plain banner — macOS silently
drops the communication styling — so profile-less channels keep working.

## Delegate ownership

The addon takes over the process-global `UNUserNotificationCenter` delegate.
Notifications whose identifier lacks the `lobehub-` prefix are forwarded to
whatever delegate was installed before (Electron's own `Notification`
module), so the two paths can coexist during fallback.
