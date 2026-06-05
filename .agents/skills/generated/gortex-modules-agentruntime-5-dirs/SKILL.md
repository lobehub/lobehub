---
name: gortex-modules-agentruntime-5-dirs
description: 'Work in the modules/AgentRuntime +5 dirs area — 143 symbols across 12 files (88% cohesion)'
---

# modules/AgentRuntime +5 dirs

143 symbols | 12 files | 88% cohesion

## When to Use

Use this skill when working on files in:

- `packages/observability-otel/src/modules/agent-runtime/attributes.ts`
- `packages/types/src/zustand.ts`
- `src/server/modules/AgentRuntime/InMemoryStreamEventManager.ts`
- `src/server/modules/AgentRuntime/RuntimeExecutors.ts`
- `src/server/modules/AgentRuntime/StreamEventManager.ts`
- `src/server/modules/AgentRuntime/formatErrorEventData.ts`
- `src/server/modules/AgentRuntime/messagePersistErrors.ts`
- `src/server/modules/AgentRuntime/pgError.ts`
- `src/server/modules/AgentRuntime/resolveToolTimeout.ts`
- `src/server/routers/lambda/agentNotify.ts`
- `src/store/chat/slices/aiAgent/actions/__tests__/runAgent.test.ts`
- `src/store/chat/slices/aiAgent/actions/agentGroup.ts`

## Key Files

| File                                                                  | Symbols                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/observability-otel/src/modules/agent-runtime/attributes.ts` | input, input, ContextEngineeringAttributes, toolName, buildChatResponseAttributes, ...            |
| `packages/types/src/zustand.ts`                                       | StoreApiWithSelector                                                                              |
| `src/server/modules/AgentRuntime/InMemoryStreamEventManager.ts`       | event, operationId, waitForEvent, subscribers, reason, ...                                        |
| `src/server/modules/AgentRuntime/RuntimeExecutors.ts`                 | maxRetries, RuntimeExecutorContext, isOperationInterrupted, flushTextBuffer, shouldRetryTool, ... |
| `src/server/modules/AgentRuntime/StreamEventManager.ts`               | StreamEvent                                                                                       |
| `src/server/modules/AgentRuntime/formatErrorEventData.ts`             | error, formatErrorEventData, phase                                                                |
| `src/server/modules/AgentRuntime/messagePersistErrors.ts`             | error, isPersistFatal, cause, T, parentId, ...                                                    |
| `src/server/modules/AgentRuntime/pgError.ts`                          | unwrapPgError, looksLikePgError, value, info, error, ...                                          |
| `src/server/modules/AgentRuntime/resolveToolTimeout.ts`               | clamp, resolveToolTimeoutMs, value, readPositiveNumber, value                                     |
| `src/server/routers/lambda/agentNotify.ts`                            | publishRemoteHeteroEvent, getStreamManager, writtenMessageId                                      |
| `src/store/chat/slices/aiAgent/actions/__tests__/runAgent.test.ts`    | overrides, createStreamStartEvent                                                                 |
| `src/store/chat/slices/aiAgent/actions/agentGroup.ts`                 | eventSource.onEvent, event                                                                        |

## Entry Points

- `src/server/modules/AgentRuntime/RuntimeExecutors.ts::createRuntimeExecutors`

## Connected Communities

- **services/agentDocuments +6 dirs** (2 cross-edges)
- **types/src +29 dirs** (2 cross-edges)
- **modules/AgentRuntime · resolveLLMMaxRetries** (2 cross-edges)
- **modules/AgentRuntime +3 dirs** (2 cross-edges)
- **services/toolExecution +9 dirs** (2 cross-edges)
- **src/transformation +60 dirs** (2 cross-edges)
- **modules/AgentRuntime · stripStateForStream** (1 cross-edges)
- **context-engine/src +2 dirs** (1 cross-edges)
- **services/agentDocumentVfs +3 dirs** (1 cross-edges)
- **modules/AgentRuntime · classifyKind** (1 cross-edges)
- **services/agentRuntime +8 dirs** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-3871"
smart_context with task: "understand modules/AgentRuntime +5 dirs", format: "gcx"
find_usages with id: "src/server/modules/AgentRuntime/RuntimeExecutors.ts::createRuntimeExecutors", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
