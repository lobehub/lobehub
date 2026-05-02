# Observability And Debugging

## OTEL Ownership

Use `packages/observability-otel/src/modules/agent-signal/index.ts` for the shared tracer and metrics.

Available instruments:

- `tracer`
- `sourceCounter`
- `signalCounter`
- `actionCounter`
- `actionResultCounter`
- `chainCounter`
- `signalActionTransitionCounter`
- `chainDurationHistogram`
- `actionDurationHistogram`

Use this module when you need shared telemetry ownership instead of creating feature-local meters or tracers.

## Projection Pipeline

After runtime execution, the service projects one compact observability model from the full chain.

Read:

- `src/server/services/agentSignal/observability/projector.ts`
- `src/server/services/agentSignal/observability/traceEvents.ts`
- `src/server/services/agentSignal/observability/store.ts`

Projection outputs:

- a trace envelope with source, signals, actions, results, edges, and handler runs
- a compact telemetry record with dominant path, status breakdown, and chain metadata

This projection is built from:

- source node
- emitted signals
- planned actions
- executor results

## How To Inspect A Chain

Use this order:

1. Inspect the source type and payload.
2. Inspect emitted signals.
3. Inspect planned actions.
4. Inspect executor results.
5. Inspect projected edges and dominant path.

The helper `toAgentSignalTraceEvents(...)` flattens a chain into compact event records suitable for tracing snapshots.

## Workflow Snapshot Bridge

Workflow-triggered runs do not naturally pass through the normal foreground runtime snapshot path, so `runAgentSignalWorkflow` adds a development-only bridge into `.agent-tracing/`.

Read:

- `src/server/workflows/agentSignal/run.ts`

Use that path when:

- the source was enqueued with `enqueueAgentSignalSourceEvent(...)`
- you need local trace visibility for quiet background work

## Common Debug Questions

### The source emits but nothing happens

Check:

- feature gate enabled for the user
- source type matches a registered source handler
- dedupe or scope lock did not short-circuit generation

Read:

- `src/server/services/agentSignal/index.ts`
- `src/server/services/agentSignal/sources/index.ts`

### The signal exists but no action runs

Check:

- the signal type has a registered signal handler
- the signal handler returns `status: 'dispatch'`
- the handler actually returned actions

### The action runs twice

Check:

- source dedupe key stability
- action idempotency strategy
- scope key stability across retries and workflow handoff

Reference:

- `src/server/services/agentSignal/policies/actionIdempotency.ts`
- `src/server/services/agentSignal/policies/analyzeIntent/actions/userMemory.ts`

### Background runs are hard to discover

Check:

- workflow snapshot bridge in development
- projected telemetry record contents
- OTEL counters and histograms in the shared module

## Minimal Completion Checklist

- source ingress is testable
- handler registration is discoverable from the policy factory
- action executor returns structured results
- projection includes the new path cleanly
- tests cover at least one happy path and one no-op or failure path
