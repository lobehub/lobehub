import { describe, expect, it, vi } from 'vitest';

import { backfillTopicPages } from './pagination';

describe('backfillTopicPages', () => {
  it('uses the configured topic page size to fill the viewport', async () => {
    const loadMore = vi.fn().mockResolvedValue(undefined);

    await backfillTopicPages({
      canLoadMore: () => true,
      count: 0,
      itemsNeeded: 31,
      loadMore,
      pageSize: 10,
    });

    expect(loadMore).toHaveBeenCalledTimes(4);
  });

  it('stops loading when the latest topic state is exhausted', async () => {
    let hasMore = true;
    const loadMore = vi.fn(async () => {
      if (loadMore.mock.calls.length === 2) hasMore = false;
    });

    await backfillTopicPages({
      canLoadMore: () => hasMore,
      count: 0,
      itemsNeeded: 50,
      loadMore,
      pageSize: 10,
    });

    expect(loadMore).toHaveBeenCalledTimes(2);
  });
});
