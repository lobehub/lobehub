## Problem

On desktop, Electron's `requestSingleInstanceLock()` prevents running more than one LobeHub instance simultaneously. On the browser this works naturally — each tab/window is independent.

Users who want two isolated LobeHub setups (work + personal, or two different agent ecosystems) have no way to do so on desktop.

## Solution

Add multi-instance support via a `--instance-id=<name>` launch flag and `LOBEHUB_INSTANCE_ID` env var.

When `--instance-id=work` is passed:
1. `app.setPath('userData', '<baseUserData>-work')` is called **before** any store/DB init
2. Each instance gets a fully isolated userData directory with independent store, DB, and settings
3. The single-instance lock is scoped to that userData path (per Electron native behaviour)
4. Instances are completely independent — no shared state

Also adds `--allow-multiple-instances` / `LOBEHUB_ALLOW_MULTIPLE_INSTANCES` to skip the lock entirely.

## Usage

```
# Two isolated instances side by side
LobeHub.exe --instance-id=work
LobeHub.exe --instance-id=personal

# Via env var (e.g. from a custom shortcut)
set LOBEHUB_INSTANCE_ID=dev && LobeHub.exe

# Skip lock entirely (shared userData, advanced)
LobeHub.exe --allow-multiple-instances
```

## Files changed

- `apps/desktop/src/main/core/App.ts` - multi-instance logic in `bootstrap()`
- `apps/desktop/src/main/const/dir.ts` - comment clarifying lazy resolution of userData path

## Notes

- No change when no flag is passed - single-instance behaviour is fully preserved
- userData isolation ensures each instance has its own lobehub-storage, plugins, and settings
- Matches browser behaviour where multiple independent sessions are trivially possible
