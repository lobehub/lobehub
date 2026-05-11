---
name: upstash-workflow
description: 'Upstash Workflow implementation guide. Use when creating async workflows with QStash, implementing fan-out patterns, or building 3-layer workflow architecture (process → paginate → execute).'
user-invocable: false
---

# Upstash Workflow Implementation Guide

Standard patterns for implementing Upstash Workflow + QStash async workflows in the LobeHub codebase.

## 🎯 The Three Core Patterns

Every workflow in LobeHub combines these three patterns. They exist because the platform constrains you in three ways: rate limits make blind fan-out dangerous, step limits cap a single workflow's size, and idempotency demands that retries don't double-process.

1. **🔍 Dry-Run Mode** — get statistics without triggering actual execution
2. **🌟 Fan-Out Pattern** — split large batches into smaller chunks for parallel processing
3. **🎯 Single Task Execution** — each workflow execution processes **exactly ONE item**

---

## Architecture Overview

All workflows follow the same 3-layer architecture:

```text
Layer 1: Entry Point (process-*)
  ├─ Validates prerequisites
  ├─ Calculates total items to process
  ├─ Filters existing items
  ├─ Supports dry-run mode (statistics only)
  └─ Triggers Layer 2 if work is needed

Layer 2: Pagination (paginate-*)
  ├─ Handles cursor-based pagination
  ├─ Implements fan-out for large batches
  ├─ Recursively processes all pages
  └─ Triggers Layer 3 for each item

Layer 3: Single Task Execution (execute-* / generate-*)
  └─ Performs actual business logic for ONE item
```

**Real examples in this codebase:** `welcome-placeholder`, `agent-welcome` — see [`references/examples.md`](./references/examples.md).

---

## The Three Patterns in 60 Seconds

### 1. Dry-Run Mode

Short-circuit Layer 1 before any side effects so callers can preview what would happen:

```typescript
if (dryRun) {
  return {
    ...result,
    dryRun: true,
    message: `[DryRun] Would process ${itemsNeedingProcessing.length} items`,
  };
}
```

Use case: check how many items will be processed before committing.

### 2. Fan-Out Pattern

Layer 2 splits oversized batches into chunks and recursively re-triggers itself with each chunk. This avoids hitting workflow step limits when one page contains too many items:

```typescript
const CHUNK_SIZE = 20;

if (itemIds.length > CHUNK_SIZE) {
  const chunks = chunk(itemIds, CHUNK_SIZE);
  await Promise.all(
    chunks.map((ids, idx) =>
      context.run(`workflow:fanout:${idx + 1}/${chunks.length}`, () =>
        WorkflowClass.triggerPaginateItems({ itemIds: ids }),
      ),
    ),
  );
}
```

Defaults: `PAGE_SIZE = 50` (items per page), `CHUNK_SIZE = 20` (items per fan-out chunk).

### 3. Single Task Execution

Layer 3 always processes exactly one item per invocation. Parallelism comes from Layer 2 fanning out to many Layer 3 invocations, controlled by `flowControl`:

```typescript
export const { POST } = serve<ExecutePayload>(
  async (context) => {
    const { itemId } = context.requestPayload ?? {};
    if (!itemId) return { success: false, error: 'Missing itemId' };

    const item = await context.run('workflow:get-item', () => getItem(itemId));
    const result = await context.run('workflow:execute', () => processItem(item));
    await context.run('workflow:save', () => saveResult(itemId, result));

    return { success: true, itemId, result };
  },
  {
    flowControl: { key: 'workflow.execute', parallelism: 10, ratePerSecond: 5 },
  },
);
```

---

## File Structure

```text
src/
├── app/(backend)/api/workflows/
│   └── {workflow-name}/
│       ├── process-{entities}/route.ts      # Layer 1
│       ├── paginate-{entities}/route.ts     # Layer 2
│       └── execute-{entity}/route.ts        # Layer 3
│
└── server/workflows/
    └── {workflowName}/
        └── index.ts                          # Workflow class
```

---

## Where to Go Next

Pick the reference that matches what you're doing:

| You want to...                                       | Read                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| Write the Workflow class + 3 routes from scratch     | [`references/implementation.md`](./references/implementation.md) |
| Tune flowControl, error handling, logging, testing   | [`references/best-practices.md`](./references/best-practices.md) |
| See two real workflows end-to-end                    | [`references/examples.md`](./references/examples.md)             |
| Deploy on lobehub-cloud (re-exports, cloud-only ops) | [`references/cloud.md`](./references/cloud.md)                   |

---

## Environment Variables

```bash
# Required for all workflows
APP_URL=https://your-app.com # Base URL for workflow endpoints
QSTASH_TOKEN=qstash_xxx      # QStash authentication token

# Optional (for custom QStash URL)
QSTASH_URL=https://custom-qstash.com
```

---

## Checklist for New Workflows

### Planning

- [ ] Identify the entity to process (users, agents, items, …)
- [ ] Define the per-item business logic
- [ ] Determine filtering logic (Redis cache, database state, …)

### Implementation

- [ ] Define payload types with TypeScript interfaces
- [ ] Create workflow class with static trigger methods
- [ ] **Layer 1:** entry point with **dry-run** support
- [ ] **Layer 1:** filtering logic to avoid duplicate work
- [ ] **Layer 2:** pagination with **fan-out**
- [ ] **Layer 3:** **single-task execution** (ONE item per run)
- [ ] Configure appropriate `flowControl` for each layer
- [ ] Consistent logging with workflow prefixes
- [ ] Validate all required payload parameters
- [ ] Unique `context.run()` step names

### Quality & Deployment

- [ ] Return consistent response shapes
- [ ] Configure cloud deployment ([`references/cloud.md`](./references/cloud.md) if on lobehub-cloud)
- [ ] Write integration tests (`dryRun` path + full path)
- [ ] Smoke-test with dry-run first
- [ ] Test with a small batch before full rollout

---

## Additional Resources

- [Upstash Workflow Documentation](https://upstash.com/docs/workflow)
- [QStash Documentation](https://upstash.com/docs/qstash)
- [Example Workflows in Codebase](<../../src/app/(backend)/api/workflows/>)
- [Workflow Classes](../../src/server/workflows/)
