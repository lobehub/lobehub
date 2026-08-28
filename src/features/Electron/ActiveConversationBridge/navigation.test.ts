import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import { resolveActiveConversationCoordinate } from './coordinate';
import { subscribeActiveConversationNavigation } from './navigation';
import { projectActiveConversationCoordinate } from './projectCoordinate';

vi.mock('@/features/Electron/navigation/appNavigate', () => ({ appNavigate: vi.fn() }));

describe('active conversation navigation', () => {
  beforeEach(() => {
    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agent-a',
        activeThreadId: 'thread-a',
        activeTopicId: 'topic-a',
      },
      false,
    );
  });

  it('turns one atomic topic and thread store change into one active-tab navigation', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-a', topicId: 'topic-a' },
      resolvedAgentId: 'agent-a',
      url: '/team/agent/agent-a/topic-a?thread=thread-a&mode=single',
    });
    const navigate = vi.fn();
    projectActiveConversationCoordinate(coordinate);
    const unsubscribe = subscribeActiveConversationNavigation(() => coordinate, navigate);

    useChatStore.setState({ activeThreadId: undefined, activeTopicId: 'topic-b' }, false);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/team/agent/agent-a/topic-b?mode=single', {
      replace: true,
    });
    unsubscribe();
  });

  it('restores the routed topic after a scoped store reset without navigating', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-a', topicId: 'topic-a' },
      resolvedAgentId: 'agent-a',
      url: '/agent/agent-a/topic-a',
    });
    const navigate = vi.fn();
    projectActiveConversationCoordinate(coordinate);
    const unsubscribe = subscribeActiveConversationNavigation(() => coordinate, navigate);

    useChatStore.setState({ activeTopicId: undefined }, false);

    expect(useChatStore.getState().activeTopicId).toBe('topic-a');
    expect(navigate).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not convert a global topic change into navigation from an agent subpage', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-a' },
      resolvedAgentId: 'agent-a',
      url: '/agent/agent-a/profile',
    });
    const navigate = vi.fn();
    const unsubscribe = subscribeActiveConversationNavigation(() => coordinate, navigate);

    useChatStore.setState({ activeTopicId: 'topic-b' }, false);

    expect(navigate).not.toHaveBeenCalled();
    unsubscribe();
  });
});
