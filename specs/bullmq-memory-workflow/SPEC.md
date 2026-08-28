# Spec: BullMQ Memory Workflow for Self-Hosted LobeHub

## Status: DRAFT

## Branch: feature/bullmq-memory-workflow

## Created: 2026-08-21

---

## 1. Problem Statement

LobeHub's memory extraction pipeline (User Memory Analysis) relies on **Upstash QStash Workflows** — an external SaaS service that uses HTTP callbacks to orchestrate multi-step background jobs. This creates critical issues for self-hosted deployments:

- **QStash local dev server does NOT support Workflow API** (closed as "not planned" — lobehub/lobe-chat#14421)
- **QStash Cloud requires a publicly accessible HTTPS endpoint** — many self-hosted setups are behind NAT/firewall
- **10+ open issues** about workflows getting stuck on self-hosted (#16636, #15497, #17596, #17483)
- **External dependency** on Upstash account and API tokens

## 2. Solution

Implement a **BullMQ-based local execution path** following the existing codebase pattern where QStash workflows can be replaced with local implementations (see `agent-signal/local.ts`, `expertise-history`, `queue/impls/local.ts`, `taskScheduler/impls/local.ts`).

### Three execution modes

| Mode       | Env Var                            | Use Case                            |
| ---------- | ---------------------------------- | ----------------------------------- |
| QStash     | `AGENT_RUNTIME_MODE=queue`         | Cloud/Vercel deployments (existing) |
| BullMQ     | `MEMORY_WORKFLOW_MODE=local-queue` | Self-hosted production (NEW)        |
| In-process | default (no env)                   | Local dev/testing (NEW)             |

### Key design principle

**Reuse all existing workflow handlers unchanged.** The handlers (`hourly.ts`, `processUsers.ts`, etc.) accept a `WorkflowContext` and call `context.run()`. We provide a fake context where `run()` is a direct passthrough — same pattern as `agent-signal/local.ts`. BullMQ provides the durability boundary instead of QStash's step persistence.

## 3. Architecture

### 3.1 Component Overview

```
┌──────────────────────────────────────────────────────────────┐
│              MemoryExtractionWorkflowService                  │
│                                                               │
│  triggerProcessUsers() / triggerHourly() / etc.               │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ QStash impl  │  │ BullMQ impl  │  │ Local in-process     │ │
│  │ (existing)   │  │ (NEW)        │  │ (NEW)                │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘ │
└─────────┼────────────────┼──────────────────────┼─────────────┘
          │                │                      │
          ▼                ▼                      ▼
     QStash Cloud    ┌─────────┐           Direct function
     (external)      │ Redis 7 │           calls (no queue)
                     │(existing)│
                     └────┬────┘
                          │
                    ┌─────▼─────┐
                    │  BullMQ   │
                    │  Workers  │
                    └─────┬─────┘
                          │
                    ┌─────▼─────────────────────┐
                    │ Existing workflow handlers  │
                    │ (hourly.ts, processUsers.ts │
                    │  processTopic.ts, etc.)     │
                    └─────┬─────────────────────┘
                          │
                    ┌─────▼─────────────────────┐
                    │ MemoryExtractionExecutor   │
                    │ (business logic — unchanged)│
                    └───────────────────────────┘
```

### 3.2 File Structure

```
apps/server/src/services/memory/userMemory/
├── extract.ts                              # EXISTING — MemoryExtractionExecutor unchanged
│                                           # EXISTING — MemoryExtractionWorkflowService refactored
└── workflow/                               # NEW directory
    ├── types.ts                            # Shared types (payload, options, mode)
    ├── impls/
    │   ├── index.ts                        # Mode switch → implementation
    │   ├── qstash.ts                       # Refactored from MemoryExtractionWorkflowService
    │   ├── bullmq.ts                       # NEW: BullMQ trigger service
    │   └── local.ts                        # NEW: In-process trigger (dev/test)
    └── workers/                            # NEW: BullMQ worker infrastructure
        ├── queues.ts                       # 6 Queue definitions
        ├── context.ts                      # Fake WorkflowContext factory
        ├── bootstrap.ts                    # Worker startup/shutdown
        └── processors/
            ├── hourly.ts
            ├── processUsers.ts
            ├── processUserTopics.ts
            ├── processTopics.ts
            ├── processTopic.ts
            └── personaUpdate.ts
```

### 3.3 Queue Topology

| Queue Name              | Concurrency | Rate Limiter  | Group Key |
| ----------------------- | ----------- | ------------- | --------- |
| `memory:hourly`         | 1           | 1/s           | —         |
| `memory:process-users`  | 1           | 1/s           | —         |
| `memory:user-topics`    | 25          | —             | —         |
| `memory:process-topics` | 20          | —             | —         |
| `memory:process-topic`  | 25          | 5/s per group | `userId`  |
| `memory:persona-update` | 4           | 1/s per group | `userId`  |

### 3.4 Fake WorkflowContext

```typescript
// The core abstraction — same pattern as agent-signal/local.ts
const createLocalWorkflowContext = <TPayload>(job: Job<TPayload>) => ({
  requestPayload: job.data,
  workflowRunId: `bullmq-${job.id}`,
  run: async (_stepId: string, handler: () => Promise<any>) => handler(),
});
```

This means:

- `context.run(stepName, fn)` → `await fn()` (no persistence, no replay)
- `context.requestPayload` → `job.data` (BullMQ serializes to JSON, same as QStash)
- `context.workflowRunId` → `bullmq-${job.id}` (synthetic ID for tracking)

### 3.5 Switching Logic

In `MemoryExtractionWorkflowService`, each trigger method checks the mode:

```typescript
static async triggerProcessUsers(payload, options?) {
  const mode = getMemoryWorkflowMode();

  if (mode === 'bullmq') {
    const job = await QUEUES.processUsers.add('process-users', payload);
    return { workflowRunId: `bullmq-${job.id}` };
  }

  if (mode === 'local') {
    // Direct in-process execution
    const { processUsersHandler } = await import('.../workflows/processUsers');
    const context = createDirectContext(payload);
    processUsersHandler(context);
    return { workflowRunId: `local-${Date.now()}` };
  }

  // Default: QStash (existing behavior)
  return this.getClient().trigger({ ... });
}
```

### 3.6 Worker Deployment

**Option A: In-process (recommended for single-user self-hosted)**

Workers start alongside the Hono server when `MEMORY_WORKFLOW_MODE=local-queue`:

```typescript
// In server startup
if (process.env.MEMORY_WORKFLOW_MODE === 'local-queue') {
  startMemoryWorkers();
}
```

**Option B: Separate container (for multi-user or resource isolation)**

```yaml
# docker-compose.yml
lobe-worker:
  image: lobehub/lobe-server
  command: node dist/workers/memory/bootstrap.js
  environment:
    - MEMORY_WORKFLOW_MODE=local-queue
    - REDIS_URL=redis://redis:6379
```

### 3.7 Cancellation

BullMQ cancellation replaces QStash's bulk cancel API:

```typescript
// Cancel all jobs for a given hourly task
const cancelHourlyJobs = async (hourlyTaskId: string) => {
  for (const queue of Object.values(QUEUES)) {
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
    for (const job of jobs) {
      if (job.data.hourlyTaskId === hourlyTaskId) {
        await job.remove();
      }
    }
  }
};
```

Cooperative cancellation (checking `async_tasks` table) remains unchanged — it's already in the workflow handlers.

### 3.8 Observability

- **BullMQ events**: `worker.on('completed')`, `worker.on('failed')`, `worker.on('stalled')` → structured logging
- **OTEL spans**: Wrap each processor with the same OTEL tracing as the QStash handlers
- **Metrics**: BullMQ provides `queue.getJobCounts()` for Prometheus-style metrics
- **Dashboard**: Optional `@bull-board/express` for UI monitoring

## 4. What Changes vs. What Stays

### Unchanged (zero modifications)

| Component                  | File                                                                                                                        | Why                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `MemoryExtractionExecutor` | `extract.ts` (lines 1-2780)                                                                                                 | Pure business logic, no QStash coupling         |
| Workflow handlers          | `workflows/hourly.ts`, `processUsers.ts`, `processUserTopics.ts`, `processTopics.ts`, `processTopic.ts`, `personaUpdate.ts` | Accept `WorkflowContext`, agnostic to transport |
| Run guard                  | `workflows/runGuard.ts`                                                                                                     | Already Redis-native                            |
| Utils                      | `workflows/utils.ts`                                                                                                        | Cursor serialization, cancellation checks       |
| `AsyncTaskModel`           | database model                                                                                                              | Progress tracking unchanged                     |
| Payload types              | `extract.ts` types                                                                                                          | JSON-serializable, transport-agnostic           |
| Route registration         | `workflows/memory-user-memory/index.ts`                                                                                     | QStash routes stay for cloud mode               |

### Refactored (extract, don't rewrite)

| Component                         | Change                                                          | Why                                          |
| --------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| `MemoryExtractionWorkflowService` | Extract trigger methods into transport-specific implementations | Enable switching between QStash/BullMQ/local |

### New code

| Component                | File                      | Lines (est.)      |
| ------------------------ | ------------------------- | ----------------- |
| Fake WorkflowContext     | `workers/context.ts`      | \~30              |
| Queue definitions        | `workers/queues.ts`       | \~50              |
| BullMQ trigger service   | `impls/bullmq.ts`         | \~150             |
| Local in-process trigger | `impls/local.ts`          | \~100             |
| Mode switching           | `impls/index.ts`          | \~40              |
| 6 worker processors      | `workers/processors/*.ts` | \~60 each = \~360 |
| Worker bootstrap         | `workers/bootstrap.ts`    | \~80              |
| Types                    | `workflow/types.ts`       | \~40              |
| **Total**                |                           | **\~850**         |

## 5. Testing Strategy

### 5.1 Regression Safety — Existing Tests Must Pass

**Before any changes:**

```bash
# Run all existing memory-related tests
pnpm test -- --filter="@lobechat/server" -- memory
pnpm test -- --filter="@lobechat/server" -- extract
pnpm test -- --filter="@lobechat/server" -- workflow
```

**After each task:**

- Re-run the same test suite
- Zero new failures allowed

### 5.2 Unit Tests for New Code

#### `workflow/impls/index.ts` — Mode switching

```
- returns QStash impl when AGENT_RUNTIME_MODE=queue
- returns BullMQ impl when MEMORY_WORKFLOW_MODE=local-queue
- returns local impl when no env vars set
- returns BullMQ impl when both modes set (MEMORY_WORKFLOW_MODE takes precedence)
```

#### `workflow/impls/bullmq.ts` — BullMQ trigger service

```
- triggerProcessUsers adds job to memory:process-users queue
- triggerProcessTopic adds job with correct userId groupKey
- triggerHourly creates job with workflowRunId
- triggerHourlyTracked creates async task then adds job
- all trigger methods return { workflowRunId: "bullmq-<jobId>" }
- throws when baseUrl is missing
```

#### `workflow/impls/local.ts` — In-process trigger

```
- triggerProcessUsers calls handler directly
- returns synthetic workflowRunId
- does not create BullMQ jobs
```

#### `workflow/workers/context.ts` — Fake context

```
- createLocalWorkflowContext returns object with requestPayload from job.data
- context.run() executes handler directly and returns result
- context.workflowRunId matches expected format
```

#### `workflow/workers/processors/*.ts` — Each processor

```
- processor calls existing handler with fake context
- processor handles handler errors gracefully
- processor reports progress via job.updateProgress()
```

### 5.3 Integration Tests

#### End-to-end memory extraction (BullMQ mode)

```
Setup:
  - Start Redis (test container or existing)
  - Start BullMQ workers
  - Seed database with test user, topic, and messages

Test:
  1. Call triggerHourly() via BullMQ service
  2. Wait for job completion (with timeout)
  3. Assert: user_memories table has extracted records
  4. Assert: async_task status is 'success'
  5. Assert: no QStash calls were made
```

#### Cancellation test

```
1. Start a large extraction (many topics)
2. Cancel via async_task.cancelRequestedAt
3. Assert: remaining jobs are removed from queues
4. Assert: already-extracted memories are preserved
```

#### Mode switching test

```
1. Set MEMORY_WORKFLOW_MODE=local-queue
2. Trigger extraction
3. Assert: BullMQ jobs created (not QStash calls)
4. Switch to MEMORY_WORKFLOW_MODE=local
5. Trigger extraction
6. Assert: direct execution (no queue jobs)
```

### 5.4 Smoke Test — Manual Verification

```bash
# 1. Start dev environment
docker compose -f docker-compose-dev.yml up -d

# 2. Set env
export MEMORY_WORKFLOW_MODE=local-queue

# 3. Start LobeHub server
pnpm dev

# 4. Open UI, create a chat with some messages
# 5. Click "Request Memory Analysis" in settings
# 6. Verify: BullMQ dashboard shows jobs processing
# 7. Verify: Memories appear in the UI after completion
# 8. Verify: No QStash errors in logs
```

### 5.5 What to Watch For

| Risk                                              | Mitigation                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| JSON serialization differences (QStash vs BullMQ) | Both use JSON.stringify — Dates become strings. Existing `parseWorkflowDate()` handles this.              |
| BullMQ job retry vs QStash step replay            | BullMQ retries the entire job. Handlers already have idempotency checks (`isTopicExtracted()`).           |
| Redis connection sharing                          | BullMQ creates its own ioredis connections. Use same Redis instance but separate connection pools.        |
| Worker process crash                              | BullMQ marks job as failed, retries with backoff. `failureFunction` equivalent via `worker.on('failed')`. |
| Memory leaks in long-running workers              | BullMQ workers are long-lived. Monitor with `process.memoryUsage()`. Set `lockDuration` appropriately.    |

## 6. Dependencies

### New npm dependency

```json
{
  "bullmq": "^5.x"
}
```

BullMQ uses `ioredis` internally (already a dependency). No other new dependencies.

### Existing infrastructure

- **Redis 7** — already in Docker Compose (`redis:7-alpine`)
- **ioredis** — already a dependency (`^5.11.1`)
- **PostgreSQL** — unchanged (async\_tasks, user\_memories tables)

## 7. Environment Variables

| Variable                        | Values                          | Default              | Description                           |
| ------------------------------- | ------------------------------- | -------------------- | ------------------------------------- |
| `MEMORY_WORKFLOW_MODE`          | `local-queue`, `local`, (unset) | unset                | Execution mode for memory workflow    |
| `REDIS_URL`                     | URL                             | `redis://redis:6379` | Existing — used by BullMQ             |
| `MEMORY_WORKFLOW_BULLMQ_PREFIX` | string                          | `bull`               | BullMQ key prefix in Redis (optional) |

When `MEMORY_WORKFLOW_MODE` is unset:

- If `AGENT_RUNTIME_MODE=queue` → QStash (existing behavior)
- Otherwise → in-process local (new, for dev)

## 8. Migration Path

1. **Zero breaking changes** — existing QStash path is untouched
2. **Opt-in** — set `MEMORY_WORKFLOW_MODE=local-queue` to enable BullMQ
3. **Reversible** — unset the env var to fall back to QStash or local
4. **No DB migrations** — same tables, same schemas
5. **No Docker changes required** — Redis already in stack

## 9. Out of Scope

- `bull-board` dashboard (can be added later)
- Separate worker container (in-process is sufficient for single-user)
- Replacing QStash for other workflows (agent-signal, expertise-history, etc.)
- Modifying the memory extraction prompts or LLM logic
