# Web (Full-Stack) Testing

Default surface for **full-stack changes** — a new/changed API plus the UI that
consumes it. The browser is the one surface where network requests and UI state are
observable together, so you can assert both sides of the contract in a single run.

For pure-frontend changes in a project that ships a desktop shell, prefer
[electron.md](./electron.md); for backend-only changes prefer [cli.md](./cli.md).

The base URL, session name, and auth for the web surface come from
[`.agents/verify/PROJECT.md`](../references/project-adapter.md) §4/§3. This guide is
the methodology.

## Prerequisites

- Complete [Step 2.0](../SKILL.md#20-resolve-the-current-test-environment) (resolve
  ports) and the [Phase 1 approval gate](../SKILL.md#phase-1-approval-gate--report-environment--plan-to-the-user) first.
- Local dev server running — start command from `PROJECT.md` §2.
- Web auth verified in the agent-browser session — status check and seeding from
  `PROJECT.md` §3.

## Option A — agent-browser with seeded auth (recommended)

Seed/verify the web session per `PROJECT.md` §3, then drive it. Use one named
session as the single evidence source:

```bash
SESSION=your-session           # session name from PROJECT.md §4
BASE_URL=http://localhost:3000 # base URL from PROJECT.md §4

agent-browser --session $SESSION open "$BASE_URL/"
agent-browser --session $SESSION snapshot -i
# interact via refs — full command reference: ../references/agent-browser.md
```

Use this session as the evidence source. Do not use ordinary Chrome screenshots or
Chrome Network records as proof; ordinary Chrome is only a fallback source for
copying cookies into agent-browser when the seeded login is not available.

### Watch the API while driving the UI

```bash
# After triggering the UI action under test:
agent-browser --session $SESSION network requests --type xhr,fetch
agent-browser --session $SESSION network requests --method POST

# Record a full HAR for the report
agent-browser --session $SESSION network har start
# ... drive the scenario ...
agent-browser --session $SESSION network har stop ./capture.har
```

Assert both layers: the request/response shape (network) and the rendered result
(snapshot/screenshot). Both belong in the report as evidence — the network dump or
HAR as a linked non-visual artifact, the rendered state as an inline screenshot.

## Option B — real Chrome with remote debugging

For flows that need a real, visible browser (e.g. exercising the login UI itself):

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-test-profile \
  "<URL>" &
sleep 5
agent-browser --cdp 9222 snapshot -i

# Or auto-discover a running Chrome with remote debugging
agent-browser --auto-connect snapshot -i
```

## Method notes (project-independent)

- **Prove the session is live before trusting an auth-scoped result.** An
  owner-only / permission-gated UI fails identically whether the gate is broken or
  the session is simply missing. `document.cookie` is not the probe — session
  cookies are often httpOnly, so it reads empty on a fully authenticated page.
  Instead call any authed endpoint from the page and read the status: `401` = no
  session reached the server (re-seed), `200` = you are really signed in. Only then
  conclude anything about the gate.
- **The app can swallow an injected fetch failure.** A store action may resolve
  even when the underlying fetch was aborted, so the UI/promise is not a reliable
  signal that your fault landed. Judge interception by the **fetch's own outcome**
  (wrap `window.fetch` and record each request's resolve/reject) — see
  [../references/probe-mock-patterns.md](../references/probe-mock-patterns.md) A.
- **A cached first-load can mask a failure.** A surface that loaded once caches the
  last-good value; a later failed fetch keeps showing the settled content instead
  of the error. To see a genuine first-load error, cold-load (clear
  localStorage / sessionStorage / IndexedDB / Cache API), which usually logs you
  out — re-seed auth after. See probe-mock-patterns B.
- **Enumerate every surface a shared component renders on.** A shared input/toolbar
  can be composed differently on the home page vs an inner page; verify each place
  the changed component appears, with separate evidence, and mark any skipped
  surface explicitly.
