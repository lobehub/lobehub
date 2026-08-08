---
name: agent-signal
description: 'Build or extend LobeHub Agent Signal pipelines. Use for signal sources, signal/action types, policies, middleware, workflow handoff, dedupe, scope behavior, or observability.'
---

# Agent Signal

Use this skill to implement event-driven background work for agents without coupling the work to the foreground chat request.

Agent Signal has one consistent runtime shape:

`source event` -> `signal interpretation` -> `action execution` -> built-in result signals

Durable self-iteration work has one extra completion branch:

`memory/skill action` -> `execAgent` enqueue -> `agent.execution.completed` -> `selfIteration` receipt projection

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

- `apps/server/src/services/agentSignal/index.ts`
- `apps/server/src/workflows/agentSignal/index.ts`
- `apps/server/src/workflows/agentSignal/run.ts`

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
2. Define or reuse a source type in `packages/agent-signal/src/source/sourceTypes.ts`.
3. Define or reuse signal and action types in `apps/server/src/services/agentSignal/policies/types.ts`.
4. Implement handlers with `defineSourceHandler`, `defineSignalHandler`, or `defineActionHandler`.
5. Add source normalization or hydration under `apps/server/src/services/agentSignal/sources/**` when the producer payload needs shaping.
6. Bundle handlers with `defineAgentSignalHandlers(...)`.
7. Register the policy in `apps/server/src/services/agentSignal/policies/index.ts` and pass it into the runtime factory if needed.
8. Add or update ingress code that emits or enqueues the source event.
9. For async self-iteration writes, stamp an Agent Signal operation marker and project user-visible receipts from the completion path.
10. Add observability and tests before considering the flow complete.

## Default Reading Set

- Shared semantic core:
  `packages/agent-signal/src/index.ts`
  `packages/agent-signal/src/base/builders.ts`
  `packages/agent-signal/src/base/types.ts`
  `packages/agent-signal/src/source/sourceTypes.ts`
  `packages/agent-signal/src/source/sourceEvent.ts`
- Server-owned runtime and middleware:
  `apps/server/src/services/agentSignal/runtime/AgentSignalRuntime.ts`
  `apps/server/src/services/agentSignal/runtime/AgentSignalScheduler.ts`
  `apps/server/src/services/agentSignal/runtime/middleware.ts`
  `apps/server/src/services/agentSignal/runtime/context.ts`
- Existing policy example:
  `apps/server/src/services/agentSignal/policies/analyzeIntent/index.ts`
  `apps/server/src/services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts`
  `apps/server/src/services/agentSignal/policies/analyzeIntent/feedbackDomain.ts`
  `apps/server/src/services/agentSignal/policies/analyzeIntent/feedbackAction.ts`
  `apps/server/src/services/agentSignal/policies/analyzeIntent/actions/userMemory.ts`
  `apps/server/src/services/agentSignal/policies/analyzeIntent/actions/skillManagement.ts`
  `apps/server/src/services/agentSignal/policies/analyzeIntent/completionSkillSynthesis.ts`
  `apps/server/src/services/agentSignal/policies/completionPolicy.ts`
  `apps/server/src/services/agentSignal/services/selfIteration/completion/buildSelfIterationReceipts.ts`
  `apps/server/src/services/agentSignal/services/selfIteration/completion/selfIterationCompletionHandler.ts`
- Observability:
  `apps/server/src/services/agentSignal/observability/projector.ts`
  `apps/server/src/services/agentSignal/observability/traceEvents.ts`
  `packages/observability-otel/src/modules/agent-signal/index.ts`

## Implementation Rules

- Reuse existing source, signal, and action types before adding new ones.
- Keep source handlers focused on interpretation and fan-out, not heavy side effects.
- Keep action handlers responsible for side effects, idempotency, and executor-style result reporting. For memory/skill self-iteration actions, the side effect is enqueueing `execAgent`; the durable write and receipt projection happen after completion.
- Use stable ids and idempotency keys when the same source can arrive more than once.
- Preserve scope discipline. The runtime uses `scopeKey` to serialize related background work.
- Prefer the dedicated shared package types and builders from `@lobechat/agent-signal` for normalized nodes and result contracts.
- Do not project memory or skill receipts from the enqueue action. Use `agent.execution.completed` + `selfIteration` finalState via `createSelfIterationCompletionHandler(...)`.
- Add focused tests near the touched runtime, policy, or store module. Existing tests under `apps/server/src/services/agentSignal/**/__test__` and `**/__tests__` are the reference pattern.

## References

- Architecture and boundaries: `references/architecture.md`
- Writing handlers and policies: `references/handlers.md`
- Observability, metrics, and debugging: `references/observability.md`
