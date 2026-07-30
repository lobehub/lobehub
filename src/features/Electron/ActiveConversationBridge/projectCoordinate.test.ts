import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent/store';
import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import { resolveActiveConversationCoordinate } from './coordinate';
import { projectActiveConversationCoordinate } from './projectCoordinate';

describe('active conversation projection', () => {
  beforeEach(() => {
    useAgentStore.setState({ activeAgentId: 'agent-old' }, false);
    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agent-old',
        activeThreadId: 'thread-old',
        activeTopicId: 'topic-old',
      },
      false,
    );
  });

  it('projects the active tab route into both global stores as one conversation coordinate', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-new', topicId: 'topic-new' },
      resolvedAgentId: 'agent-new',
      url: '/agent/agent-new/topic-new?thread=thread-new',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useAgentStore.getState().activeAgentId).toBe('agent-new');
    expect(useChatStore.getState()).toMatchObject({
      activeAgentId: 'agent-new',
      activeThreadId: 'thread-new',
      activeTopicId: 'topic-new',
    });
  });

  it('preserves topic state on a subpage of the same agent', () => {
    useAgentStore.setState({ activeAgentId: 'agent-old' }, false);
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-old' },
      resolvedAgentId: 'agent-old',
      url: '/agent/agent-old/profile',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useChatStore.getState()).toMatchObject({
      activeAgentId: 'agent-old',
      activeThreadId: 'thread-old',
      activeTopicId: 'topic-old',
    });
  });

  it('clears stale conversation state when a different agent subpage becomes active', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-new' },
      resolvedAgentId: 'agent-new',
      url: '/agent/agent-new/profile',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useChatStore.getState()).toMatchObject({
      activeAgentId: 'agent-new',
      activeThreadId: undefined,
      activeTopicId: null,
    });
  });
});
