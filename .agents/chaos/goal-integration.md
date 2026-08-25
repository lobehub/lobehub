# Goal Chaos integration

Goal consumes Agent Chaos through application-owned adapters. `@achaos/*` must not import Goal,
Task, Drizzle schemas, QStash, or server services.

## Test harness

Place concrete integration code under `apps/server/src/services/goal/__chaos__/`:

1. Arrange a real Goal Graph, Work Task, Topic and Agent Operation in `getTestDB()`.
2. Register `createRuntimeChaosHooks(controller)` for preflight result replacement/drop faults. For
   retryable failures, wrap each `executeToolWithRetry` attempt with `executeToolAttemptWithChaos`.
3. Register an application `@achaos/database` port for scoped lease/state mutations.
4. Drive the production action (`GoalService.tick`, completion ingestion, scheduled wake, or
   human decision) as the runner exercise.
5. Evaluate persisted state with application-owned oracles; never use the builder Agent's text as
   proof.
6. Attach the `ChaosRunResult` JSON and trace events to Acceptance evidence.

## Initial campaign

### Operation reclaim and restart

- Inject: age the active operation lease after its worker disappears.
- Exercise: create a fresh GoalService instance and run the next coordinator tick.
- Safety oracle: the abandoned operation never becomes `done`.
- Liveness oracle: a replacement attempt starts within the configured recovery bound.
- Consistency oracle: Goal Work, Task, Topic and Operation ownership agree.

This campaign requires `settleStaleRunning` / `recoverAbandonedWork` from the Goal runtime
resilience work to be present on the target branch.

### Duplicate and late completion

- Inject: deliver an identical completion twice, then deliver completion from an abandoned attempt.
- Safety oracle: Acceptance dispatch occurs at most once.
- Safety oracle: the abandoned attempt cannot overwrite its terminal status.
- Consistency oracle: only the lease-owning attempt advances the Work.

### Tool failure and retry

- Inject: throw a typed transient error from inside one `executeToolWithRetry` attempt.
- Exercise: let the normal Agent Runtime and Goal retry policy continue.
- Liveness oracle: the operation settles or reaches a bounded human gate.
- Safety oracle: an external side effect is not duplicated.
- Budget oracle: retries never exceed the Goal policy.

### Verifier-driven evolution

- Inject: return incomplete or contradictory Acceptance evidence.
- Exercise: run Goal verification and the following coordinator tick.
- Safety oracle: the Goal never reaches `achieved` while a required criterion failed.
- Liveness oracle: a bounded repair Work or Decision is created.
- Evidence oracle: verifier gaps are linked to the successor Work.

### Human gate and resume

- Inject: delay, reject and duplicate a human-intervention response.
- Safety oracle: approval-gated tools never execute before approval.
- Consistency oracle: one decision resolves at most once.
- Liveness oracle: an approved Goal resumes from durable state after a server restart.

## CI tiers

- PR: deterministic in-process and PGlite/Postgres campaigns; no real process kill or network fault.
- Nightly: server restart, QStash duplicate/reorder, heterogeneous Agent and real child-process kill.
- Canary: allowlisted non-destructive experiments with a kill switch and strict blast radius.
- Production: observation and trace capture only until a separate approval policy exists.

Every campaign must preserve its seed, result JSON, trace id, baseline revision and candidate
revision. A discovered probabilistic failure becomes a reduced deterministic fixture before it is
accepted as regression coverage.
