# Implementation Patterns

Full code templates for the 3-layer architecture. Read this when actually writing workflow files.

## Table of Contents

1. [Workflow Class](#workflow-class) — `src/server/workflows/{workflowName}/index.ts`
2. [Layer 1: Entry Point](#layer-1-entry-point-process-) — `process-*` route
3. [Layer 2: Pagination](#layer-2-pagination-paginate-) — `paginate-*` route
4. [Layer 3: Execution](#layer-3-execution-execute--generate-) — `execute-*` / `generate-*` route

---

## Workflow Class

**Location:** `src/server/workflows/{workflowName}/index.ts`

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

const getWorkflowUrl = (path: string): string => {
  const baseUrl = process.env.APP_URL;
  if (!baseUrl) throw new Error('APP_URL is required to trigger workflows');
  return new URL(path, baseUrl).toString();
};

const getWorkflowClient = (): Client => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to trigger workflows');

  const config: ConstructorParameters<typeof Client>[0] = { token };
  if (process.env.QSTASH_URL) {
    (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  }
  return new Client(config);
};

export class {WorkflowName}Workflow {
  private static client: Client;

  private static getClient(): Client {
    if (!this.client) this.client = getWorkflowClient();
    return this.client;
  }

  static triggerProcessItems(payload: ProcessItemsPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.processItems);
    log('Triggering process-items workflow');
    return this.getClient().trigger({ body: payload, url });
  }

  static triggerPaginateItems(payload: PaginateItemsPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.paginateItems);
    log('Triggering paginate-items workflow');
    return this.getClient().trigger({ body: payload, url });
  }

  static triggerExecuteItem(payload: ExecuteItemPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.executeItem);
    log('Triggering execute-item workflow: %s', payload.itemId);
    return this.getClient().trigger({ body: payload, url });
  }

  /**
   * Filter items that need processing (e.g. check Redis cache, database state).
   * Return only the ones that actually need work — keeps the pipeline idempotent.
   */
  static async filterItemsNeedingProcessing(itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) return [];
    // Check existing state and return items that need processing
    return itemIds;
  }
}
```

---

## Layer 1: Entry Point (process-\*)

**Purpose:** Validates prerequisites, calculates statistics, supports dry-run mode.

```typescript
import { serve } from '@upstash/workflow/nextjs';
import { getServerDB } from '@/database/server';
import { WorkflowClass, type ProcessPayload } from '@/server/workflows/{workflowName}';

export const { POST } = serve<ProcessPayload>(
  async (context) => {
    const { dryRun, force } = context.requestPayload ?? {};

    console.log('[{workflow}:process] Starting with payload:', { dryRun, force });

    const allItemIds = await context.run('{workflow}:get-all-items', async () => {
      const db = await getServerDB();
      // Query database for eligible items
      return items.map((item) => item.id);
    });

    console.log('[{workflow}:process] Total eligible items:', allItemIds.length);

    if (allItemIds.length === 0) {
      return { success: true, totalEligible: 0, message: 'No eligible items found' };
    }

    const itemsNeedingProcessing = await context.run('{workflow}:filter-existing', () =>
      WorkflowClass.filterItemsNeedingProcessing(allItemIds),
    );

    const result = {
      success: true,
      totalEligible: allItemIds.length,
      toProcess: itemsNeedingProcessing.length,
      alreadyProcessed: allItemIds.length - itemsNeedingProcessing.length,
    };

    // Dry-run short-circuits before any side effects
    if (dryRun) {
      console.log('[{workflow}:process] Dry run mode, returning statistics only');
      return {
        ...result,
        dryRun: true,
        message: `[DryRun] Would process ${itemsNeedingProcessing.length} items`,
      };
    }

    if (itemsNeedingProcessing.length === 0) {
      return { ...result, message: 'All items already processed' };
    }

    await context.run('{workflow}:trigger-paginate', () => WorkflowClass.triggerPaginateItems({}));

    return {
      ...result,
      message: `Triggered pagination for ${itemsNeedingProcessing.length} items`,
    };
  },
  {
    flowControl: {
      key: '{workflow}.process',
      parallelism: 1, // single instance — avoids duplicate processing
      ratePerSecond: 1,
    },
  },
);
```

---

## Layer 2: Pagination (paginate-\*)

**Purpose:** Handles cursor-based pagination, implements fan-out for large batches.

```typescript
import { serve } from '@upstash/workflow/nextjs';
import { chunk } from 'es-toolkit/compat';
import { getServerDB } from '@/database/server';
import { WorkflowClass, type PaginatePayload } from '@/server/workflows/{workflowName}';

const PAGE_SIZE = 50;
const CHUNK_SIZE = 20;

export const { POST } = serve<PaginatePayload>(
  async (context) => {
    const { cursor, itemIds: payloadItemIds } = context.requestPayload ?? {};

    console.log('[{workflow}:paginate] Starting:', {
      cursor,
      itemIdsCount: payloadItemIds?.length ?? 0,
    });

    // If specific itemIds were passed in (from a fanout chunk), process them directly
    if (payloadItemIds && payloadItemIds.length > 0) {
      await Promise.all(
        payloadItemIds.map((itemId) =>
          context.run(`{workflow}:execute:${itemId}`, () =>
            WorkflowClass.triggerExecuteItem({ itemId }),
          ),
        ),
      );
      return { success: true, processedItems: payloadItemIds.length };
    }

    // Paginate through all items
    const itemBatch = await context.run('{workflow}:get-batch', async () => {
      const db = await getServerDB();
      const items = await db.query(...);
      if (!items.length) return { ids: [] };
      const last = items.at(-1);
      return {
        ids: items.map((item) => item.id),
        cursor: last ? last.id : undefined,
      };
    });

    const batchItemIds = itemBatch.ids;
    const nextCursor = 'cursor' in itemBatch ? itemBatch.cursor : undefined;

    if (batchItemIds.length === 0) {
      return { success: true, message: 'Pagination complete' };
    }

    const itemIds = await context.run('{workflow}:filter-existing', () =>
      WorkflowClass.filterItemsNeedingProcessing(batchItemIds),
    );

    if (itemIds.length > 0) {
      if (itemIds.length > CHUNK_SIZE) {
        // Fan out — recursively re-enter pagination with each chunk
        const chunks = chunk(itemIds, CHUNK_SIZE);
        console.log('[{workflow}:paginate] Fanout mode:', {
          chunks: chunks.length,
          chunkSize: CHUNK_SIZE,
        });

        await Promise.all(
          chunks.map((ids, idx) =>
            context.run(`{workflow}:fanout:${idx + 1}/${chunks.length}`, () =>
              WorkflowClass.triggerPaginateItems({ itemIds: ids }),
            ),
          ),
        );
      } else {
        // Process this page directly
        await Promise.all(
          itemIds.map((itemId) =>
            context.run(`{workflow}:execute:${itemId}`, () =>
              WorkflowClass.triggerExecuteItem({ itemId }),
            ),
          ),
        );
      }
    }

    // Tail-call into the next page
    if (nextCursor) {
      await context.run('{workflow}:next-page', () =>
        WorkflowClass.triggerPaginateItems({ cursor: nextCursor }),
      );
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

---

## Layer 3: Execution (execute-\* / generate-\*)

**Purpose:** Performs the actual business logic for exactly ONE item.

```typescript
import { serve } from '@upstash/workflow/nextjs';
import { getServerDB } from '@/database/server';
import { WorkflowClass, type ExecutePayload } from '@/server/workflows/{workflowName}';

export const { POST } = serve<ExecutePayload>(
  async (context) => {
    const { itemId } = context.requestPayload ?? {};

    if (!itemId) {
      return { success: false, error: 'Missing itemId' };
    }

    const db = await getServerDB();

    const item = await context.run('{workflow}:get-item', async () => {
      // Query database for item
      return item;
    });

    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    const result = await context.run('{workflow}:process-item', async () => {
      const workflow = new WorkflowClass(db, itemId);
      return workflow.generate(); // or process(), execute(), etc.
    });

    await context.run('{workflow}:save-result', async () => {
      const workflow = new WorkflowClass(db, itemId);
      return workflow.saveToRedis(result); // or saveToDatabase(), etc.
    });

    return { success: true, itemId, result };
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
