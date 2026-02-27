# Upstash Workflow Implementation Guide

This guide covers the standard patterns for implementing Upstash Workflow + QStash async workflows in the LobeHub codebase.

## 🎯 The Three Core Patterns

All workflows in LobeHub follow the same 3-layer architecture with three essential patterns:

1. **🔍 Dry-Run Mode** - Get statistics without triggering actual execution
2. **🌟 Fan-Out Pattern** - Split large batches into smaller chunks for parallel processing
3. **🎯 Single Task Execution** - Each workflow execution processes **ONE item only**

These patterns ensure scalable, debuggable, and cost-efficient async workflows.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Patterns](#core-patterns)
3. [File Structure](#file-structure)
4. [Implementation Patterns](#implementation-patterns)
5. [Best Practices](#best-practices)
6. [Examples](#examples)

---

## Architecture Overview

### Standard 3-Layer Pattern

All workflows follow a standard 3-layer architecture:

```
Layer 1: Entry Point (process-*)
  ├─ Validates prerequisites
  ├─ Calculates total items to process
  ├─ Filters existing items
  ├─ Supports dry-run mode (statistics only)
  └─ Triggers Layer 2 if work needed

Layer 2: Pagination (paginate-*)
  ├─ Handles cursor-based pagination
  ├─ Implements fan-out for large batches
  ├─ Recursively processes all pages
  └─ Triggers Layer 3 for each item

Layer 3: Single Task Execution (execute-*/generate-*)
  └─ Performs actual business logic for ONE item
```

**Examples**: `welcome-placeholder`, `agent-welcome`

---

## Core Patterns

### 1. Dry-Run Mode

**Purpose**: Get statistics without triggering actual execution

**Pattern**:

```typescript
// Layer 1: Entry Point
if (dryRun) {
  console.log('[workflow:process] Dry run mode, returning statistics only');
  return {
    ...result,
    dryRun: true,
    message: `[DryRun] Would process ${itemsNeedingProcessing.length} items`,
  };
}
```

**Use Case**: Check how many items will be processed before committing to execution

**Response**:

```typescript
{
  success: true,
  totalEligible: 100,
  toProcess: 80,
  alreadyProcessed: 20,
  dryRun: true,
  message: "[DryRun] Would process 80 items"
}
```

### 2. Fan-Out Pattern

**Purpose**: Split large batches into smaller chunks for parallel processing

**Pattern**:

```typescript
// Layer 2: Pagination
const CHUNK_SIZE = 20;

if (itemIds.length > CHUNK_SIZE) {
  // Fan-out to smaller chunks
  const chunks = chunk(itemIds, CHUNK_SIZE);
  console.log('[workflow:paginate] Fan-out mode:', {
    chunks: chunks.length,
    chunkSize: CHUNK_SIZE,
    totalItems: itemIds.length,
  });

  await Promise.all(
    chunks.map((ids, idx) =>
      context.run(`workflow:fanout:${idx + 1}/${chunks.length}`, () =>
        WorkflowClass.triggerPaginateItems({ itemIds: ids }),
      ),
    ),
  );
}
```

**Use Case**: Avoid hitting workflow step limits by splitting large batches

**Configuration**:

- `PAGE_SIZE = 50` - Items per pagination page
- `CHUNK_SIZE = 20` - Items per fan-out chunk
- If batch > CHUNK_SIZE, split into chunks and recursively trigger pagination

### 3. Single Task Execution

**Purpose**: Execute business logic for ONE item at a time

**Pattern**:

```typescript
// Layer 3: Single Task Execution
export const { POST } = serve<ExecutePayload>(
  async (context) => {
    const { itemId } = context.requestPayload ?? {};

    if (!itemId) {
      return { success: false, error: 'Missing itemId' };
    }

    // Get item
    const item = await context.run('workflow:get-item', async () => {
      return getItem(itemId);
    });

    // Execute business logic for THIS item only
    const result = await context.run('workflow:execute', async () => {
      return processItem(item);
    });

    // Save result for THIS item
    await context.run('workflow:save', async () => {
      return saveResult(itemId, result);
    });

    return { success: true, itemId, result };
  },
  {
    flowControl: {
      key: 'workflow.execute',
      parallelism: 10,
      ratePerSecond: 5,
    },
  },
);
```

**Key Principles**:

- Each workflow execution handles **exactly ONE item**
- Parallelism controlled by `flowControl` config
- Multiple items processed via Layer 2 triggering multiple Layer 3 executions

---

## File Structure

### Directory Layout

```
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

### Cloud Project Configuration

For lobehub-cloud specific configurations (re-exports, cloud-only workflows, deployment patterns), see:

📄 **[Cloud Configuration Guide](./reference/cloud.md)**

---

## Implementation Patterns

### 1. Workflow Class

**Location**: `src/server/workflows/{workflowName}/index.ts`

```typescript
import { Client } from '@upstash/workflow';
import debug from 'debug';

const log = debug('lobe-server:workflows:{workflow-name}');

// Workflow paths
const WORKFLOW_PATHS = {
  processItems: '/api/workflows/{workflow-name}/process-items',
  paginateItems: '/api/workflows/{workflow-name}/paginate-items',
  executeItem: '/api/workflows/{workflow-name}/execute-item',
} as const;

// Payload types
export interface ProcessItemsPayload {
  dryRun?: boolean;
  force?: boolean;
}

export interface PaginateItemsPayload {
  cursor?: string;
  itemIds?: string[]; // For fanout chunks
}

export interface ExecuteItemPayload {
  itemId: string;
}

/**
 * Get workflow URL using APP_URL
 */
const getWorkflowUrl = (path: string): string => {
  const baseUrl = process.env.APP_URL;
  if (!baseUrl) throw new Error('APP_URL is required to trigger workflows');
  return new URL(path, baseUrl).toString();
};

/**
 * Get workflow client
 */
const getWorkflowClient = (): Client => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to trigger workflows');

  const config: ConstructorParameters<typeof Client>[0] = { token };
  if (process.env.QSTASH_URL) {
    (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  }
  return new Client(config);
};

/**
 * {Workflow Name} Workflow
 */
export class {WorkflowName}Workflow {
  private static client: Client;

  private static getClient(): Client {
    if (!this.client) {
      this.client = getWorkflowClient();
    }
    return this.client;
  }

  /**
   * Trigger workflow to process items (entry point)
   */
  static triggerProcessItems(payload: ProcessItemsPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.processItems);
    log('Triggering process-items workflow');
    return this.getClient().trigger({ body: payload, url });
  }

  /**
   * Trigger workflow to paginate items
   */
  static triggerPaginateItems(payload: PaginateItemsPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.paginateItems);
    log('Triggering paginate-items workflow');
    return this.getClient().trigger({ body: payload, url });
  }

  /**
   * Trigger workflow to execute a single item
   */
  static triggerExecuteItem(payload: ExecuteItemPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.executeItem);
    log('Triggering execute-item workflow: %s', payload.itemId);
    return this.getClient().trigger({ body: payload, url });
  }

  /**
   * Filter items that need processing (e.g., check Redis cache, database state)
   */
  static async filterItemsNeedingProcessing(itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) return [];

    // Check existing state (Redis, database, etc.)
    // Return items that need processing

    return itemIds;
  }
}
```

### 2. Layer 1: Entry Point (process-\*)

**Purpose**: Validates prerequisites, calculates statistics, supports dryRun mode

```typescript
import { serve } from '@upstash/workflow/nextjs';
import { getServerDB } from '@/database/server';
import { WorkflowClass, type ProcessPayload } from '@/server/workflows/{workflowName}';

/**
 * Entry workflow for {workflow description}
 * 1. Get all eligible items
 * 2. Filter items that already have results
 * 3. If dryRun, return statistics only
 * 4. If no items need processing, return early
 * 5. Trigger paginate workflow
 */
export const { POST } = serve<ProcessPayload>(
  async (context) => {
    const { dryRun, force } = context.requestPayload ?? {};

    console.log('[{workflow}:process] Starting with payload:', { dryRun, force });

    // Get all eligible items
    const allItemIds = await context.run('{workflow}:get-all-items', async () => {
      const db = await getServerDB();
      // Query database for eligible items
      return items.map((item) => item.id);
    });

    console.log('[{workflow}:process] Total eligible items:', allItemIds.length);

    if (allItemIds.length === 0) {
      return {
        success: true,
        totalEligible: 0,
        message: 'No eligible items found',
      };
    }

    // Filter items that need processing
    const itemsNeedingProcessing = await context.run('{workflow}:filter-existing', () =>
      WorkflowClass.filterItemsNeedingProcessing(allItemIds),
    );

    const result = {
      success: true,
      totalEligible: allItemIds.length,
      toProcess: itemsNeedingProcessing.length,
      alreadyProcessed: allItemIds.length - itemsNeedingProcessing.length,
    };

    console.log('[{workflow}:process] Check result:', result);

    // If dryRun mode, return statistics only
    if (dryRun) {
      console.log('[{workflow}:process] Dry run mode, returning statistics only');
      return {
        ...result,
        dryRun: true,
        message: `[DryRun] Would process ${itemsNeedingProcessing.length} items`,
      };
    }

    // If no items need processing, return early
    if (itemsNeedingProcessing.length === 0) {
      console.log('[{workflow}:process] All items already processed');
      return {
        ...result,
        message: 'All items already processed',
      };
    }

    // Trigger paginate workflow
    console.log('[{workflow}:process] Triggering paginate workflow');
    await context.run('{workflow}:trigger-paginate', () => WorkflowClass.triggerPaginateItems({}));

    return {
      ...result,
      message: `Triggered pagination for ${itemsNeedingProcessing.length} items`,
    };
  },
  {
    flowControl: {
      key: '{workflow}.process',
      parallelism: 1,
      ratePerSecond: 1,
    },
  },
);
```

### 3. Layer 2: Pagination (paginate-\*)

**Purpose**: Handles cursor-based pagination, implements fanout for large batches

```typescript
import { serve } from '@upstash/workflow/nextjs';
import { chunk } from 'es-toolkit/compat';
import { getServerDB } from '@/database/server';
import { WorkflowClass, type PaginatePayload } from '@/server/workflows/{workflowName}';

const PAGE_SIZE = 50;
const CHUNK_SIZE = 20;

/**
 * Paginate items workflow - handles pagination and fanout
 * 1. If specific itemIds provided (from fanout), process them directly
 * 2. Otherwise, paginate through all items using cursor
 * 3. Filter items that need processing
 * 4. If batch > CHUNK_SIZE, fanout to smaller chunks
 * 5. Trigger execute workflow for each item
 * 6. Schedule next page if cursor exists
 */
export const { POST } = serve<PaginatePayload>(
  async (context) => {
    const { cursor, itemIds: payloadItemIds } = context.requestPayload ?? {};

    console.log('[{workflow}:paginate] Starting with payload:', {
      cursor,
      itemIdsCount: payloadItemIds?.length ?? 0,
    });

    // If specific itemIds are provided, process them directly (from fanout)
    if (payloadItemIds && payloadItemIds.length > 0) {
      console.log('[{workflow}:paginate] Processing specific itemIds:', {
        count: payloadItemIds.length,
      });

      await Promise.all(
        payloadItemIds.map((itemId) =>
          context.run(`{workflow}:execute:${itemId}`, () =>
            WorkflowClass.triggerExecuteItem({ itemId }),
          ),
        ),
      );

      return {
        success: true,
        processedItems: payloadItemIds.length,
      };
    }

    // Paginate through all items
    const itemBatch = await context.run('{workflow}:get-batch', async () => {
      const db = await getServerDB();
      // Query database with cursor and PAGE_SIZE
      const items = await db.query(...);

      if (!items.length) return { ids: [] };

      const last = items.at(-1);
      return {
        ids: items.map(item => item.id),
        cursor: last ? last.id : undefined,
      };
    });

    const batchItemIds = itemBatch.ids;
    const nextCursor = 'cursor' in itemBatch ? itemBatch.cursor : undefined;

    console.log('[{workflow}:paginate] Got batch:', {
      batchSize: batchItemIds.length,
      nextCursor,
    });

    if (batchItemIds.length === 0) {
      console.log('[{workflow}:paginate] No more items, pagination complete');
      return { success: true, message: 'Pagination complete' };
    }

    // Filter items that need processing
    const itemIds = await context.run('{workflow}:filter-existing', () =>
      WorkflowClass.filterItemsNeedingProcessing(batchItemIds),
    );

    console.log('[{workflow}:paginate] After filtering:', {
      needProcessing: itemIds.length,
      skipped: batchItemIds.length - itemIds.length,
    });

    // Process items if any need processing
    if (itemIds.length > 0) {
      if (itemIds.length > CHUNK_SIZE) {
        // Fanout to smaller chunks
        const chunks = chunk(itemIds, CHUNK_SIZE);
        console.log('[{workflow}:paginate] Fanout mode:', {
          chunks: chunks.length,
          chunkSize: CHUNK_SIZE,
          totalItems: itemIds.length,
        });

        await Promise.all(
          chunks.map((ids, idx) =>
            context.run(`{workflow}:fanout:${idx + 1}/${chunks.length}`, () =>
              WorkflowClass.triggerPaginateItems({ itemIds: ids }),
            ),
          ),
        );
      } else {
        // Process directly
        console.log('[{workflow}:paginate] Processing items directly:', {
          count: itemIds.length,
        });

        await Promise.all(
          itemIds.map((itemId) =>
            context.run(`{workflow}:execute:${itemId}`, () =>
              WorkflowClass.triggerExecuteItem({ itemId }),
            ),
          ),
        );
      }
    }

    // Schedule next page
    if (nextCursor) {
      console.log('[{workflow}:paginate] Scheduling next page:', { nextCursor });
      await context.run('{workflow}:next-page', () =>
        WorkflowClass.triggerPaginateItems({ cursor: nextCursor }),
      );
    } else {
      console.log('[{workflow}:paginate] No more pages');
    }

    return {
      success: true,
      processedItems: itemIds.length,
      skippedItems: batchItemIds.length - itemIds.length,
      nextCursor: nextCursor ?? null,
    };
  },
  {
    flowControl: {
      key: '{workflow}.paginate',
      parallelism: 20,
      ratePerSecond: 5,
    },
  },
);
```

### 4. Layer 3: Execution (execute-_/generate-_)

**Purpose**: Performs actual business logic

```typescript
import { serve } from '@upstash/workflow/nextjs';
import { getServerDB } from '@/database/server';
import { WorkflowClass, type ExecutePayload } from '@/server/workflows/{workflowName}';

/**
 * Execute item workflow - performs actual business logic
 * 1. Get item data
 * 2. Perform business logic (AI generation, data processing, etc.)
 * 3. Save results
 */
export const { POST } = serve<ExecutePayload>(
  async (context) => {
    const { itemId } = context.requestPayload ?? {};

    console.log('[{workflow}:execute] Starting:', { itemId });

    if (!itemId) {
      return { success: false, error: 'Missing itemId' };
    }

    const db = await getServerDB();

    // Get item data
    const item = await context.run('{workflow}:get-item', async () => {
      // Query database for item
      return item;
    });

    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    // Perform business logic
    const result = await context.run('{workflow}:process-item', async () => {
      const workflow = new WorkflowClass(db, itemId);
      return workflow.generate(); // or process(), execute(), etc.
    });

    // Save results
    await context.run('{workflow}:save-result', async () => {
      const workflow = new WorkflowClass(db, itemId);
      return workflow.saveToRedis(result); // or saveToDatabase(), etc.
    });

    console.log('[{workflow}:execute] Completed:', { itemId });

    return {
      success: true,
      itemId,
      result,
    };
  },
  {
    flowControl: {
      key: '{workflow}.execute',
      parallelism: 10,
      ratePerSecond: 5,
    },
  },
);
```

---

## Best Practices

### 1. Error Handling

```typescript
export const { POST } = serve<Payload>(
  async (context) => {
    const { itemId } = context.requestPayload ?? {};

    // Validate required parameters
    if (!itemId) {
      return { success: false, error: 'Missing itemId in payload' };
    }

    try {
      // Perform work
      const result = await context.run('step-name', () => doWork(itemId));

      return { success: true, itemId, result };
    } catch (error) {
      console.error('[workflow:error]', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },
  { flowControl: { ... } },
);
```

### 2. Logging

Use consistent log prefixes and structured logging:

```typescript
console.log('[{workflow}:{layer}] Starting with payload:', payload);
console.log('[{workflow}:{layer}] Processing items:', { count: items.length });
console.log('[{workflow}:{layer}] Completed:', result);
console.error('[{workflow}:{layer}:error]', error);
```

### 3. Return Values

Return consistent response shapes:

```typescript
// Success response
return {
  success: true,
  itemId,
  result,
  message: 'Optional success message',
};

// Error response
return {
  success: false,
  error: 'Error description',
  itemId, // Include context if available
};

// Statistics response (for entry point)
return {
  success: true,
  totalEligible: 100,
  toProcess: 80,
  alreadyProcessed: 20,
  dryRun: true, // If applicable
  message: 'Summary message',
};
```

### 4. flowControl Configuration

**Purpose**: Control concurrency and rate limiting for workflow executions

Tune concurrency based on layer:

```typescript
// Layer 1: Entry point - single instance only
flowControl: {
  key: '{workflow}.process',
  parallelism: 1,        // Only 1 process workflow at a time
  ratePerSecond: 1,      // 1 execution per second
}

// Layer 2: Pagination - moderate concurrency
flowControl: {
  key: '{workflow}.paginate',
  parallelism: 20,       // Up to 20 pagination workflows in parallel
  ratePerSecond: 5,      // 5 new executions per second
}

// Layer 3: Single task execution - high concurrency
flowControl: {
  key: '{workflow}.execute',
  parallelism: 10,       // Up to 10 items processed in parallel
  ratePerSecond: 5,      // 5 new items per second
}
```

**Guidelines**:

- **Layer 1**: Always use `parallelism: 1` to avoid duplicate processing
- **Layer 2**: Moderate concurrency for pagination (typically 10-20)
- **Layer 3**: Higher concurrency for parallel item processing (typically 5-10)
- Adjust `ratePerSecond` based on external API rate limits or resource constraints

### 5. context.run() Best Practices

- Use descriptive step names with prefixes: `{workflow}:step-name`
- Each step should be idempotent (safe to retry)
- Don't nest context.run() calls - keep them flat
- Use unique step names when processing multiple items:

```typescript
// Good: Unique step names
await Promise.all(
  items.map((item) => context.run(`{workflow}:execute:${item.id}`, () => processItem(item))),
);

// Bad: Same step name for all items
await Promise.all(
  items.map((item) =>
    context.run(`{workflow}:execute`, () =>
      // ❌ Not unique
      processItem(item),
    ),
  ),
);
```

### 6. Payload Validation

Always validate required parameters at the start:

```typescript
export const { POST } = serve<Payload>(
  async (context) => {
    const { itemId, configId } = context.requestPayload ?? {};

    // Validate at the start
    if (!itemId) {
      return { success: false, error: 'Missing itemId in payload' };
    }

    if (!configId) {
      return { success: false, error: 'Missing configId in payload' };
    }

    // Proceed with work...
  },
  { flowControl: { ... } },
);
```

### 7. Database Connection

Get database connection once per workflow:

```typescript
export const { POST } = serve<Payload>(
  async (context) => {
    const db = await getServerDB(); // Get once

    // Use in multiple steps
    const item = await context.run('get-item', async () => {
      return itemModel.findById(db, itemId);
    });

    const result = await context.run('save-result', async () => {
      return resultModel.create(db, result);
    });
  },
  { flowControl: { ... } },
);
```

### 8. Testing

Create integration tests for workflows:

```typescript
describe('WorkflowName', () => {
  it('should process items successfully', async () => {
    // Setup test data
    const items = await createTestItems();

    // Trigger workflow
    await WorkflowClass.triggerProcessItems({ dryRun: false });

    // Wait for completion (use polling or webhook)
    await waitForCompletion();

    // Verify results
    const results = await getResults();
    expect(results).toHaveLength(items.length);
  });

  it('should support dryRun mode', async () => {
    const result = await WorkflowClass.triggerProcessItems({ dryRun: true });

    expect(result).toMatchObject({
      success: true,
      dryRun: true,
      totalEligible: expect.any(Number),
      toProcess: expect.any(Number),
    });
  });
});
```

---

## Examples

### Example 1: Welcome Placeholder

**Use Case**: Generate AI-powered welcome placeholders for users

**Structure**:

- Layer 1: `process-users` - Entry point, checks eligible users
- Layer 2: `paginate-users` - Paginates through active users
- Layer 3: `generate-user` - **Generates placeholders for ONE user**

**Core Patterns Demonstrated**:

1. **Dry-Run Mode**:

```typescript
// Layer 1: process-users
if (dryRun) {
  return {
    ...result,
    dryRun: true,
    message: `[DryRun] Would process ${usersNeedingGeneration.length} users`,
  };
}
```

2. **Fan-Out Pattern**:

```typescript
// Layer 2: paginate-users
if (userIds.length > CHUNK_SIZE) {
  const chunks = chunk(userIds, CHUNK_SIZE);
  await Promise.all(
    chunks.map((ids, idx) =>
      context.run(`welcome-placeholder:fanout:${idx + 1}/${chunks.length}`, () =>
        WelcomePlaceholderWorkflow.triggerPaginateUsers({ userIds: ids }),
      ),
    ),
  );
}
```

3. **Single Task Execution**:

```typescript
// Layer 3: generate-user
export const { POST } = serve<GenerateUserPlaceholderPayload>(async (context) => {
  const { userId } = context.requestPayload ?? {};

  // Execute for ONE user only
  const workflow = new WelcomePlaceholderWorkflow(db, userId);
  const placeholders = await context.run('generate', () => workflow.generate());

  return { success: true, userId, placeholdersCount: placeholders.length };
});
```

**Key Features**:

- ✅ Filters users who already have cached placeholders in Redis
- ✅ Supports `paidOnly` flag to process only subscribed users
- ✅ Supports `dryRun` mode for statistics
- ✅ Uses fan-out for large user batches (CHUNK_SIZE=20)
- ✅ Each execution processes exactly ONE user

**Files**:

- `/api/workflows/welcome-placeholder/process-users/route.ts`
- `/api/workflows/welcome-placeholder/paginate-users/route.ts`
- `/api/workflows/welcome-placeholder/generate-user/route.ts`
- `/server/workflows/welcomePlaceholder/index.ts`

### Example 2: Agent Welcome

**Use Case**: Generate welcome messages and open questions for AI agents

**Structure**:

- Layer 1: `process-agents` - Entry point, checks eligible agents
- Layer 2: `paginate-agents` - Paginates through active agents
- Layer 3: `generate-agent` - **Generates welcome data for ONE agent**

**Core Patterns Demonstrated**:

1. **Dry-Run Mode**:

```typescript
// Layer 1: process-agents
if (dryRun) {
  return {
    ...result,
    dryRun: true,
    message: `[DryRun] Would process ${agentsNeedingGeneration.length} agents`,
  };
}
```

2. **Fan-Out Pattern**: Same as welcome-placeholder

3. **Single Task Execution**:

```typescript
// Layer 3: generate-agent
export const { POST } = serve<GenerateAgentWelcomePayload>(async (context) => {
  const { agentId } = context.requestPayload ?? {};

  // Execute for ONE agent only
  const workflow = new AgentWelcomeWorkflow(db, agentId);
  const data = await context.run('generate', () => workflow.generate());

  return { success: true, agentId, data };
});
```

**Key Features**:

- ✅ Filters agents who already have cached data in Redis
- ✅ Supports `paidOnly` flag for subscribed users' agents only
- ✅ Supports `dryRun` mode for statistics
- ✅ Uses fan-out for large agent batches (CHUNK_SIZE=20)
- ✅ Each execution processes exactly ONE agent

**Files**:

- `/api/workflows/agent-welcome/process-agents/route.ts`
- `/api/workflows/agent-welcome/paginate-agents/route.ts`
- `/api/workflows/agent-welcome/generate-agent/route.ts`
- `/server/workflows/agentWelcome/index.ts`

---

## Key Takeaways from Examples

Both workflows follow the **exact same pattern**:

1. **Layer 1** (Entry Point):
   - Calculate statistics
   - Filter existing items
   - Support dry-run mode
   - Trigger pagination only if needed

2. **Layer 2** (Pagination):
   - Paginate with cursor (PAGE_SIZE=50)
   - Fan-out large batches (CHUNK_SIZE=20)
   - Trigger Layer 3 for each item
   - Recursively process all pages

3. **Layer 3** (Execution):
   - Process **ONE item** per execution
   - Perform business logic
   - Save results
   - Return success/failure

The only differences are:

- Entity type (users vs agents)
- Business logic (placeholder generation vs welcome generation)
- Data source (different database queries)

---

## Common Pitfalls

### ❌ Don't: Use context.run() without unique names

```typescript
// Bad: Same step name when processing multiple items
await Promise.all(items.map((item) => context.run('process', () => process(item))));
```

```typescript
// Good: Unique step names
await Promise.all(items.map((item) => context.run(`process:${item.id}`, () => process(item))));
```

### ❌ Don't: Forget to validate payload parameters

```typescript
// Bad: No validation
export const { POST } = serve<Payload>(async (context) => {
  const { itemId } = context.requestPayload ?? {};
  const result = await process(itemId); // May fail with undefined
});
```

```typescript
// Good: Validate early
export const { POST } = serve<Payload>(async (context) => {
  const { itemId } = context.requestPayload ?? {};

  if (!itemId) {
    return { success: false, error: 'Missing itemId' };
  }

  const result = await process(itemId);
});
```

### ❌ Don't: Skip filtering existing items

```typescript
// Bad: No filtering, may duplicate work
const allItems = await getAllItems();
await Promise.all(allItems.map((item) => triggerExecute(item)));
```

```typescript
// Good: Filter existing items first
const allItems = await getAllItems();
const itemsNeedingProcessing = await filterExisting(allItems);
await Promise.all(itemsNeedingProcessing.map((item) => triggerExecute(item)));
```

### ❌ Don't: Use inconsistent logging

```typescript
// Bad: Inconsistent prefixes and formats
console.log('Starting workflow');
log.info('Processing item:', itemId);
console.log(`Done with ${itemId}`);
```

```typescript
// Good: Consistent structured logging
console.log('[workflow:layer] Starting with payload:', payload);
console.log('[workflow:layer] Processing item:', { itemId });
console.log('[workflow:layer] Completed:', { itemId, result });
```

---

## Environment Variables Required

```bash
# Required for all workflows
APP_URL=https://your-app.com # Base URL for workflow endpoints
QSTASH_TOKEN=qstash_xxx      # QStash authentication token

# Optional (for custom QStash URL)
QSTASH_URL=https://custom-qstash.com # Custom QStash endpoint
```

---

## Checklist for New Workflows

### Planning Phase

- [ ] Identify entity to process (users, agents, items, etc.)
- [ ] Define business logic for single item execution
- [ ] Determine filtering logic (Redis cache, database state, etc.)

### Implementation Phase

- [ ] Define payload types with proper TypeScript interfaces
- [ ] Create workflow class with static trigger methods
- [ ] **Layer 1**: Implement entry point with **dry-run** support
- [ ] **Layer 1**: Add filtering logic to avoid duplicate work
- [ ] **Layer 2**: Implement pagination with **fan-out** logic
- [ ] **Layer 3**: Implement **single task execution** (ONE item per run)
- [ ] Configure appropriate flowControl for each layer
- [ ] Add consistent logging with workflow prefixes
- [ ] Validate all required payload parameters
- [ ] Use unique context.run() step names

### Quality & Deployment

- [ ] Return consistent response shapes
- [ ] Configure cloud deployment (see [Cloud Guide](./reference/cloud.md) if using lobehub-cloud)
- [ ] Write integration tests
- [ ] Test with dry-run mode first
- [ ] Test with small batch before full rollout

---

## Additional Resources

- [Upstash Workflow Documentation](https://upstash.com/docs/workflow)
- [QStash Documentation](https://upstash.com/docs/qstash)
- [Example Workflows in Codebase](<../../src/app/(backend)/api/workflows/>)
- [Workflow Classes](../../src/server/workflows/)
