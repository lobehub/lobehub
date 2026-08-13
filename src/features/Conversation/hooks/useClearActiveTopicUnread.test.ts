import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, useProjectionStore } from '@/projection';
import { useChatStore } from '@/store/chat';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

import { useClearActiveTopicUnread } from './useClearActiveTopicUnread';

const AGENT_ID = 'agent-1';
const TOPIC_ID = 'topic-1';

const seed = (status: 'unread' | 'active', activeTopicId: string | null = TOPIC_ID) => {
  useChatStore.setState({
    activeAgentId: AGENT_ID,
    activeGroupId: undefined,
    activeTopicId: activeTopicId as any,
  });
  getProjectionStoreState().commitChatTopicsPage(
    getCacheScope(),
    {
      containerKey: topicMapKey({ agentId: AGENT_ID }),
      context: { agentId: AGENT_ID },
      items: [{ id: TOPIC_ID, status, title: 't' } as any],
      page: 0,
      pageSize: 20,
      signature: {},
      surface: 'sidebar',
      total: 1,
    },
    { observedAt: 100, source: 'network' },
  );
};

describe('useClearActiveTopicUnread', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.setState({ activeTopicId: null as any });
    useProjectionStore.setState({ scopes: {} });
  });

  it('marks the active topic read when it hydrates as unread', () => {
    const markTopicRead = vi.fn();
    useChatStore.setState({ markTopicRead });
    seed('unread');

    renderHook(() => useClearActiveTopicUnread());

    expect(markTopicRead).toHaveBeenCalledWith({ topicId: TOPIC_ID });
  });

  it('does nothing when the active topic is already read', () => {
    const markTopicRead = vi.fn();
    useChatStore.setState({ markTopicRead });
    seed('active');

    renderHook(() => useClearActiveTopicUnread());

    expect(markTopicRead).not.toHaveBeenCalled();
  });

  it('clears once the topic list loads the unread topic after hydration', () => {
    const markTopicRead = vi.fn();
    // activeTopicId set first (route hydration), topic not loaded yet.
    useChatStore.setState({
      activeAgentId: AGENT_ID,
      activeTopicId: TOPIC_ID as any,
      markTopicRead,
    });

    const { rerender } = renderHook(() => useClearActiveTopicUnread());
    expect(markTopicRead).not.toHaveBeenCalled();

    // Topic list arrives with the topic persisted as unread.
    act(() => {
      seed('unread');
    });
    rerender();

    expect(markTopicRead).toHaveBeenCalledWith({ topicId: TOPIC_ID });
  });
});
