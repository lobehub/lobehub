# iMessage Desktop bridge regression test

The iMessage channel is different from the other bot platforms: there is **no
native app to drive with osascript**. Instead the Desktop app runs a local
**BlueBubbles bridge** — a small HTTP server in the Electron main process that
registers a webhook on a local [BlueBubbles](https://bluebubbles.app/) server,
receives iMessage events, and forwards them to LobeHub Cloud.

So the test surface is three layers:

1. **Electron main IPC** — `imessageBridge.*` handlers (`getStatus`,
   `testConfig`, `upsertConfig`, `removeConfig`, `start`, `stop`)
2. **Local bridge HTTP server** — `http://127.0.0.1:<port>/webhooks/bluebubbles/<appId>?secret=<secret>`
3. **BlueBubbles REST API** — `http://127.0.0.1:1234/api/v1/*` (webhook + server/info)

## Prerequisites

- A running **BlueBubbles server** (macOS, default `http://127.0.0.1:1234`) with
  a known password. Sanity check:
  ```bash
  curl -sS -m4 -o /dev/null -w '%{http_code}\n' \
    "http://127.0.0.1:1234/api/v1/server/info?password=<PW>" # expect 200
  ```
- **Electron dev running with CDP**: `./.agents/skills/local-testing/scripts/electron-dev.sh start`
- The **iMessage Desktop branch** checked out (the `imessageBridge` IPC group
  and `@lobechat/chat-adapter-imessage` must be compiled into the main bundle).
  Run `pnpm install --ignore-scripts` at the repo root **and** in `apps/desktop/`
  after switching branches — the new workspace package must be linked or the
  main build fails to resolve `@lobechat/chat-adapter-imessage`.

## Fast path: automated script

```bash
./.agents/skills/local-testing/bot/imessage/test-imessage-bridge.sh '<bluebubbles_password>' [bb_url] [cdp_port]
```

Asserts the whole flow and self-cleans (unique `applicationId` per run, removes
its bridge config + BlueBubbles webhook on exit). Exit 0 = all green. It covers:

- BlueBubbles reachable + password valid; Electron CDP reachable; IPC available
- `testConfig` happy path → success
- `testConfig` wrong password → rejected; unreachable URL → rejected
- `upsertConfig` **first-time save → success** (Bug #1 regression guard, below)
- `getStatus` → `running:true`, config persisted, password redacted (`blueBubblesPasswordSet`)
- BlueBubbles webhook actually registered for the appId
- Local bridge HTTP server: wrong secret → 401; valid secret → past auth

The password is passed as argv (visible in `ps`) — local dev only, don't use a
real secret on a shared machine.

## Layer 1 — IPC probes (no UI)

The renderer exposes the main-process handlers via `window.electronAPI.invoke`.
This is the quickest way to exercise the bridge without clicking:

```bash
# baseline
agent-browser --cdp 9222 eval \
  "(async()=>JSON.stringify(await window.electronAPI.invoke('imessageBridge.getStatus',{})))()"

# test a connection (note: password as a JS string)
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(async function () {
  try {
    var r = await window.electronAPI.invoke('imessageBridge.testConfig', {
      applicationId: 'probe',
      blueBubblesServerUrl: 'http://127.0.0.1:1234',
      blueBubblesPassword: 'PASTE_PW',
      enabled: true,
      webhookSecret: 'probe-secret',
    });
    return JSON.stringify(r);            // { success: true }
  } catch (e) { return 'ERR: ' + (e.message || e); }
})()
EVALEOF
```

`upsertConfig` persists to the Electron store, starts the local HTTP server, and
registers the BlueBubbles webhook. `removeConfig` + `stop` reverse it.

## Layer 2 — full UI flow (agent-browser)

The bridge settings only render in Desktop (`isDesktop` guard) under the agent's
**Channel → iMessage** screen. The platform tile only appears as a real (non
"Coming Soon") entry once the server registers `imessage` **and** the frontend
drops it from `COMING_SOON_PLATFORMS` (`src/routes/(main)/agent/channel/const.ts`).

```bash
agent-browser --cdp 9222 open "http://localhost:5173/agent/<aid>/channel"
agent-browser --cdp 9222 wait --load networkidle && agent-browser --cdp 9222 wait 1500

# confirm the remote backend lists imessage (it must be registered + deployed)
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(async function(){
  var url='lobe-backend://lobe/trpc/lambda/agentBotProvider.listPlatforms?input='+encodeURIComponent('{"json":null,"meta":{"values":["undefined"],"v":1}}');
  var d=await (await fetch(url,{credentials:'include'})).json();
  var p=d.result?.data?.json||d;
  return JSON.stringify(p.map(function(x){return x.id;}));
})()
EVALEOF

# click the iMessage tile, then fill the form by ref
agent-browser --cdp 9222 eval "(()=>{var b=[...document.querySelectorAll('aside button')].find(x=>/imessage/i.test(x.textContent));b&&b.click();})()"
agent-browser --cdp 9222 wait 1500
agent-browser --cdp 9222 snapshot -i | grep -iE "127.0.0.1:1234|Application ID|Webhook Secret|Test BlueBubbles|Save Bridge"
```

Field refs (from the snapshot): Application ID, Webhook Secret, BlueBubbles
Server URL (`placeholder="http://127.0.0.1:1234"`), and a **nested** textbox right
under the URL one is the BlueBubbles Password. Fill with `fill` (real input
events — `eval`-setting React inputs won't fire onChange), click **Test
BlueBubbles**, then **Save Bridge**. Read the antd toast immediately (it
auto-dismisses):

```bash
agent-browser --cdp 9222 eval \
  "JSON.stringify([...new Set([...document.querySelectorAll('.ant-message-custom-content')].map(n=>n.textContent.trim()))])"
# Test  → "BlueBubbles connection passed"
# Save  → "iMessage Desktop bridge saved"
```

Verify the end state via BlueBubbles + IPC:

```bash
curl -sS "http://127.0.0.1:1234/api/v1/webhook?password=<PW>" # webhook for the appId present
agent-browser --cdp 9222 eval "(async()=>JSON.stringify(await window.electronAPI.invoke('imessageBridge.getStatus',{})))()"
# running:true, serverUrl: http://127.0.0.1:33270, configs[].blueBubblesPasswordSet:true
```

Cleanup: `removeConfig` + `stop` via IPC, then `DELETE /api/v1/webhook/<id>` on
BlueBubbles.

## Outbound send test (desktop → BlueBubbles → iMessage)

Verifies the leg the bridge uses to _reply_: `BlueBubblesApiClient.sendText`
→ `POST /api/v1/message/text`. Run the helper against your own number:

```bash
./.agents/skills/local-testing/bot/imessage/send-imessage-test.sh '<bb_password>' '+<E164>' # e.g. +15551234567
```

**Gotcha that bites everyone:** with `method=apple-script` and a _new_
conversation, the HTTP POST often **times out** even though the message is
sent. Never judge success by the HTTP response. Instead poll
`POST /api/v1/message/query` and read the matching `isFromMe:true` row's
`error` field:

- `error: 0` (or null) → sent OK
- non-zero `error` → real send failure

The script does exactly this: fires the send, ignores the timeout, then matches
its marker text in the message store and asserts `error == 0`.

Two more notes:

- Use a full E.164 handle (`iMessage;-;+<countrycode><number>`) or an Apple ID
  email. Looking the chat up by guid afterwards may 404 if BB filed the message
  under a differently-formatted guid — that's a lookup quirk, not a send failure.
- Sending to _your own_ number round-trips: BB records both the outgoing
  (`fromMe:true`) and an incoming copy (`fromMe:false`).

## Inbound e2e test (iMessage → cloud agent → reply)

Full inbound chain: a message arrives → BlueBubbles fires its `new-message`
webhook → local bridge (`:33270`) → `forwardWebhook` POSTs to
`<remote>/api/agent/webhooks/imessage/<appId>?secret=…` → cloud agent → reply
flows back via Device Gateway → BB `sendText`.

Prerequisites:

- A cloud bot provider for the same `applicationId` exists and is **connected**
  (Save Configuration + the device gateway connected — a _disconnected_ gateway
  yields `DEVICE_NOT_FOUND` on connect and blocks the reply leg).
- The `imessage` Labs toggle is on (otherwise the channel is gated to "Coming
  Soon"), and `webhookSecret` matches on both ends (auto-generated on save).

Two ways to drive it:

1. **Second device / Apple ID (recommended).** Have _another_ Apple ID message
   the BB-hosted number (e.g. "please reply pong"). The bot replies; you see it
   on the other device. **No loop risk** — the reply goes to the other party,
   not back to itself.
2. **Send to your own number (quick, loop-aware).** `sendText` to the hosted
   number; the loopback _incoming_ copy (`isFromMe:false`) triggers the bot.
   Watch the reply land in `message/query` as a `fromMe:true` row.

**Loop guard — why a self-send doesn't spin forever:** the Chat SDK adapter
drops any `isFromMe` message before dispatch
(`packages/chat-adapter-imessage/src/adapter.ts`: `if (message.isFromMe) return`).
The bot's own reply (`isFromMe:true`) is never re-processed, so in the normal
case (someone else → bot → reply to them) there is no loop. The self-send case
is a **test-only edge**: the bot's reply also round-trips to your number, and
only the adapter's `isFromMe` check stops a second pass. Keep the prompt
conversational (so the bot doesn't keep finding something to answer), and
**turn the `imessage` lab off / remove the config when done** — never leave a
self-send bot running unattended.

Watch the chain live:

```bash
tail -f /tmp/electron-dev.log | grep -iE "imessage|bridge|forward|Message API"
# the agent reply shows up as a fromMe:true row with the bot's text:
curl -sS -X POST "http://127.0.0.1:1234/api/v1/message/query?password=<PW>" \
  -H 'Content-Type: application/json' -d '{"limit":5,"sort":"DESC"}'
```

`startTyping` will log a Private-API error unless BlueBubbles has the Private
API helper set up (needs a jailbroken / SIP-disabled Mac) — it's logged and
ignored; text replies still work.

## Known bugs / gotchas

- **Bug #1 — first-time save (fixed; guarded by the script).** BlueBubbles'
  `GET /api/v1/webhook?url=<unregistered>` returns **HTTP 500**
  (`Cannot read properties of null (reading 'events')`). The bridge must list
  **all** webhooks and match client-side, never pass the `?url=` filter. If you
  see `upsertConfig` fail with "An unhandled error has occurred!" originating in
  `listWebhooks`, this regressed.
- **Save leaves a half-state on webhook failure.** `upsertConfig` writes the
  config + starts the HTTP server _before_ registering the webhook, so a webhook
  failure still reports `running:true` with the config persisted but no
  BlueBubbles webhook. Always assert the BlueBubbles webhook list, not just IPC
  status.
- **Unknown appId / forward failure → 500.** Posting to the local bridge for an
  unknown appId, or when no cloud bot is bound, returns 500 (BlueBubbles retries
  on 5xx). Auth (wrong secret → 401) is enforced before that.
- **Backend deploy lag.** Desktop dev proxies tRPC through `lobe-backend://` to
  the _remote_ server. iMessage only appears in `listPlatforms` once the server
  registration is deployed there, regardless of local branch.
- **Restart to load main-process fixes.** Editing `imessageBridgeSrv.ts` /
  `@lobechat/chat-adapter-imessage` needs `electron-dev.sh restart` — main isn't
  hot-replaced. On restart, enabled configs auto-register their webhook again.
