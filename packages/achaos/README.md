# Agent Chaos infrastructure

Agent-domain chaos engineering packages use the temporary `@achaos/*` namespace:

- `@achaos/core` — portable experiment, effect, safety, oracle, receipt and result contracts.
- `@achaos/runner` — validated fixture loading and deterministic lifecycle execution.
- `@achaos/runtime` — Agent Runtime hook and completion-delivery adapters.
- `@achaos/database` — schema-independent mutation and rollback port.
- `@achaos/process` — ownership-checked destructive process injection.
- `@achaos/testing` — deterministic test targets and scenario helpers.

Application incidents and fixtures belong under `.agents/chaos`; package code contains mechanisms,
not LobeHub business models. Goal, Agent Evals, CI and self-improvement workflows are consumers.
