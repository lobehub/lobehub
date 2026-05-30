import { describe, expect, it, vi } from 'vitest';

import { processItemsConcurrent } from '../topicBatching';

describe('processItemsConcurrent', () => {
  it('should process all items', async () => {
    const processed: number[] = [];
    const results = await processItemsConcurrent(
      [1, 2, 3],
      async (item) => {
        processed.push(item);
      },
      { concurrency: 2 },
    );

    expect(processed).toHaveLength(3);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('should respect concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    await processItemsConcurrent(
      [1, 2, 3, 4],
      async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 50));
        running--;
      },
      { concurrency: 2 },
    );

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('should collect errors without stopping other items', async () => {
    const results = await processItemsConcurrent(
      ['ok1', 'fail', 'ok2'],
      async (item) => {
        if (item === 'fail') throw new Error('boom');
      },
      { concurrency: 1 },
    );

    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.success)).toHaveLength(2);
    expect(results.filter((r) => !r.success)).toHaveLength(1);
    expect(results.find((r) => !r.success)?.error).toBeInstanceOf(Error);
  });

  it('should throw on invalid concurrency', async () => {
    await expect(
      processItemsConcurrent([], async () => {}, { concurrency: 0 }),
    ).rejects.toThrow('concurrency must be greater than 0');
  });

  it('should handle empty items array', async () => {
    const results = await processItemsConcurrent([], async () => {}, { concurrency: 2 });
    expect(results).toHaveLength(0);
  });

  it('should pass correct index to handler', async () => {
    const indices: number[] = [];
    await processItemsConcurrent(
      ['a', 'b', 'c'],
      async (_, index) => {
        indices.push(index);
      },
      { concurrency: 1 },
    );

    expect(indices).toEqual([0, 1, 2]);
  });

  it('should maintain result order with concurrency=1', async () => {
    const results = await processItemsConcurrent(
      [1, 2, 3],
      async (item) => {
        if (item === 2) throw new Error('fail');
      },
      { concurrency: 1 },
    );

    expect(results.map((r) => r.item)).toEqual([1, 2, 3]);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
  });

  it('should handle all items failing', async () => {
    const results = await processItemsConcurrent(
      [1, 2, 3],
      async () => {
        throw new Error('fail');
      },
      { concurrency: 2 },
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.success)).toBe(true);
  });

  it('should handle concurrency=1 as sequential', async () => {
    const order: number[] = [];
    await processItemsConcurrent(
      [1, 2, 3],
      async (item) => {
        order.push(item);
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
      { concurrency: 1 },
    );

    expect(order).toEqual([1, 2, 3]);
  });

  it('should handle single item', async () => {
    const results = await processItemsConcurrent(
      ['only'],
      async () => {},
      { concurrency: 5 },
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].item).toBe('only');
  });
});
