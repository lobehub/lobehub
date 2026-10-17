# permission-probe

Throwaway macOS app for privacy-permission experiments, mainly the one question
the app can only answer on a real machine: **does a Screen Recording grant that
lands while the app is already running take effect without a relaunch?**

It builds a signed Electron app whose only job is to read the statuses and take a
still every two seconds, printing all four signals so the log shows which one
flips first:

| Column | Source |
| --- | --- |
| `cg` | `CGPreflightScreenCaptureAccess` — caches its first answer for the process lifetime |
| `tccd` | the raw tccd XPC query `@/utils/permissions` uses for the live status |
| `sck` | a real `SCScreenshotManager` still through `@lobechat/electron-mac-screen-capture` |
| `legacy` | a real `node-screenshots` still, the API ScreenCaptureKit replaced |

## Usage

```bash
node apps/desktop/scripts/permission-probe/probe.mjs build
node apps/desktop/scripts/permission-probe/probe.mjs start
# flip the switch for "PermissionProbe" in
# System Settings → Privacy & Security → Screen Recording,
# and click **Later** — never the default "Quit & Reopen", which kills the
# process under test
node apps/desktop/scripts/permission-probe/probe.mjs log
node apps/desktop/scripts/permission-probe/probe.mjs cleanup
```

### Modes

| Mode | Requests the permission | Captures | Use it for |
| --- | --- | --- | --- |
| `capture` (default) | yes | every tick | the mid-grant experiment: the app asks, the user flips the switch |
| `passive` (`start --passive`) | **no** | only after the status flips | the flow the real app uses: nothing calls `CGRequestScreenCaptureAccess` and nothing touches ScreenCaptureKit before the grant, so the entry is the pane's doing. Add the app with **+** / drag — it will not be listed on its own. |
| `probe` (`start --probe`) | no | never | smoke test of the harness: reads statuses, raises no prompt |

`passive` is the one to reach for when the question is about **macOS's own
dialogs**, e.g. whether the "quit and reopen" alert appears for an app that never
requested the permission. `capture` mode answers questions about the grant
landing, but it calls the request API, so it cannot tell the two triggers apart.

Environment overrides: `PROBE_IDENTITY` (codesign identity; otherwise the first
`Developer ID Application` in the keychain), `PROBE_BUNDLE_ID`, `PROBE_APP`,
`PROBE_LOG`.

## What the log looks like when it works

```
[14:07:41] process up pid=72370 bundle=permission-probe mode=capture
[14:08:44] #32 t+62s cg=denied  tccd=denied   sck=null
[14:08:46] #33 t+64s cg=denied  tccd=granted  sck=OK 53764B 95ms
[14:08:46] *** ScreenCaptureKit first succeeded at t+64s in the process that started before the grant.
```

`process up` appearing once means no relaunch happened; `cg` staying `denied`
afterwards is the documented cache, and the reason the old capture path could
never notice a grant without a restart.

## Why each step exists

Every item here is a failure that was hit before the recipe worked:

1. **Developer ID + `--options runtime` is mandatory.** npm's `Electron.app` is
   only linker-signed (`flags=0x20002(adhoc,linker-signed)`). Copying it and
   re-signing ad-hoc with `--deep` produces a bundle `codesign --verify` calls
   valid, but macOS treats it as no client at all: the app cannot be added to the
   Screen Recording list, `tccd` answers `unknown` instead of a decision, and
   `SCScreenshotManager` refuses. `tccutil reset` also fails with
   `-10814 No such bundle identifier` because LaunchServices resolves nothing.
2. **`com.apple.security.cs.disable-library-validation` is needed** once the
   hardened runtime is on, or the process dies at launch with
   `libffmpeg.dylib … different Team IDs`.
3. **`open`, not a shell launch**, so the app is its own TCC responsible process
   instead of inheriting the terminal's grant.
4. **`tccutil reset` runs before the bundle is deleted**, while LaunchServices
   still knows it. Afterwards the bundle id cannot be resolved at all, so the
   entry sticks — recreate and re-sign the app with the same bundle id to get
   another chance at it.
5. **Restart System Settings after changing a client's signature**
   (`killall "System Settings"`); otherwise its row shows a stale switch and the
   user toggles the wrong direction, writing `denied` where they meant to grant.

## Reading the results

- `sck` going `null → OK` with no new `process up` line: ScreenCaptureKit honours
  the grant in the running process. This is what the app relies on.
- `sck` staying `null` while `tccd=granted`: the process really cannot capture —
  which is the only case the permission guide's relaunch panel is for.
- `legacy=… content` while denied is **not** evidence of permission: the
  deprecated path returns wallpaper with other apps' windows omitted. Never fall
  back to it on failure; return `null` instead of a plausible-looking blank.
