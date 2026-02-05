import { describe, expect, it, vi } from 'vitest';

import { forEachBatchSequential } from '../topicBatching';

describe('forEachBatchSequential', () => {
  it('processes batches sequentially with the given size', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await forEachBatchSequential([1, 2, 3, 4, 5], 2, handler);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, [1, 2], 0);
    expect(handler).toHaveBeenNthCalledWith(2, [3, 4], 1);
    expect(handler).toHaveBeenNthCalledWith(3, [5], 2);
  });

  it('throws when batch size is not positive', async () => {
    await expect(
      forEachBatchSequential([1, 2, 3], 0, async () => {}),
    ).rejects.toThrowError('batchSize must be greater than 0');
  });
});
