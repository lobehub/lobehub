# LobeHub Probe & Mock Guide

This is the project-layer entry point for LobeHub acceptance probes. Read it
together with the agent-testing skill's generic `references/probe-mock-patterns.md`.
Product-independent rules belong upstream; LobeHub routes, stores, services, env
variables, and fixtures belong here.

## Choose the least invasive mechanism

1. **Use a supported command** in `scripts/app-probe.sh` for read-only app state.
2. **Use a public store action or API** when the behavior must execute real product
   logic.
3. **Use an agent-runtime hook** for tool-call mocks. `beforeToolCall` is the
   supported mock boundary; browser HMR patches are not the default for runtime
   tools.
4. **Use a narrowly scoped temporary injection** only when no stable boundary
   exists. Snapshot dirty files first, mark the injection, and prove exact cleanup.
5. **Use the historical field notes** for rare environment or renderer failures.

Never infer a passed UI state from a state probe alone. A visual claim still needs
an opened and inspected screenshot.

## Supported probes

```bash
PROBE=.agents/acceptance/scripts/app-probe.sh

$PROBE ready                      # app root + exposed-store readiness
$PROBE auth                       # renderer auth state
$PROBE server-auth                # authenticated server request (200 vs 401)
$PROBE route                      # current SPA route
$PROBE stores                     # exposed store names
$PROBE ops                        # chat operation summary
$PROBE wait-ops [timeout-seconds] # wait until no operation is running
$PROBE topic                      # active topic + metadata from the paged view
$PROBE goto /settings             # full navigation, then report route
$PROBE errors-install             # begin console.error capture
$PROBE errors                     # read captured console errors
```

Target Electron by default. For a web session:

```bash
AB_TARGET="--session lobehub-dev" $PROBE ready
```

Prefer `server-auth` over `document.cookie`: Better Auth session cookies are
HttpOnly, so an empty `document.cookie` does not establish signed-out state.

## Decision table

| Goal                               | Preferred boundary                         | Notes                                                          |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Confirm app/store mount            | `app-probe.sh ready`                       | Distinguishes an unmounted shell from a ready SPA              |
| Confirm identity                   | `auth` then `server-auth`                  | Renderer state and server session are separate claims          |
| Inspect a running agent turn       | `ops` / `wait-ops`                         | Proves operation state, not which server runtime executed      |
| Read active topic metadata         | `topic`                                    | `topicDataMap` is keyed by `agent_<id>`, not topic id          |
| Render message-attached error UI   | In-memory chat dispatch                    | Safe when the temporary message has a unique id and is deleted |
| Force a tool result                | `beforeToolCall` hook + `event.mock()`     | Local/in-memory hook mode only                                 |
| Force a fetch failure              | Request boundary or narrow HMR injection   | Preserve dirty files byte-for-byte                             |
| Verify first-load error            | Clear the cache tier in the _new_ document | Clearing then reloading does not work — see "Cold SWR cache"   |
| Diagnose Electron target confusion | CDP target list / raw CDP                  | Use a distinct agent-browser session per CDP port              |
| Seed backend fixtures              | Public API first, raw SQL last             | Raw SQL must preserve product id and relation invariants       |

## Project-specific recipes

Recipes are grouped by what you are trying to do. Add a new one inside the group it
belongs to, above `Detailed references`.

### Probing app state

#### Store exposure

`window.__LOBE_STORES.<name>` is a function returning the current state. Call it:

```js
window.__LOBE_STORES.chat();
```

It intentionally does not expose Zustand's `getState` or `setState`. If a test
repeatedly needs mutation, add a dev-only supported action or fixture command
instead of normalizing temporary `setState` HMR patches.

#### In-SPA navigation that preserves instrumentation

`app-probe.sh goto` and `location.assign("app://renderer/…")` perform a FULL
reload — any `window.fetch` wrapper or debug global installed via `eval` is
wiped, and its absence reads as "the request never fired". To change route while
keeping instrumentation alive, drive react-router through history:

```js
history.pushState({}, '', '/settings/apikey');
dispatchEvent(new PopStateEvent('popstate'));
```

This remounts the route component (SWR revalidates, list fetch observable by the
wrapper) without recreating the JS context. Leave-and-return with this pattern is
the way to capture a page's first-load request after installing a fetch wrapper.

#### Runtime proof

Client and server agent runtimes can produce the same visible result. Prove the
runtime with a server-only artifact: operation row, queue step, or enabled
main/server log namespace. Renderer state alone is not sufficient.

#### `eval` declarations persist in the page global scope

**Situation:** running several `agent-browser eval` payloads against one renderer.

**Doesn't work:** a bare top-level `const els = …` in a second payload fails with
`SyntaxError: Identifier 'els' has already been declared`, because each `eval`
shares the page's global scope.

**Works:** wrap every payload in an IIFE (`(() => { … })()`), or attach state to a
single namespaced `window.__X` object.

#### Shared agent-browser session names can cross-wire concurrent acceptance runs

**Situation:** a Web acceptance run uses the adapter's default `lobehub-dev`
session while another local run is active against a different port.

**Doesn't work:** reusing `lobehub-dev` and trusting the URL printed immediately
after `open`. Another process can steer the same session between commands, so a
later click or screenshot lands on a different acceptance and port.

**Works:** create a run-specific session name and load the seeded auth state
directly:

```bash
RUN_SESSION=visualization-acceptance
agent-browser --session "$RUN_SESSION" \
  --state ~/.lobehub-agent-testing/web-state.json open "$SERVER_URL/acceptance"
```

Then assert `get url` and `app-probe.sh auth` on that exact session before
capturing evidence.

A cross-wired session can also look perfectly healthy while running STALE code:
if the other instance's Vite has since died, the browser keeps serving its last
bundle from disk cache — every probe answers, `innerText` is full, and only the
rendered copy (an old i18n string, a pre-change label) betrays it. Before any
assertion about working-tree code, read `location.origin` AND the page's script
`src` origins, and require both to match the ports this run's `test-env.sh` /
`.records/runtime` resolved. A dead script origin that still renders = disk
cache, not your build.

#### A new module needs a renderer reload, not HMR, before probing the fix

**Situation:** verifying a source fix in the running Electron dev instance
(`electron-dev.sh`) right after editing.

**Doesn't work:** editing a component and probing a few seconds later. When the
edit adds a **new module** (extracting a hook into its own file), the desktop
Vite renderer can keep serving the previous module graph, so the probe reports
the old behavior. Read as "the fix does not work" — a false negative that looks
exactly like a logic bug in the change under test.

**Works:** force a full renderer navigation (`app-probe.sh goto <route>`) after
adding or moving a module, then re-probe. Confirm the new code is live by a
structural signal (a renamed component in the fiber chain, a new class in the
computed cascade) before concluding anything about behavior.

#### Production debug proxy stays on the development loading shell in an isolated browser

**Situation:** verifying a public SPA route with local frontend code against the
production backend through `/_dangerous_local_dev_proxy`.

**Doesn't work:** treating a successful Vite connection or the route's debug ID
as proof that the product page loaded. In a fresh, signed-out automation context,
the proxy can remain on the development loading shell without a useful page error;
its screenshot is blank except for the debug marker.

**Works:** visually reject the loading-shell screenshot, then use the adapter's
isolated local full stack. Seed the test user, ingest a representative public
Acceptance fixture through the local CLI, and capture the same route in separate
authenticated and storage-empty browser contexts. This proves both owner and
shared-viewer rendering without depending on production browser cookies.

#### The debug proxy cannot reach a settled app — workspace `packages/*` dynamic imports fail cross-origin

**Situation:** verifying frontend work through `/_dangerous_local_dev_proxy` (production
page + production login + local Vite modules), needing a screenshot of the app after it
has finished loading.

**Doesn't work:** treating the resulting `ErrorBoundary` ("页面暂时不可用") as a defect in
the change under test. The document origin is `https://app.lobehub.com`, and dynamic
`import()` of workspace modules served from `http://localhost:9876` — `packages/builtin-tools/src/register.ts`,
and intermittently `src/routes/**` — fails with `Failed to fetch dynamically imported module`.
The same URLs return **200** to `curl` and to an in-page `fetch()`; only module scripts
fail, because their cross-origin requirements are stricter. So the usual "is it reachable"
probes all say yes while the app still dies.

**Works:** treat this channel as good for boot-phase and pre-settle evidence only, and
prove attribution rather than assuming it — `git stash -u` the whole change, reload the
same proxy URL, and confirm the identical ErrorBoundary appears at HEAD. Report the
settled-state check as blocked with that A/B attached instead of chasing the module
graph. For a genuinely settled authenticated app, use Electron with an injected login
snapshot; the local Vite entry (`http://localhost:9876/`) loads modules correctly but has
no session, so it ends in the same error for a different reason. See also the two
neighbouring entries on this proxy (loading-shell in an isolated context; no seeded
agent-browser session).

### Seeding fixtures

#### Structured generation through the local OpenAI-compatible stub

**Situation:** a real product path uses non-streaming `chat/completions` for
`generateObject`, while ordinary agent turns use streaming completions against the
same local provider stub.

**Doesn't work:** returning SSE chunks for every `chat/completions` request. The
model runtime expects a normal `choices[0].message.content` response when
`stream: false`, so the request reaches the stub but structured generation crashes
before schema parsing.

**Works:** branch on the request's `stream` field. Keep SSE for streaming turns and
return a standard JSON chat completion for `stream: false`; set `STUB_TEXT` to the
schema-valid JSON required by the check.

#### Driving the Acceptance AI-review predictor locally: pinned Gemini, image fetch-back, and stub JSON

**Situation:** verifying the ✨ "ask AI to review" round on `/acceptance/<id>` (the
`review_predict` generation, its toast, the proposal cards) without a real vision key.

**Doesn't work:** three separate things, each of which reads as "the predictor never
ran" — the button spins, no card, no error.

- Pointing any provider at `llm-stub.mjs`. The predictor does not follow the verifier's
  model: it is pinned to `DEFAULT_REVIEW_PREDICT_{MODEL,PROVIDER}` in
  `packages/business/const/src/llm.ts` (Gemini native protocol, which the OpenAI-shaped
  stub cannot serve), so the provider you configured is simply never called.
- Running the dev server without `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1`. The OpenAI context
  builder fetches every `image_url` back and inlines it as base64; the local s3rver
  presigned URL is `127.0.0.1`, so the fetch is refused and the attempt lands as an
  `errored` row with no model call (the "SSRF protection blocked request" entry above).
- Expecting a `pending` state in `verify_review_predictions`. There is none: a check is
  "awaiting" only while it has NO row for the current (provider, model, promptVersion);
  `predictReviews` deletes the previous unadjudicated rows before dispatch, so reading
  the table mid-batch shows gaps, not placeholders.

**Works:** (1) temporarily pin the constants to `gpt-4o` / `openai` with an
`[AGENT-TEST]` marker (snapshot the file first, restore byte-identically at teardown —
the model-bank vision test guards the real value), then
`aiInfra().updateAiProviderConfig('openai', { keyVaults: { apiKey: 'sk-stub', baseURL:
'http://localhost:41100/v1' } })`; (2) start the dev server with
`SSRF_ALLOW_PRIVATE_IP_ADDRESS=1`; (3) set `STUB_TEXT` to a `ReviewPredictionSchema`
JSON (`{"action":"reject","regions":[{"imageIndex":0,...}]}`) — the runtime sends
`response_format: json_schema` with `stream: false`, which the stub answers as a plain
completion whose `content` is parsed as the object. A text-only evidence check is
`skipped` without a call; `STUB_FAIL=500` yields `errored` — note the SDK retries a
5xx three times, so any delay you put in front of the stub is paid ×3 on that path.
Assert the round from three places together: the toast copy (a MutationObserver on
`document.body`), the rows' `status`/`action`/`created_at`, and the card count.

#### A CLI-created topic has no trigger/status and is filtered out of the Agent paged view

**Situation:** building a topic fixture with `lh topic create`, writing fields such as
`workingDirectoryConfig` into `metadata` with SQL, then opening the UI to verify.

**Doesn't work:** navigating straight to `/agent/<agentId>/<topicId>`. The route and
`activeTopicId` are both correct, yet `app-probe.sh topic` keeps reporting
`active topic not found in the agent paged view` and `topicDataMap['agent_<id>'].total`
stays 0 — so `currentTopicMetadata` is undefined and any UI reading topic metadata
never sees the fixture, which looks like a product defect. The CLI-created row has
NULL `trigger` and NULL `status`, while the paged query carries `excludeTriggers`
(cron/document/eval/task) and `excludeStatuses` (completed); in SQL `NULL NOT IN (...)`
evaluates to NULL, i.e. false, and the whole row is dropped. `lh topic list` runs a
different query and returns it as usual, so the "visible to the CLI, invisible to the
UI" split is especially misleading.

**Works:** right after writing the metadata, also run
`update topics set status='active', trigger='chat'`, then `app-probe.sh goto` once
more. Keep the assertion order from M19: confirm `app-probe.sh topic` returns the
metadata before asserting anything in the UI.

#### `agent.updateAgentConfig` silently drops `agencyConfig.heterogeneousProvider`

**Situation:** turning a test agent into a CLI-agent shape (Claude Code / Codex) so
the heterogeneous chat input and its quota badges render.

**Doesn't work:** `updateAgentConfigById(id, { agencyConfig: { heterogeneousProvider:
{ type: 'claude-code', command: 'claude' } } })`. The store's optimistic write makes
it look applied — reading `agentMap[id].agencyConfig` back returns the provider — but
the DB row keeps only the sibling keys (`executionTarget` persists, the provider does
not), so the next full reload drops it and the plain chat input comes back. Reads as
"the agent isn't hetero" with no error anywhere.

**Works:** seed the shape directly (public API first is the rule; this is the
documented exception where the write path does not carry the field):

```bash
docker exec lobehub-agent-testing-postgres psql -U postgres -d postgres -tAc \
  "update agents set agency_config = '{\"executionTarget\":\"local\",\"heterogeneousProvider\":{\"type\":\"claude-code\",\"command\":\"claude\"}}'::jsonb where id='<agentId>';"
```

Then cold-load: a plain reload keeps serving the agent config from the tiered SWR
cache, so the renderer still shows the pre-write value (generic M18). Clear
`lobechat-swr-cache*` + `lobehub-local-data` through
`Page.addScriptToEvaluateOnNewDocument` and reload (see "Cold SWR cache" above),
then assert `agentMap[id].agencyConfig` before drawing any conclusion.

#### Day-scoped fixtures must use the browser's measured timezone, not an assumed one

**Situation:** seeding backdated rows (briefs, activity, digests) whose UI grouping is
by the viewer's _local calendar day_ (`dayjs().startOf('day')` on the client).

**Doesn't work:** computing the day boundaries from an assumed timezone (the user's
usual locale, the server tz, or the shell's). On this harness the agent-browser
Chromium reports `America/Los_Angeles`, so a "today 14:00 CST" timestamp lands on the
browser's _yesterday_ — the day view renders empty and reads exactly like the
feature not fetching, while the server endpoint returns the rows when probed with
the "correct" (assumed-tz) window.

**Works:** before seeding, read the tz the grouping actually uses —
`agent-browser eval 'Intl.DateTimeFormat().resolvedOptions().timeZone'` — and derive
every `[startAt, endAt)` from that. When a day view comes back empty, diff the
client's real request window (fetch wrapper on the batch URL) against the seeded
timestamps before suspecting the query.

#### Cold SWR cache: clearing then reloading is undone by the outgoing page

**Situation:** forcing a first-load / skeleton state for anything backed by the
tiered SWR cache (`recent:*`, `topic:*`, `message:*`, …).

**Doesn't work:** clearing `localStorage['lobechat-swr-cache:<scope>']` (and the
`lobehub-local-data` IndexedDB) in the current document, then reloading. The cache
provider registers `flushAll()` on `visibilitychange` and `pagehide`, so the reload
itself makes the outgoing page write its in-memory cache straight back. The next
document hydrates from a repopulated tier and renders settled data — which reads as
"the loading state never happens" and can be mistaken for a product bug.

```
1. before clear      : true
2. right after clear : false
3. after reload      : true   <- the outgoing page re-flushed on pagehide
```

**Works:** clear at document start in the NEW document, before the provider
hydrates:

```js
Page.addScriptToEvaluateOnNewDocument({
  source: `Object.keys(localStorage).filter(k=>k.startsWith('lobechat-swr-cache'))
             .forEach(k=>localStorage.removeItem(k));
           indexedDB.deleteDatabase('lobehub-local-data');`,
});
```

Assert the clear actually ran in the new document (set a flag in that script and
read it back) rather than trusting the removal.

**The same cache tier inverts _request-gating_ assertions, not just rendered values.**
When a component decides whether to fire a secondary query from data it reads out of
the portrait/list query (`useX(shouldFetch ? id : undefined)`), the hydrated cache is
what the gate sees on the mount frame. Change the underlying state with raw SQL and
the gate still fires off the stale cached copy, so a correct gate measures as broken —
and the reverse can hide a broken one. Drive the state change through the product
write path (whose success handler revalidates), or re-measure after the list query has
resolved once and the cache is reconciled; report the steady state, and record the
stale frame separately if you observed it. Pair it with a warm control run: if
the warm run renders data while the request is held paused and the cold run shows
the skeleton, the cache tier is proven to be what the render reads.

#### Reaching the Goals page: nested route plus a Labs toggle

**Situation:** accepting goal-related functionality requires opening the Goals page.

**Doesn't work:** opening `/agent/goals` directly. The goals route is nested under
`/agent/:aid/goals`, so `goals` is parsed as an agentId and the page reports
"assistant unavailable". The page is also gated behind the Labs toggle
`enableTopicAcceptance`; while it is off, the route silently replaces back to
`/agent/:aid`.

**Works:** look up the seeded user's agentId
(`select id from agents where user_id=...`), then turn the Labs toggle on through the
public store action (it persists to user preferences and applies for the whole
session):

```js
window.__LOBE_STORES.user().updateLab({ enableTopicAcceptance: true });
```

Then open `/agent/<agentId>/goals`. In the create-Goal dialog, "start from blank"
skips AI generation of the acceptance criteria (required when there is no local LLM
key); the criteria editor and budget field are ordinary inputs, while the goal
description is contenteditable (use `fill`; `type` does not support contenteditable).

#### Reaching the Claude Code usage calendar: a local-execution agent, a live-CLI identity, and a four-table ledger fixture

**Situation:** verifying the quota usage calendar (`AgentQuotaCalendar`), which needs
both a way to open it and quota history to render.

**Doesn't work:** three separate dead ends.

- Opening the conversation of a heterogeneous agent whose `executionTarget` is
  `device`. A bound-but-offline device renders the 设备未连接 state and the composer
  never shows the quota badge, so the panel that owns the calendar entry does not
  exist. Reads as "this build has no quota UI".
- Seeding only `agent_quota_windows`. The window rows carry `observed_tokens`, but
  the UI does not read them: `buildWindowStats` sums the **usage ledger** turns that
  fall inside each window, and the day cells come from the same ledger. Windows
  without ledger rows render as 历史未记录，which looks like a broken read model.
- Assuming the DB account is the one the modal opens. The composer badge reads the
  **live** identity from the local Claude Code CLI over Electron IPC and passes its
  `externalAccountId` down; the modal then resolves that against
  `agent_provider_accounts`. A fixture account whose `external_account_id` differs
  from the machine's real Claude login yields 账号不可用 with no other signal.

**Works:** set the agent to local execution, then seed four tables against the
account row the app itself created when it first ingested the live snapshot.

```bash
# 1. the composer only mounts the quota panel for a local-execution hetero agent
update agents set agency_config = '{"executionTarget":"local","heterogeneousProvider":{"type":"claude-code","command":"claude"}}'::jsonb where id='<agentId>';
# 2. reuse the existing account row — its external_account_id already matches the live CLI identity
select id, external_account_id from agent_provider_accounts where provider='claude-code';
```

Then insert `agent_quota_usage_ledger` turns (they drive both the day cells and the
per-window totals), `agent_quota_windows` rows for the concrete reset windows, and
`agent_quota_snapshots` readings — a reading whose `resets_at` is in the future is
what makes a window "live" and draws the burn-down curve, and a model-scoped
`weekly_scoped` reading is what adds the third segment. Derive every timestamp from
the browser's own timezone, since the calendar groups by local day. After the agent
config write, clear the SWR cache tiers before reloading or the composer keeps the
previous execution target.

One seeded value does not survive: opening the composer's quota panel makes the app
ingest the machine's **live** CLI reading into the same account row. A seeded current
window is therefore replaced by the real utilization (and the real `resets_at`, which
merges with a seeded window inside the five-minute tolerance) as soon as the panel
renders. Seed the history and the ledger, but never assert on the live window's own
percentage — read it back from `agent_quota_snapshots` and report what the run
actually rendered.

#### Shared-viewer (non-owner) evidence needs a second signed-in user — signed-out hits /signin

**Situation:** capturing how a page renders for someone who is NOT the owner of the
object (a shared acceptance link, a workspace-member view), on the local full stack.

**Doesn't work:** a fresh storage-empty agent-browser session. The SPA's `/acceptance`
(and the rest of the main layout) sits behind the client auth gate, so a signed-out
context redirects to `/signin` before the route mounts — `location.pathname` lands on
`/signin` and every "the notice never renders" reading is an artifact of the gate, not
the change under test.

**Works:** seed a second user directly (mirror what `seed-user` writes: a `users` row
with `onboarding` finished + an `accounts` row with a bcryptjs password hash), then
sign that user in from INSIDE the visitor session so the cookies land in it:

```js
await fetch('/api/auth/sign-in/email', {
  body: JSON.stringify({ email, password }),
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  method: 'POST',
});
```

Reload and assert identity with `app-probe.sh auth` before capturing. Use a
run-specific session name, never `lobehub-dev` (that one is the owner).

#### Ambient `LOBEHUB_TOPIC_ID` hijacks a local CLI ingest — strip it for fixture creation

**Situation:** creating a fixture acceptance on the LOCAL dev server with
`bun src/index.ts acceptance run ingest` while running inside a LobeHub conversation
(Claude Code sessions launched from a Topic export `LOBEHUB_TOPIC_ID` /
`LOBEHUB_AGENT_ID` / `LOBEHUB_OPERATION_ID`).

**Doesn't work:** plain ingest. The CLI auto-attaches to the ambient conversation, and
that topic id belongs to PRODUCTION — the local server answers
`topic "tpc_…" not found in the current workspace`, which reads like broken fixture
data rather than an env leak.

**Works:** strip the ambient ids only for the local fixture ingest
(`env -u LOBEHUB_TOPIC_ID -u LOBEHUB_AGENT_ID -u LOBEHUB_OPERATION_ID …`) so it lands
standalone. Keep them for the final PRODUCTION publish of the verification round —
there the auto-attach to the current conversation is exactly what you want.

### Driving the UI

#### The composer's slash menu needs real key events — `keyboard type` never opens it

**Situation:** driving the chat composer's `/` slash menu (or anything else gated on
a Lexical `KEY_DOWN_COMMAND`) through agent-browser.

**Doesn't work:** `agent-browser keyboard type "/"`. It inserts through CDP
`Input.insertText`, which produces no `keydown` at all — verified by installing a
capturing `document.addEventListener("keydown", …)` and watching it stay empty while
the character lands in the composer. The editor's SlashPlugin keeps `suppressOpen`
true until a keydown with `key.length === 1` resets it, so the text appears and the
menu never does. Reads exactly like "the slash menu is broken", which is worse than
a visible failure because the composer clearly received the input.

**Works:** use `agent-browser press '/'` for the trigger (and `press Backspace` to
clear). `press` goes through `Input.dispatchKeyEvent`, so the keydown reaches
Lexical. `keyboard type` remains fine for bulk text that no plugin is gated on —
type the prose with it, but fire any menu trigger with `press`.

```bash
agent-browser --session "$RS" click '[data-probe=composer]'
agent-browser --session "$RS" press '/'   # menu opens
agent-browser --session "$RS" press Enter # selects the highlighted item
```

Confirm the mechanism rather than assuming a menu is missing:

```bash
agent-browser --session "$RS" eval '(() => { window.__KD=[]; document.addEventListener("keydown", e => window.__KD.push(e.key), true); return "installed"; })()'
```

#### An `ActionIcon` is not a `<button>` — select it by its lucide class, click through agent-browser

**Situation:** driving an icon-only affordance inside a popover or panel (`ActionIcon`
from `@lobehub/ui`: refresh, calendar, more, …).

**Doesn't work:** three separate near-misses, each of which reads as "the affordance
does not exist" rather than as a driving error:

- `pop.querySelectorAll('button')` misses it. `ActionIcon` renders a `div`/`span`
  wrapper (`class="lobe-flex …"` around `span.anticon`), so a button-only sweep of a
  popover reports zero controls and invites the wrong conclusion that the entry was
  never rendered.
- `el.click()` on that wrapper `div` resolves and returns, but no handler runs — the
  React `onClick` sits on an inner node, so the tab-clicking recipe above does not
  transfer to icon buttons.
- `agent-browser click --x <n> --y <n>` is not a thing; `click` only takes a CSS
  selector, XPath, or an `@eN` snapshot ref, and coordinates fail with the generic
  `Element not found`, which reads as a missing element rather than a bad invocation.

**Works:** find the icon by its lucide class, tag it, and let agent-browser do the
real click:

```bash
agent-browser --cdp 9222 eval '(() => {
  const pop = [...document.querySelectorAll("[role=dialog]")].pop();
  pop.querySelector("svg.lucide-calendar-days").setAttribute("data-qc", "entry");
  return "tagged";
})()'
agent-browser --cdp 9222 click "[data-qc=entry]"
```

Enumerate candidates with `pop.querySelectorAll("button,[role=button],span[role]")`
and read each node's `svg` class when the icon's identity is unknown. **The class is
the icon's _rendered_ lucide name, not the React symbol you imported** — a component
imported as `MoreHorizontalIcon` renders `svg.lucide-ellipsis`, so a selector guessed
from the import name matches nothing and reads as "the affordance was never rendered".
Enumerate the classes present, then disambiguate duplicates by geometry (a header
control is the top-most, right-most non-zero rect) rather than by DOM order. Two follow-ons
worth knowing: a stray click on a tagged text node can dismiss the popover (re-open
and re-tag rather than assuming the control vanished), and a `Tooltip`-wrapped cell
needs a real pointer move (`Input.dispatchMouseEvent` over several coordinates, or a
dispatched `pointerover`+`mouseover` pair) before its content mounts.

#### A node reference captured before a re-render is silently dead — re-query per assertion

**Situation:** asserting several tab-strip interactions (close, pin, switch) in one
`agent-browser eval` payload, reusing the element list collected at the top.

**Doesn't work:** collecting `roots` once and then acting on `roots[0]`, `roots[1]`, …
in sequence. Each action that mutates the tab list re-renders the strip, so every
reference collected earlier now points at a detached node. Dispatching to a detached
node throws nothing and changes nothing — React never sees it — so the assertion reads
as "this interaction does not work". In this catalogue's first occurrence it produced a
confident "middle-click does not close a pinned tab" that was purely an artefact of the
stale reference, and it survived review because the number looked plausible.

**Works:** one assertion per `eval`, re-querying the strip each time. When several must
share a payload, re-query between actions and assert `el.isConnected` before dispatch.
The same applies to any probe whose own action re-renders the tree it is measuring.

#### Anchor nav-panel assertions on `#nav-panel-drawer`, not a `data-insp-path` match

**Situation:** asserting what the left nav panel renders on a given route.

**Doesn't work:** `document.querySelector('[data-insp-path*="NavPanelDraggable"]')`.
It resolves during a settled render but returns `null` in the seconds after a full
reload, and the usual `|| document.body` fallback then reads
`document.body.innerText === ''` (generic C4) — which looks exactly like an empty
panel and turns a normal loading window into a false regression.

**Works:** the panel is the `<aside>` sibling of the stable drawer anchor:

```js
const drawer = document.getElementById('nav-panel-drawer');
const aside = drawer && [...drawer.parentElement.children].find((c) => c.tagName === 'ASIDE');
```

Then assert on `aside.innerText` line count plus a count of text-free rounded boxes
(the skeleton rows). Distinguish the two skeleton states explicitly: a text-free panel
carrying `[data-testid="nav-sidebar-skeleton"]` is the nav-panel fallback, while fixed
items present with only the list area shimmering is ordinary data loading. Do NOT
identify the fallback by a row count — it is shaped per navKey now
(`NAV_SKELETON_SHAPES`), so memory/discover render header plus a nav list and no body
at all, while settings renders a search box plus four accordion groups.

#### Hold a route's Suspense fallback by parking its data request

**Situation:** the route skeleton is now held by data (`SWRConfig{ suspense: true }`
at the layout), not only by the lazy module, so parking the chunk no longer keeps it
on screen once the module is cached. The fallback lasts a few hundred ms.

**Works:** park the route's own tRPC call with raw CDP `Fetch.enable` — the skeleton
stays up until the request is released, so it can be measured and screenshotted at
leisure. `.agents/acceptance/scripts/park-request.cjs <browser-ws> <urlPattern> <holdMs>`
does this against an `agent-browser` session:

```bash
node .agents/acceptance/scripts/park-request.cjs \
  "$(agent-browser --session lobehub-dev get cdp-url)" '*trpc/lambda/aiProvider*' 25000
```

Name the route's **own** query in the pattern (`aiProvider*` for the provider page).
A broad `*trpc*` parks the shell's queries too and the route never mounts, which reads
as a product hang. For the error state, prefer `agent-browser network route <pattern> --abort` — an aborted request settles, so the boundary renders instead of hanging.

#### `SWRConfig` reaches hooks below it, never the component that renders it

**Situation:** opting one page out of a subtree's suspense (a page whose sections are
gated independently and must keep their own Retry).

**Doesn't work:** wrapping that page's own JSX in `<SWRConfig value={{ suspense: false }}>`.
The page's hooks run in its component body, which is _above_ the element it returns, so
they still read the subtree's config and the page keeps suspending. The symptom is a
whole route thrown to the error boundary the first time one section's fetch fails.

**Works:** move the hooks into a child component and wrap that child. Verify by failing
one section's request and confirming the rest of the page still renders.

#### Park a route's lazy chunk to hold its pending sidebar on screen

**Situation:** verifying what a route's `NavPanel` fallback (or any `dynamicElement`
Suspense fallback) actually renders. The pending state lasts a few hundred ms, so no
screenshot or `agent-browser eval` catches it.

**Doesn't work:** network throttling, or adding a debug flag that force-renders the
fallback. Throttling does not bound the module fetch predictably, and a force-render
flag proves the component renders, not that the product path reaches it.

**Works:** raw CDP `Fetch.enable` intercepts `app://renderer/...` module requests in
the Electron renderer. Park the route's layout chunk and the portal never registers,
so the fallback stays up indefinitely — measure and screenshot at leisure, then kill
the CDP connection to release the request and measure the settled sidebar in the same
session.

```js
Fetch.enable({ patterns: [{ requestStage: 'Request', urlPattern: '*settings/_layout*' }] });
// on Fetch.requestPaused: keep the requestId, never continueRequest
// [paused] app://renderer/src/routes/(main)/settings/_layout/index.tsx?t=1785957215039
```

Two traps. The pattern must name the **layout** chunk only: a broad `*settings*`
also parks `store/user/slices/settings/*` and the router's own `routeMeta`, which
stalls boot instead of the route. And the layout module is not always under the path
you guess — the agent sidebar registers from `(main)/agent/_layout`, not
`(main)/agent/(chat)/_layout`; when the measurement comes back `mode: real`, the
pattern missed, it is not a product finding.

Drive the navigation with `app-probe.sh goto <route>` (a full reload, so the module
is re-requested and re-parked).

#### Document-tree evidence: seed fixtures by path, drive through the shadow DOM, and note that heterogeneous Agents have no Documents tab

**Situation:** verifying how `DocumentExplorerTree` renders (the left column of
`/agent/:id/docs`, and the Documents tab of the conversation's right-hand working
sidebar), which needs a document tree with real nesting.

**Doesn't work:** three separate things that each send you the wrong way.

- Building the fixture with `agentDocument.createDocument`. Its input is only
  `agentId/title/content` — no `parentId`, no `isFolder` — so it can only produce a
  flat list and never exercises hierarchy.
- Clicking tree rows with `agent-browser click '<selector>'`. pierre/trees is a web
  component and every row lives inside the shadowRoot of `file-tree-container`, so
  document-level selectors match nothing, which reads as "those rows do not exist".
- Looking for the Documents tab inside a heterogeneous Agent's conversation (Claude
  Code and friends). `WorkingSidebar`'s tabs are
  `['skills', ...(isHetero ? [] : ['documents', 'web'])]`, so a heterogeneous Agent
  only has the Skills tab: `setWorkingSidebarTab('documents')` is written to the store
  but has no panel behind it, and
  `document.querySelectorAll('file-tree-container').length` stays 0.

**Works:**

1. Write through the VFS by path — `recursive: true` creates the whole nested
   directory in one call (hit the local tRPC directly with a better-auth cookie minted
   the same way `web-seed` does):

```bash
curl -s -b "$JAR" -H 'Content-Type: application/json' -X POST \
  "$BASE/trpc/lambda/agentDocument.mkdirDocumentByPath" \
  --data '{"json":{"agentId":"'"$A"'","path":"pitchdeck/archive/positioning","recursive":true}}'
curl -s -b "$JAR" -H 'Content-Type: application/json' -X POST \
  "$BASE/trpc/lambda/agentDocument.writeDocumentByPath" \
  --data '{"json":{"agentId":"'"$A"'","path":"pitchdeck/archive/x.md","content":"# x","createMode":"if-missing"}}'
```

2. The stable handle for a row is `data-item-path` (directories carry a trailing `/`),
   and `el.click()` is enough to expand it — pierre listens on native DOM rather than
   being a controlled React component, so the general "trusted events only" rule (D11)
   does not apply here. The criterion is `aria-expanded` flipping from `false` to
   `true`:

```js
const sr = document.querySelector('file-tree-container').shadowRoot;
const el = sr.querySelector('[data-type=item][data-item-path="pitchdeck/archive/"]');
if (el.getAttribute('aria-expanded') === 'false') el.click();
```

3. To verify the second rendering surface, switch to a non-heterogeneous Agent and
   call `toggleRightPanel()` before `setWorkingSidebarTab('documents')`; the latter
   alone does not open the panel.

4. Do not measure layout from the `innerText` of `[data-item-section=content]` — it
   holds several measurement copies produced by `MiddleTruncate`, so the text repeats
   and every copy contains `…`; counting truncated rows that way always matches
   everything. To decide whether a row is really truncated, take the `…` node whose
   `width > 0` and whose `checkVisibility()` is true, and confirm visually against the
   screenshot. For indentation, read the content-box `x` and diff it level by level —
   that difference is the real step.

#### Restyling ExplorerTree: pierre's focus state and truncation mask have two counter-intuitive contracts

**Situation:** tuning `ExplorerTree` (pierre/trees) appearance through `unsafeCSS` /
`--trees-*` variables — removing the focus highlight, changing truncation behaviour,
recolouring row states.

**Doesn't work:**

- Using `:not(:focus-visible)` to "drop the focus ring for mouse only, keep it for the
  keyboard". pierre calls `focus()` on a row when it is clicked, and Chromium still
  treats that row as `:focus-visible` on this path (measured:
  `el.matches(':focus-visible')` is `true`), so the suppression rule never matches and
  the border appears as before. The screenshot looks like "the change had no effect"
  when in fact the selector simply did not apply.
- Setting the row background to `transparent` (to let the panel colour show through)
  without also handling truncation. pierre's ellipsis is **absolutely positioned on top
  of the characters it replaces** and relies on
  `--truncate-marker-background-color` to mask them, which defaults to `--trees-bg`.
  Make the row transparent and the mask has no colour to paint, so the ellipsis sits
  directly on the text — it renders as "the text is hard-clipped with no ellipsis" and
  is easily misread as broken truncation logic.
- Fixing the previous point by hard-coding the mask to one design token. The two host
  panels of the document tree do not share a background: the docs-page left column
  measures `rgb(0,0,0)` (colorBgLayout) while the conversation's right-hand working
  sidebar measures `rgb(13,13,13)` (colorBgContainer). Pick either one and the other
  surface gets a visible colour block behind its ellipsis.
- Trying to "reserve a column" for the ellipsis to avoid overlapping glyphs
  (`grid-template-columns: minmax(0,max-content) 1.25em`). That column applies to
  **every** row, and `MiddleTruncate` renders the title as two segments, so every title
  gets a hole punched in the middle (`pitch    deck`) — for names without an extension
  the split point is the midpoint, so the hole lands mid-word.

**Works:**

- Focus ring: set `outline: none` in every state and restore keyboard visibility with a
  background instead
  (`[data-item-focused='true']:not([data-item-selected='true'])` gets `--trees-bg-muted`).
- Mask colour: at runtime, walk up from the container to the first non-transparent
  `backgroundColor` and write it into your own variable rather than using a fixed token
  (`usePanelBackground`). A third host panel then needs no further change.
- Truncation direction: `FileTreeView` hard-codes `MiddleTruncate split:"extension"`
  and `FileTreeOptions` exposes no truncation option, so the only lever is the two flex
  weights in its own styles — `[data-truncate-segment-priority='1'|'2']` are "shrink
  last" and "shrink first". Swap them and the stem segment keeps its width and shows
  its own trailing ellipsis while the extension segment is squeezed to 0, turning a long
  title from `… carrying md` into `… carrying…`. One residue to watch: when the overflow
  is smaller than the extension's width the extension is only partly squeezed, and
  because it is laid out rtl its last character leaks through — cover it by pulling that
  segment's mask to `inset: 0` inside pierre's own overflow container query
  (`@container measure (height > 1lh)`).
- To actually remove the indent guides, set
  `--trees-indent-guide-bg-override` to `transparent`; setting `spacing-item`'s
  `opacity` to 0 is not enough — pierre has two more rules ("reveal on tree hover" and
  "highlight the focused row's ancestors") that push the opacity back to 1.

#### Skill-menu interaction bugs depend on the shape of the user's data — foreground the MCP window and reproduce with zero-write clicks

**Situation:** reproducing a row-level interaction defect in the `+` menu / skills
submenu (hover detail card, the `...` policy menu, the uninstall confirmation). The
local seeded full stack survives the entire gesture matrix (rapid policy switching,
popover switching, disabling, the uninstall dialog, an injected 700ms server delay),
while the user's environment triggers it immediately.

**Doesn't work:** enumerating gesture permutations locally. The row shape that
triggers the defect exists only in real account data — an expired-authorization
Composio row (Gmail re-authorization), for example, renders through `PopoverLabel`
rather than `SkillRow`, and a local seeded account only has builtin rows, so the
detail card never even mounts. Do not draw conclusions from a background MCP tab
either (L-S10): popovers freeze at `data-starting-style`, coordinate clicks do
nothing, and timers are clamped to 1s.

**Works:** three things together. (1) Have the user bring the Chrome window the
extension opened to the foreground, and only drive it once
`document.visibilityState === 'visible'` and DevDock shows 60 FPS — a foregrounded MCP
tab is a fully trustworthy interaction surface. (2) Reproduce on the production
account with zero writes: in the policy menu click only the **already-selected** item
(`updateSkillPolicy` returns early when `currentMode === mode` and sends no request),
always dismiss confirmation dialogs with Cancel, and rely on the fact that opening and
closing menus writes nothing. (3) Attribute the mechanism with in-page event evidence
— record a profile of each pointer/focus event target at the document capture phase
(`closest` role, `inDialog`, `isConnected`) into a `window.__AGENT_LOGS` ring buffer,
and record the close reason directly from `onOpenChange(details.reason)`; screenshots
alone cannot separate outside-press from focus-out from hover-out.

### Rendering messages and tool calls

#### Message-attached heterogeneous-agent errors

Inject a temporary assistant message through
`chat().internal_dispatchMessage`, then attach an `AgentRuntimeError`. Supported
guide codes are `auth_required`, `cli_not_found`, `overloaded`, and `rate_limit`;
other values follow the generic error path. Use a unique content marker, verify the
real rendered card, and delete the temporary message afterward.

#### Agent Mock playback leaves `pluginState` empty — backfill it before capturing pluginState-driven renders

**Situation:** verifying a builtin-tool Render/Inspector (lobe-agent todos, plans —
anything reading `message.pluginState`) with DevDock → Agent Mock case playback as
the deterministic driver (no LLM).

**Doesn't work:** capturing right after playback. The mock pipeline writes each
tool step's `result` into the tool message `content` only and never sets
`pluginState`, so a Render keyed off `pluginState` mounts empty (expanded rows
show nothing) and inspectors fall to their no-data fallback. Reads as "the new
rendering is broken" when the components are fine. Also note: consecutive todo
tool rows are folded into the latest by the conversation UI, so early-state rows
may never mount.

**Works:** after playback completes, backfill in-memory from each message's own
result JSON, at the layer the Render actually reads:

```js
const c = window.__LOBE_STORES.chat();
const msgs = c.dbMessagesMap['main_<agentId>_<topicId>'];
for (const m of msgs.filter((m) => m.role === 'tool' && m.plugin)) {
  const parsed = JSON.parse(m.content);
  if (parsed?.todos)
    c.internal_dispatchMessage({
      type: 'updatePluginState',
      id: m.id,
      key: 'todos',
      value: parsed.todos,
    });
}
```

To render a payload the case doesn't cover (another builtin tool, a specific
state), payload-swap an already-MOUNTED mock row in place — update BOTH the
assistant's `tools[]` entry (`updateMessageTools`, keyed by `tool_call_id`; this
is what selects the Render component) and the tool message (`updateMessagePlugin`

- `replaceMessagePluginState`). Dispatching brand-new messages at the end of the
  list may never mount. Claude Code builtin payloads use `identifier: 'claude-code'`
  (NOT `lobe-claude-code`) and PascalCase `apiName` (`TodoWrite`). All of this is
  in-memory only — a reload clears it; delete the temp topic at teardown.

#### Verifying a builtin-tool Render with no provider key — dispatch a fresh assistant+tool pair

**Situation:** verifying a builtin tool's Render / Streaming component when the local
env has no LLM provider key, so no real model can be made to emit that tool call
(and update/remove-style APIs would need pre-existing entity ids anyway).

**Doesn't work:** waiting for a real run, or reaching for Agent Mock when no case
covers the tool. Note the neighbouring Agent Mock entry warns that "dispatching
brand-new messages at the end of the list may never mount" — that holds for a
long, already-populated mock topic, **not** for an empty conversation.

**Works:** open a conversation with no messages (`/agent/<agentId>`, bucket
`main_<agentId>_new`) and dispatch the pair straight in. The Render is selected from
the **tool message's** `plugin.identifier` + `plugin.apiName`, and its `args` come
from `safeParseJSON(plugin.arguments)` — so those three fields are the whole
contract:

```js
const c = window.__LOBE_STORES.chat();
c.internal_dispatchMessage({
  type: 'createMessage',
  id: aId,
  value: {
    role: 'assistant',
    content: '',
    meta: {},
    tools: [
      { apiName, arguments: argsJson, id: callId, identifier, result_msg_id: tId, type: 'builtin' },
    ],
  },
});
c.internal_dispatchMessage({
  type: 'createMessage',
  id: tId,
  value: {
    role: 'tool',
    content: resultText,
    parentId: aId,
    tool_call_id: callId,
    plugin: { apiName, arguments: argsJson, identifier, type: 'builtin' },
    pluginState,
  },
});
```

Two things that decide what you actually see, both in
`features/Conversation/Messages/AssistantGroup/Tool/`:

- **The row is collapsed unless the manifest says otherwise.** `getRenderDisplayControl`
  defaults to `'collapsed'`, so most tools need a click on the header before the card
  mounts — a screenshot taken right after dispatch shows only the Inspector line.
- **Truncating `arguments` into invalid JSON is how you reach the Streaming component.**
  `isArgumentsStreaming` is literally `JSON.parse(requestArgs)` throwing, and
  `forceShowStreamingRender` then auto-expands the row. Slicing the real args string
  to \~55% is a faithful half-streamed payload and also exercises the card's
  partial-data path.

Toggling the row's first action button flips `showCustomToolRender`, which drops back
to `FallbackArgumentRender` — the same branch an unregistered tool takes, so it is a
faithful "before this change" contrast shot.

Three more things decide whether the **Inspector line itself** is even on screen —
they bite when the assertion is about the inspector row, not the Render card:

- **The AssistantGroup collapse hides the whole inspector line**, one layer above the
  Render's own collapse. A settled group renders as a summary chip (`共运行 N 步`,
  or `N 次调用：…` once several tools share one assistant) and `innerText` then has
  no trace of the tool name at all — reading as "the dispatch never rendered". Click
  the summary chip first, then wait for the expand transition to settle: an
  immediate screenshot catches the first row half-slid under the sticky summary.
- **One assistant with N `tools[]` entries is the shape worth dispatching.** N
  separate assistant messages give N single-step groups, each needing its own click
  and each rendering its own avatar row; one assistant carrying all the tool calls
  reproduces the real multi-tool step layout in a single expandable group.
- **The expanded group gets its own inner scroller** (roughly 230px). The last rows
  sit below its fold while the page around it still has empty space, so evidence
  needs one capture per scroll position — set `scrollTop` on every element whose
  `scrollHeight > clientHeight`, not just the message list.

Finally, an HMR update to any module in the rendered chain **wipes the in-memory
fixture** and drops the conversation back to its welcome state. For a before/after
code A/B, re-dispatch after each edit rather than expecting react-refresh to keep
the messages — and re-run the identical dispatch + expand + scroll sequence on both
sides so the two frames differ only by the change.

#### A client bucket that keeps reverting mid-run is the gateway `uiMessages` snapshot, not your write

**Situation:** a store bucket (`dbMessagesMap[<key>]`) holds the right messages right
after a gateway send, then silently loses them a second or two later and stays wrong
for the rest of the session — while the database is correct the whole time.

**Doesn't work:** treating it as a race in your own write and adding another
`replaceMessages` / refetch earlier in the flow. The overwrite happens _after_ every
write you control, so each new attempt is undone the same way. It also looks like a
stale SWR tier (which it is not — a manual `refreshMessages()` fixes it, so the
server clearly has the data).

**Works:** the server pushes a canonical `uiMessages` snapshot at `step_start` and
`agent_runtime_end`, and `gatewayEventHandler` applies it as source of truth. That
snapshot is built by `AgentRuntimeService.queryUiMessages` from the operation's
`state.metadata`, so it is only as scoped as that metadata — a field the run needs
but the snapshot query omits makes every step boundary overwrite the bucket with a
_differently scoped_ message list. Identify the writer instead of guessing: record
every `replaceMessages` call with `new Error().stack` into a `window.__RM` ring
buffer, run the flow once, and read `action` (`gateway/step_start`,
`gateway/agent_runtime_end`) plus the frame. The `action` label alone names the
culprit. Verified in this catalogue: a subtopic run whose snapshot lacked `threadId`
kept replacing the thread's bucket with the topic's main spine.

**Corollary — use the non-gateway path as the control.** The same UI action with
`chatConfig.disableGatewayMode = true` runs through `sendMessageInServer` and never
applies a pushed snapshot. If the behavior is correct there and wrong in gateway
mode, the defect is in the gateway transport or in the server snapshot, and you have
halved the search space before reading any code.

#### `curl /health` does not prove the local agent-gateway trusts your key — run the JWT probe

**Situation:** restarting the local agent-gateway between acceptance rounds and
gating on `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/health`.

**Doesn't work:** treating a 200 as "the closed loop is up". `/health` answers before
any key is checked, so it is equally 200 when `.dev.vars` carries a JWKS that has
nothing to do with the app's. The failure then surfaces far from its cause: runs
complete server-side (`agent_operations` = `done`, full content in `messages`) while
the browser's `execServerAgentRuntime` op ends after \~100ms, the assistant bubble
stays on the `...` placeholder for the rest of the session, and a cold reload shows
the reply — reading exactly like a client-side streaming regression in the branch
under test. The tells are `chat().gatewayConnections === {}`, no `GET /ws` in the
gateway log (only server→gateway `push-event` lines, which use the static service
token and keep working), and `[Gateway] Auth failed ... signature verification
failed` in the browser console.

**Works:** after every gateway (re)start, run the decisive handshake and require
`auth_success` before collecting any evidence:

```bash
GATEWAY_PORT= < port > .agents/acceptance/scripts/agent-gateway/local-gateway-setup.sh
GATEWAY_WS=ws://localhost: .agents/acceptance/scripts/agent-gateway/local-gateway-probe.mjs < port > node
```

`.dev.vars` is regenerated per app instance, so restoring it at teardown (or another
worktree regenerating it) silently invalidates it for the next run — compare the
`kid` in `agent-gateway/.dev.vars` against `.records/env/agent-testing-jwks.json`
when in doubt.

#### A required local service can be someone else's, and `preflight` will not tell you

**Situation:** starting QStash / s3rver for a run through `init-dev-env.sh` in a
worktree while another agent-testing session is already active on the machine.

**Doesn't work:** trusting that a backgrounded `init-dev-env.sh qstash` (or `s3`)
came up because `preflight` then reports the service reachable. Both use fixed ports
(8080 / 29000), so the second starter dies immediately with
`address already in use` while the sibling session's process keeps answering — and
`preflight` is a reachability check, so it passes. The run works, but on services it
does not own.

**Works:** read the start log before assuming ownership
(`.records/logs/qstash.log`, `.records/logs/s3.log`), and treat "already in use" as
"this is not mine". It matters at teardown: stopping a service you did not start
kills the other session's run. Only the dev server (`stop-dev`, which verifies PID
ownership) and anything you launched on a port you chose yourself are yours to stop.

#### Infinite-scroll failure states

When the fixture is too short for the observer to fire, call the real load-more
store action rather than pretending to scroll. This covers the request, catch
path, and rendered retry row; it does not prove the observer gate itself. Use a
scrollable fixture when the observer behavior is the claim.

#### Safe mutation-error injection against a real (cloud) account

To exercise a mutation error branch when the app points at the user's real cloud
backend, replace the react-query `mutationFn` body with an immediate
`Promise.reject(...)` via HMR — the mutation then fails before ANY network call,
so clicking a real row (even the user's own data) has zero server effect. Switch
error shapes through a window flag (e.g. plain `Error` vs
`{ data: { code: 'FORBIDDEN' } }`) and prove HMR liveness with a module-level
marker before clicking. Snapshot the dirty file first and restore byte-identically
(cmp), never `git checkout --`.

#### Render Gallery shows "No builtin tool renders registered." after a reload

**Situation:** driving DevDock → Render Gallery to capture builtin-tool
Inspector/Render evidence, after a renderer reload or an HMR update.

**Doesn't work:** waiting. The gallery reads the builtin registries once through a
`useMemo` with an empty dependency list, so a panel that mounts before the builtin
tools finish registering caches an empty list for the lifetime of that mount. It
renders "No builtin tool renders registered." indefinitely, which reads like the
registries themselves broke.

**Works:** remount the panel — click the dock's `Render Gallery` button twice
(close, reopen) and re-select the toolset; the entries appear immediately. To land
on the gallery straight after a reload, pre-seed the dock instead of clicking
through it:

```js
localStorage.setItem(
  'LOBE_DEV_DOCK_UI',
  JSON.stringify({
    ...JSON.parse(localStorage.getItem('LOBE_DEV_DOCK_UI') || '{}'),
    activePanelId: 'render-gallery',
    expanded: true,
    maximized: true,
  }),
);
```

### Capturing and publishing evidence

#### Reading a transitioned CSS property immediately after focus/hover

**Situation:** asserting that a `:focus-within` / `:hover` rule reveals a
control.

**Doesn't work:** `getComputedStyle(el).opacity` read in the same tick as the
focus call, or in a separate `agent-browser eval` that races the re-render which
mounts the control. Both return the pre-transition `0` while the rule is in fact
matching.

**Works:** focus and read inside one `eval`, wait past the transition duration,
and assert the untransitioned property too (`width`) plus
`el.matches('<selector>:focus-within')` so a mid-transition value cannot be
mistaken for a non-matching rule.

#### Leftover React Scan instrumentation poisons every screenshot

**Situation:** capturing UI evidence in a dev instance the user (or an earlier
round) had DevTools / the DevDock open on.

**Doesn't work:** deleting the overlay canvas (`html > canvas`) once and
screenshotting. React Scan re-creates it on the next render pass, so a probe that
reports `0 canvases` a few seconds later is only measuring that nothing
re-rendered in that window — the outlines return the moment the app updates.
`localStorage` is also not a reliable read: `react-scan-options.enabled` and
`LOBE_DEV_DOCK_UI.reactScan` can both say `false` while the instrumentation is
live, because it was enabled at runtime and never written back.

**Works:** inject a capture-time style rule instead of removing nodes —
`html > canvas { display: none !important; }` appended to `documentElement`. It
survives re-creation, touches no product code or styles, and disappears on
reload. Remove it at teardown. Disclose it in the report: it suppresses a dev
overlay, which is a capture-time adjustment a reviewer should know about.

#### Counting section instances across the Home rail collapse needs real visibility, not a rect

**Situation:** asserting that a Home section moved between the rail and the main
column rather than being duplicated or lost.

**Doesn't work:** two independent traps, each of which inverts the verdict.

- Filtering candidates by `getBoundingClientRect()` alone. The collapsed rail is
  hidden with `visibility: hidden` after a transition, and a `visibility: hidden`
  subtree **keeps its layout boxes** — so the rail's copy still measures non-zero
  and every folded-in section reads as duplicated. This is the inverse of the
  generic D12 phantom (zero-size decoy); here the stale node is full-size.
- Collecting only leaf elements. The main column's `GroupBlock` renders its
  subtitle as a `<span>` inside the title, so the title element has children,
  while the rail's `RailCard` takes no subtitle and its title _is_ a leaf. A
  leaf-only walk therefore finds a section in the rail and "loses" it in the main
  column — reading exactly like the fold-in never happened.

**Works:** match on the element's own direct text nodes and gate on
`el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })`, then sort
by viewport `y`:

```js
const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
if (!label.test(own)) continue;
if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
```

Assert both columns in the same pass — a claim about _moving_ is only settled by
observing the source column go empty and the destination fill in one snapshot.

#### Boot-phase UI cannot be observed by CDP polling — sample in-page, and mirror the timer

**Situation:** asserting whether a transient boot-phase surface (a splash, a skeleton,
a first-paint gate) appears between React's first commit and the app painting.

**Doesn't work:** polling `Runtime.evaluate` from a CDP driver, even at a 50ms step.
The desktop renderer's boot spends multi-second stretches in a single synchronous
task, and every `Runtime.evaluate` queues behind it — the driver observes the state
before the window and again after it, and reports the phase "never happened". CPU
throttling makes it worse: it stretches the blocking task and the probe equally.

**Works:** inject a pure observer with `Page.addScriptToEvaluateOnNewDocument` and
sample from inside the page. Note `document.documentElement` does not exist yet in an
on-new-document script, so a `MutationObserver` cannot be attached there — use
`setInterval(check, 8)`. Record the largest gap between consecutive ticks: that gap
is the main thread's longest blocking task, and a boot window with no intermediate
sample is a blocked window, not a missing state.

When the behavior under test is time-thresholded, also **mirror the product's own
timer**: at the moment the observer first sees `#root` gain a child, schedule the same
`setTimeout(…, N)` the component uses and record when it actually fires. On a blocked
main thread it fires far later than `N` — which is the difference between "the
threshold logic is wrong" and "the threshold never had a chance to run", and no
screenshot can tell those apart.

**When the driver has no CDP (claude-in-chrome, the debug proxy), deliver the same
sampler through Vite instead**: a temporary `[AGENT-TEST]` block at the top of
`src/spa/entry.{web,desktop}.tsx` runs at bundle-eval — early enough for every
post-React phase — and needs no `Page.addScriptToEvaluateOnNewDocument`. Two things
to get right in the phase predicate: scope any `[role="status"][aria-label="Loading"]`
check with `.closest('#loading-screen')` so the **static HTML shell's own logo** is not
counted as the React `BrandTextLoading` (they share the same role/label, and conflating
them turns a clean boot into a false "the logo flashed"); and record the max gap between
consecutive ticks — LobeHub's boot routinely shows a single 0.6–1.1s blocking task, so a
phase with no sample inside it is a blocked window, not a missing state.

#### Asserting a modal's exit window: `data-ending-style` is never set, and `record-gif.sh` is far too slow

**Situation:** proving what a base-ui modal does during its \~120ms exit — typically that the body
stays mounted while the panel fades, rather than blanking at the start of the animation.

**Doesn't work:** three separate traps.

- Gating on `panel.hasAttribute("data-ending-style")`. `base-ui/Modal/style.mjs` does carry a
  `[data-ending-style]` rule, but the imperative host animates through motion/react, so the
  attribute stays absent for the whole exit. Filtering samples on it yields an empty set and reads
  as "the exit never happened".
- Polling the state from the driver. A `Runtime.evaluate` round trip is the same order of magnitude
  as the window itself, so the driver only ever observes before and after.
- `scripts/record-gif.sh`. Its own header caps effective rate at 1–2 fps; a 120ms window gets at
  most one frame.

**Works:** sample inside the page and capture frames from the compositor.

```js
// exit-window signal = opacity decay on popupInner ([role=dialog] > :first-child)
const tick = () =>
  samples.push({
    t: performance.now() - t0,
    connected: panel.isConnected,
    opacity: getComputedStyle(panel).opacity,
    panelH: panel.getBoundingClientRect().height,
    contentKids: content.children.length,
    contentTextLen: content.innerText.length,
  });
setInterval(tick, 8);
```

A body that survives the exit holds `contentTextLen` / `contentKids` constant while opacity decays,
and the panel shrinks only \~1.5% (the `scale(0.98)` exit transform) instead of collapsing to the
56px header. For the visual half, drive raw CDP `Page.startScreencast` (frames land only when the
compositor paints, so they cluster inside the animation — \~9 frames in the 120ms window) and replay
those unmodified frames slowly with ffmpeg. Do not slow the product's own transition: the exit is a
JS animation, so a CSS `transition-duration` override does nothing anyway.

#### Switching web-session theme for dark-mode evidence needs no UI — next-themes reads `localStorage.theme`

**Situation:** capturing light- and dark-mode evidence in the seeded `agent-browser`
web session (settings UI navigation is slow and the theme control moved between
releases; an earlier round wrongly concluded the web session "cannot switch to
dark").

**Doesn't work:** driving the settings UI to flip appearance, or editing user
settings server-side (the provider is `next-themes` with `defaultTheme="system"` —
the server does not own it).

**Works:** set the next-themes key directly, then reload the target route in the
same session:

```bash
agent-browser --session lobehub-dev eval "localStorage.setItem('theme','dark')"
agent-browser --session lobehub-dev open "$SERVER_URL/<route>" # re-render applies html[data-theme]
```

`'light'` / removal (`localStorage.removeItem('theme')` → back to system) work the
same way. Restore BEFORE stopping the dev server — once the server is down the
document becomes sourceless and `localStorage` access throws SecurityError, so the
override stays behind for the next run. Assert the applied theme via
`document.documentElement.dataset.theme`, not the storage value.

#### Workspace HTML publish: prove the hosted page, not the local preview

**Situation:** after publishing workspace HTML, checking whether CSS/SVG/images
actually load on the public Artifact URL.

**Doesn't work:** grepping the in-app HTML preview, or treating `app.css` /
`dot.svg` HTTP 404 on the host as failure after a successful inline publish.
Those paths are not uploaded when files are inlined. Opening a relative
`index.html` tab (instead of the Files-tree absolute path) also fails to load
and hides the publish control.

**Works:** click the Files-tree row so `openLocalFiles[].filePath` is the
Electron absolute path (on macOS often `/private/tmp/...`). After publish,
`curl` the public URL and assert the HTML no longer contains `./app.css`. Then
open that URL and assert computed CSS plus `img.naturalWidth > 0`. If the hosted
`<img>` is a data URI with `text/plain`, the image is broken even though it is
not a 404.

#### `acceptance run ingest` is creative — re-running it to re-read its output mints a duplicate round

**Situation:** after a successful ingest, wanting to re-check a field from its JSON
output (evidence count, acceptanceId).

**Doesn't work:** running the same `ingest` command again "just to see the output".
Every invocation creates a new immutable round on the acceptance — the re-run
publishes a byte-identical duplicate round that reviewers then see twice.

**Works:** re-read state with the read-only commands — `acceptance run list`,
`acceptance run get <runId>`, `acceptance view <id> --json`. If a duplicate was
minted by mistake, `acceptance run delete <runId> --yes` (newest timestamp = the
accident) restores the round history; this is data correction of an operator
error, distinct from the forbidden overwrite-a-real-round.

### Electron and the desktop shell

#### Which entry the dev Electron main window loads is NOT stable — measure it, never assume

**Situation:** verifying anything that lives in `src/spa/entry.desktop.tsx` (bootstrap
identity, adapter registration, boot marks) on an `electron-dev.sh` instance.

**Doesn't work:** assuming any particular entry, in either direction. This has now been
measured with two different results on the same helper:

- Earlier: the main window's entry script was `app://renderer/src/spa/entry.web.tsx`
  while the topicPopup window in the same instance loaded `entry.popup.tsx` — so the
  main window fell through to the root `index.html`. Consequence at the time:
  desktop-entry boot code never executed in dev, and a deletion there passed every dev
  smoke test, which is how one such call was lost for a whole release.
- 2026-08-05, on `feat/home-customize-modal`: the main window loaded
  **`app://renderer/src/spa/entry.desktop.tsx`** — the fall-through did not reproduce.

Mechanism not established in either direction, and no bisect was done, so do not
assume the newer reading is permanent either. Treat the loaded entry as an unknown to
be measured per run — that is the durable rule; the specific value is not.

**Works:** before claiming anything about a desktop entry, read the loaded entry script
and branch on it:

```js
[...document.querySelectorAll('script')].map((s) => s.src).find((s) => s.includes('entry.'));
```

If it is not the entry you are testing, the surface cannot prove your claim — fall back to
a source-order regression test, and say in the report that the runtime path needs a
packaged build (`DESKTOP_RENDERER_STATIC` / `resolveRendererFilePath` maps
`apps/desktop/index.html`, `popup.html`, `overlay.html`).

#### Measuring production-bundle startup behavior without packaging the app

**Situation:** a claim depends on the built renderer (chunk splitting, lazy-route
boundaries, startup paint timing), which dev-mode Vite cannot reproduce.

**Doesn't work:** measuring in the dev instance (unbundled modules make lazy vs
eager indistinguishable), or trusting `performance.getEntriesByType('resource')`
to identify what loaded — the `app://` protocol emits no resource-timing entries
at all (0 JS resources on a fully loaded page).

**Works:** build the renderer (`cd apps/desktop && vite build --config
vite.renderer.config.ts`), then launch a pool instance with the static override:

```bash
DESKTOP_RENDERER_STATIC=1 .agents/acceptance/scripts/electron-dev.sh start 1
```

The dev main process serves `apps/desktop/dist/renderer` over `app://renderer/`
with the seeded login. Prove which build is loaded via the modulepreload hashes
in the live DOM, not resource timing:

```js
[...document.querySelectorAll('link[rel=modulepreload]')]
  .map((l) => l.href)
  .find((h) => h.includes('<chunk-under-test>'));
```

Paint metrics survive post-hoc collection: a buffered
`PerformanceObserver({ type: 'largest-contentful-paint', buffered: true })` plus
`performance.getEntriesByType('paint')` read after load give FCP/DCL and the full
LCP-candidate timeline. `restart 1` re-seeds userData, so each restart is a
comparable cold start; `location.reload()` gives low-variance warm samples. For
A/B builds, swap `dist/renderer` directories between restarts — remote-image LCP
entries are network-noisy, so compare text-paint candidates and DCL across ≥5
cold samples per variant before attributing a delta.

#### Driving and probing a real Electron popup window

**Situation:** verifying `entry.popup.tsx` behavior (its own HTML shell, no `BootShell`).

**Works:** open the real window from the renderer store, then attach raw CDP to the
popup's own target — the agent-browser daemon holds the main window's target, and one
page target accepts only one websocket:

```bash
agent-browser --cdp 9222 eval '(async () => {
  await window.__LOBE_STORES.global().openTopicInNewWindow("inbox","verify-popup");
  return "requested"; })()'
curl -s http://127.0.0.1:9222/json/list # pick the target whose url contains /popup/
```

Any `(agentId, topicId)` pair works — the popup boots regardless of whether the route
resolves data, which is what makes this usable on a signed-out instance. For overlay
claims, measure rather than eyeball: `getComputedStyle` for `pointer-events` / background
alpha plus `document.elementFromPoint(x, y)` — a 50%-alpha scrim looks like a cosmetic
tint in a screenshot while actually swallowing every click.

#### Desktop tab switching is not `activateTab` alone — drive the real tab element

**Situation:** benchmarking or driving a desktop tab switch from an `eval`
payload, using `window.__LOBE_STORES.electron().activateTab(id)`.

**Doesn't work:** on the single-router shell, `activateTab` only writes
`activeTabId`; navigation is a second step performed by the TabBar
(`handleActivate` = `activateTab(id)` + `startTransition(navigate(url))`). Calling
the store action alone leaves `location.pathname` on the previous route, so the
run measures a no-op — visible as a tiny settle time, \~4 DOM mutations, and zero
long tasks, which reads like an impossibly fast surface rather than a broken
probe. The per-tab-router shell does switch content from the store action alone,
so the same payload is a real switch on one build and a no-op on the other:
any A/B built on it is invalid.

**Works:** drive the tab element the user actually clicks, and assert the
navigation happened.

```js
const all = [...document.querySelectorAll('[data-insp-path*="TabBar/TabItem.tsx"]')].filter(
  (e) => e.getBoundingClientRect().width > 100,
);
// two nested nodes per tab match — keep only the outermost
const roots = all
  .filter((e) => !all.some((o) => o !== e && o.contains(e)))
  .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
// roots[i] aligns 1:1 with store tabs[i]; verify roots.length === tabs.length
roots[idx].click();
```

`el.click()` reaches the React `onClick` here (this is not a controlled input, so
the generic D11 trusted-input caveat does not apply). Always record
`location.pathname` before and after and keep a `navigated` flag on every sample —
that flag is what catches a payload that silently stopped switching.

#### Clicking an already-active tab is a no-op — a desynced tab can never be re-entered by clicking

**Situation:** a probe adds a tab with `addTab(url)` and then clicks it to enter that route.

**Doesn't work:** `addTab` already activates the new tab, so the later click lands on the _active_ tab
and the shell does nothing. On the single-router shell this can leave `activeTabId` pointing at a tab
whose URL names one topic while `location.pathname` and `chat().activeTopicId` still name another —
after which no amount of clicking recovers it, and every downstream assertion reads the wrong page.
Symptom: the probe's final `location.pathname` is not the tab you clicked, with no error anywhere.

**Works:** after `addTab`, enter the route with a full navigation
(`app-probe.sh goto <url>`) before starting the trials, and assert the three values agree before
measuring:

```js
const st = window.__LOBE_STORES.electron();
const chat = window.__LOBE_STORES.chat();
const tab = (st.tabs || []).find((t) => t.id === st.activeTabId);
// tab.url, location.pathname and chat.activeTopicId must all point at the same topic
```

#### Attributing switch work to hidden keep-alive trees — classify on BOTH sides of the action

**Situation:** measuring what a per-tab keep-alive shell costs while a tab is hidden.

**Doesn't work:** collecting the hidden slots (the `display: none` children of the TabHost root) _before_
the switch and classifying every mutation against that list. The switch is precisely what makes the
target tab visible, and that tab was hidden when the list was captured — so the incoming tab's own
render, which is necessary user-visible work, is counted as hidden-tree work. This produced a confident
"\~44% of switch work happens off-screen" that was pure artefact, and it survived review because the
number looked plausible.

**Works:** classify against the intersection — slots hidden **before** the switch that are **still
hidden after** it:

```js
const before = hiddenSlots(); // display:none children of the TabHost root
/* click the tab, observe mutations */
const after = hiddenSlots();
const stillHidden = before.filter((s) => after.includes(s));
```

Measured this way, still-hidden slots produced **0** mutations in 6/6 switches: React
`<Activity mode="hidden">` keeps state, tears down effects, and commits nothing while hidden.

**General rule:** when a measurement classifies work by a property that the measured action itself
changes (visible/hidden, active/inactive, mounted/unmounted), capture the classification on both sides
and use the intersection. Otherwise the action's own effect lands in the wrong bucket.

#### Desktop theme follows the system appearance, not `settings.general.themeMode`

**Situation:** capturing dark-mode evidence for a desktop UI change.

**Doesn't work:** `window.__LOBE_STORES.user().updateGeneralConfig({ themeMode: 'dark' })`.
The setting persists (reading it back returns `dark`, and it survives a restart),
but `document.documentElement.dataset.theme` stays `light` and every token keeps its
light value. Restarting the instance does not apply it either. Treating the stored
setting as proof of the rendered theme yields evidence captured in the wrong theme.

**Works:** assert `document.documentElement.dataset.theme` — never the stored
setting — before capturing any theme-dependent evidence. The renderer tracks the OS
appearance, so switching it means changing the user's macOS system setting, which is
outside the harness's remit: mark the dark case untested and say why, rather than
flipping a device-level preference. Note the setting write is not free — it syncs to
the account and affects other surfaces; restore it (`auto`) at teardown if you set it.

#### A cold desktop boot renders English copy while `status.language` already says zh-CN

**Situation:** asserting anything about localized UI copy on a freshly started
`electron-dev.sh` instance — a label's text, or that a settings section rendered at all.

**Doesn't work:** grepping the rendered text for the Chinese label while
`window.__LOBE_STORES.global().status.language` reports `zh-CN`. The persisted language is
restored into the store, but i18next is still on English until `switchLocale` runs once, so every
Chinese-text assertion comes back false and reads as "the section never rendered". A full-reload
`goto` puts it back into that state, so it recurs mid-run after each navigation.

**Works:** never infer the rendered language from `status.language`. Decide from the DOM
(test for both the Chinese and English label, or read a known-localized node), or normalize first
by calling `window.__LOBE_STORES.global().switchLocale('<locale>')` — the same action the language
select calls — and only then assert. When the check under test IS the language, drive the real
select, and re-read `status.language` plus the DOM copy after every switch: the two can disagree.

#### `app-probe.sh goto /` cannot reach the desktop Home route — seed the tab first

**Situation:** driving the Electron shell to the Home route (`/`) to check the nav
panel there.

**Doesn't work:** `app-probe.sh goto /` prints `"/"` but the renderer stays on the
previous route. `goto` is a full reload, and the desktop shell restores the active
tab's persisted url on boot — every non-root route survives that restore, so `goto`
appears to work for `/tasks`, `/agents`, `/settings` and silently fails only for
`/`. The follow-up probe then describes the old page with no error anywhere.

**Works:** create and activate a Home tab first, then navigate:

```js
window.__LOBE_STORES.electron().addTab('/'); // addTab also activates it
```

```bash
.agents/acceptance/scripts/app-probe.sh goto /
```

Assert `location.pathname` after the reload rather than trusting `goto`'s echo.

#### The dev Electron instance may be a thin client on PRODUCTION — read `dataSyncConfig` before any write

**Situation:** starting `electron-dev.sh` to verify a frontend change, then driving flows that
create or mutate product objects (labels, groups, agents, forwarded topics, saved edits).

**Doesn't work:** assuming the instance talks to a local backend because the run also started one.
The seeded login snapshot carries its own target, and `{"storageMode":"cloud","active":true}` means
the renderer runs your working-tree code while every request goes to `app.lobehub.com` with the
user's real account. `app-probe.sh server-auth` returns 200, which reads as "the local stack is
wired up" and encourages exactly the writes that then land in production. The local dev server the
run started sits unused.

**Works:** read the target first and let it decide the test's write budget.

```bash
agent-browser --cdp 9222 eval '(() => JSON.stringify(window.__LOBE_STORES.electron().dataSyncConfig))()'
# {"storageMode":"cloud","active":true}   -> production account; keep the run read-only
# {"storageMode":"selfHost","remoteServerUrl":"http://localhost:3111", ...} -> local backend
```

On `cloud`, verify open / render / close only, treat every submit as a user-owned decision, and
prove afterwards that nothing was written (re-read the relevant store count). Note this also makes
the whole local-server bring-up unnecessary — check the target before spending minutes on it.

**Corollary — a preference key your branch ADDS cannot be proven to persist here.** The cloud
server validates `user.updatePreference` against its own deployed `UserPreferenceSchema`, so a key
that exists only in your working tree is accepted with HTTP 200 and then silently dropped: the
next `user.getUserState` comes back without it and a reload shows the setting reverted, which
reads exactly like a broken write path. Attribute it before reporting a defect — wrap `fetch`,
confirm the request body carries the key, and confirm an ALREADY-shipped sibling key
(`terminalFontFamily`) round-trips in the same response. Then mark persistence blocked on the
server schema version rather than failing the change; only a local full stack running the branch's
schema can close that loop.

#### A global `indexedDB.open` stall holds the boot on web but kills the Electron renderer

**Situation:** needing to freeze the boot at a pre-app phase long enough to capture it,
by keeping the SWR cache hydration from ever completing.

**Doesn't work on desktop:** replacing `indexedDB.open` with a never-settling stub
breaks the Electron renderer outright — the local database adapter registered in
`entry.desktop.tsx` needs IndexedDB, so the entry dies before React renders and the
HTML loading screen stays up forever. The symptom reads as "the phase under test never
appears", i.e. exactly like the product defect you were looking for.

**Works:** use the stall only on the web entry, where it holds `CacheHydrationGate`
for its full `HYDRATION_TIMEOUT` (about 8s) — ample for a screenshot plus
`getBoundingClientRect` / `getComputedStyle` measurements over the same CDP
connection. For desktop, do not stall storage: observe the natural boot with the
in-page sampler above. Either way, disarm with
`Page.removeScriptToEvaluateOnNewDocument` and reload before capturing the settled
state, or the comparison shot is taken against a still-crippled runtime.

#### Locale regression tests and desktop resource scanning

**Situation:** a locale-copy change needs a focused regression assertion while
the Electron dev renderer imports locale resources from the default resource tree.

**Doesn't work:** placing `*.test.ts` beside files in
`packages/locales/src/default/`. The desktop resource scan can include that module
in the renderer graph, which makes Vite optimize and execute `vitest` in the app.

**Works:** keep the assertion under the consuming feature's test directory and
import the locale resource there. Restart the isolated Electron instance after a
bad scan because the optimized dependency graph can remain poisoned.

### Auth and session state

#### Task CLI polling with seeded API-key auth

**Situation:** A local acceptance run is driven through `lh task run` with the
seeded `LOBEHUB_CLI_API_KEY`, and the test needs to observe the asynchronous
repair lifecycle.

**Doesn't work:** `lh task run <id> --follow` switches to `/webapi/*`, which
requires OIDC and rejects API-key auth after the task has already started.
Likewise, `lh acceptance view task:T-N` does not currently resolve a task
identifier to its internal subject id.

**Works:** Start the task without `--follow`, poll with `lh task view T-N`, and
query the aggregate with `lh acceptance view task:<internal-task-id>`. The start
response and task activity expose the operation and topic ids; the Acceptance
bundle exposes the repair round and final rollup.

The same identifier/internal-id gap exists on the WRITE path: a local
`acceptance run ingest --subject task:T-N` stores the literal `T-N` as
`acceptance_subjects.subject_id`, while task/goal detail pages resolve the
acceptance by the task's INTERNAL id — the page then renders an empty state even
though ingest succeeded. Use the internal id in `--subject` (or fix the
`subject_id` row afterwards) when the evidence must render in the local app UI.

#### Production-backend web runs have no seeded agent-browser session

**Situation:** verifying frontend-only work against real production data through
`bun run dev:spa`'s `_dangerous_local_dev_proxy` URL.

**Doesn't work:** the adapter's Web evidence path (`agent-browser --session
lobehub-dev` seeded by `setup-auth.sh web-seed`) authenticates against the LOCAL
server. There is no sanctioned way to give that session a production login —
`setup-auth.sh web`'s Chrome-cookie injection is explicitly forbidden against
production.

**Works:** drive the proxy in the user's already-authenticated Chrome (the
`claude-in-chrome` tooling), and compensate for the weaker evidence channel with
DOM measurements (`getBoundingClientRect` / `getComputedStyle`) alongside every
screenshot, plus an independent server-side check through `lh` in a clean env.
Prove the working-tree bundle is actually live first — read back a string that
exists only in the working tree (e.g. a changed placeholder), never assume HMR
applied.

#### The desktop instance pins a previous run's server port, and its saved OAuth login expires

**Situation:** starting an Electron dev instance for a surface that needs the local
backend (any tRPC-backed panel), in a fresh worktree.

**Doesn't work:** starting the dev server on the port `init-dev-env.sh` allocates
for this worktree and assuming the app will follow. The desktop app is a thin
client — `BackendProxyProtocolManager` proxies `app://renderer/trpc/*` to whatever
`dataSyncConfig.remoteServerUrl` the seeded login snapshot carries, which is the
port an _earlier_ run allocated. The mismatch surfaces as `app-probe.sh server-auth`
returning **502** (proxy reached nothing), not as an auth error. And once the port
matches, the snapshot's OAuth tokens are usually expired anyway — the app shows
「登录已过期」 and `server-auth` returns **401**, while `auth` still reports
`isSignedIn: true` from renderer state alone.

**Works:** read the app's own target first, then start the server on that port:

```bash
agent-browser --cdp 9222 eval '(() => JSON.stringify(window.__LOBE_STORES.electron().dataSyncConfig))()'
# → {"storageMode":"selfHost","remoteServerUrl":"http://localhost:3111","active":true}
SERVER_PORT=3111 .agents/acceptance/scripts/init-dev-env.sh dev-next
```

It must be `SERVER_PORT=`, not `PORT=`. The last line of `cmd_dev_next` is
`exec pnpm exec next dev -p "$SERVER_PORT"`, and `SERVER_PORT` falls back to the
ports-file allocation only when it is not passed explicitly. `PORT=` is exported but
never reaches `-p`, so the server still comes up on the ports-file port: the log
looks entirely normal and only BackendProxy keeps returning 502.

For the expired login, do **not** drive the OAuth flow. The proxy forwards the
Electron session's cookies alongside its `Oidc-Auth` header, and the server accepts
a better-auth session cookie — so mint one for the seeded user and inject it over
raw CDP:

```bash
curl -c cookie.jar -H 'Content-Type: application/json' -X POST \
  "$SERVER_URL/api/auth/sign-in/email" \
  --data '{"callbackURL":"/","email":"agent-testing@lobehub.com","password":"TestPassword123!"}'
# then Network.setCookie better-auth.session_token / better-auth.session_data
# for url http://localhost:<port>, domain localhost, httpOnly, on the renderer target
```

Gate on `app-probe.sh server-auth` returning `{"authenticated":true,"status":200}` —
renderer `isSignedIn` alone never proves the server accepted anything.

#### A pool instance seeded from the login snapshot can boot signed out — `safeStorage` cannot decrypt the copied token

**Situation:** `electron-dev.sh start <id>` in a worktree; the helper reports the
renderer ready and the seeded login is present on disk.

**Doesn't work:** trusting `login-status`'s "refresh token PRESENT" as proof the
instance will come up authenticated. The pool's copied userData can fail to decrypt
its access token — `/tmp/lobe-electron-pool/instance-<id>.log` repeats
`Failed to decrypt access token: Error while decrypting the ciphertext provided to
safeStorage.decryptString` — and the app boots signed out (`app-probe.sh auth` →
`isSignedIn: false`) with a near-blank shell that reads like a broken route tree.
Cause not established; re-seeding and restarting the same pool id does not help.

**Works:** fall back to the legacy single instance (`electron-dev.sh start`, no id),
which runs on the golden profile in place and decrypts normally. It boots on the
loading shell once, so reload once before probing (see L-S8). Gate on
`app-probe.sh auth` AND `server-auth`, never on the helper's "Ready" line.

#### Electron dev's BackendProxy targets the server port persisted in the login snapshot — mint a session and inject the cookie over CDP

**Situation:** starting the Electron surface inside a worktree to verify a pure
frontend change; the renderer looks fine, but `app-probe.sh server-auth` returns 502
and `isUserStateInit` stays false (UI gated on it — the Labs section, for instance —
silently does not render, so the store state reads as "set but not taking effect").

**Doesn't work:** starting the dev server on 3010 or on the dynamic port `test-env.sh`
resolves. The desktop main process persists the BackendProxy target port in the login
snapshot's userData; `BackendProxy upstream fetch failed ... http://localhost:<port>`
in `/tmp/electron-dev.log` is the only source of truth, and it has nothing to do with
the current ports-file. If a 401 appears once the port matches, the snapshot cookie is
no longer valid against the local database — restarting Electron to re-seed the
snapshot does not recover it.

**Works:** three steps. (1) Read the BackendProxy target port from the log and start
the dev server with `PORT=<that port>`. (2) Mint a better-auth session with the same
curl `web-seed` uses (`POST /api/auth/sign-in/email` as the seeded user; fetching from
inside the renderer is rejected 403 because of the `app://` origin, so it must be
curl). (3) Write both `better-auth.session_data` and `better-auth.session_token` into
Electron's cookie store through raw CDP `Network.setCookie` (with `url` set to
`http://localhost:<port>/`); after `location.reload()`, `server-auth` returns 200 and
`isUserStateInit` is true.

#### A pool instance's BackendProxy port also comes from the login snapshot, and its log is `instance-<id>.log`

**Situation:** starting a pool instance with `electron-dev.sh start <id>` to verify a
pure frontend change; `auth` and `server-auth` both pass, but the content area shows
"failed to load" with `sessions: 0` and `isSessionsFirstFetchFinished: false`.

**Doesn't work:** starting the dev server on the port `test-env.sh` resolves (the
ports-file one). Do not go looking in `/tmp/electron-dev.log` either — pool instances
never write that file, so grepping it for BackendProxy finds nothing and reads as
"there are no proxy errors". Note also that a 200 from `server-auth` does not prove
the data layer works: it does not take the same route as tRPC.

**Works:** read
`BackendProxy upstream fetch failed ... http://localhost:<port>/trpc/...` from
`/tmp/lobe-electron-pool/instance-<id>.log`, start the dev server on that port
(`PORT=<port> APP_URL=http://localhost:<port> init-dev-env.sh dev`), then restart that
pool instance. The criterion is that `topicDataMap` actually holds items, not the
helper's Ready line. Beware that `init-dev-env.sh dev` / `stop-dev` can SIGTERM the
pool instance along the way (the log shows
`GPU process exited unexpectedly: exit_code=15`), so the order is: fix the port and
start the server first, then start Electron.

### Renderer OTA: creating a real download delta in dev

**Situation:** verifying renderer OTA incremental download in dev, where the
"builtin" renderer (`apps/desktop/dist/renderer`) is the same directory the build
writes to.

**Doesn't work:** rebuild + publish the manifest from `dist/renderer`, then
trigger a check — the manager diffs against the builtin tree, which now equals
the manifest tree, so every file is hardlink-reused and 0 files download.

**Works:** snapshot `dist/renderer` before the new build; publish the manifest
from the fresh build output; then restore the snapshot over `dist/renderer` so
the local tree differs from the manifest. The check then downloads only the real
delta. Also: read the feed server's 404 line after boot to learn the exact
`<channel>/<mainHash>` path the running app expects instead of recomputing it.

### Dev server, install, and ports

#### A backgrounded `init-dev-env.sh dev` looks dead while the server is alive on a dynamic port

**Situation:** starting the dev server from a harness-managed background command in a
worktree, then waiting for readiness.

**Doesn't work:** trusting the background task's captured output (it can stay 0 bytes
while the detached process tree lives on), or polling the default port. Worktrees
allocate dynamic ports, so probing `localhost:3010` waits forever while the server is
already up elsewhere; a retry then fails with "an owned dev server is already running".

**Works:** treat `.records/runtime/` as the source of truth — it records `PID`,
`SERVER_PORT` and `SPA_PORT` for the owned instance. Read the port from there and poll
that. For a long-lived start prefer a detached `screen -dmS <name> … >> .records/logs/x.log`
so the log lands in a stable file; `stop-dev` still stops the recorded PID tree either way.

#### Agent-browser navigation hangs after an orphaned Next child keeps the port

**Situation:** an isolated full-stack dev launcher exits, but its Next child
continues listening without returning HTTP responses. `agent-browser open`,
`get url`, and even session close can then appear to hang because navigation
never settles.

**Doesn't work:** repeatedly recreating browser sessions or assuming the
browser daemon is the root cause while `curl --max-time` to the target route
also receives zero bytes.

**Works:** inspect the exact listener with `lsof`, confirm its command and
working tree, terminate only that run-owned process tree, then restart through
`init-dev-env.sh dev` and reseed the isolated browser auth. A successful HTTP
probe must precede browser assertions.

#### An unconverged lockfile puts two copies of a dep in the graph — every route using it dies at the ErrorBoundary

**Situation:** after rebasing onto a canary that bumped a shared UI dependency and
running `pnpm install`, every route rendering the rich-text editor (agent profile,
Home composer) fails with
`LexicalComposerContext.useLexicalComposerContext: cannot find a LexicalComposerContext`
and the SPA shows 页面暂时不可用.

**Doesn't work:** reading it as a defect in the change under test, or as a stale
Vite dep cache. Clearing `node_modules/.vite` (both root and `src/`) and a plain
`pnpm install` both leave it broken, because the duplicate is in the resolution,
not the cache.

**Works:** attribute first, then measure the resolution.

1. Attribution is cheap and decisive: load a route the branch definitely does not
   touch that uses the same dependency. If it fails too, the change under test is
   ruled out without checking out the base ref.

2. The mechanism is two physical copies with different peer sets. The root
   declares an exact-ish range while workspace packages declare a loose one, so a
   dependency bump moves only the root:

   ```bash
   readlink node_modules/@lobehub/editor            # -> …editor@4.23.1_…ui@5.27.0
   readlink packages/*/node_modules/@lobehub/editor # -> …editor@4.20.3_…ui@5.20.2
   ```

   A React context is module-scoped, so two copies means the provider and the
   consumer read different context objects — the symptom is always "cannot find
   the context", never a version error.

3. `pnpm dedupe` converges them; clear the Vite dep caches and restart afterwards.

**`pnpm-lock.yaml` is gitignored in this repo (`.gitignore`), so this divergence is
always LOCAL install state — never something canary committed and never something to
open a PR about.** A loose workspace range (`^4`) stays satisfied by the old version
across incremental installs, so the drift accumulates silently in a long-lived
checkout and appears right after a rebase that bumps the root range. Do not report it
as a defect of the branch or of the base ref; note it as an environment finding and
move on. Back up the lockfile before `dedupe` anyway — it is the only copy.

#### A fresh worktree installed with `--ignore-scripts` returns 500 on every `/trpc/lambda/*`

**Situation:** bootstrapping a new git worktree for a run — `pnpm install` at the root,
then `init-dev-env.sh dev`.

**Doesn't work:** `pnpm install --ignore-scripts`. The server starts and serves the SPA
normally, but Turbopack cannot instantiate `@icons-pack/react-simple-icons` (reached
through `packages/const/src/composio.ts` → `packages/database/src/schemas/*`), so every
`/trpc/lambda/*` route returns **500** while the page itself looks healthy. The CLI
surfaces this only as `Unable to transform response from server`, which reads as an auth
or API-key problem and sends you to `setup-auth.sh` instead of to the install. The Next
log holds the real cause (`module factory is not available`), and its own suggested fix
— clear the browser cache / service worker — is misleading here.

**Works:** install without `--ignore-scripts`, and clear the stale Turbopack cache
because the broken module graph is persisted:

```bash
.agents/acceptance/scripts/init-dev-env.sh stop-dev
rm -rf .next && pnpm install # no --ignore-scripts
.agents/acceptance/scripts/init-dev-env.sh dev
```

**Same persisted cache, second shape — a startup panic, no install involved.** A dev
start can also die before serving anything with
`panicked at turbo-tasks-backend/.../operation/mod.rs: Restore of All for task TaskId <n> failed in another thread: restoring failed`, followed by `next exited unexpectedly`
and a `dev` exit 143. The install is fine here; the corruption is in `.next`'s persisted
turbo-tasks cache from an earlier run that was killed mid-write. It reads like a
Turbopack bug worth reporting upstream (the panic message says so itself) and invites a
dependency hunt, but for a local run it is disposable state: `stop-dev`, `rm -rf .next`,
start again — no reinstall needed. Treat any turbo-tasks panic naming cache
restore/persist as the same disposable-state class, and do not attribute it to the branch
under test.

Gate on a real authenticated TRPC call rather than on the page rendering: a 200 from
`$SERVER_URL/` proves nothing about the lambda routes. Remember `apps/cli` and
`apps/desktop` are standalone installs (PROJECT.md §1), so each also needs its own
`pnpm install` in a fresh worktree.

#### A worktree Electron run leaves a second `@types/react` that fails the worktree type-check

**Situation:** running the Electron surface from a git worktree, which requires
the `apps/desktop` standalone install (adapter §1), then running `bun run check --type`.

**Doesn't work:** treating the resulting type errors as the branch's own. The
desktop install brings its own `@types/react` (e.g. `19.2.18`) alongside the
root's (`19.2.13`), and the two identities collide on every `lucide-react` icon
`ref`, producing a cluster of "Two different types with this name exist, but they
are unrelated" errors in files the branch never touched.

**Works:** intersect the erroring files with the branch's changed-file list before
drawing any conclusion, and confirm causality by A/B — moving
`apps/desktop/node_modules` aside makes the cluster vanish. At teardown, remove
`apps/desktop/node_modules` and re-run the root `pnpm install` to restore a clean
`✓ types clean` baseline. **Do not run the A/B while the instance is live** — the
Electron binary runs out of that directory, so parking it kills the instance;
capture all UI evidence first.

#### Managed command runners can reap `electron-dev.sh start` children after the helper returns

**Situation:** `electron-dev.sh start` (legacy and pool forms) reports that CDP
and the renderer are ready, but the CDP port closes immediately after the helper
command returns. The Electron log contains a normal renderer mount and no crash;
changing from the saved login snapshot to the fresh golden profile does not alter
the exit. The cause is not established.

**Doesn't work:** retrying the helper with another pool id or changing the auth
seed. Both instances become interactive during the helper's readiness loop and
are gone before the next command can connect.

**Works:** use the documented multi-instance Model B command in a long-lived PTY
with the same isolated userData, Vite port, IPC id, and CDP port:

```bash
LOBE_DESKTOP_VITE_PORT=5175 \
  LOBE_DESKTOP_USER_DATA_DIR=/tmp/lobe-electron-pool/ud-2 \
  LOBE_IPC_ID=lobehub-desktop-dev-2 \
  pnpm -C apps/desktop dev -- --remote-debugging-port=9224
```

Keep that command session open for the run. Confirm the CDP endpoint, project
process path, `app-probe.sh ready`, renderer auth, server auth, and a raw-CDP
screenshot before collecting evidence.

#### A reset shell cwd silently retargets git commits at the main repo's checked-out branch

**Situation:** a long worktree-based session where the harness occasionally resets the
shell cwd back to the main repo root (e.g. after a `cd /tmp` in a compound command).

**Doesn't work:** running `git add -A && git commit` (or `bun run check`) without an
explicit `cd` into the worktree. The commands succeed against the MAIN repo — the
commit lands on whatever branch the user has checked out there, staging their
unrelated dirty files, while the intended worktree change stays uncommitted. The
only tell is an unexpected diffstat / parent commit; `push <branch>` then reports
"Everything up-to-date" because the worktree branch ref never moved.

The same reset has a second, harder-to-spot consequence: it also retargets
`init-dev-env.sh dev`, so the dev server and its Vite serve the MAIN checkout while
every health signal stays green — see `common-mistakes.md` L-S17.

**Works:** in any worktree session, prefix every git/check command with an explicit
`cd <worktree> &&`, and read the commit output's diffstat + `git log -1` parent
before pushing. Recovery for a mistaken main-repo commit: `git reset --mixed HEAD~1`
restores the user's branch and leaves their working tree as it was (verify against
the session-start `gitStatus` snapshot); nothing needs force-pushing because the
wrong-branch push was a no-op.

#### Proving which prompt version the running server holds

**Situation:** verifying a change to a prompt under `packages/prompts` — the assertion is
about the model's behaviour, so the run is only meaningful if the server is executing the
new prompt.

**Doesn't work:** trusting the Vite HMR line (`page reload packages/prompts/src/...`).
That is the client reloading; the Next server keeps the workspace package it started
with, so it answers with the old prompt indefinitely. Reading the model's output and
judging "this looks like the new behaviour" is circular — the whole point of the change
is that the output should differ, so any difference confirms the hypothesis either way.

**Works:** every traced generation records the version it ran. After one call, read it
back:

```bash
docker exec lobehub-agent-testing-postgres psql -U postgres -d postgres -tAc \
  "select prompt_version, model, created_at from llm_generation_tracing \
   where scenario='<scenario>' order by created_at desc limit 1"
```

A stale version means the server needs a real process restart (PROJECT.md §6), not a
reload. Gate the first evidence-bearing call on this row, not on the edit's timestamp —
otherwise the round publishes new-prompt claims backed by old-prompt output.

#### Server-side reads of local S3 evidence are blocked by SSRF protection — private IPs must be allowed explicitly

**Situation:** verifying any capability where the **server** reads back an uploaded
file (multimodal image judging, thumbnail processing, feeding a screenshot to a
model). Locally the server always reads through `s3rver`, i.e. a presigned
`http://127.0.0.1:29000/...` URL. The symptom is a silent whole-feature failure: the
endpoint returns normally, the business counter is 0, and the log carries neither a
model error nor an auth error — it looks exactly like the model deciding there was
nothing to do.

**Doesn't work:** investigating the model side, checking the provider key, confirming
the evidence row and its `fileId` exist. All of that checks out, because the request
was never sent — the failure is in the server's own fetch of the image.

**Works:** add `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1` to the dev server environment. The
criterion is the log pair
`SSRF protection blocked request: ... DNS lookup 127.0.0.1 ... is not allowed. Because, It is private IP address.`
followed by `Error converting image to base64`. Production uses a real object-storage
domain and is unaffected, so this is purely a local verification-environment gate and
not a product defect — do not report it as a bug, and do not work around it by
switching to inline base64, which would verify a path the product never takes.

## Detailed references

- [Probe field notes](./references/probe-field-notes.md) — all historical
  LobeHub findings, original identifiers, commands, and failure analysis.
- [Auth](./references/auth.md) — per-surface auth injection and recovery.
- [Dev server](./references/dev-server.md) — local stack and restart behavior.
- [Multi-instance Electron](./references/multi-instance.md) — pool, ports, CDP
  sessions, and user-data isolation.
- [Agent gateway](./references/agent-gateway.md) — closed-loop gateway probes.

## Adding a new learning

- Add a command or option to `app-probe.sh` when the probe is read-only,
  repeatable, and has a stable output contract. Add a smoke test with it.
- Add a concise recipe here when it is a recurring decision or supported
  mechanism.
- Add a field note only for a narrow incident, including Situation / Doesn't
  work / Works and evidence for every mechanism claim.
- Promote product-independent findings to the generic skill layer rather than
  duplicating them here.
- Put a new recipe inside the `Project-specific recipes` group it belongs to, above
  `Detailed references` — never after the closing sections, or the taxonomy drifts.
