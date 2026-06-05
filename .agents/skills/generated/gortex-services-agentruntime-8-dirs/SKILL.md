---
name: gortex-services-agentruntime-8-dirs
description: 'Work in the services/agentRuntime +8 dirs area — 202 symbols across 20 files (89% cohesion)'
---

# services/agentRuntime +8 dirs

202 symbols | 20 files | 89% cohesion

## When to Use

Use this skill when working on files in:

- `packages/chat-adapter-imessage/src/api.ts`
- `packages/observability-otel/src/modules/agent-runtime/attributes.ts`
- `src/server/agent-hono/handlers/runStep.ts`
- `src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts`
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

| File                                                                  | Symbols                                                                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/chat-adapter-imessage/src/api.ts`                           | body, queryMessages                                                                                                        |
| `packages/observability-otel/src/modules/agent-runtime/attributes.ts` | buildInvokeAgentResultAttributes, InvokeAgentResultAttributes, invokeAgentSpanName, buildInvokeAgentAttributes, input, ... |
| `src/server/agent-hono/handlers/runStep.ts`                           | c, runStep                                                                                                                 |
| `src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts`          | operationId, getExecutionHistory, disconnect, operationId, limit, ...                                                      |
| `src/server/modules/AgentRuntime/GatewayStreamNotifier.ts`            | publishAgentRuntimeEnd, operationId, params, count, getStreamHistory                                                       |
| `src/server/modules/AgentRuntime/InMemoryAgentStateManager.ts`        | createOperationMetadata, state, operationId, operationId, saveAgentState, ...                                              |
| `src/server/modules/AgentRuntime/InMemoryStreamEventManager.ts`       | cleanupOperation, operationId                                                                                              |
| `src/server/modules/AgentRuntime/types.ts`                            | PublishAgentRuntimeEndParams                                                                                               |
| `src/server/routers/lambda/__tests__/integration/aiAgent/helpers.ts`  | waitForOperationComplete, stateManager, operationId, options                                                               |
| `src/server/services/agentRuntime/AgentRuntimeService.test.ts`        | createStreamEventManager                                                                                                   |
| `src/server/services/agentRuntime/AgentRuntimeService.ts`             | shouldContinueExecution, executeStep, queueService, stepResult, determineCompletionReason, ...                             |
| `src/server/services/agentRuntime/CompletionLifecycle.ts`             | operationId, SignalEvent, statusForReason, error, state, ...                                                               |
| `src/server/services/agentRuntime/abort.ts`                           | message, getAbortError, createAbortError, signal, error, ...                                                               |
| `src/server/services/agentRuntime/stepPresentation.ts`                | total, formatTokenCount                                                                                                    |
| `src/server/services/agentRuntime/types.ts`                           | StartExecutionParams, OperationCreationResult, PendingInterventionsResult, StartExecutionResult, AgentExecutionResult, ... |
| `src/server/services/agentSignal/emitter.ts`                          | TSourceType, options, withSelfIterationPolicy, AgentSignalEmitOptions, input, ...                                          |
| `src/server/services/queue/QueueService.ts`                           | getImpl, message, scheduleMessage                                                                                          |
| `src/server/services/queue/impls/local.ts`                            | messages, scheduleMessage, scheduleBatchMessages, message                                                                  |
| `src/server/services/queue/impls/qstash.ts`                           | message, messages, scheduleMessage, scheduleBatchMessages                                                                  |
| `src/server/services/queue/types.ts`                                  | QueueMessage                                                                                                               |

## Connected Communities

- **modules/AgentRuntime +5 dirs** (7 cross-edges)
- **src/store +8 dirs** (2 cross-edges)
- **modules/AgentRuntime · publishAgentRuntimeInit** (2 cross-edges)
- **modules/AgentRuntime · enrichWithSpec** (2 cross-edges)
- **src/providers +8 dirs** (2 cross-edges)
- **services/agentRuntime · buildStepPresentation** (1 cross-edges)
- **services/agentRuntime · extractAttachmentsFromContent** (1 cross-edges)
- **agentSignal/sources +7 dirs** (1 cross-edges)
- **services/agentRuntime · reject** (1 cross-edges)
- **server/services · enqueueAgentSignalSourceEvent** (1 cross-edges)
- **fixtures/agent-signal +1 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4016"
smart_context with task: "understand services/agentRuntime +8 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
