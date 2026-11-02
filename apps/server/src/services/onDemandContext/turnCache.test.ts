import type { OnDemandRetrievalBatch } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { getOrLoadOnDemandRetrieval } from './turnCache';

const batch = (mode: OnDemandRetrievalBatch['mode']): OnDemandRetrievalBatch => ({
  candidates: [],
  durationMs: 1,
  mode,
});

describe('getOrLoadOnDemandRetrieval', () => {
  it('loads once for a user turn and reuses the batch across tool steps', async () => {
    const load = vi.fn().mockResolvedValue(batch('vector'));

    const first = await getOrLoadOnDemandRetrieval({
      currentUserMessage: 'deploy safely',
      load,
      messageId: 'user-message-1',
      messageIndex: 4,
    });
    const second = await getOrLoadOnDemandRetrieval({
      cache: first,
      currentUserMessage: 'deploy safely',
      load,
      messageId: 'user-message-1',
      messageIndex: 4,
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('re-retrieves for every new user message even when the text is identical', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(batch('vector'))
      .mockResolvedValueOnce(batch('lexical_fallback'));

    const first = await getOrLoadOnDemandRetrieval({
      currentUserMessage: 'same text',
      load,
      messageId: 'user-message-1',
      messageIndex: 2,
    });
    const second = await getOrLoadOnDemandRetrieval({
      cache: first,
      currentUserMessage: 'same text',
      load,
      messageId: 'user-message-2',
      messageIndex: 6,
    });

    expect(load).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(second.batch.mode).toBe('lexical_fallback');
  });
});
