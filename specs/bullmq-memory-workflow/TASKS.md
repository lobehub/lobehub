# Task Decomposition: BullMQ Memory Workflow

## Phase 0: Baseline (before any changes)

### T0.1 — Capture existing test baseline

- Run all memory-related tests and record results
- `pnpm test -- --filter="@lobechat/server" -- memory`
- `pnpm test -- --filter="@lobechat/server" -- extract`
- Save output to `specs/bullmq-memory-workflow/baseline-test-results.txt`
- **Acceptance:** All existing tests pass (or known failures documented)

---

## Phase 1: Foundation (no behavior changes)

### T1.1 — Add BullMQ dependency

- `pnpm add bullmq` in root
- Verify `ioredis` peer dependency is satisfied
- Verify build still passes: `pnpm build`
- **Acceptance:** `pnpm build` succeeds, no new peer dep warnings

### T1.2 — Create workflow types

- File: `apps/server/src/services/memory/userMemory/workflow/types.ts`
- Define `MemoryWorkflowMode` type: `'qstash' | 'bullmq' | 'local'`
- Define `MemoryWorkflowTriggerResult` type: `{ workflowRunId: string }`
- Define `MemoryWorkflowTriggerOptions` type
- Re-export payload types from `extract.ts`
- **Acceptance:** Types compile, no circular imports

### T1.3 — Create fake WorkflowContext factory

- File: `apps/server/src/services/memory/userMemory/workflow/workers/context.ts`
- `createLocalWorkflowContext(job)` returns fake `WorkflowContext`
- `context.run(stepId, handler)` → `await handler()`
- `context.requestPayload` → `job.data`
- `context.workflowRunId` → `bullmq-${job.id}`
- **Unit tests:** context returns correct payload, run executes handler, workflowRunId format

### T1.4 — Create BullMQ queue definitions

- File: `apps/server/src/services/memory/userMemory/workflow/workers/queues.ts`
- 6 queues: `memory:hourly`, `memory:process-users`, `memory:user-topics`, `memory:process-topics`, `memory:process-topic`, `memory:persona-update`
- Redis connection from existing config
- Configurable prefix via `MEMORY_WORKFLOW_BULLMQ_PREFIX`
- **Unit tests:** queues created with correct names, connection config

### T1.5 — Run regression tests

- Re-run T0.1 baseline tests
- **Acceptance:** Zero new failures

---

## Phase 2: Refactor trigger service (extract, don't rewrite)

### T2.1 — Extract `MemoryExtractionWorkflowService` into transport implementations

- Create `workflow/impls/qstash.ts` — move existing trigger methods from `extract.ts`
- Create `workflow/impls/index.ts` — mode switching logic
- Update `extract.ts` to import from `workflow/impls/index.ts`
- **Behavior:** Identical to current (QStash path unchanged)
- **Acceptance:** All existing tests pass, no behavior change

### T2.2 — Create local in-process trigger

- File: `workflow/impls/local.ts`
- Each trigger method calls the corresponding handler directly with fake context
- Returns synthetic `workflowRunId: "local-${Date.now()}"`
- Promise-chaining for `parallelism: 1` queues (like agent-signal/local.ts)
- **Unit tests:** each trigger calls correct handler, returns valid workflowRunId

### T2.3 — Create BullMQ trigger service

- File: `workflow/impls/bullmq.ts`
- Each trigger method calls `queue.add()` with correct queue and options
- Per-user group keys for `process-topic` and `persona-update`
- Returns `{ workflowRunId: "bullmq-${job.id}" }`
- **Unit tests:** each trigger adds to correct queue, correct options, correct return value

### T2.4 — Wire mode switching in `impls/index.ts`

- `getMemoryWorkflowMode()` reads env vars
- `MEMORY_WORKFLOW_MODE=local-queue` → BullMQ
- `MEMORY_WORKFLOW_MODE=local` → local
- `AGENT_RUNTIME_MODE=queue` → QStash
- Default → local
- **Unit tests:** all 4 mode combinations

### T2.5 — Run regression tests

- Re-run T0.1 baseline tests
- **Acceptance:** Zero new failures (QStash path is default, unchanged)

---

## Phase 3: BullMQ Workers

### T3.1 — Create hourly processor

- File: `workers/processors/hourly.ts`
- Wraps `hourlyWorkflowHandler` with fake context
- Error handling + logging
- **Unit tests:** calls handler, handles errors

### T3.2 — Create processUsers processor

- File: `workers/processors/processUsers.ts`
- Wraps `processUsersHandler` with fake context
- **Unit tests:** calls handler, handles errors

### T3.3 — Create processUserTopics processor

- File: `workers/processors/processUserTopics.ts`
- Wraps `processUserTopicsHandler` with fake context
- **Unit tests:** calls handler, handles errors

### T3.4 — Create processTopics processor

- File: `workers/processors/processTopics.ts`
- Wraps `processTopicsHandler` with fake context
- **Unit tests:** calls handler, handles errors

### T3.5 — Create processTopic processor

- File: `workers/processors/processTopic.ts`
- Wraps `processTopicHandler` with fake context
- Handles `WorkflowNonRetryableError` → `job.discard()`
- **Unit tests:** calls handler, handles non-retryable errors

### T3.6 — Create personaUpdate processor

- File: `workers/processors/personaUpdate.ts`
- Wraps `personaUpdateHandler` with fake context
- **Unit tests:** calls handler, handles errors

### T3.7 — Create worker bootstrap

- File: `workers/bootstrap.ts`
- `startMemoryWorkers()` — creates 6 workers with correct concurrency/limiter config
- `stopMemoryWorkers()` — graceful shutdown (close workers + queues)
- Event handlers: `completed`, `failed`, `stalled` → structured logging
- **Unit tests:** workers created with correct config, graceful shutdown

### T3.8 — Run regression tests

- Re-run T0.1 baseline tests
- **Acceptance:** Zero new failures

---

## Phase 4: Integration

### T4.1 — Wire BullMQ workers into server startup

- In server startup code, check `MEMORY_WORKFLOW_MODE=local-queue`
- Call `startMemoryWorkers()` if BullMQ mode
- Call `stopMemoryWorkers()` on graceful shutdown (SIGTERM)
- **Acceptance:** Server starts cleanly with `MEMORY_WORKFLOW_MODE=local-queue`

### T4.2 — Wire BullMQ trigger into memory extraction entry points

- Update hourly cron trigger to use new `MemoryExtractionWorkflowService`
- Update UI "Request Memory Analysis" button path
- **Acceptance:** Extraction can be triggered via UI in BullMQ mode

### T4.3 — Integration test: end-to-end extraction

- Start Redis + PostgreSQL (Docker Compose dev)
- Set `MEMORY_WORKFLOW_MODE=local-queue`
- Seed test data (user, topic, messages)
- Trigger extraction
- Wait for completion (timeout: 60s)
- Assert: `user_memories` has records
- Assert: `async_task` status is success
- Assert: no QStash calls in logs
- **Acceptance:** Memories extracted successfully via BullMQ

### T4.4 — Integration test: cancellation

- Start extraction with many topics
- Set `cancelRequestedAt` on async\_task
- Assert: remaining jobs cleaned up
- Assert: already-extracted memories preserved
- **Acceptance:** Cancellation works correctly

### T4.5 — Run full regression suite

- All tests from T0.1
- All new unit tests from T1-T3
- All new integration tests from T4
- **Acceptance:** Zero failures

---

## Phase 5: Docker & Documentation

### T5.1 — Update docker-compose-dev.yml

- Add `MEMORY_WORKFLOW_MODE=local-queue` to lobe service env
- Verify Redis connection works
- **Acceptance:** `docker compose up` works with BullMQ mode

### T5.2 — Update documentation

- Add `MEMORY_WORKFLOW_MODE` to env var documentation
- Add troubleshooting section for BullMQ mode
- **Acceptance:** Docs are clear and complete

### T5.3 — Final smoke test

- Full manual test: Docker Compose up → UI → chat → memory analysis → verify results
- **Acceptance:** End-to-end flow works in Docker

---

## Task Dependencies

```
T0.1 (baseline)
  └─ T1.1 (bullmq dep)
  └─ T1.2 (types)
  └─ T1.3 (fake context) ─────────────────────┐
  └─ T1.4 (queues) ──────────────────────────┐ │
  └─ T1.5 (regression)                       │ │
      └─ T2.1 (refactor trigger)             │ │
          └─ T2.2 (local trigger)            │ │
          └─ T2.3 (bullmq trigger) ──────────┤ │
          └─ T2.4 (mode switch)              │ │
          └─ T2.5 (regression)               │ │
              └─ T3.1-T3.6 (processors) ◄────┘ │
              └─ T3.7 (bootstrap) ◄────────────┘
              └─ T3.8 (regression)
                  └─ T4.1 (server wiring)
                  └─ T4.2 (entry points)
                  └─ T4.3 (integration: e2e)
                  └─ T4.4 (integration: cancel)
                  └─ T4.5 (full regression)
                      └─ T5.1 (docker)
                      └─ T5.2 (docs)
                      └─ T5.3 (smoke test)
```

## Parallel Execution Opportunities

| Group       | Tasks                              | Can Run Parallel        |
| ----------- | ---------------------------------- | ----------------------- |
| Foundation  | T1.1, T1.2, T1.3, T1.4             | Yes (no file overlap)   |
| Processors  | T3.1, T3.2, T3.3, T3.4, T3.5, T3.6 | Yes (independent files) |
| Integration | T4.1, T4.2                         | Yes (different files)   |
| Final       | T5.1, T5.2                         | Yes (different files)   |

## Estimated Effort

| Phase     | Tasks  | Effort       |
| --------- | ------ | ------------ |
| Phase 0   | 1      | 30 min       |
| Phase 1   | 5      | 1 day        |
| Phase 2   | 5      | 2 days       |
| Phase 3   | 8      | 2 days       |
| Phase 4   | 5      | 1-2 days     |
| Phase 5   | 3      | 1 day        |
| **Total** | **27** | **\~7 days** |
