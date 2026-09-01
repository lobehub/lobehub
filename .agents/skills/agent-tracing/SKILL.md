---
name: agent-tracing
description: 'Agent tracing CLI for execution snapshots. Use for agent-tracing, traces, snapshots, LLM call inspection, context engine data, agent step analysis, execution debugging, or pulling remote/production traces ("拉线上 tracing") by operation id. Also the first stop for debugging agent tool calls — wrong or missing tool_calls, unexpected tool arguments or results, which tools were available at a step, or why a tool ran where it did.'
user-invocable: false
---

# Agent Tracing CLI Guide

`@lobechat/agent-tracing` is a zero-config local dev tool that records agent execution snapshots to disk and provides a CLI to inspect them.

## How It Works

In `NODE_ENV=development`, `AgentRuntimeService.executeStep()` automatically records each step to `.agent-tracing/` as partial snapshots. When the operation completes, the partial is finalized into a complete `ExecutionSnapshot` JSON file.

**Data flow**: executeStep loop -> build `StepPresentationData` -> write partial snapshot to disk -> on completion, finalize to `.agent-tracing/{timestamp}_{traceId}.json`

**Context engine capture**: In `RuntimeExecutors.ts`, the `call_llm` executor calls `ctx.tracingContextEngine(input, output)` after `serverMessagesEngine()` processes messages. `AgentRuntimeService.executeStep` buffers the call per step and forwards it to `OperationTraceRecorder.appendStep` as the typed `contextEngine` field. CE flows through this side channel rather than the `events` array so its heavy payload (agentDocuments, systemRole, …) never enters the Redis state pipeline (LOBE-9110).

## Package Location

```
packages/agent-tracing/
  src/
    types.ts          # ExecutionSnapshot, StepSnapshot, SnapshotSummary
    store/
      types.ts        # ISnapshotStore interface
      file-store.ts   # FileSnapshotStore (.agent-tracing/*.json)
    recorder/
      index.ts        # appendStepToPartial(), finalizeSnapshot()
    viewer/
      index.ts        # Terminal rendering: renderSnapshot, renderStepDetail, renderMessageDetail, renderSummaryTable, renderPayload, renderPayloadTools, renderMemory
    cli/
      index.ts        # CLI entry point (#!/usr/bin/env bun)
      inspect.ts      # Inspect command (default)
      partial.ts      # Partial snapshot commands (list, inspect, clean)
    index.ts          # Barrel exports
```

## Data Storage

- Completed snapshots: `.agent-tracing/{ISO-timestamp}_{traceId-short}.json`
- Latest symlink: `.agent-tracing/latest.json`
- In-progress partials: `.agent-tracing/_partial/{operationId}.json`
- Downloaded remote snapshots: `.agent-tracing/_remote/{operationId}.json`
- `FileSnapshotStore` resolves from `process.cwd()` — **run CLI from the repo root**

## Remote Traces (Production / Staging)

Server deployments also upload completed snapshots to object storage (zstd-compressed; the key is stored in `agent_operations.trace_s3_key`).

**Preferred: `lh trace op`.** The server resolves the key and signs the object for the caller's own scope, so a LobeHub login is the only requirement — no `TRACING_BASE_URL`, no bucket domain, and no SQL to turn a topic id into an operation id:

```bash
lh trace op list --topic tpc_xxx # operations of a topic, newest first, with a TRACE column
lh trace op inspect op_xxx_agt_xxx_tpc_xxx_xxxx
lh trace op inspect op_xxx_agt_xxx_tpc_xxx_xxxx -T # tool injection (enabledToolIds, manifests)
```

`TRACE = —` in `list` means no snapshot was recorded for that run (it predates trace upload, or upload was off). A recorded snapshot can still 404 in storage after its retention window.

Backend: the `agentTrace` lambda router (`getSnapshotUrl` / `listOperations`). Note it is `blocked` for restricted API keys, so these commands need a real session, not a scoped key.

**Fallback: the standalone `agent-tracing` CLI.** It has no LobeHub session, so it builds the object URL itself and needs the bucket's public domain configured:

- env var: `TRACING_BASE_URL=https://<bucket-public-domain>/agent-traces`
- or `.agent-tracing/.env` in the repo root with the same `TRACING_BASE_URL=...` line

The deployment-specific value is private to each deployment and intentionally not recorded in this repo. Find the operation id by hand first:

```sql
SELECT id, trace_s3_key FROM agent_operations WHERE topic_id = 'tpc_xxx';
```

Either way the snapshot is cached to `.agent-tracing/_remote/<opId>.json`, and every `inspect` flag works the same as for local traces.

Implementation: `packages/agent-tracing/src/store/loadSnapshot.ts` (resolution order: local store → `_remote/` cache → injected `resolveDownloadUrl` → `TRACING_BASE_URL`) and `store/remote-store.ts` (URL built as `{base}/{agentId}/{topicId}/{opId}.json.zst`). Reading a compressed snapshot needs Node >= 22.15.

## Goal Trajectories

A goal is one complete _goal_ execution the way an operation is one complete agent execution, so it gets the same trace format one level up: `GoalTrajectory : AdvanceSnapshot` mirrors `ExecutionSnapshot : StepSnapshot`. There is no table of advances, exactly as there is no `agent_steps` table — `goal_traces` holds one rollup row per goal plus the object key, and the detail lives in the object.

The leaves join back down: an advance records the `operationId`s it put in flight (on `tick.effects[].operationId`), so `lh trace op inspect <opId>` continues from where the goal trace stops.

```bash
agent-tracing goal               # list local goal trajectories
agent-tracing goal goal_xxx      # the run: triggers, outcomes, graph, gates, ops
agent-tracing goal goal_xxx -a 3 # one advance in full, with the frontier it ranked
agent-tracing goal goal_xxx -j   # raw JSON
```

What each tick records is the **decision input**, not just the result: the graph it read (as a delta against the previous tick), the budget it evaluated, the responsible task's state, and every eligible work node **including the ones it passed over**. Without the losers a trace cannot answer "why not that node".

**Storage** follows the operation switch, so a deployment that keeps one keeps the other:

- Completed: `goal-traces/{goalId}.json.zst`
- In progress: `goal-traces/_partial/{goalId}.json.zst` (an unfinished long-horizon goal is the normal thing to inspect)
- Dev: `.goal-tracing/{goalId}.json`

**Replay.** `replayGoalAgainstCurrentCoordinator(trajectory)` re-runs the real `decideNextMove` over the recorded inputs and reports `{advanceSeq, tickIndex, field, recorded, replayed}` wherever the current coordinator would now choose differently. This reproduces the coordinator's _decisions_ exactly; it says nothing about whether the dispatched work would have gone the same way.

Implementation: `packages/agent-tracing/src/goal/`, recorded through `apps/server/src/services/goal/advanceGoal.ts` (the single funnel every advance passes through) via the `onDecision` side channel on `GoalService.tick`.

## CLI Commands

All commands run from the **repo root**:

```bash
# View latest trace (tree overview, `inspect` is the default command)
agent-tracing
agent-tracing inspect
agent-tracing inspect <traceId>
agent-tracing inspect latest

# List recent snapshots
agent-tracing list
agent-tracing list -l 20

# Inspect specific step (-s is short for --step)
agent-tracing inspect <traceId> -s 0

# View messages (-m is short for --messages)
agent-tracing inspect <traceId> -s 0 -m

# View full content of a specific message (by index shown in -m output)
agent-tracing inspect <traceId> -s 0 --msg 2
agent-tracing inspect <traceId> -s 0 --msg-input 1

# View tool call/result details (-t is short for --tools)
agent-tracing inspect <traceId> -s 1 -t

# View raw events (-e is short for --events)
agent-tracing inspect <traceId> -s 0 -e

# View runtime context (-c is short for --context)
agent-tracing inspect <traceId> -s 0 -c

# View context engine input overview (-p is short for --payload)
agent-tracing inspect <traceId> -p
agent-tracing inspect <traceId> -s 0 -p

# View available tools in payload (-T is short for --payload-tools)
agent-tracing inspect <traceId> -T
agent-tracing inspect <traceId> -s 0 -T

# View user memory (-M is short for --memory)
agent-tracing inspect <traceId> -M
agent-tracing inspect <traceId> -s 0 -M

# Raw JSON output (-j is short for --json)
agent-tracing inspect <traceId> -j
agent-tracing inspect <traceId> -s 0 -j

# List in-progress partial snapshots
agent-tracing partial list

# Inspect a partial (use `inspect` directly — all flags work with partial IDs)
agent-tracing inspect <partialOperationId>
agent-tracing inspect <partialOperationId> -T
agent-tracing inspect <partialOperationId> -p

# Clean up stale partial snapshots
agent-tracing partial clean

# Map the context window composition of every LLM call (cm / map are aliases)
agent-tracing ctx-map
agent-tracing ctx-map <operationId|traceId|path.json>
agent-tracing ctx-map --html            # standalone report under .agent-tracing/_reports/
agent-tracing ctx-map --html out.html

# Re-issue a recorded LLM call against other models (see "replay" below)
agent-tracing replay <operationId|traceId|path.json>
agent-tracing replay <target> -s 4 -m openai/gpt-5,anthropic/claude-sonnet-5
agent-tracing replay <target> --all-steps
```

## replay — Re-issue a Frozen Call

A snapshot already freezes everything one LLM call saw: `steps[].contextEngine.output` is the
exact message array sent to the model, `context.payload.tools` the toolset it could reach.
`replay` sends that frozen payload back out with only the model swapped, so a difference in
output is attributable to the model rather than to context assembly. If every model fails the
same payload, the context is at fault; if some pass, it is model selection.

Available from both CLIs — `agent-tracing replay` (reads `LOBEHUB_JWT`) and `lh trace op replay`
(uses the `lh login` session). Both need credentials because the call goes out through the
LobeHub chat route.

```bash
# One call: defaults to the last call_llm step and the model the op ran on
lh trace op replay <operationId>
lh trace op replay <operationId> -s 4 -m openai/gpt-5,anthropic/claude-sonnet-5
lh trace op replay <operationId> --judge "answers with a concrete file path"

# Every call of the operation
lh trace op replay <operationId> --all-steps
lh trace op replay <operationId> --all-steps --concurrency 8
```

`--all-steps` answers the question the whole feature exists for: **take a run that succeeded, put
another model on it, and see whether that model also gets the job done.** It ends in a PASS / FAIL
verdict from an llm-rubric judge comparing the replayed outcome against the recorded one; pass
`--judge "<criteria>"` to define success yourself instead of using the default rubric.

The judge scores the **outcome, not the route**. A model that solved the same problem by calling
different tools has passed. The per-call tool comparison (`toolSignature`) is reported underneath
as supporting evidence — where the run took another path — and never decides pass / fail. A final
call that never reached the model is a FAIL, not a missing verdict.

Each call is replayed independently, against the payload the harness actually built for it, so a
different answer at call 2 cannot contaminate call 4, a call that fails to reach the provider
costs only itself, and the calls go out concurrently (4 at a time by default).

Chaining the nodes — feeding each replayed output into the next — was built and then removed. A
trace cannot regenerate tool output, only hand back what was recorded, so the moment the model
deviates there is no ground truth left; the run then measures nothing while still looking like it
succeeded. Independent replay is the design, not a fallback.

Known limitation: **sampling parameters are not recorded.** The recorder stores the runtime step
context under `context.payload`, not the provider request body, so temperature, `top_p`,
`max_tokens`, penalties and reasoning config are absent from every trace written so far. Replays
use the server's current defaults for those. Model-to-model comparisons stay valid (every target
gets the same request); comparisons against the recorded output do not, for an operation that ran
with non-default settings. `--temperature` / `--max-tokens` override explicitly. The CLI prints a
`note` line whenever a replay is running without recorded parameters.

## ctx-map — Context Window Composition

`ctx-map` renders one row per `call_llm` step: the messages that call sent to the model, split
into typed segments (system / injected block / user / reasoning / tool call / tool result) with
width proportional to tokens, laid against the model's context window.

The second axis is what `ctx-lint` cannot show: each row is diffed against the previous call, so
the longest identical **message prefix** — the part a provider's prefix cache can reuse — is
marked, along with the first message that mutated and the tokens re-processed behind it. A small
injected block carrying a relative timestamp (`1m ago` → `now`) invalidates every token after it,
which shows up as a break marker early in the row.

Reading a row:

- **Block colors** encode role directly: orange system, green user, blue assistant, gray tool.
  Assistant reasoning, content, and tool calls use different steps of the same blue scale;
  framework-injected blocks use a lighter orange than the system prompt. Every value is a step
  index into a LobeHub scale vendored in `viewer/contextMapScales.ts`, with assignments in
  `viewer/contextMapPalette.ts`. The HTML report ships both themes and follows the system theme.
- **Neutral message frames** group segments that belong to the same payload message. Every role
  uses the same frame color: the outline communicates structure only, while the block fill carries
  role and subtype semantics. The original framed layout uses padding inside each message and a
  small track gap between messages, keeping each payload message visually distinct.
- **Fill** says whether the provider reused it: shaded `▓` (HTML: 60%-opaque hatch) was served
  from the prefix cache; solid `█` (HTML: flat) was re-processed by the model.
- **The line under the track** is the cache ledger — a bracket / green band spanning exactly the
  cached prefix, then the break marker (`▲` in the terminal, a red rule through the track in
  HTML) at the column where reuse stopped, with the reason and the re-processed tokens.

| Flag            | Short | Description                                                |
| --------------- | ----- | ---------------------------------------------------------- |
| `--html [path]` |       | Standalone HTML report (hover a segment for its content)   |
| `--width <n>`   | `-w`  | Track width in terminal columns                            |
| `--window <n>`  |       | Override the model context window used as the track        |
| `--full-window` |       | Always scale to the full window, never to the largest call |
| `--json`        | `-j`  | Per-call segments + cache stats                            |

The track scales to the context window; when the window dwarfs the payloads (a 50k payload on a
1M window) it falls back to the largest call so the composition stays readable, and the header
says which basis is in use. Analysis lives in `analysis/contextMap.ts` and is exported as
`buildContextMap()` for downstream corpus work.

## Inspect Flag Reference

| Flag              | Short | Description                                                                                       | Default Step |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------- | ------------ |
| `--step <n>`      | `-s`  | Target a specific step                                                                            | —            |
| `--messages`      | `-m`  | Messages context (CE input → params → LLM payload)                                                | —            |
| `--tools`         | `-t`  | Tool calls & results (what agent invoked)                                                         | —            |
| `--events`        | `-e`  | Raw events (llm\_start, llm\_result, etc.)                                                        | —            |
| `--context`       | `-c`  | Runtime context & payload (raw)                                                                   | —            |
| `--system-role`   | `-r`  | Full system role content                                                                          | 0            |
| `--env`           |       | Environment context                                                                               | 0            |
| `--payload`       | `-p`  | Context engine input overview (model, knowledge, tools summary, memory summary, platform context) | 0            |
| `--payload-tools` | `-T`  | Available tools detail (plugin manifests + LLM function definitions)                              | 0            |
| `--memory`        | `-M`  | Full user memory (persona, identity, contexts, preferences, experiences)                          | 0            |
| `--diff <n>`      | `-d`  | Diff against step N (use with `-r` or `--env`)                                                    | —            |
| `--msg <n>`       |       | Full content of message N from Final LLM Payload                                                  | —            |
| `--msg-input <n>` |       | Full content of message N from Context Engine Input                                               | —            |
| `--json`          | `-j`  | Output as JSON (combinable with any flag above)                                                   | —            |

Flags marked "Default Step: 0" auto-select step 0 if `--step` is not provided. All flags support `latest` or omitted traceId.

## Typical Debug Workflow

```bash
# 1. Trigger an agent operation in the dev UI

# 2. See the overview
agent-tracing inspect

# 3. List all traces, get traceId
agent-tracing list

# 4. Quick overview of what was fed into context engine
agent-tracing inspect -p

# 5. Inspect a specific step's messages to see what was sent to the LLM
agent-tracing inspect TRACE_ID -s 0 -m

# 6. Drill into a truncated message for full content
agent-tracing inspect TRACE_ID -s 0 --msg 2

# 7. Check available tools vs actual tool calls
agent-tracing inspect -T      # available tools
agent-tracing inspect -s 1 -t # actual tool calls & results

# 8. Inspect user memory injected into the conversation
agent-tracing inspect -M

# 9. Diff system role between steps (multi-step agents)
agent-tracing inspect TRACE_ID -r -d 2
```

## Key Types

```typescript
interface ExecutionSnapshot {
  traceId: string;
  operationId: string;
  model?: string;
  provider?: string;
  startedAt: number;
  completedAt?: number;
  completionReason?:
    'done' | 'error' | 'interrupted' | 'max_steps' | 'cost_limit' | 'waiting_for_human';
  totalSteps: number;
  totalTokens: number;
  totalCost: number;
  error?: { type: string; message: string };
  steps: StepSnapshot[];
}

interface StepSnapshot {
  stepIndex: number;
  stepType: 'call_llm' | 'call_tool';
  executionTimeMs: number;
  content?: string; // LLM output
  reasoning?: string; // Reasoning/thinking
  inputTokens?: number;
  outputTokens?: number;
  toolsCalling?: Array<{ apiName: string; identifier: string; arguments?: string }>;
  toolsResult?: Array<{
    apiName: string;
    identifier: string;
    isSuccess?: boolean;
    output?: string;
  }>;
  messages?: any[]; // DB messages before step
  context?: { phase: string; payload?: unknown; stepContext?: unknown };
  events?: Array<{ type: string; [key: string]: unknown }>;
  contextEngine?: {
    input?: unknown; // contextEngineInput minus messages + toolsConfig (reconstructible from baseline)
    output?: unknown; // processed messages array (final LLM payload)
  };
}
```

## --messages Output Structure

When using `--messages`, the output shows three sections (if context engine data is available):

1. **Context Engine Input** — DB messages passed to the engine, with `[0]`, `[1]`, ... indices. Use `--msg-input N` to view full content.
2. **Context Engine Params** — systemRole, model, provider, knowledge, tools, userMemory, etc.
3. **Final LLM Payload** — Processed messages after context engine (system date injection, user memory, history truncation, etc.), with `[0]`, `[1]`, ... indices. Use `--msg N` to view full content.

## Integration Points

- **Recording**: `apps/server/src/services/agentRuntime/AgentRuntimeService.ts` — in the `executeStep()` method, after building `stepPresentationData`, writes partial snapshot in dev mode
- **Context engine capture**: `apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts` — in `call_llm` executor, after `serverMessagesEngine()` returns, calls `ctx.tracingContextEngine(input, output)`. `AgentRuntimeService.executeStep` buffers it per step and passes it to `traceRecorder.appendStep` as the typed `contextEngine` field (kept off the `events` array to stay out of Redis state).
- **Store**: `FileSnapshotStore` reads/writes to `.agent-tracing/` relative to `process.cwd()`
