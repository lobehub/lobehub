# Heterogeneous Agent Debug Workflow

## Contents

1. Pipeline map
2. Capture raw CLI traces first
3. Compare raw and adapted events
4. Check step boundaries before persistence
5. Check tool persistence invariants
6. Focused tests
7. Repro-to-fix workflow

## 1. Pipeline Map

```
CLI raw stdout
  -> HeterogeneousAgentCtr (Electron main)
  -> heteroAgentRawLine broadcast
  -> createAdapter(...)
  -> executeHeterogeneousAgent(...)
  -> persistToolBatch / persistToolResult
  -> createGatewayEventHandler(...)
  -> UI hydration
```

Start at the leftmost broken layer. Do not jump straight to UI rendering unless raw and adapted events already look correct.

## 2. Capture Raw CLI Traces First

### Codex raw JSONL

Use a read-only prompt and save traces under the repo-local scratch directory `.heerogeneous-tracing/`.

```bash
ts=$(date +%Y%m%d-%H%M%S)
out=".heerogeneous-tracing/codex-${ts}.jsonl"
last=".heerogeneous-tracing/codex-${ts}.last.txt"

cat << 'EOF' | codex exec --json --skip-git-repo-check --sandbox read-only -C "$PWD" -o "$last" - > "$out"
You are being run only to collect a raw Codex JSON event trace.
Do not modify any files.
Use at least 4 separate shell tool invocations, one invocation per command.
Run a short sequence of read-only repo checks and then reply with a one-sentence summary.
EOF
```

What to look for in the JSONL:

- `thread.started`
- `turn.started`
- `item.started` / `item.completed`
- `item.type === 'command_execution'`
- `item.type === 'agent_message'`
- `turn.completed`

If raw Codex already merges tools into one item, the adapter is innocent. If raw Codex emits independent items but UI collapses them, the bug is downstream.

If the repo already contains useful traces under `.heerogeneous-tracing/`, inspect them before reproducing.

### Claude Code raw NDJSON

Mirror the arguments from `apps/desktop/src/main/modules/heterogeneousAgent/drivers/claudeCode.ts`.

- `-p`
- `--input-format stream-json`
- `--output-format stream-json`
- `--verbose`
- `--include-partial-messages`
- `--permission-mode bypassPermissions`

You can capture a local raw trace like this:

```bash
ts=$(date +%Y%m%d-%H%M%S)
out=".heerogeneous-tracing/claude-${ts}.ndjson"

cat << 'EOF' | claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --permission-mode bypassPermissions \
  > "$out"
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Do a few read-only repo checks, use several tool calls, and then summarize briefly."}]}}
EOF
```

What to look for in Claude Code raw traces:

- `type: 'system', subtype: 'init'`
- `type: 'assistant'` blocks for `thinking`, `tool_use`, and `text`
- `type: 'user'` blocks containing `tool_result`
- `type: 'stream_event'` with `message_start`, `content_block_delta`, and `message_delta`
- `type: 'result'`
- `type: 'rate_limit_event'`

Important Claude Code semantics:

- Each content block often arrives as its own assistant event.
- Multiple assistant events can share the same `message.id`; that is still one turn.
- `message.id` change is the main-step boundary.
- Partial deltas arrive before the later full assistant block.
- `message_delta.usage` is the authoritative per-turn usage.
- Subagent events are tagged with `parent_tool_use_id`.

If the repo already contains useful references, inspect these first:

- `.heerogeneous-tracing/cc-monitor-real-trace.jsonl`
- `.heerogeneous-tracing/cc-stream-chain-reference.md`

If you only need boundary semantics or tool persistence behavior, prefer existing adapter tests under:

- `packages/heterogeneous-agents/src/adapters/claudeCode.test.ts`
- `packages/heterogeneous-agents/src/adapters/claudeCode.e2e.test.ts`

## 3. Compare Raw And Adapted Events

In dev builds, `executeHeterogeneousAgent` stores raw lines plus adapted events on:

- `window.__HETERO_AGENT_TRACE`

Use that trace to compare:

- raw `item.started` / `item.completed`
- adapted `stream_chunk { chunkType: 'tools_calling' }`
- adapted `tool_result`
- adapted `tool_end`

For Codex, the usual mapping is:

- raw `item.started(command_execution)` -> `tools_calling` + `tool_start`
- raw `item.completed(command_execution)` -> `tool_result` + `tool_end`
- raw `item.completed(agent_message)` -> `stream_chunk(text)`

If the raw trace is right but adapted events are wrong, fix the adapter before touching persistence.

## 4. Check Step Boundaries Before Persistence

This is the first thing to verify for "mixed tools in one assistant" bugs.

### Claude Code

Claude Code step boundaries are keyed off assistant `message.id` changes. The adapter should emit:

- `stream_end`
- `stream_start { newStep: true }`

Also verify these Claude-specific invariants:

- the first assistant after init does not open a new step
- repeated assistant events with the same `message.id` do not open a new step
- partial `content_block_delta` text/thinking does not get duplicated by the later full assistant event
- `tool_result` from `type: 'user'` updates the matching tool row
- `parent_tool_use_id` creates thread-scoped subagent chunks instead of main-stream chunks
- TodoWrite `tool_use.input` is converted into synthesized `pluginState.todos` on `tool_result`

Good references:

- `packages/heterogeneous-agents/src/adapters/claudeCode.ts`
- `packages/heterogeneous-agents/src/adapters/claudeCode.test.ts`

### Codex

Codex raw traces usually provide turn-level boundaries through:

- `turn.started`
- `turn.completed`

The executor only cuts a new assistant message when it receives a step-boundary signal it understands. If the adapter emits `stream_start` without `newStep`, multiple Codex tools and text chunks can accumulate under the same assistant longer than intended.

Relevant files:

- `packages/heterogeneous-agents/src/adapters/codex.ts`
- `src/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor.ts`

## 5. Check Tool Persistence Invariants

Read `persistToolBatch` and `persistToolResult` before changing UI code.

### `persistToolBatch`

The expected order is:

1. Pre-register assistant `tools[]`
2. Create `role: 'tool'` messages
3. Backfill `result_msg_id` onto assistant `tools[]`

If tool rows are created before assistant `tools[]` are registered, orphan tool messages are likely.

### `persistToolResult`

`tool_result` must resolve the tool row through `toolMsgIdByCallId`.

Warning signs:

- `tool_result for unknown toolCallId`
- tool rows with empty content forever
- missing `result_msg_id`

For Claude Code, remember that tool results originate from raw `type: 'user'` events.

### Main vs subagent scope

- Main-agent tool state is per-step.
- `toolMsgIdByCallId` is global across main and subagent scopes.
- Subagent chunks must not be forwarded into the main gateway handler.

If subagent events leak to the main handler, the main bubble can inherit the wrong `tools[]` and content.

## 6. Focused Tests

Run the smallest useful test set first.

```bash
bunx vitest run --silent='passed-only' 'packages/heterogeneous-agents/src/adapters/codex.test.ts'
bunx vitest run --silent='passed-only' 'packages/heterogeneous-agents/src/adapters/claudeCode.test.ts'
bunx vitest run --silent='passed-only' 'src/store/chat/slices/aiChat/actions/__tests__/heterogeneousAgentExecutor.test.ts'
```

Especially useful places:

- `packages/heterogeneous-agents/src/adapters/codex.test.ts`
- `packages/heterogeneous-agents/src/adapters/claudeCode.test.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/heterogeneousAgentExecutor.test.ts`

Claude Code-specific assertions worth adding when fixing bugs:

- same `message.id` does not emit `newStep`
- changed `message.id` does emit `stream_end` plus `stream_start { newStep: true }`
- partial text/thinking is emitted once
- `tool_result` from `user` events reaches the right tool row
- subagent chunks carry `subagent.parentToolCallId`
- TodoWrite result synthesizes `pluginState.todos`

When the bug comes from a real trace, distill it into the closest existing test file instead of relying on manual UI-only repros.

## 7. Repro-To-Fix Workflow

1. Capture a raw trace and save it under `.heerogeneous-tracing/`.
2. Confirm whether the bug appears in raw events, adapted events, or persistence.
3. Add or update the narrowest failing test near the broken layer.
4. Fix the smallest layer that can explain the symptom.
5. Re-run focused tests.
6. Only then do an Electron smoke test with the `local-testing` skill if UI confirmation is still needed.

Do not start with a broad Electron repro if a raw trace or adapter test can prove the fault zone faster.
