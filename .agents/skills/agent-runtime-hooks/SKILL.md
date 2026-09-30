---
name: agent-runtime-hooks
description: 'Use for agent lifecycle hooks, tool mocks, intervention, sub-agent calls and context compression.'
user-invocable: false
---

# Agent Runtime Hooks

Register lifecycle hooks through `execAgent({ hooks })`. `HookDispatcher` stores them per operation and dispatches them in registration order.

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
  │     │     ├─ afterCallAgent ─── After creation/start returns
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

| File                                                                   | Role                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/agent-runtime/src/types/hooks.ts`                            | Event types and required/optional fields                  |
| `apps/server/src/services/agentRuntime/hooks/types.ts`                 | Registration and webhook types                            |
| `apps/server/src/services/agentRuntime/hooks/HookDispatcher.ts`        | Registration, dispatch, local mocks, HTTP/QStash delivery |
| `apps/server/src/services/agentRuntime/hooks/webhookPayload.ts`        | Event projection and email enrichment                     |
| `apps/server/src/modules/AgentRuntime/adapters/toolCallHookContext.ts` | Shared tool-event context builder                         |
| `apps/server/src/modules/AgentRuntime/adapters/ServerToolTransport.ts` | Tool notifications and execution results                  |
| `apps/server/src/modules/AgentRuntime/RuntimeExecutors.ts`             | Tool, compression and human-intervention execution        |
| `apps/server/src/services/agentRuntime/AgentRuntimeService.ts`         | Step events and human-intervention continuation           |
| `apps/server/src/services/agentRuntime/CompletionLifecycle.ts`         | Terminal events                                           |
| `apps/server/src/services/aiAgent/subAgentRuns.ts`                     | Sub-agent events                                          |

## Registration

```ts
const hooks: AgentHook[] = [
  {
    id: 'observe-step',
    type: 'afterStep',
    handler: async (event) => {
      console.log(event.operationId, event.stepIndex);
    },
  },
];
await aiAgentService.execAgent({ agentId, prompt, hooks });
```

Completion cleans up registrations through `hookDispatcher.unregister(operationId)`.

### Webhook Hooks

Webhook-only hooks deliver in both local and queue modes. For hooks with both `handler` and `webhook`, local dispatch calls the handler; queue dispatch uses the serialized webhook. Only webhook configuration is persisted, so functions are unavailable after a process restart.

```ts
const hook: AgentHook = {
  id: 'tool-notification',
  type: 'afterToolCall',
  matcher: '^fs/readFile$',
  webhook: {
    url: 'https://example.com/hooks',
    delivery: 'fetch',
    timeout: 5, // seconds; default 30
    headers: { Authorization: 'Bearer ${HOOK_TOKEN}' },
    allowedEnvVars: ['HOOK_TOKEN'],
  },
};
```

- `matcher` is a regex against `${identifier}/${apiName}`, supported only on tool events. Omitted, empty, or `*` matches all tools.
- Header environment templates resolve only at send time from `allowedEnvVars`; persist templates, never resolved secrets.
- Notifications ignore response content and may return HTTP 204.
- `beforeToolCall` with `responseHandling: 'toolCall'` awaits an HTTP control response before tool execution. Return HTTP 200 JSON with `{ "decision": "allow" }` or `{ "decision": "deny", "reason": "禁止执行该操作" }`. The type is `{ decision: 'allow' } | { decision: 'deny'; reason?: string }`; a deny without reason uses `Blocked by beforeToolCall hook.`. Denials preserve the reason in the tool result/card with classification `hook_denied`.
- Empty bodies, HTTP 204 or other non-200 status, invalid JSON, missing/invalid decisions, and responses containing only the old nested `hookSpecificOutput` format are protocol errors. They follow the control hook's `onError: 'continue' | 'block'` policy (default `continue`); an empty response is never an allow decision.
- Extra response fields are allowed and discarded. Only `decision` and a deny's optional string `reason` are consumed; `updatedInput`/`additionalContext` do not change tool arguments or conversation context.
- Configuration: `packages/types/src/agentHook.ts`; response parsing: `packages/types/src/agentHookResponse.ts`; HTTP delivery: `apps/server/src/services/agentRuntime/hooks/httpWebhook.ts`.

## Events

| Event                       | Timing and payload                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `beforeStep`                | Before a step; `AgentHookEvent`                                                            |
| `afterStep`                 | After a step; content, tool calls/results and usage totals                                 |
| `onComplete`                | Terminal state; reason such as `done`, `error`, `interrupted`, `max_steps` or `cost_limit` |
| `onError`                   | Operation error; `errorMessage`, `errorDetail` and available error metadata                |
| `beforeToolCall`            | Before tool execution; shared tool context and local `mock()` callback                     |
| `afterToolCall`             | After tool execution; structured `result` and `mocked`                                     |
| `onToolCallError`           | Tool execution throws; shared tool context and `error`                                     |
| `beforeHumanIntervention`   | Before approval; `pendingTools`, `operationId`, `stepIndex`                                |
| `afterHumanIntervention`    | Approval decision and continuation; `action`, optional `toolCallId` and `rejectionReason`  |
| `onStopByHumanIntervention` | Human rejection stops the run; optional `toolCallId` and `rejectionReason`                 |
| `beforeCompact`             | Before compression; `messageCount`, `tokenCount`, `stepIndex`                              |
| `afterCompact`              | After compression; `groupId`, `messagesBefore`, `messagesAfter`, `summary`                 |
| `onCompactError`            | Compression error; `error`, `tokenCount`, `stepIndex`                                      |
| `beforeCallAgent`           | Before sub-agent creation; `agentId`, `instruction`                                        |
| `afterCallAgent`            | Creation/start returns; `agentId`, `subOperationId`, `success`, optional `threadId`        |
| `onCallAgentError`          | Sub-agent call fails; `agentId`, `error`                                                   |

CallAgent events dispatch on the parent operation identified by `parentOperationId`. An isolated child supplies `threadId`; shared group members use the shared conversation. Child completion is reported by the child's `onComplete` event.

## Tool Context

Use `buildToolCallHookContext()` for the three tool events.

- Required fields: native `toolCallId`, `assistantMessageId`, `identifier`, `apiName`, effective `args`, `callIndex`, `stepIndex`, `operationId` and `executor`.
- Optional associations come from the run context: agent, topic, session, thread, group, task, workspace, document, source/tool message and parent operation IDs.
- `userId` uses `runtime.userId ?? origin.userId`.
- `toolSource` identifies the tool's origin; `executor` identifies the server/client dispatch route. `executionTarget` and `activeDeviceId` describe the run's execution plan and device selection.
- `afterToolCall.result` carries `content`, `success`, optional `executionTime` and error/state data such as `state.type: 'blocked'`. `mocked` marks results supplied by a local hook.

Sandbox and MCP tools use the same event path. Filter with `identifier`, `apiName` or `toolSource`.

### Local Mocking

`dispatchBeforeToolCall()` exposes `event.mock(result)`. The first accepted mock wins and short-circuits the remaining mock handlers. The method returns `{ isMocked: true, result }` for a mock, or `null` to continue execution.

```ts
event.mock({ content: '{"items":[]}', success: true });
```

Tool observation payloads use `BeforeToolCallObservationEvent`; the callback belongs to the in-memory handler event. `dispatchBeforeToolCall()` does not deliver webhooks.

## Webhook Payloads

`createWebhookPayloadBuilder()` selects `eventFields`, adds `hookId`/`hookType`, then merges `webhook.body`. The body determines the final value of overlapping fields. Tool-result payloads use `redactResultForEvents()` to trim raw skill Work data; Work registration retains the full in-process result. `finalState` is available to local handlers; serialized payloads carry the event's data fields.

When email is selected, the builder resolves `userEmail` from the final effective `userId`, replacing supplied email values. Email-only projections use the event ID. An explicit invalid ID, missing email or lookup error leaves email omitted.

Email queries share a per-dispatcher cache of up to 1,000 users for five minutes. Query timeouts belong to the database layer. The builder's optional fourth `{ signal }` argument lets a waiter cancel independently; cancellation returns `undefined` so the caller can stop delivery. Fetch and QStash use the enriched payload.

## Delivery Errors

Dispatch awaits each handler or webhook. Ordinary errors are logged and dispatch continues. Webhooks with `fallback: 'none'` accumulate a `CriticalHookDeliveryError`, which is thrown after sibling hooks have run. QStash delivery defaults to a fetch fallback; use `fallback: 'none'` for QStash-signed endpoints.
