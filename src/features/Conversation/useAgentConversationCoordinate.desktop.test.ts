/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { useAgentConversationCoordinate } from './useAgentConversationCoordinate.desktop';

const route = vi.hoisted(() => ({
  params: { aid: 'agent-route', topicId: 'topic-route' } as {
    aid?: string;
    projectId?: string;
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

  it('resolves the agent from the project topic on project conversation routes', () => {
    route.params = { projectId: 'prj_1', topicId: 'tpc_1' };
    route.search = new URLSearchParams();
    useProjectDirectoryStore.setState(
      {
        projectTopicsMap: {
          prj_1: [{ agentId: 'agent-of-topic', id: 'tpc_1' } as never],
        },
      },
      false,
    );

    const { result } = renderHook(() => useAgentConversationCoordinate());

    expect(result.current).toEqual(['agent-of-topic', 'tpc_1', null]);
  });

  it('keeps agent undefined for an unknown project topic instead of falling back to the global pointer', () => {
    route.params = { projectId: 'prj_1', topicId: 'tpc_unknown' };
    route.search = new URLSearchParams();

    const { result } = renderHook(() => useAgentConversationCoordinate());

    expect(result.current).toEqual([undefined, 'tpc_unknown', null]);
  });
});
