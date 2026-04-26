# Agent Signal Architecture

## Pipeline

Use this mental model first:

```text
producer
  -> emitAgentSignalSourceEvent(...) or enqueueAgentSignalSourceEvent(...)
    -> emitSourceEvent(...)
      -> dedupe + scope lock + source normalization
        -> runtime.emitNormalized(source)
          -> source handlers
            -> signal handlers
              -> action handlers
                -> built-in result signals
                  -> observability projection + persistence
```

The scheduler is queue-driven, not hard-coded for one policy:

```text
source node
  -> matching source handlers
    -> dispatch signals/actions
      -> matching signal handlers
        -> dispatch more signals/actions
          -> matching action handlers
            -> ExecutorResult
              -> signal.action.applied | signal.action.skipped | signal.action.failed
```

Read:

- `src/server/services/agentSignal/index.ts`
- `src/server/services/agentSignal/sources/index.ts`
- `src/server/services/agentSignal/runtime/AgentSignalScheduler.ts`

## Package Boundaries

### `packages/agent-signal`

Treat this as the shared semantic core.

It provides:

- base node types: source, signal, action
- builders: `createSource`, `createSignal`, `createAction`
- built-in result signal types
- runtime result contracts such as `RuntimeProcessorResult` and `ExecutorResult`

Read:

- `packages/agent-signal/src/base/types.ts`
- `packages/agent-signal/src/base/builders.ts`
- `packages/agent-signal/src/types/events.ts`
- `packages/agent-signal/src/types/builtin.ts`

### `src/server/services/agentSignal`

Treat this as the server-owned implementation layer.

It owns:

- source catalogs and payload maps
- policy-specific signal and action catalogs
- middleware registration
- runtime scheduling and guard backends
- Redis-backed dedupe, waypoint, and policy state
- service entrypoints for synchronous and async execution

### `packages/observability-otel/src/modules/agent-signal`

Treat this as shared OTEL ownership for Agent Signal metrics and tracer instances.

## Core Vocabulary

### Source

A source is the normalized external fact that started the chain.

Examples:

- `agent.user.message`
- `runtime.before_step`
- `runtime.after_step`
- `client.runtime.start`
- `bot.message.merged`

Define source payloads in:

- `src/server/services/agentSignal/sourceTypes.ts`

Build normalized sources in:

- `src/server/services/agentSignal/sources/buildSource.ts`
- `packages/agent-signal/src/base/builders.ts`

### Signal

A signal is a semantic interpretation. Signals should be reusable and meaning-oriented.

Examples from `analyzeIntent`:

- `signal.feedback.satisfaction`
- `signal.feedback.domain.memory`
- `signal.feedback.domain.prompt`
- `signal.feedback.domain.skill`

Define server-owned signal types in:

- `src/server/services/agentSignal/policies/types.ts`

### Action

An action is a concrete side effect the runtime should execute.

Example:

- `action.user-memory.handle`

Action handlers usually:

- check idempotency
- call tools, models, or services
- return `ExecutorResult`

### Policy

A policy is an installable bundle of handlers. It is the composition unit that turns the generic runtime into a feature.

Example:

- `createAnalyzeIntentPolicy(...)`

### Procedure

"Procedure" is not a first-class type in this runtime. Use the word to describe one end-to-end use case:

1. define ingress source
2. emit or enqueue the source
3. interpret source into signals
4. plan actions from signals
5. execute actions
6. persist trace and metrics

When a user asks for "the procedure", document the flow above and point to the exact producer, handlers, and execution entrypoint.

## Scope, Deduping, And Quiet Background Work

`scopeKey` is the serialization boundary for related work. It is used for:

- source dedupe windows
- scope locks during source generation
- runtime guard state
- waypoint persistence for queued processing

Read:

- `src/server/services/agentSignal/sources/index.ts`
- `src/server/services/agentSignal/runtime/context.ts`
- `src/server/services/agentSignal/constants.ts`

Use `enqueueAgentSignalSourceEvent(...)` when the work should stay quiet and out-of-band. That path:

1. normalizes the source envelope
2. derives or reuses `scopeKey`
3. triggers `AgentSignalWorkflow`
4. executes later in `runAgentSignalWorkflow`

This is the preferred path when the UI request should finish immediately and the policy can run in the background.

Read:

- `src/server/workflows/agentSignal/index.ts`
- `src/server/workflows/agentSignal/run.ts`

## Existing Example: `analyzeIntent`

Use `analyzeIntent` as the reference chain:

```text
agent.user.message
  -> feedback satisfaction source handler
    -> signal.feedback.satisfaction
      -> feedback domain signal handler
        -> signal.feedback.domain.*
          -> feedback action planner
            -> action.user-memory.handle
              -> signal.action.applied | skipped | failed
```

Read:

- `src/server/services/agentSignal/policies/analyzeIntent/index.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/feedbackDomain.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/feedbackAction.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/actions/userMemory.ts`
