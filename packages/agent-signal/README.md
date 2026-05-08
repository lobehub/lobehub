# @lobechat/agent-signal

`@lobechat/agent-signal` is the shared Agent Signal domain package. It defines the language of Agent Signal nodes and source events, but it does not run policies, call model runtimes, read databases, trigger workflows, or import app server modules.

Use this package when code needs browser-safe or server-safe source event types, source event constants, scope-key helpers, and the core Agent Signal node shapes.

Do not add app integration here. Side effects belong in `src/server/services/agentSignal` or the browser service facade.

## Public APIs

### Core node APIs

Import from the package root when building or inspecting source, signal, action, and executor nodes:

```ts
import type { AgentSignalSource, BaseAction, BaseSignal } from '@lobechat/agent-signal';
import { createAction, createSignal, createSource } from '@lobechat/agent-signal';
```

Use these APIs inside runtime, scheduler, policy, and observability code that needs normalized semantic nodes.

### Source event APIs

Import from `@lobechat/agent-signal/source` when producing, typing, validating, or routing source events:

```ts
import {
  AGENT_SIGNAL_SOURCE_TYPES,
  createSourceEvent,
  type AgentSignalSourceEvent,
  type AgentSignalSourceEventInput,
} from '@lobechat/agent-signal/source';

const event = createSourceEvent({
  payload: {
    message: 'Please remember that I prefer concise answers.',
    messageId: 'msg_1',
    topicId: 'topic_1',
  },
  sourceId: 'source_1',
  sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
});
```

`createSourceEvent` fills in:

- `scopeKey`, from `topicId` first, then bot thread metadata, then `fallback:global`
- `timestamp`, from `Date.now()` when the caller does not provide one

Use `AgentSignalSourceEventInput<TSourceType>` for producer inputs and `AgentSignalSourceEvent<TSourceType>` once `scopeKey` and `timestamp` are required.

### Scope-key APIs

Use `getSourceEventScopeKey` for source-event payloads and `AgentSignalScopeKey` when code already has structured scope metadata:

```ts
import { AgentSignalScopeKey, getSourceEventScopeKey } from '@lobechat/agent-signal/source';

const topicScopeKey = getSourceEventScopeKey({ topicId: 'topic_1' });
const botScopeKey = AgentSignalScopeKey.forBotThread({
  applicationId: 'discord-app',
  platform: 'discord',
  platformThreadId: 'thread_1',
});
```

## Which Layer To Use

Use this package for:

- Shared browser/server source event types
- Source type constants and payload maps
- Scope-key derivation
- Pure Agent Signal source, signal, action, result, and trigger types
- Pure node builders

Use the browser service facade for:

- Emitting source events from browser runtime code
- Sending events through tRPC
- Keeping UI paths non-blocking

See [src/services/agentSignal.ts](../../src/services/agentSignal.ts) and [src/store/chat/slices/aiChat/actions/agentSignalBridge.ts](../../src/store/chat/slices/aiChat/actions/agentSignalBridge.ts).

Use server services for:

- Feature gating
- DB access
- Workflow handoff
- Policy/runtime execution
- Redis or in-memory dedupe
- Observability persistence

See [src/server/services/agentSignal/emitter.ts](../../src/server/services/agentSignal/emitter.ts), [src/server/services/agentSignal/orchestrator.ts](../../src/server/services/agentSignal/orchestrator.ts), and [src/server/services/agentSignal/sources/index.ts](../../src/server/services/agentSignal/sources/index.ts).

## Supported Source Events

| Source event                   | Constant                                              | Primary producer                                                                                                                  | Payload intent                                                                                            |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `agent.execution.completed`    | `AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted`   | [Agent Runtime](../../src/server/services/agentRuntime/AgentRuntimeService.ts)                                                    | Server agent execution completed with operation, step, topic, and context metadata.                       |
| `agent.execution.failed`       | `AGENT_SIGNAL_SOURCE_TYPES.agentExecutionFailed`      | [Agent Runtime](../../src/server/services/agentRuntime/AgentRuntimeService.ts)                                                    | Server agent execution failed with operation, reason, error, topic, and context metadata.                 |
| `agent.user.message`           | `AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage`          | [Workflow bridge](../../src/server/workflows/agentSignal/run.ts), [Bot router](../../src/server/services/bot/BotMessageRouter.ts) | User feedback/message content that policies can analyze for memory, prompt, document, or skill changes.   |
| `bot.message.merged`           | `AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged`          | [Bot router](../../src/server/services/bot/BotMessageRouter.ts)                                                                   | Bot-platform message content merged into a conversation scope.                                            |
| `client.gateway.error`         | `AGENT_SIGNAL_SOURCE_TYPES.clientGatewayError`        | [Gateway event handler](../../src/store/chat/slices/aiChat/actions/gatewayEventHandler.ts)                                        | Browser gateway error for a client-side runtime operation.                                                |
| `client.gateway.runtime_end`   | `AGENT_SIGNAL_SOURCE_TYPES.clientGatewayRuntimeEnd`   | [Gateway event handler](../../src/store/chat/slices/aiChat/actions/gatewayEventHandler.ts)                                        | Browser gateway runtime finished for a client-side operation.                                             |
| `client.gateway.step_complete` | `AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStepComplete` | [Gateway event handler](../../src/store/chat/slices/aiChat/actions/gatewayEventHandler.ts)                                        | Browser gateway step completed with operation and step index metadata.                                    |
| `client.gateway.stream_start`  | `AGENT_SIGNAL_SOURCE_TYPES.clientGatewayStreamStart`  | [Gateway event handler](../../src/store/chat/slices/aiChat/actions/gatewayEventHandler.ts)                                        | Browser gateway stream started with operation and first step metadata.                                    |
| `client.runtime.complete`      | `AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeComplete`     | [Chat streaming executor](../../src/store/chat/slices/aiChat/actions/streamingExecutor.ts)                                        | Browser chat runtime completed with operation, topic, thread, and status metadata.                        |
| `client.runtime.start`         | `AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart`        | [Chat streaming executor](../../src/store/chat/slices/aiChat/actions/streamingExecutor.ts)                                        | Browser chat runtime started; workflow may bridge this into `agent.user.message` with serialized context. |
| `runtime.after_step`           | `AGENT_SIGNAL_SOURCE_TYPES.runtimeAfterStep`          | [Agent Runtime](../../src/server/services/agentRuntime/AgentRuntimeService.ts)                                                    | Server runtime step finished with operation, step index, topic, and context metadata.                     |
| `runtime.before_step`          | `AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep`         | [Agent Runtime](../../src/server/services/agentRuntime/AgentRuntimeService.ts)                                                    | Server runtime step is about to run with operation, step index, topic, and context metadata.              |

`AGENT_SIGNAL_CLIENT_SOURCE_TYPES` is the allow-list for browser-originated events accepted by [src/server/routers/lambda/agentSignal.ts](../../src/server/routers/lambda/agentSignal.ts). It currently includes only the `client.*` source events.

## Source Event Modules

- [Source event API](src/source/sourceEvent.ts): input and normalized event types plus `createSourceEvent`.
- [Source type catalog](src/source/sourceTypes.ts): constants, payload map, source variants, and the client allow-list.
- [Scope-key helpers](src/source/scopeKey.ts): topic, bot thread, task, agent/user, and user scope-key builders.
- [Browser service facade](../../src/services/agentSignal.ts): tRPC client wrapper for browser code.
- [Browser bridge](../../src/store/chat/slices/aiChat/actions/agentSignalBridge.ts): feature-gated non-blocking browser emission helper.
- [Lambda router](../../src/server/routers/lambda/agentSignal.ts): authenticated browser ingress and client source type validation.
- [Server emitter](../../src/server/services/agentSignal/emitter.ts): feature-gated immediate execution or workflow handoff.
- [Server orchestrator](../../src/server/services/agentSignal/orchestrator.ts): source event execution through policies, runtime, and observability.
- [Source dedupe store](../../src/server/services/agentSignal/sources/index.ts): source event dedupe, scope locking, and source node rendering.
- [Workflow trigger](../../src/server/workflows/agentSignal/index.ts): async Upstash Workflow handoff.
- [Workflow runner](../../src/server/workflows/agentSignal/run.ts): workflow execution and client runtime bridge.
- [Agent Runtime](../../src/server/services/agentRuntime/AgentRuntimeService.ts): server runtime source event producers.
- [Chat](../../src/store/chat/slices/aiChat/actions/streamingExecutor.ts): browser chat runtime source event producer.
- [Gateway event handler](../../src/store/chat/slices/aiChat/actions/gatewayEventHandler.ts): browser gateway source event producer.
- [Bot router](../../src/server/services/bot/BotMessageRouter.ts): bot-platform source event producer.

## Adding A Source Event

1. Add the constant and payload shape in [src/source/sourceTypes.ts](src/source/sourceTypes.ts).
2. Add a renderer in [src/server/services/agentSignal/sources/renderers](../../src/server/services/agentSignal/sources/renderers) if the generic payload needs normalization before becoming an `AgentSignalSource`.
3. Register the renderer in [src/server/services/agentSignal/sources/buildSource.ts](../../src/server/services/agentSignal/sources/buildSource.ts).
4. Add the source to `AGENT_SIGNAL_CLIENT_SOURCE_TYPES` only when browser code should be allowed to emit it through the lambda router.
5. Add focused tests for source event creation, router validation, renderer normalization, or workflow bridging depending on the new producer path.

Keep source events stable. Source type strings are persisted in traces, dedupe keys, and workflow payloads.
