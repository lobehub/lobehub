import { describe, expect, it } from 'vitest';

import { buildActiveConversationUrl, resolveActiveConversationCoordinate } from './coordinate';

describe('active conversation coordinate', () => {
  it('resolves a workspace topic route and preserves unrelated URL state when changing topic', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-a', topicId: 'topic-a' },
      resolvedAgentId: 'agent-a',
      url: '/team/agent/agent-a/topic-a?thread=thread-a&mode=single#message-a',
    });

    expect(coordinate).toMatchObject({
      agentBasePath: '/team/agent/agent-a',
      agentId: 'agent-a',
      isConversation: true,
      routeAgentId: 'agent-a',
      threadId: 'thread-a',
      topicId: 'topic-a',
    });
    expect(buildActiveConversationUrl(coordinate, 'topic-b', null)).toBe(
      '/team/agent/agent-a/topic-b?mode=single#message-a',
    );
  });

  it('does not interpret an agent subpage as a conversation route', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'agent-a' },
      resolvedAgentId: 'agent-a',
      url: '/agent/agent-a/profile?thread=stale',
    });

    expect(coordinate.isConversation).toBe(false);
    expect(coordinate.topicId).toBeNull();
    expect(coordinate.threadId).toBeNull();
  });

  it('resolves group routes and keeps subsequent topic navigation in the group route', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { gid: 'group-a', topicId: 'topic-a' },
      url: '/team/group/group-a/topic-a?thread=thread-a',
    });

    expect(coordinate).toMatchObject({
      groupBasePath: '/team/group/group-a',
      groupId: 'group-a',
      isConversation: true,
      threadId: 'thread-a',
      topicId: 'topic-a',
    });
    expect(buildActiveConversationUrl(coordinate, 'topic-b', null)).toBe(
      '/team/group/group-a/topic-b',
    );
  });

  it('keeps the resolved agent id on an agent subpage', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'friendly-name' },
      resolvedAgentId: 'agt_persisted',
      url: '/agent/friendly-name/profile',
    });

    expect(coordinate).toMatchObject({
      agentId: 'agt_persisted',
      isConversation: false,
      routeAgentId: 'friendly-name',
    });
  });

  it('retains the group id on a group subpage', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { gid: 'group-a' },
      url: '/group/group-a/profile',
    });

    expect(coordinate).toMatchObject({
      groupId: 'group-a',
      isConversation: false,
    });
  });

  it('does not treat an agent named group as a group route', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: { aid: 'group', topicId: 'topic-a' },
      url: '/agent/group/topic-a',
    });

    expect(coordinate.groupBasePath).toBeUndefined();
    expect(buildActiveConversationUrl(coordinate, 'topic-b', null)).toBe('/agent/group/topic-b');
  });

  it('ignores non-agent routes even when another segment is named agent', () => {
    const coordinate = resolveActiveConversationCoordinate({
      params: {},
      url: '/community/agent/example',
    });

    expect(coordinate.routeAgentId).toBeUndefined();
    expect(coordinate.isConversation).toBe(false);
  });
});
