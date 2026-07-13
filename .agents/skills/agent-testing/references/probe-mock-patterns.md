# Probe / Mock Pattern Library (generic layer)

> **This is the GENERIC layer of the living log.** It is read-only in a consumer
> repo and updated only by PR to the CLI repo that ships this skill. Every recipe
> here must be **product-independent** — framework-level or tool-level, no project's
> stores, routes, tables, env vars, or file paths. Project-specific probes and mocks
> go to `.agents/verify/probe-mock-patterns.md` (the writable project layer).
>
> **Read this before any run that must force an error state or inspect runtime
> state.** Each item: Situation / Doesn't work / Works.
>
> **Separate the observation from the explanation.** When you add an item, cite the
> exact mechanism (a `file:line`, a measured A/B) — and if you only saw a symptom,
> write "cause not established" instead of guessing. A wrong mechanism is worse than
> none: it sends the next reader to fix the wrong thing.

---

## A. Forcing a fetch to FAIL (error-state testing)

### A1. Judge interception by the fetch's own outcome, not by the UI or the promise

- Apps commonly **swallow** a failed fetch: a store action can resolve successfully
  even when its underlying request was aborted, so the UI and the action's promise
  both "look like" a 200. Never judge whether your fault landed by the action or the
  UI.
- **Works**: wrap `window.fetch` post-load and record each request's own resolve /
  reject. Use a guard so a second `eval` doesn't wrap the wrapper (stack overflow):
  ```js
  if (!window.__W) {
    window.__W = 1;
    window.__R = [];
    const of = window.fetch;
    window.fetch = function (...a) {
      const p = of.apply(this, a);
      if (String(a[0]).includes('<url-fragment>'))
        p.then(
          (r) => window.__R.push('resolved_' + r.status),
          (e) => window.__R.push('REJECTED_' + e.message),
        );
      return p;
    };
  }
  ```
- **`agent-browser network route --abort` glob matching is finicky.** A bare `**/x`
  or `*/path/*` can match nothing on a nested path; an absolute-URL prefix with a
  trailing `*` matches reliably (the trailing `*` also covers a `?query` string). And
  `agent-browser network requests` **under-reports** — it is not ground truth for
  "did the request happen"; trust the `window.fetch` wrapper instead.

### A2. `set offline` shows the browser's page, not the component error

- `agent-browser set offline on` trips Chrome's document-level offline interstitial
  ("Reconnect to Wi-Fi"), not the app's own error component. Its copy (and the dino
  game) also false-matches naive error-copy greps, and offline breaks lazy
  route-chunk loading → a hard-nav fallback to the browser page. Use it to break
  connectivity, not to assert an app-level error state.

### A3. WORKS — force an error by injecting a throw into the code path via HMR

- Add a throw at the top of the client method the data fetcher / mutation calls, let
  the dev server hot-apply it, capture, then revert:
  ```ts
  // <the service method the fetcher calls> — [AGENT-TEST] REMOVE
  list = async (params) => {
    if (true) throw Object.assign(new Error('injected'), { data: { httpStatus: 500 } });
    return realClient.list(params);
  };
  ```
- Use a status the UI treats as **retryable** (commonly anything but 401/403) if you
  want the Retry affordance visible; a non-retryable status suppresses it. The same
  technique works on the **write side** — inject into the mutation method to exercise
  a failed-save state.
- **Revert carefully.** `git checkout -- <file>` on a service file often triggers a
  FULL reload (not just HMR), resetting the SPA to a blank shell — after reverting,
  re-navigate and re-fetch element refs. And see A5: `git checkout --` is the WRONG
  revert when the file already had uncommitted changes.

### A4. WORKS — alternatives when HMR injection isn't available

- **CDP `Network.setBlockedURLs`** — blocks at the network stack (below `fetch`, so
  it catches requests a page-realm `fetch` override might miss). Needs a raw CDP ws
  connection.
- **Server-side** — temporarily make the one endpoint return 500.

### A5. `git checkout -- <file>` to revert an injection DESTROYS the branch's uncommitted changes in that file

- When you inject a probe into a file that the branch has **already modified
  (uncommitted)** — the common case for a pre-PR review — `git checkout -- <file>`
  resets it to HEAD, silently wiping the very feature edits you were sent to verify,
  not just your probe. Nothing warns you: the residue check (`grep -rn AGENT-TEST`)
  comes back clean either way, because your marker is gone too.
- **Works — snapshot the file yourself before injecting, restore from the snapshot:**
  ```bash
  cp <file> /tmp/probe-backup-$(basename <file>)     # BEFORE the edit
  # ... inject, HMR, capture ...
  cp /tmp/probe-backup-$(basename <file>) <file>     # restore — preserves uncommitted work
  ```
  Then prove the restore is exact (`git diff -- <file>` shows the same working-tree
  blob as before) and `grep -rn AGENT-TEST` is empty. Check `git status --short`
  before you start so you know which files are dirty; for a dirty file, `git checkout --` is never the revert. `git stash` has the same failure shape.

### A6. WORKS — before/after visual diffing by checking out the OLD file, gated on a measured version signal

- The clean way to produce a real "before" render is to write the pre-change version
  into the working tree (`git show <base>:<path> > <path>`), capture, then restore —
  **not** to trust that HMR applied the swap. HMR can silently fail to apply the
  second swap: the file on disk is old while the renderer keeps the new styles, and
  the screenshot is the AFTER state mislabeled BEFORE (an M5 failure no screenshot
  review catches).
- **Works — gate every capture on a measured version signal, not a sleep.** Pick a
  property that differs between the two versions and read it back with
  `getComputedStyle` before shooting; if it's not the expected value, force a full
  reload and re-enter the surface. A full reload resets SPA state, so budget for
  re-establishing any fixture.
- **Corollary — a layout change may be invisible at the default size.** A
  right-alignment / `flex` fix can render identically to the broken version in a
  narrow container (content already fills the row); drive the app's own resize
  affordance with real mouse events before concluding "no visual change".

---

## B. Cache / stale state that MASKS the failure

### B1. A failed revalidation cannot show an error once the data has settled

- A surface that loaded successfully once caches the last-good value. On a later
  failed fetch, a well-behaved error boundary keeps the settled content and does NOT
  show the error (by design: a background error must not blow away loaded content). So
  your injected failure shows the old content, not the error.
- **Works**: to see a genuine FIRST-LOAD error, clear all client storage, then
  cold-load. Clearing usually logs you out → re-seed auth after.
  ```js
  (async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    try {
      const d = await indexedDB.databases();
      await Promise.all(
        (d || []).map(
          (x) =>
            new Promise((r) => {
              const q = indexedDB.deleteDatabase(x.name);
              q.onsuccess = q.onerror = q.onblocked = () => r();
            }),
        ),
      );
    } catch {}
    try {
      const k = await caches.keys();
      await Promise.all(k.map((c) => caches.delete(c)));
    } catch {}
    return 1;
  })();
  ```
  then re-seed auth, then `open about:blank` → `open <target>`.

### B2. SWR-style clients retry for \~30s before the error settles

- A data client with retry/backoff keeps `isLoading` true during retries, so you
  screenshot a skeleton, not the error. A typical config (5 attempts, exponential
  backoff capped at 30s) settles the error only after \~30s.
- **Works**: wait \~35s after load for retries to exhaust, THEN screenshot. (Or disable
  retries for the probe — but that can also hide the Retry button, since many clients
  mark a non-retrying error as non-retryable.)

### B3. In-memory cache survives `open`; persisted cache survives everything

- `open about:blank` then `open <target>` forces a fresh JS context (clears in-memory
  cache) but does NOT clear persisted storage — you still need B1 for a true cold
  load. Verify a marker set via `eval` (not from the page's own script, which re-runs
  on the second `open` and re-creates it, reading as "context preserved"). Persisted
  caches commonly live in **two tiers** — IndexedDB for big collections and
  localStorage for small shells — which is why B1 clears both plus the Cache API.

### B4. Component-local state seeded from a cached item does NOT reset when fresh data arrives

- A row component that initializes local state from its item (`useState(() =>
derive(item))`) captures the value at first render. When a persisted cache hydrates
  the list with a stale item first, `useState` captures the stale value; when the
  fresh server response replaces the data, the row does not remount (same React key),
  so the stale local state sticks. No amount of waiting fixes it.
- **Works**: for any assertion on an initial-render flag that flows through
  `useState(init)`, force a clean first frame by clearing only the persisted-cache
  tier and reloading (login usually survives if you don't touch the session cookie),
  and verify the underlying data separately so a stale render is attributed to cache,
  not to the change under test.

---

## C. Probing app / runtime state

### C1. WORKS — read live component state with a temporary debug global

- The decisive way to read a component's live props / store / fetched values: add a
  debug global in the render, reload, read it, remove it.
  ```tsx
  // inside the component render, temporary — [AGENT-TEST] REMOVE
  if (typeof window !== 'undefined')
    (window as any).__DBG = { data: /* ... */, hasError: !!error, isLoading };
  ```
  ```bash
  agent-browser --session $S eval 'JSON.stringify(window.__DBG)'
  ```
  This surfaces cases where the data looks settled even on error — a discrepancy a
  screenshot can't show.

### C2. `agent-browser console` capture works — use it for what console is for

- Console capture is reliable on current agent-browser (a page-script `[log]` and one
  emitted later from `eval` both appear). An empty console means the page logged
  nothing, not that capture is broken. The debug-global (C1) is still the better tool
  for reading structured component state; use console for what console is for.

### C3. `document.body.innerText` keyword grep false-positives on fixture text

- Asserting a state via `body.innerText.includes('<phrase>')` matches your own fixture
  content if it happens to contain that substring (e.g. a fixture literally named
  "…failure…" when you assert on "failure") — a false pass on a state that never
  rendered.
- **Works**: scope the check to the actual UI element (`querySelectorAll` on the
  specific tag/toast/alert), never `body.innerText`. And pick fixture names that do
  NOT contain any state keyword you'll assert on.

### C4. `innerText` can be 0 on a rendered page — use it to tell a wedge from a blank

- On some app shells `document.body.innerText` reads `""` even on a fully rendered
  page (some ancestor collapses the layout-dependent computation); probe a more
  specific container (e.g. the app root element) instead.
- **Diagnostic**: `innerText` needs layout, `textContent` does not. When the root
  gives `innerText === 0` but `textContent > 0`, the DOM is fine and the RENDERER is
  not painting (a compositor wedge — see D9). When both are 0, the DOM is genuinely
  empty. This distinction tells a non-painting renderer from a blank page.

### C5. A successful ingest does not prove acceptance attachment when the CLI is stale

- A globally installed CLI may accept `ingest-report` and return a run id while
  lacking newer subject/acceptance behavior. The result is an orphan round even
  though the command appears successful.
- Compare `lh --version` with the skill marker before publishing. If the branch
  under test changes the CLI contract, run that branch's CLI; otherwise use
  `npx @lobehub/cli@latest`. Confirm the returned acceptance id or inspect the
  acceptance page rather than treating a run id alone as proof.

---

## D. agent-browser / CDP mechanics

- **D1. `screenshot` honours a relative path — but still pass an absolute one.** A
  relative path saves to the caller's cwd; the cwd of a step in a longer script is
  easy to lose track of, so an absolute path is the right habit.
- **D2. The CDP port can be ephemeral.** A browser launched with
  `--remote-debugging-port=0` picks a random port; read `DevToolsActivePort` in the
  user-data-dir, or use `agent-browser get cdp-url` (note: `cdp-url` is a `get`
  subject, not a top-level command). Electron dev instances usually pin a known port
  (e.g. 9222) — the project adapter says which.
- **D3. `wait --load networkidle` HANGS during a retry loop** (the network never
  idles) and can blow the command timeout — use a fixed `wait <ms>` when a fetch is
  stuck retrying. (macOS has no `timeout(1)` to bound it.)
- **D4. Portal toasts auto-dismiss (\~5s) and `snapshot -i` may miss their buttons.** A
  base-ui / portal-rendered toast lives outside the main tree and can be occluded by a
  dev overlay; `snapshot -i` does not reliably surface its action buttons. Read the
  toast via an `eval` DOM query, and because it dismisses in \~5s, re-trigger it
  immediately before the screenshot/query (or fire its button via `.click()` in the
  same `eval`) rather than relying on a timed hover-then-observe.
- **D5. `agent-browser screenshot` can WEDGE the session; `eval`/`get` still work.**
  Each session is one daemon socket, so a wedge is scoped to that session. An
  interrupted screenshot RPC (a killed command, a bad flag, `--full` on a giant page)
  can leave the socket half-consumed, after which every later `screenshot` fails
  (`Resource temporarily unavailable` / `CDP response channel closed`) while
  `eval`/`get url` keep working — **not** a display-sleep or permission issue. Reset
  with `agent-browser close --all`, or skip the daemon entirely (D6).
- **D6. WORKS — raw-CDP screenshot bypasses the daemon.** `scripts/cdp-screenshot.sh [--port <n>] [--out x.png] [--full] [--check]` opens its own ws to the target, does
  one `Page.captureScreenshot`, and closes (\~60ms). Immune to the D5 wedge and
  **robust when the display is asleep or the window is minimized/occluded** (the
  engine forces a compositor frame). Use it for Electron evidence and as a preflight
  (`--check` → exit 0 iff a real, non-black frame was captured).
- **D7. OS `screencapture` is BLACK when the display is asleep/locked/screensaver.**
  Distinct from D5/D6: `screencapture` (and `capture-app-window.sh`, osascript grabs)
  captures the physical framebuffer, so an idle-slept display → a uniformly black PNG
  (mean/max = 0). Permission can be fine. Gate with `scripts/check-screen-recording.sh`
  (checks the permission bit + a real-frame blackness probe) and keep the display
  awake for the whole run: `caffeinate -dimsu &`. CDP capture (D6) does not have this
  problem.
- **D8. The daemon serializes commands — `open` queues behind a screenshot loop.**
  While a recording loop (`record-gif.sh`) is running, `agent-browser open <url>`
  lands late/out of order, and your "during navigation" screenshot can show the
  PREVIOUS page (which may look identical to the expected end state — a false read).
  **Works**: during any recording loop, navigate with
  `agent-browser eval 'location.href="<url>"'` (fire-and-forget) instead of `open`.
- **D9. A mid-session bundler dependency re-optimize can wedge the renderer
  compositor.** Symptom: capture returns black, the app root's `innerText` is 0 while
  `textContent` still holds the full DOM (C4), and `visibilityState` is `visible` with
  real dimensions — not display sleep or permission (D6/D7 would survive both). It
  often follows a "re-optimizing dependencies" / "failed to fetch dynamically imported
  module" log line. **Works**: restart the dev instance; `location.reload()` alone may
  not clear it.
- **D10. Virtualized lists: driving `scrollTop` by hand blanks the pane — use a small
  fixture.** A virtualizer unmounts nodes as you scroll past (a `TreeWalker` search
  then "loses" a node that was there a second ago), and forcing `scrollTop` far
  outside the rendered window can make the scroll container itself disappear — reading
  exactly like a render bug. **Works**: pick a fixture small enough that the target is
  on the first screen; far cheaper and more reliable than fighting the virtualizer.
- **D11. React controlled inputs ignore synthetic events — use `agent-browser click`
  (trusted CDP input).** `el.click()` and even a full synthetic
  `pointerdown/mousedown/pointerup/click` sequence are `isTrusted: false`, so a
  React-controlled checkbox/toggle never updates its state. **Works**: `snapshot -i`
  for the ref, then `agent-browser click <ref>` — it goes through CDP
  `Input.dispatchMouseEvent`, which the page sees as a real user click. The snapshot
  also reveals when a control is `[disabled]` (the app deliberately refusing), which a
  coordinate-click never would.
- **D12. Disambiguate elements by geometry or an identifying attribute — don't
  singular-select.** A page can render a hidden zero-size duplicate of a subtree
  (e.g. an offscreen measurement copy) at `(0,0)`, first in DOM order, so a singular
  `querySelector` grabs the phantom: a `fill` reports success while the visible box
  stays empty, a click on the phantom button is a silent no-op, and an `innerText`/aria
  grep "finds" a control the user can't see. **Works**: enumerate and filter by a
  non-zero `getBoundingClientRect()`, or target by the component's own `aria-label`;
  tag the resolved element with a `data-probe` attribute and drive it with
  `agent-browser click '[data-probe=...]'`.
- **D13. A blank page at `about:blank` with a 1280px viewport usually means the
  previous `open` failed** (exited non-zero without navigating — e.g. an unrecognized
  global flag). The session still exists and answers every later probe — against the
  fresh page it was born with, at the default viewport. Read the `open` exit code and
  stderr to learn _why_ rather than assuming the page went blank; treat the
  fingerprint as "the navigation failed".

---

## E. Environment / shell gotchas

- **E1. Not every layer hot-reloads — restart and prove which code the process runs.**
  A dev server's HMR typically covers the renderer/client only. Server code,
  main-process code, and adapters that run out-of-process are often NOT recompiled on
  edit, so reloading the client verifies nothing — the old code is still running, and
  the failure looks exactly like a logic bug in your own diff. **Works**: after an
  edit to a non-client layer, restart before drawing a conclusion, and prove the
  process has your code before debugging it — e.g. curl the dev bundler for the source
  and grep for a marker (renderer), or grep the built bundle for the marker (server /
  main).
- **E2. The shell's `grep` may honor `.gitignore` — "not found anywhere" can be a
  false negative.** Some environments alias `grep` to a wrapper (e.g. `ugrep --ignore-files`) that skips `.gitignore`d paths, silently omitting `node_modules`.
  Before asserting "X exists nowhere", name the ignored directory explicitly
  (`grep -rl X node_modules`) or call `/usr/bin/grep` directly.
- **E3. In zsh, a loop variable named `path` overwrites the command search path.** zsh
  ties `path` to `PATH` as a special array; assigning it (e.g. parsing a cookie jar's
  path field) replaces the process command search path, and the next executable fails
  with `command not found`. Name the field something else (`cookie_path`); this is a
  shell failure, not an auth/browser failure. (Similarly, `zsh does NOT word-split
unquoted vars` — stashing `S="--session x --cdp 9226"` then `agent-browser $S`
  fails; inline the flags or use an array.)
- **E4. A curl "502" from a local port with nothing listening can be a shell proxy
  env.** If `HTTP_PROXY`/`HTTPS_PROXY` are set and `NO_PROXY` does not exempt
  localhost, a dead local host is forced through the proxy and returns the proxy's
  502 — a "server up but broken" mirage. `curl --noproxy '*'` is a harmless
  belt-and-braces habit; if you actually see a 502 from a local port, check `NO_PROXY`
  before believing the server is up.
- **E5. Dev servers can write managed files on start — check `git status` before
  reporting the tree clean.** Some frameworks append a managed block to a repo file on
  `dev` start (once, idempotently). Reverting it at teardown makes it look like
  per-start churn and causes it to be re-appended on the next start. Commit the block
  or opt out per the framework, and always check `git status` before claiming a clean
  tree.
- **E6. Persistent resource exhaustion (e.g. Vite `EMFILE: too many open files`) is a
  stop-and-ask, not a workaround.** If a surface exits at startup with a
  file-watcher/resource-exhaustion error while the port is free, the likely cause is
  other running watchers (extra worktrees, surviving terminals, an editor window) that
  you must not kill. Terminate the run, report the exact error, and ask the user to
  clean up other processes — do not change watch mode, fall back to a static build, or
  publish a report from a degraded surface.
- **E7. The default `lobehub-dev` browser session is shared — a parallel run can steal your
  tab.** `agent-browser` sessions are keyed by name, not by workspace, so two runs both using
  `--session lobehub-dev` drive the **same** browser. The other run navigates the tab to _its_
  dev server, after which your `eval` reads that page while `screenshot` may still show yours —
  a screenshot that renders your fixture next to a `document.body.innerText` from the same
  moment containing none of its strings, every assertion `false`. It reads like a product bug;
  it is two runs sharing one browser. **Works**: give every run its own session name, seed auth
  into it, and confirm the tab is yours before asserting — `agent-browser --session <name> tab
  list` must print YOUR port and path. Same applies to ports: a worktree allocates its own
  `SERVER_PORT`/`SPA_PORT`, so re-run `test-env.sh` inside the worktree you are testing rather
  than assuming another checkout's ports.
