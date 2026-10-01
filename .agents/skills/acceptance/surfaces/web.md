# Web surface

Default surface for frontend and full-stack changes — the browser is the one place
network requests and rendered UI are observable together, so you can assert both
sides of a contract in one run. Driven by `agent-browser`
([../references/agent-browser.md](../references/agent-browser.md)).

Use web when the behavior is the same in a normal browser against the app's dev
server or a deployed URL. Return to the surface router if the criterion depends
on the desktop shell or is fully provable through backend/CLI output.

## Setup

1. Have the app reachable at a URL: a local dev server you started (e.g.
   `http://localhost:<port>`), or a deployed/preview URL the task targets.
2. If the state under test is behind login, authenticate the agent-browser
   session first — see
   [../references/auth-web.md](../references/auth-web.md). Use a named `--session`
   to reuse cookies across commands in the same running browser. Add `--restore`
   when authentication must survive browser restarts.

```bash
SESSION=app-<run-id>                         # unique per run; parallel runs must not share one
export AGENT_BROWSER_IDLE_TIMEOUT_MS=1800000 # set this before the first call; the only thing
                                             # that closes the session when the run dies
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

Reach for this only when the change under test is frontend-only **and** no
self-contained local environment can run it. Drive the frontend URL the same way,
but treat it as a fallback, not a default: the backend is not your branch and may
be production, so it proves frontend behavior against someone else's backend and
data — not backend changes, and not the delivered branch end to end.

Keep the local dev server the project's adapter provides as the default surface.
When a remote-backed surface is unavoidable, say so in the report so the reviewer
knows which layers the evidence actually covers.

## Time-based behavior & OS-level steps

- **Behavior over time** (streaming, loading→loaded, animation) needs a clip, not a
  screenshot — record CDP frames:
  [../references/recording-cdp.md](../references/recording-cdp.md).
- **A native step the page can't script** (file picker, OS permission prompt, Save
  dialog) — drop to Computer Use for that step, then return:
  [../references/computer-use.md](../references/computer-use.md).

## Teardown — close the session you opened {#web-teardown}

Every named `--session` starts a background daemon with its own browser that
keeps running after your process exits. Nothing reaps it: a run that ends
without closing leaks a full headless browser (hundreds of MB to over 1 GB per
session), and unique per-run session names make the leak grow by one browser
every run.

```bash
agent-browser --session $SESSION close
```

Close only the sessions this run opened. Never `close --all` or
`pkill -f agent-browser` as routine cleanup — that kills sibling runs'
browsers mid-capture. Keep `AGENT_BROWSER_IDLE_TIMEOUT_MS` set so a run that
crashes before teardown still releases its browser.

A session also grows *while* it stays open: renderer heap, page cache, and every
screenshot, HAR buffer and CDP frame it has taken. On a run with many captures,
close and reopen the session periodically (reopen with `--restore` to keep auth)
instead of holding one browser for the whole round.

When a run boots services, drives a browser and records media together, start the
[resource guard](../references/resource-guard.md) next to the session: it samples
swap and per-group RSS and, at red, stops only the processes this run started.
Report its peak tier with the round.

## Boundaries

- **Provenance:** tag artifacts captured by `agent-browser` as
  `--by agent-browser`; use `--by cdp` only for a direct CDP client capture.
- **Headless / cloud:** web is cloud-native — headless Chromium and CDP screenshots
  work without a display. Prefer CDP capture over OS-level capture.
- **HMR breaks refs.** After a hot reload during dev, re-snapshot before interacting.
