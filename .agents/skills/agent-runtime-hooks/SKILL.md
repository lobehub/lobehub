---
name: agent-runtime-hooks
description: 'Agent runtime lifecycle hooks. Use for before/after tool or step hooks, tool mocks, human intervention, sub-agent calls, context compression, evals, tracing, callAgent, or lifecycle events.'
user-invocable: false
---

# Agent Runtime Hooks

Lifecycle hooks for observing and intercepting agent execution. Hooks are registered per-operation via `execAgent({ hooks })` and dispatched by `HookDispatcher`.

## Hook Types

16 hook types across 5 categories:

```
execAgent({ hooks })
  │
  ├─ beforeStep ──────────── Before each step executes
  │     │
  │     ├─ [call_llm]        LLM inference
  │     │
  │     ├─ [call_tool]
  │     │     ├─ beforeToolCall ── Before tool executes (supports mocking)
  │     │     ├─ (tool execution)
  │     │     ├─ afterToolCall ─── After tool completes (observation only)
  │     │     └─ onToolCallError ─ Tool threw an exception
  │     │
  │     ├─ [request_human_approve]
  │     │     ├─ beforeHumanIntervention ── Before agent pauses
  │     │     ├─ afterHumanIntervention ─── After approve/reject + resume
  │     │     └─ onStopByHumanIntervention ── User rejected, agent halted
  │     │
  │     ├─ [compress_context]
  │     │     ├─ beforeCompact ──── Before compression starts
  │     │     ├─ afterCompact ───── After compression completes
  │     │     └─ onCompactError ─── Compression failed
  │     │
  │     ├─ [callAgent] (via execSubAgentTask)
  │     │     ├─ beforeCallAgent ── Before sub-agent starts
  │     │     ├─ afterCallAgent ─── After sub-agent completes
  │     │     └─ onCallAgentError ── Sub-agent failed
  │     │
  │     └─ afterStep ──────────── After step completes
  │
  ├─ (next step...)
  │
  ├─ onComplete ───────────── Operation reaches terminal state
  └─ onError ──────────────── Error during execution
```

## Key Files

| File                                                            | Role                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/agent-runtime/src/types/hooks.ts`                     | Type definitions (AgentHookType, all event interfaces) |
| `apps/server/src/services/agentRuntime/hooks/types.ts`          | Server-side types (AgentHook, re-exports)              |
| `apps/server/src/services/agentRuntime/hooks/HookDispatcher.ts` | Registration, dispatch, dispatchBeforeToolCall         |
| `apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts`      | Tool/Compact/HumanIntervention hook dispatch           |
| `apps/server/src/services/agentRuntime/AgentRuntimeService.ts`  | Step hooks + HumanIntervention resume/reject           |
| `apps/server/src/services/aiAgent/index.ts`                     | CallAgent hook dispatch                                |

## Registration Flow

```ts
const hooks: AgentHook[] = [
  { id: 'my-hook', type: 'afterStep', handler: async (event) => { ... } },
];
await aiAgentService.execAgent({ agentId, prompt, hooks });
// Internally: hookDispatcher.register(operationId, hooks)
// Cleanup:    hookDispatcher.unregister(operationId)
```

## Hook Reference

### Step Level

**`beforeStep`** — Before each step. `event: AgentHookEvent`
**`afterStep`** — After each step. `event: AgentHookEvent` (content, toolsCalling, totalCost, etc.)
**`onComplete`** — Terminal state. `event: AgentHookEvent` (reason: done/error/interrupted/max\_steps/cost\_limit)
**`onError`** — Error occurred. `event: AgentHookEvent` (errorMessage, errorDetail)

### Tool Call Level

**`beforeToolCall`** — Before tool executes. **Supports mocking** via `event.mock()`.

```ts
// event: ToolCallHookEvent
{
  (identifier, apiName, args, callIndex, stepIndex, operationId, mock);
}
// Mock example:
event.mock({ content: '{"error":"rate limited"}' });
```

Dispatch method: `hookDispatcher.dispatchBeforeToolCall()` (returns mock result or null).

**`afterToolCall`** — After tool completes. Observation only.

```ts
// event: AfterToolCallHookEvent
{
  (identifier, apiName, args, callIndex, content, success, mocked, executionTimeMs, stepIndex);
}
```

**`onToolCallError`** — Tool threw an exception (catch block, not just `success=false`).

```ts
// event: ToolCallErrorHookEvent
{
  (identifier, apiName, args, callIndex, error, stepIndex);
}
```

### Human Intervention

**`beforeHumanIntervention`** — Before agent pauses for approval.

```ts
// event: BeforeHumanInterventionHookEvent
{ operationId, stepIndex, pendingTools: [{ identifier, apiName }] }
```

**`afterHumanIntervention`** — After approve/reject, agent resumes.

```ts
// event: AfterHumanInterventionHookEvent
{ operationId, action: 'approve' | 'reject' | 'rejectAndContinue', toolCallId?, rejectionReason? }
```

**`onStopByHumanIntervention`** — User rejected, agent halted.

```ts
// event: StopByHumanInterventionHookEvent
{ operationId, toolCallId?, rejectionReason? }
```

### Context Compression

**`beforeCompact`** — Before compression starts.

```ts
// event: BeforeCompactHookEvent
{
  (operationId, stepIndex, messageCount, tokenCount);
}
```

**`afterCompact`** — After compression completes.

```ts
// event: AfterCompactHookEvent
{
  (operationId, stepIndex, groupId, messagesBefore, messagesAfter, summary);
}
```

**`onCompactError`** — Compression failed.

```ts
// event: CompactErrorHookEvent
{
  (operationId, stepIndex, tokenCount, error);
}
```

### Sub-Agent (CallAgent)

**`beforeCallAgent`** — Before calling sub-agent. Dispatched on **parent** operation.

```ts
// event: BeforeCallAgentHookEvent
{
  (operationId, agentId, instruction);
}
```

**`afterCallAgent`** — Sub-agent completed. Dispatched on **parent** operation.

```ts
// event: AfterCallAgentHookEvent
{
  (operationId, agentId, subOperationId, threadId, success);
}
```

**`onCallAgentError`** — Sub-agent failed. Dispatched on **parent** operation.

```ts
// event: CallAgentErrorHookEvent
{
  (operationId, agentId, error);
}
```

Note: CallAgent hooks require `parentOperationId` in `ExecSubAgentTaskParams`.

## Design Notes

- **Fire-and-forget**: All handlers return `Promise<void>`. Errors are non-fatal.
- **Exception**: `beforeToolCall` supports mock via `event.mock()` — uses `dispatchBeforeToolCall()` which returns the mock result.
- **Sequential**: Same-type hooks run in registration order.
- **Local only**: `beforeToolCall` mock only works in local mode (in-memory hooks). Webhook mode does not support mocking.
- **Scoped per operation**: Auto-cleaned via `hookDispatcher.unregister()` on completion.
- **Sandbox/MCP**: No separate hooks — they go through `executeTool`, so `beforeToolCall`/`afterToolCall` cover them. Use `event.identifier` to filter.

## LLM Generation Tracing

Treat `scenario` as the stable product-workflow partition key, not as a label for a shared prompt, schema, model, or helper.

- Check `packages/const/src/llmGenerationTracing.ts` before adding a generation call.
- Reuse a scenario only when the call belongs to the same user-visible workflow and lifecycle stage.
- Add a new `TRACING_SCENARIOS` entry when the business action differs, even if it reuses the same prompt or JSON schema. For example, editable `createGoal` criteria drafting and run-time verify-plan generation require separate scenarios.
- Never borrow a nearby scenario as a placeholder. It corrupts latency, cost, success-rate, and quality dashboards for both workflows.
- Keep `promptVersion` next to the prompt it versions, format it as `v<major>` or `v<major>.<minor>`, and pass `schemaName` for structured generation. Do not prefix the version with the scenario or feature name; `scenario` already carries that identity.
- Add a regression assertion on the emitted tracing options whenever introducing or correcting a scenario.

## Real-World Example: agent-evals

See `devtools/agent-evals/helpers/runner.ts` — `createEvalHooks()` uses `afterStep`, `onComplete`, `afterToolCall`, and `beforeToolCall` (for mock).
