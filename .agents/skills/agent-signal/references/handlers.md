# Writing Handlers And Policies

## Fluent Registration API

Use the middleware helpers in `src/server/services/agentSignal/runtime/middleware.ts`.

They provide:

- `defineSourceHandler(...)`
- `defineSignalHandler(...)`
- `defineActionHandler(...)`
- `defineAgentSignalHandlers(...)`

These helpers do two jobs:

1. keep handler registration terse
2. preserve strong typing when `listen` points at concrete source, signal, or action types

## Handler Shape

Each handler receives:

- the current runtime node
- `RuntimeProcessorContext`

The context gives you:

- `scopeKey`
- `now()`
- `runtimeState.getGuardState(lane)`
- `runtimeState.touchGuardState(lane, now?)`

Read:

- `src/server/services/agentSignal/runtime/context.ts`

## Return Contracts

Return one of these shapes:

- `void`: no fan-out, stop at this handler
- `{ status: 'dispatch', signals?, actions? }`: continue the chain
- `{ status: 'wait', pending? }`: pause for later host coordination
- `{ status: 'schedule', nextHop }`: schedule another hop
- `{ status: 'conclude', concluded? }`: stop with a terminal runtime result
- `ExecutorResult`: only for action handlers that performed a concrete side effect

Read:

- `packages/agent-signal/src/base/types.ts`
- `src/server/services/agentSignal/runtime/AgentSignalScheduler.ts`

## Policy Composition Pattern

Use `defineAgentSignalHandlers([...])` to bundle related handlers into one policy.

Example from `analyzeIntent`:

```ts
return defineAgentSignalHandlers([
  createFeedbackSatisfactionJudgeProcessor(...),
  createFeedbackDomainJudgeSignalHandler(...),
  createFeedbackActionPlannerSignalHandler(),
  defineUserMemoryActionHandler(...),
]);
```

That bundle is later passed into the runtime via:

- `createDefaultAgentSignalPolicies(...)`
- `createAgentSignalRuntime({ policies })`

Read:

- `src/server/services/agentSignal/policies/index.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/index.ts`

## Source Handler Pattern

Use a source handler when you are interpreting a producer event into semantic signals.

Reference:

- `src/server/services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts`

Pattern:

```ts
return defineSourceHandler(
  AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
  'agent.user.message:my-handler',
  async (source, ctx): Promise<RuntimeProcessorResult | void> => {
    // interpret source payload
    // optionally use ctx.runtimeState

    return {
      signals: [
        /* one or more semantic signals */
      ],
      status: 'dispatch',
    };
  },
);
```

Write source handlers when:

- a raw message, lifecycle event, or bot ingress needs interpretation
- the work is still semantic, not side-effectful

## Signal Handler Pattern

Use a signal handler when one semantic state should branch into more semantic states or planned actions.

References:

- `src/server/services/agentSignal/policies/analyzeIntent/feedbackDomain.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/feedbackAction.ts`

Pattern:

```ts
return defineSignalHandler(
  MY_SIGNAL_TYPE,
  'signal.my-policy-router',
  async (signal): Promise<RuntimeProcessorResult | void> => {
    return {
      actions: [
        /* planned work */
      ],
      status: 'dispatch',
    };
  },
);
```

Use signal handlers for:

- routing
- fan-out
- filtering
- conflict resolution
- converting interpretation into planned actions

## Action Handler Pattern

Use an action handler when the runtime should do actual work.

Reference:

- `src/server/services/agentSignal/policies/analyzeIntent/actions/userMemory.ts`

Pattern:

```ts
return defineActionHandler(
  MY_ACTION_TYPE,
  'action.my-policy-executor',
  async (action, ctx): Promise<ExecutorResult> => {
    // run service/tool/model side effect
    // check idempotency if needed

    return {
      actionId: action.actionId,
      attempt: {
        completedAt: ctx.now(),
        current: 1,
        startedAt,
        status: 'succeeded',
      },
      status: 'applied',
    };
  },
);
```

Keep these rules:

- perform idempotency checks here or immediately before side effects
- return stable `actionId`
- include failure detail in `error`
- let the scheduler turn the `ExecutorResult` into built-in result signals

## Source, Signal, And Action Type Placement

Use this split:

- external event payloads:
  `src/server/services/agentSignal/sourceTypes.ts`
- policy-owned signal and action payloads:
  `src/server/services/agentSignal/policies/types.ts`
- normalized shared node contracts:
  `packages/agent-signal/src/base/types.ts`

Do not put app-specific signal catalogs into `packages/agent-signal`. That package should stay generic and reusable.

## Choosing The Right Node

Choose `source` when:

- the outside world emitted a new fact

Choose `signal` when:

- the system needs semantic meaning that downstream handlers can reuse

Choose `action` when:

- the runtime is ready for a concrete side effect

If a handler both interprets meaning and performs side effects, split it. That keeps chains inspectable and testable.

## Testing Strategy

Prefer focused tests near the touched code.

Useful references:

- `src/server/services/agentSignal/runtime/__tests__/AgentSignalRuntime.test.ts`
- `src/server/services/agentSignal/__tests__/index.integration.test.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/__tests__/*`
- `src/server/services/agentSignal/policies/analyzeIntent/actions/__tests__/*`

Test at the smallest level that proves the behavior:

- handler unit test for one routing rule
- runtime test for queue fan-out
- integration test for service ingress and observability persistence
