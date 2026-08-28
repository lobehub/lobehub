/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import { useAgentConversationCoordinate } from './useAgentConversationCoordinate.desktop';

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

describe('useAgentConversationCoordinate (desktop)', () => {
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

  it('uses its own memory-router coordinate when the global pointer belongs to another tab', () => {
    const { result } = renderHook(() => useAgentConversationCoordinate());

    expect(result.current).toEqual(['agent-route', 'topic-route', 'thread-route']);
  });

  it('returns the blank conversation coordinate from the route without inheriting a global topic', () => {
    route.params = { aid: 'agent-route' };
    route.search = new URLSearchParams();

    const { result } = renderHook(() => useAgentConversationCoordinate());

    expect(result.current).toEqual(['agent-route', null, null]);
  });
});
