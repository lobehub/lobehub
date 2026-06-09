# LobeHub gateway streaming + tab-switch test harness

Captures store + DOM state at 200ms intervals so we can prove or disprove
claims like "切回 tab 后消息回到了很早以前". Built for gateway-mode chat but
works for any LobeHub streaming session.

## Files

`scripts/agent-gateway/`

| File            | Role                                                             |
| --------------- | ---------------------------------------------------------------- |
| `probe.js`      | Injects a 200ms sampler + `__PROBE_EVENT` marker + `__switchTab` |
| `probe-dump.js` | Stops the sampler and returns `{events, samples}` as JSON string |
| `tab-switch.js` | Runs N round-trip switches between two tabs, marks each step     |
| `analyze.mjs`   | Node post-processor: timeline + regression detection             |

## Standard workflow

```bash
# 1. Start Electron with CDP
./.agents/skills/local-testing/scripts/electron-dev.sh start

# 2. Navigate to a chat, switch runtime to Cloud Sandbox (gateway mode)

# 3. Install the probe + helpers
agent-browser --cdp 9222 eval --stdin \
  < .agents/skills/local-testing/scripts/agent-gateway/probe.js

# 4. Send a tool-call message — manually or via type+press
agent-browser --cdp 9222 eval "window.__PROBE_EVENT('SENT')"

# 5. Run the multi-switch driver (auto-picks active tab as BACK and the
#    rightmost inactive tab as AWAY — edit ROUND_TRIPS / DWELL_MS in the
#    file if you want different timing)
agent-browser --cdp 9222 eval --stdin \
  < .agents/skills/local-testing/scripts/agent-gateway/tab-switch.js

# 6. Wait for streaming to finish, then dump
agent-browser --cdp 9222 eval --stdin \
  < .agents/skills/local-testing/scripts/agent-gateway/probe-dump.js \
  > /tmp/probe.json

# 7. Analyze
node .agents/skills/local-testing/scripts/agent-gateway/analyze.mjs /tmp/probe.json
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
