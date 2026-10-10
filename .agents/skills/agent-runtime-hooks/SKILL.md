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
  │     │     ├─ afterToolCall ─── After tool completes (optional result control)
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
- `beforeToolCall` with `responseHandling: 'toolCall'` awaits an optional HTTP decision before tool execution. Return HTTP 2xx JSON with `{ "decision": "allow" }` or `{ "decision": "deny", "reason": "禁止执行该操作" }` to intervene. The type is `{ decision: 'allow' } | { decision: 'deny'; reason?: string }`; a deny without reason uses `Blocked by beforeToolCall hook.`. Denials preserve the reason in the tool result/card with classification `hook_denied`.
- `afterToolCall` also accepts `responseHandling: 'toolCall'`. It synchronously checks the full request/result before archival and model consumption; deny replaces the original result with the receiver's optional reason in both content and blocked state. A deny without reason uses `Blocked by afterToolCall hook.`, following the same `Blocked by ${type} hook.` rule as `beforeToolCall`. The reason enters model context and the tool card, as with `beforeToolCall`. It does not undo tool side effects, retries, or charges. See [the result-control contract](../../../docs/development/agent-tool-result-hooks.md) for deferred completions and runtime boundaries.
- Environment response modes are `ignore` (default notifications) and `toolCall` (optional decisions for both before and after). Only subscribed events are enabled. Replace removed `toolResult`/`toolCallAndResult` values with `toolCall`; use the events list to select after-only checking. Existing after responses with a valid decision now control results.
- HTTP 204, empty successful bodies, invalid JSON, and JSON without a top-level decision (including arrays, scalars, null, or only the old nested `hookSpecificOutput`) are notification responses, even with `onError: 'block'`. Continue checking subsequent hooks; do not treat a notification as permission to skip later policies. Explicit invalid decisions, non-2xx status, oversized bodies, invalid UTF-8, network failures, and timeouts follow `onError: 'continue' | 'block'` (default `continue`); blocking uses `hook_control_error` as the tool-result content and reason for both before and after hooks. Cancellation never grants permission.
- Extra response fields are allowed and discarded. Only `decision` and a deny's optional string `reason` are consumed; `updatedInput`/`additionalContext` do not change tool arguments or conversation context.
- Configuration: `packages/types/src/agentHook.ts`; response parsing: `packages/types/src/agentHookResponse.ts`; HTTP delivery: `apps/server/src/services/agentRuntime/hooks/httpWebhook.ts`.

### Hook configuration lifetime

- Environment hooks (`AGENT_HOOK_WEBHOOK_*`) always come from the executing worker's **current environment**, including after human approval and deferred completion. Never persist their configuration or restore a previous environment's hooks.
- Code-supplied webhook hooks (`execAgent({ hooks })`) retain the existing per-operation serialization and persistence. Recover these caller hooks from the runtime snapshot or durable operation record; preserve environment-variable templates without expanding secrets into storage.
- Evaluate each operation's recovered caller hooks in order, then evaluate current environment hooks once in the final round. Do not deduplicate caller hook IDs across operations. Environment-only hooks do not require durable operation storage. Removing an environment hook stops it from controlling subsequent results; when no matching result control remains, allow the result. Do not freeze a previous environment policy across an approval or restart.
- Deferred completion publishes into its empty placeholder once; duplicate callbacks retain that first final result, including a denial. Propagate caller-policy storage errors rather than treating failed reads as an empty hook list. Do not extend default allow to configured-hook delivery failures: those follow `onError`.
- Cover environment removal/addition across approval and snapshot expiry, publication without review markers, and continued enforcement of persisted caller hooks in regression tests.

### Publish after the result hook

- Await result control before archival, message content/state writes, streaming, and model consumption. Persist the allowed result or the sanitized denial directly; do not add `toolResultControl` pending/allowed/blocked metadata or hide raw output through history projections.
- Human approval sources claim the decision and retain the answer in their private resolution/outbox. `MessageModel.resolveHumanApproval` defaults to claim-only; only the runtime calls it with `publishResult: true` after result control. Stop/rejection receipts can publish directly because they contain no executed tool output.
- Recover original caller hooks through the existing intervention operation identity or deferred callback's parent operation. Keep the in-memory hook verdict separate from tool-owned state; a tool returning `type: 'blocked'` is not a hook verdict.
- Every deferred backfill, including a member that fails to start, follows the same hook-before-write order. Use the existing empty placeholder to arbitrate duplicate final writes; do not introduce a replacement review state machine.
- When a thread has a sub-agent or group-member completion bridge, that bridge exclusively publishes its tool result. Thread lifecycle hooks update thread metadata only; never prefill the tool message with an ungated summary, including after approval recovery.
- Cover an answer held while a hook runs, atomic publication and rollback, duplicate callbacks after policy removal, and partial member startup failure. History readers should need no result-review logic.

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

`createWebhookPayloadBuilder()` selects `eventFields`, adds `hookId`/`hookType`, then merges `webhook.body`. The body determines the final value of overlapping fields. Tool-result notification payloads use `redactResultForEvents()` to trim raw skill Work data; controls receive the full result. Work registration retains the full in-process result. `finalState` is available to local handlers; serialized payloads carry the event's data fields.

When email is selected, the builder resolves `userEmail` from the final effective `userId`, replacing supplied email values. Email-only projections use the event ID. An explicit invalid ID, missing email or lookup error leaves email omitted.

Email queries share a per-dispatcher cache of up to 1,000 users for five minutes. Query timeouts belong to the database layer. The builder's optional fourth `{ signal }` argument lets a waiter cancel independently; cancellation returns `undefined` so the caller can stop delivery. Fetch and QStash use the enriched payload.

## Delivery Errors

Dispatch awaits each handler or webhook. Ordinary errors are logged and dispatch continues. Webhooks with `fallback: 'none'` accumulate a `CriticalHookDeliveryError`, which is thrown after sibling hooks have run. QStash delivery defaults to a fetch fallback; use `fallback: 'none'` for QStash-signed endpoints.
