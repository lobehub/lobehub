# LobeHub gateway streaming + tab-switch test harness

Captures store + DOM state at 200ms intervals so we can prove or disprove
claims like "切回 tab 后消息回到了很早以前". Built for gateway-mode chat but
works for any LobeHub streaming session.

## Running a LOCAL gateway for a real closed loop

> Use this when you need to verify the **browser↔gateway** path end-to-end
> (gateway mode / Cloud Sandbox / group broadcast over WebSocket). The probe
> harness below assumes a gateway is already streaming to your browser — this
> section is how you get one locally.

**Why the online gateway can't close the loop locally.** The online gateway
(`agent-gateway.lobehub.com`) verifies the browser's user JWT against the
**production** app's JWKS. A local dev instance signs that JWT with its **own**
`JWKS_KEY`, so the online gateway rejects the WS handshake with
`{"type":"auth_failed","reason":"signature verification failed"}` → close
`1008`. The server→gateway **push** still returns `200` (it uses the static
`AGENT_GATEWAY_SERVICE_TOKEN`, not JWKS) — so events flow server-side but the
browser never receives them. That's why client / SSE / online-gateway are all
**not** a real local closed loop. Confirm the failure shape by hooking
`WebSocket` in the page and reading the first frame after the `auth` send.

**Fix — run the gateway yourself.** The gateway worker lives in a **sibling
repo: look for `agent-gateway/` next to `lobehub/`** (same parent dir). It's a
Cloudflare Worker (`wrangler dev`, Durable Objects in local mode) whose
`verifyToken` checks JWTs against a configurable `JWKS_PUBLIC_KEY` secret. Point
that secret at **your local app's** public key and the local gateway trusts your
local JWT → `auth_success` → full local loop.

```bash
# 1. Generate agent-gateway/.dev.vars (public JWK extracted from JWKS_KEY +
#    reuse of AGENT_GATEWAY_SERVICE_TOKEN). Source resolves to
#    .records/env/gateway.env by default, else .env.local; override with
#    JWKS_SOURCE=<env file>. (Managed agent-testing runs have NO .env.local.)
.agents/skills/agent-testing/scripts/agent-gateway/local-gateway-setup.sh

# 2. Start the worker (separate terminal) → http://localhost:8787
cd ../agent-gateway && bun run dev
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/health # → 200

# 3. Decisive check — does the local gateway accept the app's JWT?
node .agents/skills/agent-testing/scripts/agent-gateway/local-gateway-probe.mjs
#    → RECV: {"type":"auth_success"}   ✅ feasible

# 4. Point the APP at the local gateway and RESTART its dev server:
#      AGENT_GATEWAY_URL=http://localhost:8787   (client → ws://localhost:8787/ws)
#      AGENT_GATEWAY_SERVICE_TOKEN=<unchanged>   (matches gateway .dev.vars SERVICE_TOKEN)
#      ENABLE_AGENT_GATEWAY=1                     (→ serverConfig.enableGatewayMode)
```

Key facts the setup relies on: `JWKS_PUBLIC_KEY` is just `JWKS_KEY` with the
private fields (`d,p,q,dp,dq,qi`) stripped — same `kid`, so signatures verify.
The app's gateway URL flows `AGENT_GATEWAY_URL` →
`getServerGlobalConfig` → `serverConfig.agentGatewayUrl`, and the client builds
the WS URL by swapping `http(s)→ws(s)` and appending `/ws?operationId=…`, so an
`http://localhost:8787` value Just Works. Server-side, the
`GatewayStreamNotifier` is wrapped whenever `AGENT_GATEWAY_URL &&
AGENT_GATEWAY_SERVICE_TOKEN` are set (`AgentRuntime/factory.ts`), and it
registers each op with the gateway via `POST /api/operations/init` carrying only
`{operationId, userId}` — it does **not** upload a per-op public key, which is
exactly why the gateway must already trust the signing key via
`JWKS_PUBLIC_KEY`.

## Files

`scripts/agent-gateway/`

| File                      | Role                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `local-gateway-setup.sh`  | Writes `agent-gateway/.dev.vars` from the app's `.env.local`     |
| `local-gateway-probe.mjs` | Signs an app JWT, asserts the local gateway returns auth_success |
| `probe.js`                | Injects a 200ms sampler + `__PROBE_EVENT` marker + `__switchTab` |
| `probe-dump.js`           | Stops the sampler and returns `{events, samples}` as JSON string |
| `tab-switch.js`           | Runs N round-trip switches between two tabs, marks each step     |
| `analyze.mjs`             | Node post-processor: timeline + regression detection             |

## Standard workflow

```bash
# 1. Start Electron with CDP
./.agents/skills/agent-testing/scripts/electron-dev.sh start

# 2. Navigate to a chat, switch runtime to Cloud Sandbox (gateway mode)

# 3. Install the probe + helpers
agent-browser --cdp 9222 eval --stdin \
  < .agents/skills/agent-testing/scripts/agent-gateway/probe.js

# 4. Send a tool-call message — manually or via type+press
agent-browser --cdp 9222 eval "window.__PROBE_EVENT('SENT')"

# 5. Run the multi-switch driver (auto-picks active tab as BACK and the
#    rightmost inactive tab as AWAY — edit ROUND_TRIPS / DWELL_MS in the
#    file if you want different timing)
agent-browser --cdp 9222 eval --stdin \
  < .agents/skills/agent-testing/scripts/agent-gateway/tab-switch.js

# 6. Wait for streaming to finish, then dump
agent-browser --cdp 9222 eval --stdin \
  < .agents/skills/agent-testing/scripts/agent-gateway/probe-dump.js \
  > /tmp/probe.json

# 7. Analyze
node .agents/skills/agent-testing/scripts/agent-gateway/analyze.mjs /tmp/probe.json
```

The analyzer prints three sections: EVENTS, TIMELINE, REGRESSIONS. If
REGRESSIONS is non-empty it means content/reasoning/childN dropped on the
same topic — the symptom users describe.

## What the probe tracks (and why)

`chat.messagesMap` only stores the top-level `assistantGroup` shell. The
actual streamed content, reasoning, and tool calls live in
`assistantGroup.children: AssistantContentBlock[]`. Any probe that only
reads `m.content` / `m.reasoning` will see zeros throughout streaming and
miss everything that matters. probe.js walks both levels and sums:

- `cT` total content length
- `rT` total reasoning length
- `toolT` total tool-call count
- `childN` number of content blocks

Plus DOM-side signals (`domLen`, search/crawl indicator counts) so you can
tell store-side regressions apart from render-side regressions.

## Gotchas

- **Optimistic new-topic state.** Before the first chunk lands, messages
  live under the `<scope>_new` key with `tmp_*` ids and no `topicId` field.
  probe.js falls back to those when `activeTopicId` is null.
- **Reasoning resets to 0 are not bugs.** When the assistant finishes
  thinking and starts tool-use or text, the streaming reasoning buffer
  empties and the finalised reasoning gets sealed into a completed block.
  Filter these out manually if needed.
- **DOM length jitters by a handful of chars** because counters like "(10)"
  in tool-call labels change as results arrive. analyze.mjs only flags
  `domLen` drops greater than 100 chars to ignore that noise.
- **Never identify tabs by innerText.** The active tab's text embeds a
  ` · <agent name>` suffix, so a search like `'LobeHub Growth'` matches the
  active tab when the active agent happens to be LobeHub Growth — and you
  end up clicking the tab you're already on. probe.js uses the stable
  `data-contextmenu-trigger` attribute (a React `useId()` value that's set
  per-tab and survives focus changes) plus `data-active="true"` to mark
  the active one. Helpers exposed:
  `__listTabs()` / `__clickTabByKey(key)` / `__clickTabByIndex(i)` /
  `__activeTabKey()`.
- **`tab-switch.js` fires-and-forgets.** The IIFE kicks off an async loop
  and returns immediately so the agent-browser CLI eval doesn't blow past
  its default 25 s timeout. Wait on the `SWITCH_LOOP_DONE` event marker
  before dumping. Re-running while a loop is in flight is refused — the
  chaotic data from overlapping runs is not worth debugging.
