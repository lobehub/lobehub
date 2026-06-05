---
name: gortex-modules-agentruntime-8-dirs
description: 'Work in the modules/AgentRuntime +8 dirs area — 210 symbols across 21 files (87% cohesion)'
---

# modules/AgentRuntime +8 dirs

210 symbols | 21 files | 87% cohesion

## When to Use

Use this skill when working on files in:

- `packages/chat-adapter-imessage/src/api.ts`
- `packages/observability-otel/src/modules/agent-runtime/attributes.ts`
- `src/server/agent-hono/handlers/runStep.ts`
- `src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts`
- `src/server/modules/AgentRuntime/AgentStateManager.ts`
- `src/server/modules/AgentRuntime/GatewayStreamNotifier.ts`
- `src/server/modules/AgentRuntime/InMemoryAgentStateManager.ts`
- `src/server/modules/AgentRuntime/InMemoryStreamEventManager.ts`
- `src/server/modules/AgentRuntime/types.ts`
- `src/server/routers/lambda/__tests__/integration/aiAgent/helpers.ts`
- `src/server/services/agentRuntime/AgentRuntimeService.test.ts`
- `src/server/services/agentRuntime/AgentRuntimeService.ts`
- `src/server/services/agentRuntime/CompletionLifecycle.ts`
- `src/server/services/agentRuntime/abort.ts`
- `src/server/services/agentRuntime/stepPresentation.ts`
- `src/server/services/agentRuntime/types.ts`
- `src/server/services/agentSignal/emitter.ts`
- `src/server/services/queue/QueueService.ts`
- `src/server/services/queue/impls/local.ts`
- `src/server/services/queue/impls/qstash.ts`
- `src/server/services/queue/types.ts`

## Key Files

| File                                                                  | Symbols                                                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/chat-adapter-imessage/src/api.ts`                           | body, queryMessages                                                                                                     |
| `packages/observability-otel/src/modules/agent-runtime/attributes.ts` | input, InvokeAgentAttributes, invokeAgentSpanName, InvokeAgentResultAttributes, agentName, ...                          |
| `src/server/agent-hono/handlers/runStep.ts`                           | c, runStep                                                                                                              |
| `src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts`          | operationId, operationId, previousStatus, streamEventManager, cleanupExpiredOperations, ...                             |
| `src/server/modules/AgentRuntime/AgentStateManager.ts`                | loadAgentState, operationId, getExecutionHistory, operationId, limit                                                    |
| `src/server/modules/AgentRuntime/GatewayStreamNotifier.ts`            | operationId, initialState, count, publishAgentRuntimeEnd, operationId, ...                                              |
| `src/server/modules/AgentRuntime/InMemoryAgentStateManager.ts`        | state, createOperationMetadata, data, operationId, operationId, ...                                                     |
| `src/server/modules/AgentRuntime/InMemoryStreamEventManager.ts`       | operationId, cleanupOperation                                                                                           |
| `src/server/modules/AgentRuntime/types.ts`                            | PublishAgentRuntimeEndParams                                                                                            |
| `src/server/routers/lambda/__tests__/integration/aiAgent/helpers.ts`  | stateManager, operationId, waitForOperationComplete, options                                                            |
| `src/server/services/agentRuntime/AgentRuntimeService.test.ts`        | createStreamEventManager                                                                                                |
| `src/server/services/agentRuntime/AgentRuntimeService.ts`             | humanIntervention, params, state, options, messageServiceInstance, ...                                                  |
| `src/server/services/agentRuntime/CompletionLifecycle.ts`             | operationId, dispatchHooks, extractErrorMessage, CompletionLifecycle, operationId, ...                                  |
| `src/server/services/agentRuntime/abort.ts`                           | signal, createAbortError, message, isAbortError, getAbortError, ...                                                     |
| `src/server/services/agentRuntime/stepPresentation.ts`                | formatTokenCount, total                                                                                                 |
| `src/server/services/agentRuntime/types.ts`                           | StartExecutionParams, PendingInterventionsResult, StepCompletionReason, StartExecutionResult, AgentExecutionParams, ... |
| `src/server/services/agentSignal/emitter.ts`                          | context, options, options, selfIterationEnabled, emitAgentSignalSourceEvent, ...                                        |
| `src/server/services/queue/QueueService.ts`                           | scheduleMessage, getImpl, message                                                                                       |
| `src/server/services/queue/impls/local.ts`                            | scheduleBatchMessages, scheduleMessage, message, messages                                                               |
| `src/server/services/queue/impls/qstash.ts`                           | message, scheduleBatchMessages, messages, scheduleMessage                                                               |
| `src/server/services/queue/types.ts`                                  | QueueMessage                                                                                                            |

## Connected Communities

- **modules/AgentRuntime +5 dirs** (9 cross-edges)
- **modules/AgentRuntime · enrichWithSpec** (2 cross-edges)
- **src/store +8 dirs** (2 cross-edges)
- **src/providers +8 dirs** (2 cross-edges)
- **services/agentRuntime · reject** (1 cross-edges)
- **services/agentRuntime · buildStepPresentation** (1 cross-edges)
- **platforms/telegram +61 dirs** (1 cross-edges)
- **fixtures/agent-signal +1 dirs** (1 cross-edges)
- **services/agentRuntime · extractAttachmentsFromContent** (1 cross-edges)
- **server/services · enqueueAgentSignalSourceEvent** (1 cross-edges)
- **services/agentSignal · executeAgentSignalSourceEventCo…** (1 cross-edges)
- **libs/redis +14 dirs** (1 cross-edges)
- **taskScheduler/impls · LocalTaskScheduler** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4018"
smart_context with task: "understand modules/AgentRuntime +8 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
