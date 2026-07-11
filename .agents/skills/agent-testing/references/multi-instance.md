# Concurrent Electron Instances (Multi-Instance Automation)

Status: **implemented + empirically validated 2026-07-01.** Multiple isolated dev
Electron instances run concurrently, each with its own userData dir, Vite dev
port, and IPC socket, each signed in from a copied login state, with independent
renderer state. Three env-gated product knobs (`LOBE_DESKTOP_USER_DATA_DIR`,
`LOBE_IPC_ID`, `LOBE_DESKTOP_VITE_PORT`) plus an `electron-dev.sh` instance pool.
Details, collision matrix, and two validation transcripts below.

Use case driving this: **N git worktrees under one project, each doing different
work, each running its own Electron dev instance** — so each needs its own Vite
dev server + its own userData, while reusing the developer's existing login.

## Worktree instance prerequisites (deps + first mount) — validated 2026-07-04

A git worktree starts with **no `node_modules`** (gitignored, not shared). Two traps
sink an `electron-dev.sh start <id>` on a fresh worktree before it will even mount:

- **`pnpm install` per worktree — do NOT symlink the main checkout's `node_modules`.**
  Symlinking the primary repo's `node_modules` into the worktree _looks_ like it works
  but silently pins the **main branch's dependency versions**, which can lag the
  worktree branch. Real failure: a worktree on `canary` imports `FloatingPanel` from
  `@lobehub/ui ^5.19.0`, but the symlinked main checkout had `5.18.0` → the renderer
  crashed at load (`Uncaught SyntaxError: … does not provide an export named
'FloatingPanel'`) and the app hung on the loading screen (`#root` empty,
  `__LOBE_STORES` undefined) **even though raw-CDP screenshots still showed a painted
  frame** from before the crash. Fix: real `pnpm install` in the worktree **root** _and_
  `apps/desktop` (standalone install, per Step 2.1) before `start`. (`type-check` warns
  of the same skew: cross-root `packages/*` dual-identity errors when `node_modules` is
  symlinked across worktree roots.)
- **First cold Vite load can `ECONNRESET` under resource contention.** Two full
  Electron+Vite dev stacks at once (main app + a fresh worktree instance) can overwhelm
  Vite on the cold module storm: the log fills with `Vite dev server fetch failed:
http://127.0.0.1:<port>/src/… [read ECONNRESET]`, the SPA hangs on the loading screen,
  `#root` stays at 0 children. **Not a code error** — a clean `electron-dev.sh stop <id>
&& start <id>` once the install/CPU storm is over mounts cleanly (0 ECONNRESET,
  `__LOBE_STORES` becomes an object, `#root` fills).

> "Screenshot shows the app but `eval` sees an empty `#root`" → the app never mounted
> (loading-screen shell), not a target mismatch. Confirm with `eval
"document.getElementById('root')?.childElementCount"` (0 + a `#loading-screen` = not
> mounted). And remember `cdp-screenshot.sh` reads **`--port`, not** a `CDP_PORT` env —
> pass `--port 92xx` for a pool instance or you'll silently shoot the default 9222 (the
> main app), not your worktree instance.

## The real bottleneck is NOT "one port"

CDP is single-port, multi-target: one `--remote-debugging-port` exposes every
`BrowserWindow` as a target. What actually blocks N independent, write-isolated
app sessions are dev-build singletons. Validated verdicts:

| Singleton                                | Location                                                         | Verdict for N instances                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Electron single-instance lock            | `App.ts:227`                                                     | ✅ **keyed by userData** — distinct userData dirs each get their own lock; all instances run. No code change needed. |
| Chromium `SingletonLock`                 | per userData dir                                                 | ✅ one per userData dir automatically (observed distinct PIDs per dir).                                              |
| userData dir `lobehub-desktop-dev`       | `pre-app-init.ts:12`                                             | ✅ fixed — now env-overridable via `LOBE_DESKTOP_USER_DATA_DIR`.                                                     |
| Vite dev server `strictPort:true` 5173   | `electron.vite.config.ts`                                        | ✅ fixed — now env-overridable via `LOBE_DESKTOP_VITE_PORT` (Model B: one Vite per worktree).                        |
| `electron-server-ipc` unix socket        | `App.ts` → `packages/electron-server-ipc/src/ipcServer.ts:23-31` | ✅ fixed — id now env-overridable via `LOBE_IPC_ID`; distinct sockets, no more hijack (was last-writer-wins).        |
| safeStorage / Chromium cookie encryption | OS keychain, keyed by **app name**                               | 🔑 requires **app name constant** to decrypt a copied login state.                                                   |
| Global shortcuts / `lobehub://` protocol | OS-global                                                        | first/last wins; harmless for headless automation.                                                                   |
| Static file server / iMessage bridge     | `getPort()` dynamic                                              | ✅ auto-allocated, safe.                                                                                             |

## The key tension (and its resolution)

Two requirements pull opposite ways:

- **Login-state reuse** needs the **app name constant** — `safeStorage` (OIDC
  tokens in `lobehub-settings.json`) and Chromium cookie encryption (better-auth
  session in `Cookies`) derive their key from an OS-keychain entry named after
  the app. Change the app name → copied secrets no longer decrypt.
- **IPC-socket uniqueness** wants a **per-instance appId** (the socket path is
  `os.tmpdir()/${appId}-electron-ipc.sock`, appId = app name).

Naively "give each instance a different app name" (a tempting first instinct)
**breaks login reuse** — the exact thing this use case needs. Resolution:

> **Keep `app.setName('lobehub-desktop-dev')` constant for every instance. Vary
> only the userData dir.** That satisfies the single-instance lock (keyed by
> userData) AND keeps the keychain key valid so copied tokens/cookies decrypt.
> The IPC socket is decoupled from the app name via its own `LOBE_IPC_ID` knob
> (not the app name), so each instance still gets a distinct socket.

## Product changes (all env-gated, all validated)

Three tiny env-gated knobs — no behavior change unless the env is set. This
branch ships all three:

1. **`apps/desktop/src/main/pre-app-init.ts`** — per-instance userData, app name
   fixed (so copied login state still decrypts):

   ```ts
   app.setName('lobehub-desktop-dev');
   const userDataOverride = process.env.LOBE_DESKTOP_USER_DATA_DIR;
   app.setPath(
     'userData',
     userDataOverride || path.join(app.getPath('appData'), 'lobehub-desktop-dev'),
   );
   ```

2. **`apps/desktop/src/main/core/App.ts`** — per-instance IPC id so the
   `electron-server-ipc` socket path stops colliding (no more "last one wins"):

   ```ts
   const ipcId = process.env.LOBE_IPC_ID || name;
   this.ipcServer = new ElectronIPCServer(ipcId, ipcServerEvents);
   ```

3. **`apps/desktop/electron.vite.config.ts`** — per-instance Vite dev port
   (Model B: one Vite per worktree), kept `strictPort` so HMR clientPort matches:

   ```ts
   const DEV_VITE_PORT = Number(process.env.LOBE_DESKTOP_VITE_PORT) || 5173;
   // ...used for both server.port and server.hmr.clientPort
   ```

All three verified live via the `electron-dev.sh` pool (transcript below).

## Login-state reuse across userData dirs (validated)

To make a fresh userData dir come up **already logged in**, copy from the golden
profile (`~/Library/Application Support/lobehub-desktop-dev/`) — only the
login-bearing items, NOT the multi-GB caches:

```bash
SRC="$HOME/Library/Application Support/lobehub-desktop-dev"
DST="/tmp/lobe-ud-<id>"
for f in lobehub-settings.json "Local State" Preferences \
  Cookies Cookies-journal "Local Storage" IndexedDB \
  "Session Storage" "Network Persistent State" lobehub-storage; do
  [ -e "$SRC/$f" ] && cp -R "$SRC/$f" "$DST/"
done # ~27 MB vs the 1.7 GB full profile (Cache/Code Cache/GPUCache skipped)
```

- `lobehub-settings.json` → `encryptedTokens` (OIDC access/refresh, safeStorage).
- `Cookies` + `Local Storage` + `IndexedDB` → better-auth renderer session.
- Decryption works because app name is unchanged on the same machine (keychain
  entry `lobehub-desktop-dev Safe Storage` is reused). **Same machine only** —
  a copy to another machine won't decrypt.
- **Stale-token caveat:** if the copied access token's `exp` has passed you'll
  see `Authentication failed: "exp" claim timestamp check failed` — this actually
  **confirms decryption succeeded** (the token was decrypted, then found expired).
  `isSignedIn` still returns true (session/refresh recovers), but profile API
  calls may lag until refresh completes (the settings page briefly shows
  "Anonymous User" + skeletons). Copy from a freshly-active profile for a clean
  first paint.

## IPC socket caveat (the one real conflict)

`ipcServer.ts` constructor does `if (fs.existsSync(socketPath)) fs.unlinkSync(...)`
then binds. So starting instance N **unlinks instance N-1's socket and takes over
the path** + rewrites `${appId}-electron-ipc-info.json`. Observed: non-fatal, no
crash, all instances keep running and their **renderer↔main IPC (standard
Electron `ipcMain`/`ipcRenderer`) is unaffected** (that's per-webContents). Only
the external `electron-server-ipc` channel — used by the embedded CLI `lh` and
the Next server to reach the main process — resolves to the **last-started
instance**. For CDP-driven UI automation this is harmless. To make it clean for a
real feature, give the IPC server a per-instance appId (env, decoupled from
`app.setName`) at `App.ts` where `new ElectronIPCServer(appId, …)` is constructed.

## agent-browser driving gotcha (important)

The `agent-browser` daemon **reuses one session across `--cdp` ports** — calling
`agent-browser --cdp 9223 …` then `--cdp 9224 …` both hit whichever target the
daemon connected to first, so reads/writes bleed and look like cross-instance
state sync (they aren't). Two correct patterns:

```bash
# ✅ pin a distinct session name per instance — supports concurrent driving
agent-browser --session s9223 --cdp 9223 snapshot -i
agent-browser --session s9224 --cdp 9224 snapshot -i

# ✅ or reset between targets (slower, serial)
agent-browser close --all && agent-browser --cdp 9223 get url
```

Raw `curl http://localhost:<port>/json/list` always shows a port's true target
(title/url/id) and is the tie-breaker when in doubt.

## Two operating models

### Model A — one Vite, many electron processes (what the validation used)

One `electron-vite dev` owns Vite 5173 + the built `dist/main`; extra instances
are raw electrons sharing the renderer via `ELECTRON_RENDERER_URL`:

```bash
# instance 1: owns Vite 5173 + is itself CDP 9223
cd apps/desktop
LOBE_DESKTOP_USER_DATA_DIR=/tmp/lobe-ud-1 \
  npx electron-vite dev -- --remote-debugging-port=9223

# instances 2,3: reuse Vite 5173 + built main, isolate userData + CDP
LOBE_DESKTOP_USER_DATA_DIR=/tmp/lobe-ud-2 ELECTRON_RENDERER_URL=http://127.0.0.1:5173 \
  npx electron . --remote-debugging-port=9224
LOBE_DESKTOP_USER_DATA_DIR=/tmp/lobe-ud-3 ELECTRON_RENDERER_URL=http://127.0.0.1:5173 \
  npx electron . --remote-debugging-port=9225
```

Lightest; all share one build/renderer. Extra instances get no HMR re-launch.

### Model B — one Vite per worktree (the N-worktree use case)

Each worktree runs its own `electron-vite dev` (own code, own build, own HMR).
The `LOBE_DESKTOP_VITE_PORT` knob makes this work — otherwise the 2nd worktree
fails on `strictPort` 5173. Just use the pool (below), or by hand per worktree:

```bash
LOBE_DESKTOP_VITE_PORT=51xx LOBE_DESKTOP_USER_DATA_DIR=… LOBE_IPC_ID=… \
  npx electron-vite dev -- --remote-debugging-port=92xx
```

`electron-vite dev` injects the matching `ELECTRON_RENDERER_URL` automatically.
Cost: N Vite servers + N builds (heavy); acceptable since each worktree is a
distinct dev target. **Validated** — two `electron-vite dev` on 5174 + 5175 ran
concurrently (transcript below).

## electron-dev.sh instance pool (implemented)

`scripts/electron-dev.sh` now keys lifecycle on an **instance id**, not the
project path (the old single-instance script matched every project Electron by
binary path, so a 2nd `start` tore down the 1st):

```bash
electron-dev.sh start 1    # CDP 9223, Vite 5174, userData ud-1 (login copied), IPC id -1
electron-dev.sh start 2    # CDP 9224, Vite 5175, userData ud-2, IPC id -2
electron-dev.sh list       # show running pool instances
electron-dev.sh stop 1     # sibling-safe: kills ONLY instance 1 (KEEP_DATA=1 to keep ud)
electron-dev.sh stop --all # stop every instance
# no id → legacy single-instance behavior (CDP 9222), unchanged
```

- Derives `CDP=9222+id`, `Vite=5173+id`, `userData=$POOL_DIR/ud-<id>`,
  `IPC id=lobehub-desktop-dev-<id>`, per-id log + pidfile.
- `start <id>` seeds a fresh userData with the login-item set from the golden
  profile (override via `LOBE_GOLDEN_PROFILE`); `stop <id>` wipes it unless
  `KEEP_DATA=1`.
- `stop <id>` matches by **pidfile session-leader tree + CDP/Vite port holders**,
  never the broad project path → never kills a sibling.
- Drive each instance with `agent-browser --session s<port> --cdp <port>`.

## Validation transcripts (2026-07-01)

### Round 1 — concurrency, login reuse, isolation (Model A)

Golden profile `lobehub-desktop-dev` (logged in, user\_2gmT…); 3 userData copies
(27 MB each), app name constant. inst1 = `electron-vite dev` (CDP 9223, Vite
5173\), inst2/inst3 = raw electron (CDP 9224/9225) sharing Vite.

- ✅ **All 3 booted** — no single-instance exit (distinct `SingletonLock` PIDs).
- ✅ **All 3 signed in** — `isSignedIn:true, user_2gmT…` on all ports (copied
  `safeStorage` tokens decrypted; app name unchanged).
- ✅ **State isolated** — raw `/json/list` showed distinct target ids + URLs. The
  "all same route" seen mid-test was the agent-browser daemon session-reuse
  artifact, fixed by per-instance `--session`.
- ⚠️ **IPC socket hijack** (pre-fix) — last-started instance owned the socket;
  non-fatal, renderers unaffected. → motivated the `LOBE_IPC_ID` fix below.

### Round 2 — the three product knobs + the pool (Model B)

`electron-dev.sh start 1` + `start 2` on the fixed build:

- ✅ **Vite port override** — 5174 **and** 5175 bound concurrently (two
  `electron-vite dev`, `strictPort` no longer collides).
- ✅ **IPC decouple** — two **distinct** sockets `lobehub-desktop-dev-1-…sock` +
  `…-2-…sock`; no hijack.
- ✅ **userData isolation** — ud-1 / ud-2 with distinct `SingletonLock` PIDs; both
  CDP ports reachable; `list` shows both UP.
- ✅ **Sibling-safe stop** — `stop 1` killed instance 1's 7-proc tree + wiped
  ud-1, while instance 2 (9224 / 5175 / its socket) stayed fully alive.

Teardown: `stop --all`; `rm -rf` pool dir. Ports released.
