# Agent Chaos infrastructure

Agent-domain chaos engineering packages use the temporary `@chaos/*` namespace:

- `@chaos/core` — portable experiment, effect, safety, oracle, receipt and result contracts.
- `@chaos/runner` — validated fixture loading and deterministic lifecycle execution.
- `@chaos/runtime` — Agent Runtime hook and completion-delivery adapters.
- `@chaos/database` — schema-independent mutation and rollback port.
- `@chaos/process` — ownership-checked destructive process injection.
- `@chaos/testing` — deterministic test targets and scenario helpers.

Application incidents and fixtures belong under `.agents/chaos`; package code contains mechanisms,
not LobeHub business models. Goal, Agent Evals, CI and self-improvement workflows are consumers.
