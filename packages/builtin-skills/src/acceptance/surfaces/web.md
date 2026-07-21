# Web surface

Default surface for frontend and full-stack changes — the browser is the one place
network requests and rendered UI are observable together, so you can assert both
sides of a contract in one run. Driven by `agent-browser`
([../references/agent-browser.md](../references/agent-browser.md)).

Use web when the behavior is the same in a normal browser against the app's dev
server or a deployed URL. If the criterion depends on the desktop shell, use
[electron.md](./electron.md) instead; if it's backend/CLI, use [cli.md](./cli.md).

## Setup

1. Have the app reachable at a URL: a local dev server you started (e.g.
   `http://localhost:<port>`), or a deployed/preview URL the task targets.
2. If the state under test is behind login, authenticate the agent-browser
   session first — see [../references/auth.md](../references/auth.md). Use a named
   `--session` so cookies persist across commands.

```bash
SESSION=app
agent-browser --session $SESSION open "http://localhost:3000/"
agent-browser --session $SESSION snapshot -i
# interact via refs, then capture
agent-browser --session $SESSION screenshot ./proof/state.png
```

Use the authenticated session as the evidence source. Do **not** use a separate
ordinary-Chrome screenshot as proof — it doesn't prove the automated session
reached the state. Ordinary Chrome is only a cookie source for auth fallback.

## Full-stack — assert both layers {#web-full-stack}

When the criterion spans a new/changed API and the UI consuming it, capture both
the network exchange and the rendered result:

```bash
SESSION=app
agent-browser --session $SESSION network har start
# ... drive the scenario that triggers the API ...
agent-browser --session $SESSION network requests --type xhr,fetch # inspect calls
agent-browser --session $SESSION network har stop ./proof/capture.har
agent-browser --session $SESSION screenshot ./proof/result.png
```

Upload the screenshot (`--type screenshot`) and the network proof (the HAR as
`--type text --file ./proof/capture.har`, or a focused request/response as
`--type text --content …`). Asserting only one layer leaves the contract half-proven.

## Local frontend against a remote backend

If you can only run the frontend locally but the backend is remote, drive the
frontend URL the same way — just remember the backend is not your branch, so it
proves frontend behavior, not backend changes.

## Time-based behavior & OS-level steps

- **Behavior over time** (streaming, loading→loaded, animation) needs a clip, not a
  screenshot — record it: [../references/recording.md](../references/recording.md).
- **A native step the page can't script** (file picker, OS permission prompt, Save
  dialog) — drop to Computer Use for that step, then return:
  [../references/computer-use.md](../references/computer-use.md).

## Boundaries

- **Headless / cloud:** web is cloud-native — headless Chromium and CDP screenshots
  work without a display. Prefer CDP capture over OS-level capture (see
  [../references/evidence.md](../references/evidence.md#headless--cloud-portability)).
- **HMR breaks refs.** After a hot reload during dev, re-snapshot before interacting.
