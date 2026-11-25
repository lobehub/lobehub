import { describe, expect, it, vi } from 'vitest';

import { type ChatStore } from '@/store/chat/store';

import { settleExistingTopicAfterSend } from './existingTopicAfterSend';

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: any) => state.topics[id],
  },
}));

const store = (metadata?: Record<string, unknown>, projectId?: string) => {
  const state = {
    internal_dispatchTopic: vi.fn(),
    refreshTopic: vi.fn().mockResolvedValue(undefined),
    topics: { 'topic-1': { id: 'topic-1', metadata, projectId } },
  };
  return { get: () => state as unknown as ChatStore, state };
};

describe('settleExistingTopicAfterSend', () => {
  it('bumps the sort key without refetching an ordinary topic', () => {
    const { get, state } = store({});

    settleExistingTopicAfterSend(get, 'topic-1');

    expect(state.internal_dispatchTopic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'topic-1', type: 'updateTopic' }),
    );
    expect(state.refreshTopic).not.toHaveBeenCalled();
  });

  it('refetches a project conversation, whose runner may move as this turn starts', () => {
    const { get, state } = store({}, 'project-1');

    settleExistingTopicAfterSend(get, 'topic-1');

    expect(state.refreshTopic).toHaveBeenCalled();
  });

  it('refetches a topic whose runner switch the server applies on this turn', () => {
    const { get, state } = store({ pendingProjectWorkingDirectoryId: 'dir-2' });

    settleExistingTopicAfterSend(get, 'topic-1');

    expect(state.refreshTopic).toHaveBeenCalled();
  });
});
