---
name: heterogeneous-agent
description: Guide for implementing and debugging LobeHub heterogeneous agent integrations such as Claude Code, Codex, and future external CLI agents. Use when working on adapter event mapping, Electron IPC transport, renderer persistence, tool-call chaining, subagent threads, resume/session handling, or regressions like mixed multi-tool messages, broken step boundaries, stuck tool loading, and orphan tool messages. Triggers on 'heterogeneous agent', 'hetero agent', '异构 agent', 'claude code adapter', 'codex adapter', 'external agent CLI', '孤立 tool 消息', 'raw Codex trace', or adapter/executor bugs.
---

# Heterogeneous Agent Development

Use this skill when the bug or feature lives in the external CLI agent pipeline, not the normal server-side agent runtime.

## Use This Skill For

- Adding or changing a driver under `apps/desktop/src/main/modules/heterogeneousAgent/drivers/`
- Editing an adapter under `packages/heterogeneous-agents/src/adapters/`
- Debugging `heteroAgentRawLine` transport, `window.__HETERO_AGENT_TRACE`, or `executeHeterogeneousAgent`
- Fixing Claude Code stream-json bugs such as duplicate partial/full chunks, broken `message.id` boundaries, missing `tool_result`, TodoWrite state drift, or subagent thread routing
- Fixing Codex JSONL bugs such as mixed multi-tool messages, broken turn boundaries, or missing tool-result mapping
- Fixing step-boundary, tool persistence, subagent thread, or resume bugs in Claude Code / Codex flows
- Reproducing multi-tool mixing, orphan tool messages, or stuck tool-result loading

## Pipeline Map

1. CLI raw stdout / JSONL
2. Electron main spawns the CLI and broadcasts `heteroAgentRawLine`
3. Adapter maps raw provider events into `HeterogeneousAgentEvent`
4. `executeHeterogeneousAgent` persists assistant/tool messages and forwards stream events
5. `createGatewayEventHandler` hydrates the UI
6. Only after this path looks correct should you move on to `agent-tracing` or context-engine debugging

## Read These Files First

- `apps/desktop/src/main/controllers/HeterogeneousAgentCtr.ts`
- `apps/desktop/src/main/modules/heterogeneousAgent/drivers/claudeCode.ts`
- `apps/desktop/src/main/modules/heterogeneousAgent/drivers/codex.ts`
- `packages/heterogeneous-agents/src/adapters/claudeCode.ts`
- `packages/heterogeneous-agents/src/adapters/codex.ts`
- `src/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/heterogeneousAgentExecutor.test.ts`

## Default Debug Order

1. Prove whether the raw CLI output is correct before touching UI code.
2. If raw output is correct, compare it with adapter output. In dev, `executeHeterogeneousAgent` exposes `window.__HETERO_AGENT_TRACE`.
3. If adapted events look correct, inspect `persistToolBatch`, `persistToolResult`, step transitions, and subagent routing.
4. Turn the repro into a focused test before fixing.
5. Only after the transport/adapter/executor path looks sound should you debug later-stage message processing.

## Critical Invariants

- One raw tool item must map to one stable `ToolCallPayload.id`.
- A new main-agent step must emit a boundary signal before events are forwarded to the new assistant.
- In Claude Code, multiple assistant events with the same `message.id` are one turn, not multiple turns.
- In Claude Code, `tool_result` lives in `type: 'user'` events, not assistant events.
- In Claude Code partial mode, `message_delta.usage` is authoritative; do not trust echoed usage on every assistant block.
- `persistToolBatch` must pre-register assistant `tools[]` before creating tool messages.
- Every tool message must keep `parentId` equal to the owning assistant and `tool_call_id` equal to the tool id.
- `tool_result` must resolve an existing `toolMsgIdByCallId`.
- Subagent chunks must stay in thread scope and must not be forwarded into the main assistant stream.
- Never clear the global `toolMsgIdByCallId` map at main step boundaries.

## Common Bug Patterns

- Claude Code duplicates text or thinking:
  check whether partial deltas and the later full assistant block are both being emitted.
- Claude Code opens too many assistant messages:
  check whether the adapter is cutting steps on every assistant event instead of only on `message.id` changes.
- Claude Code tool results never land:
  check whether `type: 'user'` `tool_result` blocks are being ignored because the code only inspects assistant events.
- Claude Code TodoWrite cards look stale:
  check whether synthesized `pluginState.todos` is being attached at tool-result time.
- Claude Code subagent transcript leaks into the main bubble:
  check `parent_tool_use_id` handling and whether subagent chunks are being forwarded to the main gateway handler.
- Multiple Codex tools collapse into one assistant message:
  first check whether the adapter emits a usable step boundary such as `newStep` or an equivalent turn-change signal.
- Orphan tool messages:
  first check step-transition ordering and whether `persistToolBatch` Phase 1 ran before tool message creation.
- Tool bubble stays loading:
  look for `tool_result for unknown toolCallId` and missing `result_msg_id` backfill.
- Subagent tools show up in the main bubble:
  check for subagent chunks reaching the main gateway handler.

## References

- For commands, trace capture, invariants, and focused test commands, read [references/debug-workflow.md](./references/debug-workflow.md).
