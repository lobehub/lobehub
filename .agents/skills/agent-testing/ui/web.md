# Web (Full-Stack) Testing

Default surface for **full-stack changes** — a new/changed API plus the UI that
consumes it. The browser is the one surface where network requests and UI state
are observable together, so you can assert both sides of the contract in a
single run.

For pure-frontend changes prefer [electron.md](./electron.md); for
backend-only changes prefer [../cli/index.md](../cli/index.md).

## Prerequisites

- Complete [Step 0.0](../SKILL.md#00-resolve-the-current-test-environment) (resolve ports) and [Step -1](../SKILL.md#step--1--plan-approval-for-non-trivial-tests) (plan approval) first.
- Local dev server running — [../references/dev-server.md](../references/dev-server.md)
- Web auth verified in agent-browser — see [auth decision flow](../references/auth.md#web--decision-flow).

## Option A — agent-browser with injected auth (recommended)

```bash
SESSION=lobehub-dev

agent-browser --session $SESSION open "$SERVER_URL/"
agent-browser --session $SESSION snapshot -i
# interact via refs — full command reference: ../references/agent-browser.md
```

Use this session as the evidence source. Do not use ordinary Chrome screenshots
or Chrome Network records as proof for Web tests; ordinary Chrome is only a
source for copying cookies into agent-browser.

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

Assert both layers: the request/response shape (network) and the rendered
result (snapshot/screenshot). Both belong in the report as evidence.

## Option B — real Chrome with remote debugging

For flows that need a real, visible browser (e.g. exercising the login UI
itself):

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-test-profile \
  "<URL>" &
sleep 5
agent-browser --cdp 9222 snapshot -i

# Or auto-discover running Chrome with remote debugging
agent-browser --auto-connect snapshot -i
```

## Option C — Debug Proxy (local frontend, production backend)

`bun run dev:spa` prints a **Debug Proxy** URL
(`https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=…`) that loads
your local Vite SPA inside the online environment — HMR against real server
config. Useful for verifying frontend behavior against production data, **not**
for testing backend changes (the backend is production, not your branch).
