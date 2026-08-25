/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import { useAgentConversationCoordinate } from './useAgentConversationCoordinate';

const route = vi.hoisted(() => ({
  params: { aid: 'agent-route', topicId: 'topic-route' } as {
    aid?: string;
    topicId?: string;
  },
  search: new URLSearchParams('thread=thread-route'),
}));

vi.mock('react-router', () => ({
  useParams: () => route.params,
  useSearchParams: () => [route.search, vi.fn()],
}));

describe('useAgentConversationCoordinate', () => {
  beforeEach(() => {
    route.params = { aid: 'agent-route', topicId: 'topic-route' };
    route.search = new URLSearchParams('thread=thread-route');
    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agent-global',
        activeThreadId: 'thread-global',
        activeTopicId: 'topic-global',
      },
      false,
    );
  });

  it('uses the route coordinate before the global chat pointer catches up', () => {
    const { result } = renderHook(() => useAgentConversationCoordinate());

    expect(result.current).toEqual(['agent-route', 'topic-route', 'thread-route']);
  });

  it('does not inherit the previous global topic for a blank conversation route', () => {
    route.params = { aid: 'agent-route' };
    route.search = new URLSearchParams();

    const { result } = renderHook(() => useAgentConversationCoordinate());

    expect(result.current).toEqual(['agent-route', null, null]);
  });
});
