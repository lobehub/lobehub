# Best Practices & Common Pitfalls

Apply these once your scaffold from `implementation.md` is in place.

## Table of Contents

1. [Error Handling](#1-error-handling)
2. [Logging](#2-logging)
3. [Return Values](#3-return-values)
4. [flowControl Configuration](#4-flowcontrol-configuration)
5. [context.run() Best Practices](#5-contextrun-best-practices)
6. [Payload Validation](#6-payload-validation)
7. [Database Connection](#7-database-connection)
8. [Testing](#8-testing)
9. [Common Pitfalls](#common-pitfalls)

---

## 1. Error Handling

```typescript
export const { POST } = serve<Payload>(
  async (context) => {
    const { itemId } = context.requestPayload ?? {};

    if (!itemId) {
      return { success: false, error: 'Missing itemId in payload' };
    }

    try {
      const result = await context.run('step-name', () => doWork(itemId));
      return { success: true, itemId, result };
    } catch (error) {
      console.error('[workflow:error]', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  { flowControl: { ... } },
);
```

## 2. Logging

Consistent prefixes make debugging much easier across QStash dashboards and grep:

```typescript
console.log('[{workflow}:{layer}] Starting with payload:', payload);
console.log('[{workflow}:{layer}] Processing items:', { count: items.length });
console.log('[{workflow}:{layer}] Completed:', result);
console.error('[{workflow}:{layer}:error]', error);
```

## 3. Return Values

Pick the shape that matches the layer's purpose — entry points return statistics, execution layers return per-item results.

```typescript
// Success
return { success: true, itemId, result, message: 'Optional success message' };

// Error
return { success: false, error: 'Error description', itemId };

// Statistics (entry point)
return {
  success: true,
  totalEligible: 100,
  toProcess: 80,
  alreadyProcessed: 20,
  dryRun: true, // if applicable
  message: 'Summary message',
};
```

## 4. flowControl Configuration

Tune concurrency by layer — entry points are singletons, execution layers fan out.

```typescript
// Layer 1: Entry — single instance to avoid duplicate processing
flowControl: { key: '{workflow}.process',  parallelism: 1,  ratePerSecond: 1 }

// Layer 2: Pagination — moderate concurrency
flowControl: { key: '{workflow}.paginate', parallelism: 20, ratePerSecond: 5 }

// Layer 3: Execution — higher concurrency for parallel item work
flowControl: { key: '{workflow}.execute',  parallelism: 10, ratePerSecond: 5 }
```

**Why these defaults:**

- **Layer 1** always uses `parallelism: 1` so concurrent triggers don't both start the same batch.
- **Layer 2** can fan out widely (10-20) since pagination is cheap.
- **Layer 3** caps at 5-10 by default; raise/lower based on external API rate limits.

## 5. context.run() Best Practices

- Use descriptive step names with prefixes: `{workflow}:step-name`
- Each step should be idempotent (safe to retry)
- Don't nest `context.run()` calls — keep them flat
- Use unique step names when processing multiple items:

```typescript
// ✅ Unique step names
await Promise.all(
  items.map((item) => context.run(`{workflow}:execute:${item.id}`, () => processItem(item))),
);

// ❌ Same step name — Upstash de-dupes by step name and you'll lose data
await Promise.all(items.map((item) => context.run(`{workflow}:execute`, () => processItem(item))));
```

## 6. Payload Validation

Validate at the top so failures are explicit, not silent `undefined` cascades:

```typescript
export const { POST } = serve<Payload>(
  async (context) => {
    const { itemId, configId } = context.requestPayload ?? {};

    if (!itemId)   return { success: false, error: 'Missing itemId in payload' };
    if (!configId) return { success: false, error: 'Missing configId in payload' };

    // Proceed with work...
  },
  { flowControl: { ... } },
);
```

## 7. Database Connection

Get the connection once per workflow — `getServerDB()` is async, repeating it inside each step adds latency:

```typescript
export const { POST } = serve<Payload>(
  async (context) => {
    const db = await getServerDB();

    const item = await context.run('get-item', () => itemModel.findById(db, itemId));
    const result = await context.run('save-result', () => resultModel.create(db, result));
  },
  { flowControl: { ... } },
);
```

## 8. Testing

Integration tests should exercise both the dry-run statistics path and the full execution path:

```typescript
describe('WorkflowName', () => {
  it('should process items successfully', async () => {
    const items = await createTestItems();
    await WorkflowClass.triggerProcessItems({ dryRun: false });
    await waitForCompletion();
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

## Common Pitfalls

### ❌ Reusing `context.run()` step names

```typescript
// Bad — Upstash dedupes by step name
await Promise.all(items.map((item) => context.run('process', () => process(item))));

// Good
await Promise.all(items.map((item) => context.run(`process:${item.id}`, () => process(item))));
```

### ❌ Skipping payload validation

```typescript
// Bad — undefined cascades into a confusing failure later
const { itemId } = context.requestPayload ?? {};
const result = await process(itemId);

// Good — fail fast with a clear error
if (!itemId) return { success: false, error: 'Missing itemId' };
```

### ❌ Skipping the filter step

```typescript
// Bad — duplicates work for items that were already processed
const allItems = await getAllItems();
await Promise.all(allItems.map((item) => triggerExecute(item)));

// Good — keeps the pipeline idempotent
const allItems = await getAllItems();
const itemsNeedingProcessing = await filterExisting(allItems);
await Promise.all(itemsNeedingProcessing.map((item) => triggerExecute(item)));
```

### ❌ Inconsistent logging

```typescript
// Bad — different prefixes, mixed formats
console.log('Starting workflow');
log.info('Processing item:', itemId);
console.log(`Done with ${itemId}`);

// Good — uniform prefix lets you grep by workflow+layer
console.log('[workflow:layer] Starting with payload:', payload);
console.log('[workflow:layer] Processing item:', { itemId });
console.log('[workflow:layer] Completed:', { itemId, result });
```
