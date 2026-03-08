---
name: agent-tracing
description: "Agent tracing CLI for inspecting agent execution snapshots. Use when user mentions 'agent-tracing', 'trace', 'snapshot', wants to debug agent execution, inspect LLM calls, view context engine data, or analyze agent steps. Triggers on agent debugging, trace inspection, or execution analysis tasks."
user-invocable: false
---

# Agent Tracing CLI Guide

`@lobechat/agent-tracing` is a zero-config local dev tool that records agent execution snapshots to disk and provides a CLI to inspect them.

## How It Works

In `NODE_ENV=development`, `AgentRuntimeService.executeStep()` automatically records each step to `.agent-tracing/` as partial snapshots. When the operation completes, the partial is finalized into a complete `ExecutionSnapshot` JSON file.

**Data flow**: executeStep loop -> build `StepPresentationData` -> write partial snapshot to disk -> on completion, finalize to `.agent-tracing/{timestamp}_{traceId}.json`

**Context engine capture**: In `RuntimeExecutors.ts`, the `call_llm` executor emits a `context_engine_result` event after `serverMessagesEngine()` processes messages. This event carries the full `contextEngineInput` (DB messages, systemRole, model, knowledge, tools, userMemory, etc.) and the processed `output` messages (the final LLM payload).

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
- `FileSnapshotStore` resolves from `process.cwd()` — **run CLI from the repo root**

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

# Inspect a partial snapshot (defaults to latest)
agent-tracing partial inspect
agent-tracing partial inspect <operationId>
agent-tracing partial inspect -j

# Clean up stale partial snapshots
agent-tracing partial clean
```

## Inspect Flag Reference

| Flag              | Short | Description                                                                                       | Default Step |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------- | ------------ |
| `--step <n>`      | `-s`  | Target a specific step                                                                            | —            |
| `--messages`      | `-m`  | Messages context (CE input → params → LLM payload)                                                | —            |
| `--tools`         | `-t`  | Tool calls & results (what agent invoked)                                                         | —            |
| `--events`        | `-e`  | Raw events (llm_start, llm_result, etc.)                                                          | —            |
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
    | 'done'
    | 'error'
    | 'interrupted'
    | 'max_steps'
    | 'cost_limit'
    | 'waiting_for_human';
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
  // context_engine_result event contains:
  //   input: full contextEngineInput (messages, systemRole, model, knowledge, tools, userMemory, ...)
  //   output: processed messages array (final LLM payload)
}
```

## --messages Output Structure

When using `--messages`, the output shows three sections (if context engine data is available):

1. **Context Engine Input** — DB messages passed to the engine, with `[0]`, `[1]`, ... indices. Use `--msg-input N` to view full content.
2. **Context Engine Params** — systemRole, model, provider, knowledge, tools, userMemory, etc.
3. **Final LLM Payload** — Processed messages after context engine (system date injection, user memory, history truncation, etc.), with `[0]`, `[1]`, ... indices. Use `--msg N` to view full content.

## Integration Points

- **Recording**: `src/server/services/agentRuntime/AgentRuntimeService.ts` — in the `executeStep()` method, after building `stepPresentationData`, writes partial snapshot in dev mode
- **Context engine event**: `src/server/modules/AgentRuntime/RuntimeExecutors.ts` — in `call_llm` executor, after `serverMessagesEngine()` returns, emits `context_engine_result` event
- **Store**: `FileSnapshotStore` reads/writes to `.agent-tracing/` relative to `process.cwd()`
