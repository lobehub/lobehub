import { type AgentGroupDetail } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent/store';
import type { QueryRouter } from '@/store/agentGroup/initialState';
import { initialChatGroupState } from '@/store/agentGroup/initialState';
import { useAgentGroupStore } from '@/store/agentGroup/store';
import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import { resolveActiveConversationCoordinate } from './coordinate';
import { projectActiveConversationCoordinate } from './projectCoordinate';

describe('active conversation projection', () => {
  beforeEach(() => {
    useAgentStore.setState({ activeAgentId: 'agent-old' }, false);
    useAgentGroupStore.setState(initialChatGroupState, false);
    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agent-old',
        activeGroupId: undefined,
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

  it('projects a group route without clearing it as a non-conversation page', () => {
    const group: AgentGroupDetail = {
      agents: [],
      createdAt: new Date(),
      id: 'group-new',
      supervisorAgentId: 'supervisor-new',
      title: 'Group New',
      updatedAt: new Date(),
      userId: 'user-1',
    };
    useAgentGroupStore.setState({ groupMap: { [group.id]: group } }, false);
    const coordinate = resolveActiveConversationCoordinate({
      params: { gid: 'group-new', topicId: 'topic-new' },
      url: '/group/group-new/topic-new?thread=thread-new',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useChatStore.getState()).toMatchObject({
      activeAgentId: 'supervisor-new',
      activeGroupId: 'group-new',
      activeThreadId: 'thread-new',
      activeTopicId: 'topic-new',
    });
    expect(useAgentStore.getState().activeAgentId).toBe('supervisor-new');
    expect(useAgentGroupStore.getState().activeGroupId).toBe('group-new');
  });

  it('clears stale group scope when projecting an agent route', () => {
    const router: QueryRouter = { push: () => {} };
    useAgentGroupStore.setState({ activeGroupId: 'group-old', router }, false);
    useChatStore.setState({ activeGroupId: 'group-old' }, false);
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-new' },
      resolvedAgentId: 'agent-new',
      url: '/agent/agent-new/profile',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useAgentGroupStore.getState().activeGroupId).toBeUndefined();
    expect(useAgentGroupStore.getState().router).toBeUndefined();
    expect(useChatStore.getState().activeGroupId).toBeUndefined();
  });

  it('clears group scope when projecting an agent conversation', () => {
    useAgentGroupStore.setState({ activeGroupId: 'group-old' }, false);
    useChatStore.setState(
      {
        activeAgentId: 'agent-old',
        activeGroupId: 'group-old',
        activeThreadId: 'thread-old',
        activeTopicId: 'topic-old',
      },
      false,
    );
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-new', topicId: 'topic-new' },
      resolvedAgentId: 'agent-new',
      url: '/agent/agent-new/topic-new?thread=thread-new',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useChatStore.getState()).toMatchObject({
      activeAgentId: 'agent-new',
      activeGroupId: undefined,
      activeThreadId: 'thread-new',
      activeTopicId: 'topic-new',
    });
  });

  it('clears thread state when an agent profile follows a route-less tab', () => {
    useChatStore.setState(
      {
        activeAgentId: undefined,
        activeGroupId: undefined,
        activeThreadId: 'thread-old',
        activeTopicId: undefined,
      },
      false,
    );
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

  it('keeps the group scope on a group subpage', () => {
    useAgentGroupStore.setState(
      {
        groupMap: {
          'group-new': {
            agents: [],
            createdAt: new Date(),
            id: 'group-new',
            supervisorAgentId: 'supervisor-new',
            title: 'Group New',
            updatedAt: new Date(),
            userId: 'user-1',
          },
        },
      },
      false,
    );
    const coordinate = resolveActiveConversationCoordinate({
      params: { gid: 'group-new' },
      url: '/group/group-new/profile',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useChatStore.getState()).toMatchObject({
      activeAgentId: 'supervisor-new',
      activeGroupId: 'group-new',
      activeTopicId: null,
    });
  });

  it('clears a previous group conversation when opening another group subpage', () => {
    useChatStore.setState({ activeGroupId: 'group-old' }, false);
    useAgentGroupStore.setState({ activeGroupId: 'group-old' }, false);
    const coordinate = resolveActiveConversationCoordinate({
      params: { gid: 'group-new' },
      url: '/group/group-new/profile',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useChatStore.getState()).toMatchObject({
      activeGroupId: 'group-new',
      activeThreadId: undefined,
      activeTopicId: null,
    });
  });

  it('does not clear an active agent before the group supervisor hydrates', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { gid: 'group-new', topicId: 'topic-new' },
      url: '/group/group-new/topic-new?thread=thread-new',
    });

    projectActiveConversationCoordinate(coordinate);

    expect(useAgentStore.getState().activeAgentId).toBe('agent-old');
    expect(useChatStore.getState().activeAgentId).toBe('agent-old');
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
