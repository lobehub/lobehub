import { act, renderHook } from '@testing-library/react';
import { type Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RoundCursorPage from '@/services/message/roundCursorPage';
import { readMessagesByRoundCursorBatch } from '@/services/message/roundCursorPage';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useChatStore } from '../../store';

vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
    useClientDataSWRWithSync: vi.fn(),
  };
});

// Keep the real priming helpers: the point under test is that the batched page
// reaches each topic's own head read through them.
vi.mock('@/services/message/roundCursorPage', async (importOriginal) => {
  const actual = await importOriginal<typeof RoundCursorPage>();
  return { ...actual, readMessagesByRoundCursorBatch: vi.fn() };
});

const batchRead = readMessagesByRoundCursorBatch as Mock;

describe('prefetchTopicMessagesBatch', () => {
  beforeEach(() => {
    useChatStore.setState({ dbMessagesMap: {}, messagesMap: {} });
    batchRead.mockReset();
  });

  it('warms every visible topic from one batched read', async () => {
    const { result } = renderHook(() => useChatStore());
    const topicIds = ['batch-topic-a', 'batch-topic-b'];

    batchRead.mockResolvedValue(
      new Map(
        topicIds.map((topicId) => [
          topicId,
          { messages: [{ id: `msg-${topicId}`, role: 'user', content: topicId }] },
        ]),
      ),
    );

    await act(async () => {
      await result.current.prefetchTopicMessagesBatch({ agentId: 'batch-agent', topicIds });
    });

    expect(batchRead).toHaveBeenCalledTimes(1);
    expect(batchRead.mock.calls[0][0].map((item: { topicId: string }) => item.topicId)).toEqual(
      topicIds,
    );

    for (const topicId of topicIds) {
      const key = messageMapKey({ agentId: 'batch-agent', topicId });
      expect(result.current.dbMessagesMap[key]?.map((message) => message.id)).toEqual([
        `msg-${topicId}`,
      ]);
    }
  });

  it('leaves a topic alone once its transcript is already loaded', async () => {
    const { result } = renderHook(() => useChatStore());
    const topicIds = ['warm-topic'];

    batchRead.mockResolvedValue(
      new Map([['warm-topic', { messages: [{ id: 'msg-warm', role: 'user', content: 'hi' }] }]]),
    );

    await act(async () => {
      await result.current.prefetchTopicMessagesBatch({ agentId: 'batch-agent', topicIds });
    });
    batchRead.mockClear();

    await act(async () => {
      await result.current.prefetchTopicMessagesBatch({ agentId: 'batch-agent', topicIds });
    });

    // "Visible AND nothing local": the second pass has rows to paint already.
    expect(batchRead).not.toHaveBeenCalled();
  });

  it('does nothing without an agent scope', async () => {
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.prefetchTopicMessagesBatch({ agentId: null, topicIds: ['a'] });
    });

    expect(batchRead).not.toHaveBeenCalled();
  });
});
