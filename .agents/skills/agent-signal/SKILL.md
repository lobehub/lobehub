---
name: agent-signal
description: Build or extend LobeHub Agent Signal pipelines for background or quiet agent work driven by event sources, semantic signals, and action handlers. Use when adding a new Agent Signal source, signal or action type, policy, middleware handler, workflow handoff, dedupe or scope behavior, or observability around `src/server/services/agentSignal/**`, `packages/agent-signal`, or `packages/observability-otel/src/modules/agent-signal`.
---

# Agent Signal

Use this skill to implement event-driven background work for agents without coupling the work to the foreground chat request.

Agent Signal has one consistent shape:

`source event` -> `signal interpretation` -> `action execution` -> built-in result signals

## Start Here

1. Read `references/architecture.md` to map the package boundary, runtime queue, scope model, and async workflow handoff.
2. Read `references/handlers.md` before writing any new policy, source handler, signal handler, or action handler.
3. Read `references/observability.md` when you need tracing, metrics, debugging, or workflow snapshot visibility.

## Use The Right Entry Point

- Use `emitAgentSignalSourceEvent(...)` when a server-owned producer should execute the pipeline immediately.
- Use `executeAgentSignalSourceEvent(...)` when a worker or controlled backend path already owns execution timing and may inject a runtime guard backend.
- Use `enqueueAgentSignalSourceEvent(...)` when the caller should return quickly and let Upstash Workflow process the event out-of-band.
- Use `emitAgentSignalSourceEventWithStore(...)` for isolated tests or evals that should avoid ambient Redis state.

Read:

- `src/server/services/agentSignal/index.ts`
- `src/server/workflows/agentSignal/index.ts`
- `src/server/workflows/agentSignal/run.ts`

## Core Model

- `source`: A normalized fact that happened. Sources come from producers such as runtime lifecycle events, user messages, or bot ingress.
- `signal`: A semantic interpretation derived from one source or from another signal. Signals express meaning, routing, or policy state.
- `action`: A concrete side effect planned from one signal. Actions do the work.
- `policy`: An installable middleware bundle that registers source, signal, and action handlers.
- `procedure`: Not a distinct runtime node. Treat "procedure" as the end-to-end flow for one use case: ingress source, matching handlers, planned actions, execution result, and observability.

Keep the boundaries strict:

- Add a new `source` when the outside world produced a new event.
- Add a new `signal` when the system needs a reusable semantic interpretation.
- Add a new `action` when the runtime needs a concrete side effect.
- Add or update a `policy` when you are wiring those pieces together.

## Implementation Workflow

1. Decide whether the use case is synchronous or quiet background work.
2. Define or reuse a source type in `src/server/services/agentSignal/sourceTypes.ts`.
3. Define or reuse signal and action types in `src/server/services/agentSignal/policies/types.ts`.
4. Implement handlers with `defineSourceHandler`, `defineSignalHandler`, or `defineActionHandler`.
5. Bundle handlers with `defineAgentSignalHandlers(...)`.
6. Register the policy in `src/server/services/agentSignal/policies/index.ts` and pass it into the runtime factory if needed.
7. Add or update ingress code that emits or enqueues the source event.
8. Add observability and tests before considering the flow complete.

## Default Reading Set

- Shared semantic core:
  `packages/agent-signal/src/index.ts`
  `packages/agent-signal/src/base/builders.ts`
  `packages/agent-signal/src/base/types.ts`
- Server-owned runtime and middleware:
  `src/server/services/agentSignal/runtime/AgentSignalRuntime.ts`
  `src/server/services/agentSignal/runtime/AgentSignalScheduler.ts`
  `src/server/services/agentSignal/runtime/middleware.ts`
  `src/server/services/agentSignal/runtime/context.ts`
- Existing policy example:
  `src/server/services/agentSignal/policies/analyzeIntent/index.ts`
  `src/server/services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts`
  `src/server/services/agentSignal/policies/analyzeIntent/feedbackDomain.ts`
  `src/server/services/agentSignal/policies/analyzeIntent/feedbackAction.ts`
  `src/server/services/agentSignal/policies/analyzeIntent/actions/userMemory.ts`
- Observability:
  `src/server/services/agentSignal/observability/projector.ts`
  `src/server/services/agentSignal/observability/traceEvents.ts`
  `packages/observability-otel/src/modules/agent-signal/index.ts`

## Implementation Rules

- Reuse existing source, signal, and action types before adding new ones.
- Keep source handlers focused on interpretation and fan-out, not heavy side effects.
- Keep action handlers responsible for side effects, idempotency, and executor-style result reporting.
- Use stable ids and idempotency keys when the same source can arrive more than once.
- Preserve scope discipline. The runtime uses `scopeKey` to serialize related background work.
- Prefer the dedicated shared package types and builders from `@lobechat/agent-signal` for normalized nodes and result contracts.
- Add focused tests near the touched runtime, policy, or store module. Existing tests under `src/server/services/agentSignal/**/__tests__` are the reference pattern.

## References

- Architecture and boundaries: `references/architecture.md`
- Writing handlers and policies: `references/handlers.md`
- Observability, metrics, and debugging: `references/observability.md`
