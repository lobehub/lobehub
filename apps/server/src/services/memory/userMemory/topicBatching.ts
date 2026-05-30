export const forEachBatchSequential = async <T>(
  items: T[],
  batchSize: number,
  handler: (batch: T[], batchIndex: number) => Promise<void>,
) => {
  if (batchSize <= 0) throw new Error('batchSize must be greater than 0');

  for (let start = 0, batchIndex = 0; start < items.length; start += batchSize, batchIndex += 1) {
    const batch = items.slice(start, start + batchSize);
    if (batch.length === 0) continue;
    // Sequential: wait for each batch before moving to the next
    await handler(batch, batchIndex);
  }
};

export interface ConcurrencyOptions {
  concurrency: number;
}

export interface ProcessItemResult<T> {
  error?: unknown;
  item: T;
  success: boolean;
}

/**
 * Process items concurrently with a bounded concurrency limit.
 * Items within each batch run in parallel up to `concurrency`.
 * All batches run sequentially to maintain back-pressure.
 */
export const processItemsConcurrent = async <T>(
  items: T[],
  handler: (item: T, index: number) => Promise<void>,
  options: ConcurrencyOptions,
): Promise<ProcessItemResult<T>[]> => {
  const { concurrency } = options;
  if (concurrency <= 0) throw new Error('concurrency must be greater than 0');

  const results: ProcessItemResult<T>[] = [];
  const semaphore = new Set<Promise<void>>();

  for (const [index, item] of items.entries()) {
    const task = (async () => {
      try {
        await handler(item, index);
        results.push({ item, success: true });
      } catch (error) {
        results.push({ error, item, success: false });
      }
    })();

    semaphore.add(task);
    task.finally(() => semaphore.delete(task));

    if (semaphore.size >= concurrency) {
      await Promise.race(semaphore);
    }
  }

  await Promise.all(semaphore);
  return results;
};
